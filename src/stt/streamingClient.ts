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
  private silenceTimeout: NodeJS.Timeout | null = null;
  private partialTimeout: NodeJS.Timeout | null = null;
  private minSilenceMs: number = 1000; // 1 second of silence before finalizing

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
    this.emit('connected');
  }

  /**
   * Send audio chunk for transcription.
   * Accumulates chunks and processes them periodically.
   */
  sendAudioChunk(chunk: Buffer): void {
    if (!this.isConnected) {
      throw new Error('Not connected. Call connect() first.');
    }

    this.audioBuffer.push(chunk);
    this.lastChunkTime = Date.now();

    // Clear existing silence timeout and restart it
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
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

    // Reset silence detection timer
    this.checkSilence();
  }

  /**
   * Check if silence has been detected and finalize if needed.
   * This is called after each audio chunk - if no new chunks arrive for minSilenceMs,
   * we finalize the transcription.
   */
  private checkSilence(): void {
    // Clear existing silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    // Set new silence timeout - if no chunks arrive for minSilenceMs, finalize
    this.silenceTimeout = setTimeout(() => {
      if (this.audioBuffer.length > 0 && this.isConnected) {
        // Process final audio after silence
        this.processBufferedAudio(true);
      }
    }, this.minSilenceMs);
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

      if (result && result.trim()) {
        const partial: PartialTranscript = {
          text: result,
          isFinal,
          timestamp: Date.now(),
        };

        if (isFinal) {
          this.emit('final', partial);
          this.audioBuffer = []; // Clear buffer after final
        } else {
          this.emit('partial', partial);
          // Clear buffer after partial - new chunks will accumulate fresh
          // Note: In a true streaming API, partials would be incremental
          // For now with batch API, we clear to avoid reprocessing same audio
          this.audioBuffer = [];
        }
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

    // Handle response format
    if (result.text) {
      return result.text.trim();
    } else if (result.transcripts && result.transcripts.channel_0) {
      return result.transcripts.channel_0.trim();
    } else {
      throw new Error(`Unexpected API response format: ${JSON.stringify(result)}`);
    }
  }

  /**
   * Set minimum silence duration before finalizing (in milliseconds).
   */
  setSilenceTimeout(ms: number): void {
    this.minSilenceMs = ms;
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
