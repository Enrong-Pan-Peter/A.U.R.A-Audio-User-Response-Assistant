import { spawn } from 'child_process';

export type AudioFormat = 'mp3' | 'wav';

export interface StreamPlayOptions {
  /** Audio format (mp3 or wav) */
  format?: AudioFormat;
}

/**
 * Streams audio bytes directly to ffplay without saving to disk.
 * Pipes audio data to ffplay which outputs to the default audio device.
 * 
 * @param audioBuffer - Audio data as Buffer
 * @param options - Optional settings (format)
 * @returns Promise that resolves when playback completes
 * @throws Error if ffplay is not found or playback fails
 */
export async function streamPlayAudio(
  audioBuffer: Buffer,
  options: StreamPlayOptions = {}
): Promise<void> {
  const format = options.format || 'mp3';
  
  // Use ffplay for streaming playback
  // -nodisp: no video window (no UI)
  // -autoexit: exit when playback finishes
  // -loglevel error: only show errors
  // -i pipe:0: read from stdin
  // -f format: specify input format (helps with auto-detection)
  const ffplayArgs = [
    '-nodisp',
    '-autoexit',
    '-loglevel', 'error',
    '-f', format,
    '-i', 'pipe:0',
  ];
  
  return new Promise<void>((resolve, reject) => {
    const ffplayProcess = spawn('ffplay', ffplayArgs, {
      stdio: ['pipe', 'ignore', 'pipe'], // stdin: pipe, stdout: ignore, stderr: pipe
    });
    
    let stderrOutput = '';
    let settled = false;
    
    // Collect stderr for error messages
    ffplayProcess.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });
    
    // Handle spawn errors (e.g., ffplay not found)
    ffplayProcess.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        if (err.message && (err.message.includes('ENOENT') || err.message.includes('spawn'))) {
          reject(new Error(
            'ffplay not found. Please install FFmpeg (which includes ffplay) and ensure it is in your PATH. ' +
            'Visit https://ffmpeg.org/download.html to download FFmpeg.'
          ));
        } else {
          reject(new Error(`Failed to start ffplay: ${err.message}`));
        }
      }
    });
    
    // Handle process exit
    ffplayProcess.on('exit', (code: number) => {
      if (!settled) {
        settled = true;
        if (code === 0) {
          // Success - playback completed
          resolve();
        } else {
          // ffplay failed
          reject(new Error(
            `ffplay failed with exit code ${code}. ` +
            (stderrOutput ? `Error: ${stderrOutput.slice(-200)}` : 'No error details available.')
          ));
        }
      }
    });
    
    // Write audio buffer to stdin
    if (ffplayProcess.stdin) {
      ffplayProcess.stdin.write(audioBuffer);
      ffplayProcess.stdin.end();
    } else {
      if (!settled) {
        settled = true;
        reject(new Error('ffplay stdin is not available'));
      }
    }
  });
}
