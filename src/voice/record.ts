import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, statSync } from 'fs';
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
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:17',message:'recordAudio entry',data:{durationSeconds,sampleRate,platform:process.platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:32',message:'Using DEVVOICE_MIC env var',data:{micName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } else {
      // Try to list available devices and use the first one
      try {
        const devices = await listAudioDevices();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:36',message:'Listed audio devices',data:{deviceCount:devices.length,devices},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (devices.length > 0) {
          micName = devices[0];
        }
      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:40',message:'Failed to list devices',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        // If listing fails, we'll throw an error below
      }
    }
    
    if (!micName) {
      throw new Error(
        'No microphone device found. Please set DEVVOICE_MIC environment variable with your microphone name, ' +
        'or ensure a microphone is connected and accessible.'
      );
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:50',message:'Selected microphone device',data:{micName,outputPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
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
        '-thread_queue_size', '512',   // Buffer size for dshow input
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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:92',message:'FFmpeg process spawned',data:{pid:ffmpeg.pid,args,outputPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    let stderrOutput = '';
    let stderrChunkCount = 0;
    
    // Collect stderr (FFmpeg outputs info to stderr)
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
      stderrChunkCount++;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:100',message:'FFmpeg stderr data',data:{chunkCount:stderrChunkCount,chunkSize:data.length,preview:data.toString().slice(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    });
    
    // Handle process errors (e.g., ffmpeg not found) - spawn failures
    ffmpeg.on('error', (err: Error) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:105',message:'FFmpeg error event',data:{error:err.message,settled},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:126',message:'FFmpeg close event fired',data:{exitCode:code,settled,killed:ffmpeg.killed,stderrChunkCount,stderrLength:stderrOutput.length,fileExists:existsSync(outputPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      // Clear safety timeout when process exits
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      
      if (!settled) {
        settled = true;
        if (code === 0) {
          // Success - FFmpeg completed normally
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:138',message:'FFmpeg success - resolving',data:{outputPath,fileSize:existsSync(outputPath)?statSync(outputPath).size:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          resolve(outputPath);
        } else {
          // FFmpeg failed with non-zero exit code
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:143',message:'FFmpeg failed with non-zero exit',data:{exitCode:code,stderrLast500:stderrOutput.slice(-500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          const errorMsg = `FFmpeg recording failed with exit code ${code}. ` +
            (stderrOutput ? `Error: ${stderrOutput.slice(-500)}` : 'No error details available.');
          reject(new Error(errorMsg));
        }
      }
    });
    
    // SAFETY: Timeout as backup (should not normally fire since -t controls duration)
    // Set to duration + 5 seconds buffer to allow FFmpeg to finish and handle Windows quirks
    const timeoutMs = (durationSeconds + 5) * 1000;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:151',message:'Setting timeout',data:{timeoutMs,durationSeconds,expectedTimeoutSec:durationSeconds+5},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    timeoutHandle = setTimeout(() => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:152',message:'Timeout fired',data:{settled,killed:ffmpeg.killed,exitCode:ffmpeg.exitCode,stderrChunkCount,stderrLength:stderrOutput.length,fileExists:existsSync(outputPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (!settled) {
        settled = true;
        // Try to kill gracefully first, then force kill
        try {
          if (!ffmpeg.killed && ffmpeg.exitCode === null) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:157',message:'Attempting to kill FFmpeg',data:{pid:ffmpeg.pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            // Process is still running
            ffmpeg.kill('SIGTERM');
            // Give it 1 second to exit gracefully
            setTimeout(() => {
              if (!ffmpeg.killed && ffmpeg.exitCode === null) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:162',message:'Force killing FFmpeg',data:{pid:ffmpeg.pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                try {
                  ffmpeg.kill('SIGKILL');
                } catch (err) {
                  // Ignore kill errors
                }
              }
            }, 1000);
          }
        } catch (err) {
          // Ignore kill errors
        }
        
        // Check if file was created despite timeout (sometimes FFmpeg creates file but doesn't exit)
        if (existsSync(outputPath)) {
          const stats = statSync(outputPath);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:176',message:'File exists at timeout',data:{outputPath,fileSize:stats.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          if (stats.size > 0) {
            // File exists and has content, resolve with it despite timeout
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:179',message:'Resolving with file despite timeout',data:{outputPath,fileSize:stats.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            resolve(outputPath);
            return;
          }
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/cc885d7f-d01b-4543-82ff-9af21ac32fc7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'record.ts:185',message:'Rejecting with timeout error',data:{stderrLast200:stderrOutput.slice(-200),stderrChunkCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        reject(new Error(
          `Recording timeout after ${durationSeconds + 5} seconds. ` +
          'FFmpeg process did not exit in time. ' +
          (stderrOutput ? `Last output: ${stderrOutput.slice(-200)}` : '') +
          ' This may indicate a microphone access issue or FFmpeg configuration problem.'
        ));
      }
    }, timeoutMs);
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
