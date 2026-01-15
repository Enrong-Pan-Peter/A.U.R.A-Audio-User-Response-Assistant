import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface StreamRecordingOptions {
  sampleRate?: number;
  channels?: number;
  chunkSizeMs?: number; // Size of each audio chunk in milliseconds (20-50ms recommended)
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
}

/**
 * Streams audio from microphone as PCM chunks.
 * Uses FFmpeg to capture audio and emit chunks as buffers.
 */
export class StreamRecorder extends EventEmitter {
  private ffmpegProcess: ChildProcess | null = null;
  private micName: string | undefined;
  private sampleRate: number;
  private chunkSizeBytes: number;
  private isRecording = false;

  constructor(options: StreamRecordingOptions = {}) {
    super();
    this.sampleRate = options.sampleRate || 16000;
    const channels = options.channels || 1;
    const chunkSizeMs = options.chunkSizeMs || 40; // 40ms chunks
    
    // PCM16: 2 bytes per sample, calculate chunk size in bytes
    // chunkSizeBytes = sampleRate * channels * 2 * (chunkSizeMs / 1000)
    this.chunkSizeBytes = Math.floor(this.sampleRate * channels * 2 * (chunkSizeMs / 1000));
  }

  /**
   * Initialize microphone device (Windows only).
   */
  async initialize(): Promise<void> {
    if (process.platform === 'win32') {
      if (process.env.DEVVOICE_MIC) {
        this.micName = process.env.DEVVOICE_MIC;
      } else {
        // Try to list available devices
        const { listAudioDevices } = await import('./record.js');
        try {
          const devices = await listAudioDevices();
          if (devices.length > 0) {
            this.micName = devices[0];
          } else {
            throw new Error('No microphone device found');
          }
        } catch (error) {
          throw new Error(
            'No microphone device found. Please set DEVVOICE_MIC environment variable.'
          );
        }
      }
    }
  }

  /**
   * Start streaming audio from microphone.
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    await this.initialize();

    const args: string[] = [];
    
    if (process.platform === 'win32') {
      args.push(
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'dshow',
        '-thread_queue_size', '512',
        '-i', `audio=${this.micName}`,
        '-ac', '1', // Mono
        '-ar', this.sampleRate.toString(),
        '-acodec', 'pcm_s16le', // 16-bit PCM
        '-f', 's16le', // Output format: raw PCM
        '-' // Output to stdout
      );
    } else {
      // Linux/macOS
      args.push(
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'alsa', // or 'pulse' for PulseAudio
        '-i', 'default',
        '-ac', '1',
        '-ar', this.sampleRate.toString(),
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-'
      );
    }

    this.ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let buffer = Buffer.alloc(0);
    let chunkSequence = 0;

    // Collect stderr for debugging
    this.ffmpegProcess.stderr?.on('data', (data: Buffer) => {
      // Only emit errors, not warnings
      const text = data.toString();
      if (text.includes('error') || text.includes('Error')) {
        this.emit('error', new Error(`FFmpeg error: ${text}`));
      }
    });

    // Handle process errors
    this.ffmpegProcess.on('error', (err: Error) => {
      if (err.message && (err.message.includes('ENOENT') || err.message.includes('spawn'))) {
        this.emit('error', new Error('FFmpeg not found. Please install FFmpeg and ensure it is in your PATH.'));
      } else {
        this.emit('error', err);
      }
    });

    // Handle process exit
    this.ffmpegProcess.on('exit', (code: number) => {
      this.isRecording = false;
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`FFmpeg exited with code ${code}`));
      } else {
        this.emit('end');
      }
    });

    // Process audio chunks from stdout
    this.ffmpegProcess.stdout?.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // Emit chunks when we have enough data
      while (buffer.length >= this.chunkSizeBytes) {
        const chunk = buffer.subarray(0, this.chunkSizeBytes);
        buffer = buffer.subarray(this.chunkSizeBytes);

        const audioChunk: AudioChunk = {
          data: chunk,
          timestamp: Date.now(),
        };

        this.emit('chunk', audioChunk);
        chunkSequence++;
      }
    });

    this.isRecording = true;
    this.emit('start');
  }

  /**
   * Stop streaming audio.
   */
  stop(): void {
    if (!this.isRecording || !this.ffmpegProcess) {
      return;
    }

    this.isRecording = false;

    try {
      // Try graceful shutdown first
      this.ffmpegProcess.kill('SIGTERM');
      
      // Force kill after 500ms if still running
      setTimeout(() => {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
          this.ffmpegProcess.kill('SIGKILL');
        }
      }, 500);
    } catch (err) {
      // Ignore kill errors
    }

    this.ffmpegProcess = null;
    this.emit('stop');
  }

  /**
   * Check if currently recording.
   */
  get recording(): boolean {
    return this.isRecording;
  }

  /**
   * Get sample rate.
   */
  get rate(): number {
    return this.sampleRate;
  }
}
