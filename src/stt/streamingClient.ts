import { EventEmitter } from 'events';
import { getElevenLabsApiKey } from '../voice/elevenlabs.js';

export interface StreamingSTTOptions {
  sampleRate?: number;
  modelId?: string;
  languageCode?: string;
}

export interface PartialTranscript {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

/**
 * Streaming Speech-to-Text client.
 * Currently supports batch mode with chunked uploads (simulated streaming).
 * Can be extended to support WebSocket-based streaming when ElevenLabs adds support.
 */
export class StreamingSTTClient extends EventEmitter {
  private apiKey: string;
  private sampleRate: number;
  private modelId: string;
  private languageCode: string;
  private isConnected = false;
  private audioBuffer: Buffer[] = [];
  private lastChunkTime: number = 0;
  private lastSpeechTime: number = 0; // Track when speech was last detected
  private silenceTimeout: NodeJS.Timeout | null = null;
  private partialTimeout: NodeJS.Timeout | null = null;
  private minSilenceMs: number = 3000; // 3 seconds of silence before finalizing
  private speechEnergyThreshold: number = 800; // RMS energy threshold for speech detection (increased to filter noise)

  constructor(options: StreamingSTTOptions = {}) {
    super();
    
    try {
      this.apiKey = getElevenLabsApiKey();
    } catch (error) {
      throw new Error('ELEVENLABS_API_KEY not set. Cannot use streaming STT.');
    }

    this.sampleRate = options.sampleRate || 16000;
    this.modelId = options.modelId || 'scribe_v1';
    this.languageCode = options.languageCode || 'en';
  }

  /**
   * Connect to streaming STT service.
   * For now, this is a no-op but prepares for WebSocket implementation.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    this.isConnected = true;
    this.audioBuffer = [];
    this.lastChunkTime = Date.now();
    this.lastSpeechTime = Date.now(); // Initialize to current time
    this.emit('connected');
  }

  /**
   * Calculate RMS (Root Mean Square) energy of audio chunk to detect speech.
   * Returns energy level - higher values indicate louder audio (likely speech).
   * 
   * @param chunk - PCM16 audio chunk (16-bit signed integers)
   * @returns RMS energy value
   */
  private calculateChunkEnergy(chunk: Buffer): number {
    if (chunk.length < 2) {
      return 0;
    }

    // PCM16: 2 bytes per sample, signed 16-bit integers
    let sumSquares = 0;
    const sampleCount = Math.floor(chunk.length / 2);

    for (let i = 0; i < chunk.length - 1; i += 2) {
      // Read 16-bit signed integer (little-endian)
      const sample = chunk.readInt16LE(i);
      sumSquares += sample * sample;
    }

    // Calculate RMS: sqrt(average of squares)
    const rms = Math.sqrt(sumSquares / sampleCount);
    return rms;
  }

  /**
   * Detect if audio chunk contains speech based on energy level.
   * 
   * @param chunk - PCM16 audio chunk
   * @returns true if chunk likely contains speech
   */
  private isSpeech(chunk: Buffer): boolean {
    const energy = this.calculateChunkEnergy(chunk);
    return energy > this.speechEnergyThreshold;
  }

  /**
   * Send audio chunk for transcription.
   * Accumulates chunks and processes them periodically.
   * Only resets silence timer if chunk contains actual speech.
   */
  sendAudioChunk(chunk: Buffer): void {
    if (!this.isConnected) {
      throw new Error('Not connected. Call connect() first.');
    }

    this.audioBuffer.push(chunk);
    this.lastChunkTime = Date.now();

    // Only reset silence timer if this chunk contains speech (not just noise)
    const hasSpeech = this.isSpeech(chunk);
    if (hasSpeech) {
      this.lastSpeechTime = Date.now();
    }

    // Clear partial processing timeout if it exists
    if (this.partialTimeout) {
      clearTimeout(this.partialTimeout);
    }

    // Process chunks in batches (every ~500ms) for partial updates
    // In a real WebSocket streaming implementation, this would send immediately
    this.partialTimeout = setTimeout(() => {
      if (this.audioBuffer.length > 0 && this.isConnected) {
        this.processBufferedAudio(false); // Not final yet
      }
    }, 500);

    // Reset silence detection timer only if speech was detected
    if (hasSpeech) {
      this.checkSilence();
    } else {
      // If no speech, check if we should finalize based on time since last speech
      this.checkSilenceAfterNoise();
    }
  }

  /**
   * Check if silence has been detected and finalize if needed.
   * This is called after speech is detected - if no speech is detected for minSilenceMs,
   * we finalize the transcription.
   */
  private checkSilence(): void {
    // Clear existing silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    // Set new silence timeout - if no speech is detected for minSilenceMs, finalize
    this.silenceTimeout = setTimeout(() => {
      // Double-check: has it been minSilenceMs since last speech?
      const timeSinceLastSpeech = Date.now() - this.lastSpeechTime;
      if (timeSinceLastSpeech >= this.minSilenceMs && this.audioBuffer.length > 0 && this.isConnected) {
        // Process final audio after speech silence
        this.processBufferedAudio(true);
      }
    }, this.minSilenceMs);
  }

  /**
   * Check if we should finalize when receiving non-speech chunks.
   * If it's been minSilenceMs since last speech, finalize even if chunks keep coming.
   */
  private checkSilenceAfterNoise(): void {
    // If we haven't received speech recently, check if we should finalize
    const timeSinceLastSpeech = Date.now() - this.lastSpeechTime;
    
    if (timeSinceLastSpeech >= this.minSilenceMs && this.audioBuffer.length > 0 && this.isConnected) {
      // Clear existing timeout
      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
      
      // Finalize immediately - no speech detected for minSilenceMs
      this.processBufferedAudio(true);
    }
  }

  /**
   * Process accumulated audio chunks.
   * For now, uses batch API as a fallback until WebSocket streaming is available.
   */
  private async processBufferedAudio(isFinal = false): Promise<void> {
    if (this.audioBuffer.length === 0) {
      return;
    }

    try {
      // Combine chunks into a single buffer
      const combinedBuffer = Buffer.concat(this.audioBuffer);

      // If this is not final, send as partial
      // For now, we'll simulate partial results by processing in chunks
      if (!isFinal && combinedBuffer.length < 32000) {
        // Buffer more before processing
        return;
      }

      // Convert PCM to WAV format for ElevenLabs API
      const wavBuffer = this.pcmToWav(combinedBuffer);

      // Use batch API for now (WebSocket can be added later)
      const result = await this.transcribeBatch(wavBuffer);

      // For partial results, only emit if we have non-empty text
      // For final results, always emit (even with empty text) so finalize() resolves
      const hasText = result && result.trim();
      
      if (isFinal) {
        // Always emit final event (even with empty text) so finalize() resolves
        const partial: PartialTranscript = {
          text: result || '', // Empty string is valid (no speech detected)
          isFinal: true,
          timestamp: Date.now(),
        };
        this.emit('final', partial);
        this.audioBuffer = []; // Clear buffer after final
      } else if (hasText) {
        // Only emit partial events if we have actual text
        const partial: PartialTranscript = {
          text: result,
          isFinal: false,
          timestamp: Date.now(),
        };
        this.emit('partial', partial);
        // Clear buffer after partial - new chunks will accumulate fresh
        // Note: In a true streaming API, partials would be incremental
        // For now with batch API, we clear to avoid reprocessing same audio
        this.audioBuffer = [];
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Convert PCM16 buffer to WAV format.
   */
  private pcmToWav(pcmBuffer: Buffer): Buffer {
    const wavHeader = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;
    const fileLength = dataLength + 36;

    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(fileLength, 4);
    wavHeader.write('WAVE', 8);

    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // fmt chunk size
    wavHeader.writeUInt16LE(1, 20); // audio format (1 = PCM)
    wavHeader.writeUInt16LE(1, 22); // channels (mono)
    wavHeader.writeUInt32LE(this.sampleRate, 24); // sample rate
    wavHeader.writeUInt32LE(this.sampleRate * 2, 28); // byte rate
    wavHeader.writeUInt16LE(2, 32); // block align
    wavHeader.writeUInt16LE(16, 34); // bits per sample

    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataLength, 40);

    return Buffer.concat([wavHeader, pcmBuffer]);
  }

  /**
   * Transcribe audio using batch API (fallback for now).
   */
  private async transcribeBatch(wavBuffer: Buffer): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model_id', this.modelId);
    formData.append('language_code', this.languageCode);
    formData.append('webhook', 'false');

    const { elevenFetch } = await import('../voice/elevenlabs.js');
    const response = await elevenFetch('/speech-to-text', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs STT API error: ${response.status} ${response.statusText}. ` +
        `Response: ${errorText}`
      );
    }

    const result = await response.json();

    // Handle response format - empty text is valid (no speech detected)
    // Format can be: {text: "", ...} or {text: "transcription", ...} or {transcripts: {channel_0: "..."}}
    if (result.text !== undefined) {
      // text can be empty string "" for no speech - that's valid
      return result.text.trim();
    } else if (result.transcripts && result.transcripts.channel_0) {
      return result.transcripts.channel_0.trim();
    } else {
      // If no text field and no transcripts, return empty string (no speech detected)
      // Don't throw error for empty responses - that's valid behavior
      return '';
    }
  }

  /**
   * Set minimum silence duration before finalizing (in milliseconds).
   * This is the duration of no speech (not just no audio chunks).
   */
  setSilenceTimeout(ms: number): void {
    this.minSilenceMs = ms;
  }

  /**
   * Set speech energy threshold for voice activity detection.
   * Lower values = more sensitive (may detect noise as speech)
   * Higher values = less sensitive (may miss quiet speech)
   * Default: 500 (good for most environments)
   * 
   * @param threshold - RMS energy threshold (default: 500)
   */
  setSpeechThreshold(threshold: number): void {
    this.speechEnergyThreshold = threshold;
  }

  /**
   * Finalize current transcription and return final result.
   */
  async finalize(): Promise<string> {
    if (this.audioBuffer.length === 0) {
      return '';
    }

    // Process final audio
    await this.processBufferedAudio(true);

    return new Promise((resolve, reject) => {
      this.once('final', (partial: PartialTranscript) => {
        resolve(partial.text);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Finalization timeout'));
      }, 5000);
    });
  }

  /**
   * Close connection and cleanup.
   */
  close(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    if (this.partialTimeout) {
      clearTimeout(this.partialTimeout);
      this.partialTimeout = null;
    }

    this.isConnected = false;
    this.audioBuffer = [];
    this.emit('close');
  }
}
