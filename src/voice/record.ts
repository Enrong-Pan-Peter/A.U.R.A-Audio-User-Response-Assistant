import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export interface RecordingOptions {
  durationSeconds?: number;
  sampleRate?: number;
}

/**
 * Records audio from the microphone using FFmpeg.
 * Returns the path to the saved WAV file.
 */
export async function recordAudio(options: RecordingOptions = {}): Promise<string> {
  const durationSeconds = options.durationSeconds || 8;
  const sampleRate = options.sampleRate || 16000;
  
  // Ensure tmp directory exists
  const tmpDir = tmpdir();
  const outputPath = join(tmpDir, `devvoice-${randomUUID()}.wav`);
  
  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  
  // On Windows, get the microphone device name
  let micName: string | undefined;
  if (process.platform === 'win32') {
    if (process.env.DEVVOICE_MIC) {
      micName = process.env.DEVVOICE_MIC;
    } else {
      // Try to list available devices and use the first one
      try {
        const devices = await listAudioDevices();
        if (devices.length > 0) {
          micName = devices[0];
        }
      } catch (error) {
        // If listing fails, we'll throw an error below
      }
    }
    
    if (!micName) {
      throw new Error(
        'No microphone device found. Please set DEVVOICE_MIC environment variable with your microphone name, ' +
        'or ensure a microphone is connected and accessible.'
      );
    }
  }
  
  return new Promise((resolve, reject) => {
    // Track if promise is already settled to prevent double resolution
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    
    // Build FFmpeg arguments
    const args: string[] = [];
    
    if (process.platform === 'win32') {
      args.push(
        '-hide_banner',                // Reduce noise
        '-loglevel', 'error',          // Only show errors
        '-f', 'dshow',
        '-i', `audio=${micName}`,
        '-t', durationSeconds.toString(), // Duration (primary control)
        '-ac', '1',                    // Mono
        '-ar', sampleRate.toString(),   // Sample rate
        '-acodec', 'pcm_s16le',        // 16-bit PCM
        '-y',                          // Overwrite output file
        outputPath
      );
    } else {
      // Linux/macOS: Use alsa/pulseaudio
      args.push(
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'alsa',                  // or 'pulse' for PulseAudio
        '-i', 'default',
        '-t', durationSeconds.toString(),
        '-ac', '1',
        '-ar', sampleRate.toString(),
        '-acodec', 'pcm_s16le',
        '-y',
        outputPath
      );
    }
    
    // Spawn FFmpeg process
    const ffmpeg = spawn('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr piped
    });
    
    let stderrOutput = '';
    
    // Collect stderr (FFmpeg outputs info to stderr)
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });
    
    // Handle process errors (e.g., ffmpeg not found) - spawn failures
    ffmpeg.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        
        let errorMsg = 'Failed to start audio recording. ';
        
        if (err.message && (err.message.includes('ENOENT') || err.message.includes('spawn'))) {
          errorMsg += 'FFmpeg not found. Please install FFmpeg and ensure it is in your PATH.';
        } else {
          errorMsg += err.message;
        }
        
        reject(new Error(errorMsg));
      }
    });
    
    // PRIMARY: Handle process exit - this is the main resolution mechanism
    ffmpeg.on('close', (code: number) => {
      // Clear safety timeout when process exits
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      
      if (!settled) {
        settled = true;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1db3fe2d-876b-4f73-9bfa-da58800c7558',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:104',message:'FFmpeg process closed',data:{exitCode:code,stderrFull:stderrOutput},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (code === 0) {
          // Success - FFmpeg completed normally
          resolve(outputPath);
        } else {
          // FFmpeg failed with non-zero exit code
          const errorMsg = `FFmpeg recording failed with exit code ${code}. ` +
            (stderrOutput ? `Error: ${stderrOutput.slice(-500)}` : 'No error details available.');
          reject(new Error(errorMsg));
        }
      }
    });
    
    // SAFETY: Timeout as backup (should not normally fire since -t controls duration)
    // Set to duration + 2 seconds buffer to allow FFmpeg to finish
    timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Try to kill gracefully first, then force kill
        try {
          ffmpeg.kill('SIGTERM');
          // Give it 500ms to exit gracefully
          setTimeout(() => {
            if (!ffmpeg.killed) {
              ffmpeg.kill('SIGKILL');
            }
          }, 500);
        } catch (err) {
          // Ignore kill errors
        }
        
        reject(new Error(
          `Recording timeout after ${durationSeconds + 2} seconds. ` +
          'FFmpeg process did not exit in time. ' +
          (stderrOutput ? `Last output: ${stderrOutput.slice(-200)}` : '')
        ));
      }
    }, (durationSeconds + 2) * 1000);
  });
}

/**
 * Wait for Enter key press to start recording.
 */
export function waitForPushToTalk(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    console.log('\n🎤 Press Enter to start recording (will record for up to 8 seconds)...');
    
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    });
  });
}

/**
 * Lists available audio input devices on Windows using FFmpeg.
 * Useful for debugging microphone issues.
 * 
 * @returns Promise resolving to list of device names
 */
export async function listAudioDevices(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy'
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stderrOutput = '';
    
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });
    
    ffmpeg.on('close', (code: number) => {
      // FFmpeg exits with non-zero code for -list_devices, that's expected
      const devices: string[] = [];
      const lines = stderrOutput.split('\n');
      
      for (const line of lines) {
        // Look for lines like: [dshow @ ...] "Device Name" (audio)
        // Match pattern: "Device Name" followed by (audio)
        const match = line.match(/"([^"]+)"\s*\(audio\)/);
        if (match) {
          devices.push(match[1]);
        }
      }
      
      resolve(devices);
    });
    
    ffmpeg.on('error', (err: Error) => {
      reject(new Error(`Failed to list audio devices: ${err.message}`));
    });
  });
}
