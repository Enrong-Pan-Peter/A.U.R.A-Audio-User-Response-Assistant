import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PartialTranscript, StreamingSTTClient } from '../stt/streamingClient.js';
import { LiveTranscriptUI } from '../ui/liveTranscript.js';
import { AudioChunk, StreamRecorder } from './streamRecord.js';
import { transcribe } from './transcribe.js';

export interface StreamTranscribeOptions {
  /** Enable live transcription (default: true) */
  live?: boolean;
  /** Silence timeout in milliseconds before finalizing (default: 1000) */
  silenceMs?: number;
  /** Sample rate for audio (default: 16000) */
  sampleRate?: number;
  /** Chunk size in milliseconds (default: 40) */
  chunkSizeMs?: number;
  /** Realtime STT model id */
  modelId?: string;
  /** Manual stop callback - return true to stop */
  onManualStop?: () => boolean;
}

export interface StreamTranscribeResult {
  transcript: string;
  audioPath?: string; // Path to saved audio file (if saved)
  duration: number;
}

function buildWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  channels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  pcmData.copy(buffer, 44);
  return buffer;
}

/**
 * Stream transcription with live updates.
 * Records audio, transcribes in real-time, displays partial results, and finalizes on silence or manual stop.
 * Falls back to batch transcription if streaming fails.
 * 
 * @param options - Configuration options
 * @returns Promise resolving to final transcript and optional audio path
 */
export async function streamTranscribe(
  options: StreamTranscribeOptions = {}
): Promise<StreamTranscribeResult> {
  const {
    live = true,
    silenceMs = 1000,
    sampleRate = 16000,
    chunkSizeMs = 40,
    modelId,
    onManualStop,
  } = options;

  const startTime = Date.now();
  let audioPath: string | undefined;
  const pcmChunks: Buffer[] = [];

  // Initialize components
  const recorder = new StreamRecorder({
    sampleRate,
    chunkSizeMs,
  });

  const sttClient = new StreamingSTTClient({
    sampleRate,
    modelId,
  });

  const ui = new LiveTranscriptUI('💬 ');

  let finalTranscript = '';
  let manualStop = false;
  let cleanupInput: (() => void) | null = null;

  return new Promise<StreamTranscribeResult>((resolve, reject) => {
    // Setup manual stop handler
    if (onManualStop || live) {
      // For manual stop, check if Enter is pressed
      const stdin = process.stdin;
      if (stdin.isTTY) {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const stopHandler = (key: string) => {
          // Enter key or 'q' to stop
          if (key === '\r' || key === '\n' || key === 'q') {
            manualStop = true;
            recorder.stop();
            if (cleanupInput) {
              cleanupInput();
            }
          }
        };

        stdin.on('data', stopHandler);

        // Cleanup on exit
        const cleanup = () => {
          stdin.removeListener('data', stopHandler);
          if (stdin.isTTY) {
            stdin.setRawMode(false);
            stdin.pause();
          }
        };

        const sigintHandler = () => cleanup();
        const sigtermHandler = () => cleanup();

        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigtermHandler);

        cleanupInput = () => {
          cleanup();
          process.off('SIGINT', sigintHandler);
          process.off('SIGTERM', sigtermHandler);
          cleanupInput = null;
        };
      }
    }

    // Setup STT client
    sttClient.setSilenceTimeout(silenceMs);

    // Handle partial transcripts
    sttClient.on('partial', (partial: PartialTranscript) => {
      if (live && ui.active) {
        ui.replace(partial.text);
      }
    });

    const finalizeAudioPath = async (): Promise<string | undefined> => {
      if (audioPath || pcmChunks.length === 0) {
        return audioPath;
      }

      const wavBuffer = buildWavBuffer(Buffer.concat(pcmChunks), sampleRate);
      const tmpDir = join(tmpdir(), 'devvoice');
      await mkdir(tmpDir, { recursive: true });
      audioPath = join(tmpDir, `devvoice-stream-${randomUUID()}.wav`);
      await writeFile(audioPath, wavBuffer);
      return audioPath;
    };

    const tryCleanupTranscript = async (): Promise<void> => {
      const path = await finalizeAudioPath();
      if (!path) {
        return;
      }

      try {
        const cleanupTranscript = await transcribe(path);
        if (cleanupTranscript) {
          finalTranscript = cleanupTranscript;
        }
      } catch (error) {
        console.warn(
          '⚠️  Batch cleanup transcription failed, keeping realtime transcript:',
          error instanceof Error ? error.message : error
        );
      }
    };

    // Handle final transcript
    sttClient.on('final', async (partial: PartialTranscript) => {
      finalTranscript = partial.text;
      
      if (live) {
        ui.finalize();
      }

      // Stop recorder if still running
      if (recorder.recording) {
        recorder.stop();
      }

      // Close STT client
      sttClient.close();

      const duration = Date.now() - startTime;

      await tryCleanupTranscript();
      if (cleanupInput) {
        cleanupInput();
      }

      resolve({
        transcript: finalTranscript,
        audioPath,
        duration,
      });
    });

    // Handle errors
    const errorHandler = async (error: Error) => {
      recorder.stop();
      sttClient.close();
      if (live) {
        ui.stop();
      }
      if (cleanupInput) {
        cleanupInput();
      }

      // Fallback to batch transcription
      console.warn('⚠️  Streaming transcription failed, falling back to batch mode...');
      
      try {
        // Record full audio for batch transcription
        const { recordAudio } = await import('./record.js');
        const batchAudioPath = await recordAudio({
          durationSeconds: 10,
          sampleRate,
        });

        const batchTranscript = await transcribe(batchAudioPath);
        const duration = Date.now() - startTime;

        resolve({
          transcript: batchTranscript,
          audioPath: batchAudioPath,
          duration,
        });
      } catch (fallbackError) {
        reject(fallbackError);
      }
    };

    recorder.on('error', errorHandler);
    sttClient.on('error', errorHandler);

    // Start recording
    recorder.start().then(() => {
      if (live) {
        ui.start();
      }

      // Send audio chunks to STT client
      recorder.on('chunk', (chunk: AudioChunk) => {
        if (!manualStop && recorder.recording) {
          pcmChunks.push(chunk.data);
          sttClient.sendAudioChunk(chunk.data);
        }
      });

      // Handle recorder stop
      recorder.on('stop', async () => {
        // If manually stopped or recorder ended, finalize
        if (manualStop || !recorder.recording) {
          try {
            const transcript = await sttClient.finalize();
            if (transcript) {
              finalTranscript = transcript;
            }
            if (live) {
              ui.finalize();
            }
            sttClient.close();

            const duration = Date.now() - startTime;
            await tryCleanupTranscript();
            if (cleanupInput) {
              cleanupInput();
            }
            resolve({
              transcript: finalTranscript,
              audioPath,
              duration,
            });
          } catch (err) {
            // If finalization fails, try to resolve with whatever we have
            if (live) {
              ui.finalize();
            }
            sttClient.close();

            const duration = Date.now() - startTime;
            if (cleanupInput) {
              cleanupInput();
            }
            resolve({
              transcript: finalTranscript || ui.text,
              audioPath,
              duration,
            });
          }
        }
      });
    }).catch(reject);

    // Connect STT client
    sttClient.connect().catch(reject);
  });
}
