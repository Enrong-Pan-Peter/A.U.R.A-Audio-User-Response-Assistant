/**
 * Real-time Text-to-Speech using ElevenLabs WebSocket streaming API
 */

import WebSocket from 'ws';
import { getRealtimeTTSWebSocketUrl, getElevenLabsWebSocketHeaders, getElevenLabsApiKey } from './elevenlabs.js';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Speaker package - optional, will be lazy-loaded
// Note: Speaker package requires native bindings to be built
// If speaker fails, we'll use batch TTS fallback
let SpeakerModule: any = null;

export interface RealtimeTTSConfig {
  voiceId?: string;
  modelId?: string;
  onAudioChunk?: (chunk: Buffer) => void;
  onError?: (error: Error) => void;
  enablePlayback?: boolean; // Whether to play audio automatically
}

export class RealtimeTTSConnection {
  private ws: WebSocket | null = null;
  private config: RealtimeTTSConfig;
  private speaker: any = null;
  private isConnected = false;
  private isProcessing = false;
  private audioChunks: Buffer[] = [];
  private tempAudioFile: string | null = null;

  constructor(config: RealtimeTTSConfig = {}) {
    const defaultVoiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel default
    // Apply config first, then set defaults for undefined values
    this.config = {
      ...config,
      voiceId: config.voiceId || process.env.ELEVENLABS_VOICE_ID || defaultVoiceId,
      modelId: config.modelId || 'eleven_turbo_v2_5', // Use turbo model for real-time TTS
      enablePlayback: config.enablePlayback !== false, // Default to true
    };

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_tts.ts:41',message:'TTS connection config initialized',data:{voiceId:this.config.voiceId,hasVoiceId:!!this.config.voiceId,envVoiceId:process.env.ELEVENLABS_VOICE_ID},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'J'})}).catch(()=>{});
    // #endregion

    // Speaker will be initialized lazily when needed
  }

  /**
   * Initializes speaker if available and enabled.
   * Returns true if speaker is available, false otherwise.
   */
  private async initSpeaker(): Promise<boolean> {
    if (this.speaker !== null) {
      return this.speaker !== undefined;
    }

    if (!this.config.enablePlayback) {
      this.speaker = undefined;
      return false;
    }

    try {
      // Lazy-load speaker module
      if (!SpeakerModule) {
        // @ts-ignore - speaker doesn't have TypeScript types
        SpeakerModule = (await import('speaker')).default;
      }
      
      // Initialize speaker for audio playback (PCM format)
      this.speaker = new SpeakerModule({
        channels: 1,
        bitDepth: 16,
        sampleRate: 24000, // ElevenLabs typical sample rate
      });
      return true;
    } catch (err) {
      // Speaker not available or initialization failed
      this.speaker = undefined;
      return false;
    }
  }

  /**
   * Establishes WebSocket connection to ElevenLabs real-time TTS API.
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.ws) {
      return;
    }

    try {
      getElevenLabsApiKey(); // Validate API key exists
    } catch (error) {
      throw new Error('ELEVENLABS_API_KEY not set. Cannot establish real-time TTS connection.');
    }

    const url = getRealtimeTTSWebSocketUrl(this.config.voiceId!, this.config.modelId);
    const headers = getElevenLabsWebSocketHeaders();

    console.error(`[TTS DEBUG] Attempting to connect to: ${url}`);
    console.error(`[TTS DEBUG] Voice ID: ${this.config.voiceId}`);
    console.error(`[TTS DEBUG] Headers: ${JSON.stringify(Object.keys(headers))}`);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_tts.ts:98',message:'TTS WebSocket connect attempt',data:{url,voiceId:this.config.voiceId,hasHeaders:!!headers,headerKeys:Object.keys(headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run13',hypothesisId:'K'})}).catch(()=>{});
    // #endregion

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers,
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        console.error(`[TTS DEBUG] WebSocket connection opened successfully`);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_tts.ts:110',message:'TTS WebSocket opened successfully',data:{url},timestamp:Date.now(),sessionId:'debug-session',runId:'run13',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          // ElevenLabs TTS WebSocket sends audio as binary or base64
          if (Buffer.isBuffer(data)) {
            // Binary audio data (PCM)
            console.error(`[TTS DEBUG] Received binary audio chunk: ${data.length} bytes`);
            this.handleAudioChunk(data).catch(err => {
              console.error(`[TTS DEBUG] Error handling audio chunk: ${err instanceof Error ? err.message : String(err)}`);
              if (this.config.onError) {
                this.config.onError(err instanceof Error ? err : new Error(String(err)));
              }
            });
          } else {
            // JSON message (status, errors, etc.)
            const messageStr = data.toString();
            console.error(`[TTS DEBUG] Received JSON message: ${messageStr}`);
            const message = JSON.parse(messageStr);
            this.handleMessage(message);
          }
        } catch (error) {
          console.error('[TTS DEBUG] Failed to process TTS message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error(`[TTS DEBUG] WebSocket error: ${error.message}`);
        console.error(`[TTS DEBUG] Error stack: ${error.stack}`);
        console.error(`[TTS DEBUG] URL was: ${url}`);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_tts.ts:138',message:'TTS WebSocket error',data:{errorMessage:error.message,errorStack:error.stack,url},timestamp:Date.now(),sessionId:'debug-session',runId:'run13',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        this.isConnected = false;
        if (this.config.onError) {
          this.config.onError(error);
        } else {
          reject(error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.error(`[TTS DEBUG] WebSocket closed with code: ${code}, reason: ${reason.toString() || 'none'}`);
        console.error(`[TTS DEBUG] URL was: ${url}`);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_tts.ts:150',message:'TTS WebSocket closed',data:{code,reason:reason.toString(),url},timestamp:Date.now(),sessionId:'debug-session',runId:'run13',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        this.isConnected = false;
        this.isProcessing = false;
      });
    });
  }

  /**
   * Handles incoming audio chunks from the TTS API.
   */
  private async handleAudioChunk(audioChunk: Buffer): Promise<void> {
    console.error(`[TTS DEBUG] handleAudioChunk called: ${audioChunk.length} bytes`);
    
    if (this.config.onAudioChunk) {
      this.config.onAudioChunk(audioChunk);
    }

    // Auto-play if playback is enabled
    if (this.config.enablePlayback) {
      // Initialize speaker if not already done
      const speakerAvailable = await this.initSpeaker();
      console.error(`[TTS DEBUG] Speaker available: ${speakerAvailable}, has speaker: ${!!this.speaker}`);
      
      if (speakerAvailable && this.speaker) {
        try {
          console.error(`[TTS DEBUG] Writing ${audioChunk.length} bytes to speaker`);
          this.speaker.write(audioChunk);
          console.error(`[TTS DEBUG] Audio chunk written to speaker successfully`);
        } catch (err) {
          console.error(`[TTS DEBUG] Speaker write failed: ${err instanceof Error ? err.message : String(err)}`);
          // Speaker write failed
          throw new Error('Speaker write failed. The speaker package may need to be rebuilt. Run: npm rebuild speaker');
        }
      } else {
        // Speaker not available - throw error to trigger batch TTS fallback
        throw new Error('Speaker package not available. Real-time audio playback requires the speaker package with native bindings. Install build tools and run: npm rebuild speaker');
      }
    }
  }

  /**
   * Handles incoming messages (non-audio) from the TTS API.
   */
  private handleMessage(message: any): void {
    if (message.type === 'error') {
      const error = new Error(message.message || 'TTS API error');
      if (this.config.onError) {
        this.config.onError(error);
      }
    } else if (message.type === 'audio_done') {
      this.isProcessing = false;
    }
  }

  /**
   * Streams text to the TTS API and receives audio chunks in real-time.
   * 
   * @param text - Text to convert to speech
   */
  async streamText(text: string): Promise<void> {
    if (!this.ws || !this.isConnected) {
      throw new Error('WebSocket not connected. Call connect() first.');
    }

    if (this.isProcessing) {
      throw new Error('Already processing text. Wait for current request to complete.');
    }

    this.isProcessing = true;
    this.audioChunks = []; // Reset chunks for new text

    // Send text to TTS API
    // According to ElevenLabs docs, the message format should be:
    // { "text": "...", "try_trigger_generation": true }
    const message = {
      text,
      try_trigger_generation: true,
    };

    const messageStr = JSON.stringify(message);
    console.error(`[TTS DEBUG] Sending message to TTS API: ${messageStr}`);
    this.ws.send(messageStr);

    // Wait for audio processing to complete
    // Note: This is a simple implementation. In practice, you'd wait for 'audio_done' message
    return new Promise((resolve) => {
      const checkComplete = setInterval(() => {
        if (!this.isProcessing) {
          clearInterval(checkComplete);
          resolve();
        }
      }, 100);

      // Fallback timeout (5 seconds)
      setTimeout(() => {
        clearInterval(checkComplete);
        this.isProcessing = false;
        resolve();
      }, 5000);
    });
  }

  /**
   * Fallback audio playback for when speaker package is not available.
   * Saves audio chunks to a temp file and plays it using system player.
   */
  private async playAudioChunksFallback(): Promise<void> {
    if (this.audioChunks.length === 0) return;

    console.error(`[TTS DEBUG] Starting fallback playback with ${this.audioChunks.length} chunks`);

    try {
      // Combine all audio chunks
      const audioData = Buffer.concat(this.audioChunks);
      console.error(`[TTS DEBUG] Combined audio data: ${audioData.length} bytes`);
      
      // Save to temp file (PCM format)
      const tempDir = tmpdir();
      this.tempAudioFile = join(tempDir, `devvoice-realtime-${Date.now()}.pcm`);
      await writeFile(this.tempAudioFile, audioData);

      // Play using FFmpeg (convert PCM to audio and play)
      if (process.platform === 'win32') {
        // On Windows, use FFmpeg to convert and play
        const ffmpeg = spawn('ffmpeg', [
          '-f', 's16le',
          '-ar', '24000',
          '-ac', '1',
          '-i', this.tempAudioFile,
          '-f', 'wav',
          'pipe:1'
        ], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        // Use Windows start command to play
        const wavFile = this.tempAudioFile.replace('.pcm', '.wav');
        const ffmpegConvert = spawn('ffmpeg', [
          '-f', 's16le',
          '-ar', '24000',
          '-ac', '1',
          '-i', this.tempAudioFile,
          '-y',
          wavFile
        ], {
          windowsHide: true,
          stdio: 'ignore'
        });

        await new Promise((resolve, reject) => {
          ffmpegConvert.on('close', (code) => {
            if (code === 0) {
              console.error(`[TTS DEBUG] FFmpeg conversion successful, playing WAV file: ${wavFile}`);
              // Play the WAV file
              spawn('start', ['', wavFile], {
                windowsHide: true,
                shell: true,
                stdio: 'ignore'
              });
              console.error(`[TTS DEBUG] WAV file playback started`);
              // Cleanup after a delay
              setTimeout(() => {
                unlink(wavFile).catch(() => {});
                if (this.tempAudioFile) {
                  unlink(this.tempAudioFile).catch(() => {});
                }
              }, 5000);
              resolve(undefined);
            } else {
              console.error(`[TTS DEBUG] FFmpeg conversion failed with code ${code}`);
              reject(new Error(`FFmpeg conversion failed with code ${code}`));
            }
          });
          ffmpegConvert.on('error', (err) => {
            console.error(`[TTS DEBUG] FFmpeg conversion error: ${err.message}`);
            reject(err);
          });
        });
      } else {
        // For non-Windows, cleanup temp file
        await unlink(this.tempAudioFile);
      }
    } catch (err) {
      // Cleanup on error
      if (this.tempAudioFile) {
        try {
          await unlink(this.tempAudioFile);
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Closes the WebSocket connection and releases audio resources.
   */
  close(): void {
    if (this.ws) {
      this.isConnected = false;
      this.isProcessing = false;
      this.ws.close();
      this.ws = null;
    }

    if (this.speaker) {
      this.speaker.end();
      this.speaker = null;
    }
  }

  /**
   * Checks if the connection is active.
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Checks if currently processing text.
   */
  get processing(): boolean {
    return this.isProcessing;
  }
}

/**
 * Creates a new real-time TTS connection.
 */
export function createRealtimeTTSConnection(config: RealtimeTTSConfig = {}): RealtimeTTSConnection {
  return new RealtimeTTSConnection(config);
}

/**
 * Convenience function to speak text in real-time.
 * Creates a connection, streams text, and closes connection.
 */
export async function speakRealtime(
  text: string,
  config: RealtimeTTSConfig = {}
): Promise<void> {
  console.error(`[TTS Realtime] speakRealtime called with text length: ${text.length}`);
  console.error(`[TTS Realtime] Config: ${JSON.stringify({ voiceId: config.voiceId, modelId: config.modelId, enablePlayback: config.enablePlayback })}`);
  
  const connection = createRealtimeTTSConnection(config);
  
  try {
    console.error(`[TTS Realtime] Connecting to WebSocket...`);
    await connection.connect();
    console.error(`[TTS Realtime] Connected, streaming text...`);
    await connection.streamText(text);
    console.error(`[TTS Realtime] Text streaming completed`);
  } catch (error) {
    console.error(`[TTS Realtime] Error in speakRealtime:`);
    console.error(`[TTS Realtime] Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[TTS Realtime] Stack: ${error.stack}`);
    }
    throw error;
  } finally {
    console.error(`[TTS Realtime] Closing connection...`);
    connection.close();
  }
}
