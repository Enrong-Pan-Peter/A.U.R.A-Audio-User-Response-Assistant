import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { elevenFetch, getElevenLabsApiKey } from './elevenlabs.js';

const execAsync = promisify(exec);

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

/**
 * Speaks text directly through OS native TTS (no files).
 * Uses Windows SAPI, macOS 'say', or Linux 'espeak'/'spd-say'.
 * Supports cancellation via AbortSignal.
 * 
 * @param text - Text to speak
 * @param abortSignal - Optional AbortSignal to cancel TTS mid-speech
 * @returns Object with promise and cancel function
 */
export async function speakWithOSTTS(
  text: string,
  abortSignal?: AbortSignal
): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:16',message:'speakWithOSTTS called',data:{textLength:text.length,platform:process.platform,hasAbortSignal:!!abortSignal},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      // Escape text for PowerShell (escape single quotes and backslashes)
      const escapedText = text.replace(/'/g, "''").replace(/\\/g, '\\\\');
      
      // Use Windows Speech API via PowerShell
      // Use spawn instead of exec to get process control for cancellation
      const args = ['-Command', `Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.Speak('${escapedText}'); $speak.Dispose()`];
      const child = spawn('powershell', args, {
        windowsHide: true,
        stdio: 'ignore',
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:28',message:'OS TTS PowerShell process started',data:{pid:child.pid,textLength:text.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      // Handle abort signal
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:35',message:'OS TTS interrupted via AbortSignal',data:{pid:child.pid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          if (child.pid) {
            // Kill PowerShell process tree on Windows
            try {
              spawn('taskkill', ['/F', '/T', '/PID', child.pid.toString()], { windowsHide: true });
            } catch (err) {
              // Fallback to kill if taskkill fails
              child.kill('SIGKILL');
            }
          } else {
            child.kill('SIGKILL');
          }
          resolve(); // Resolve instead of reject when aborted
        });
      }
      
      child.on('error', (error) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:51',message:'OS TTS process error',data:{errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (!abortSignal?.aborted) {
          reject(new Error(`OS TTS failed: ${error.message}`));
        }
      });
      
      child.on('exit', (code, signal) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:59',message:'OS TTS process exited',data:{code,signal,aborted:abortSignal?.aborted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (abortSignal?.aborted) {
          resolve(); // Resolve when aborted
        } else if (code === 0) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:64',message:'OS TTS completed successfully',data:{textLength:text.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          resolve();
        } else {
          reject(new Error(`OS TTS failed with exit code ${code}`));
        }
      });
    });
  } else if (process.platform === 'darwin') {
    // macOS: Use 'say' command
    return new Promise((resolve, reject) => {
      const escapedText = text.replace(/"/g, '\\"');
      const child = spawn('say', [escapedText], {
        stdio: 'ignore',
      });
      
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          child.kill('SIGTERM');
          resolve();
        });
      }
      
      child.on('error', (error) => {
        if (!abortSignal?.aborted) {
          reject(new Error(`OS TTS failed: ${error.message}`));
        }
      });
      
      child.on('exit', (code, signal) => {
        if (abortSignal?.aborted) {
          resolve();
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`OS TTS failed with exit code ${code}`));
        }
      });
    });
  } else if (process.platform === 'linux') {
    // Linux: Try 'espeak' or 'spd-say'
    return new Promise((resolve, reject) => {
      const escapedText = text.replace(/"/g, '\\"');
      const child = spawn('sh', ['-c', `espeak "${escapedText}" 2>/dev/null || spd-say "${escapedText}"`], {
        stdio: 'ignore',
      });
      
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          child.kill('SIGTERM');
          resolve();
        });
      }
      
      child.on('error', (error) => {
        if (!abortSignal?.aborted) {
          reject(new Error(`OS TTS failed. Install 'espeak' or 'speech-dispatcher'. Error: ${error.message}`));
        }
      });
      
      child.on('exit', (code, signal) => {
        if (abortSignal?.aborted) {
          resolve();
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`OS TTS failed with exit code ${code}`));
        }
      });
    });
  } else {
    throw new Error(`OS TTS not supported on platform: ${process.platform}`);
  }
}

/**
 * Converts text to speech using ElevenLabs API.
 * 
 * @param text - Text to convert to speech
 * @param opts - Optional settings (voiceId)
 * @returns Promise resolving to the path of the saved audio file
 */
export async function speak(
  text: string,
  opts?: { voiceId?: string }
): Promise<string> {
  // Check API key (will throw if missing)
  let apiKey: string;
  try {
    apiKey = getElevenLabsApiKey();
    console.log(`🔑 ElevenLabs API key found (length: ${apiKey.length})`);
  } catch (error) {
    console.error('❌ ELEVENLABS_API_KEY check failed:', error instanceof Error ? error.message : error);
    throw new Error('ELEVENLABS_API_KEY not set. Cannot generate speech.');
  }

  const voiceId = opts?.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  console.log(`🎤 Using voice ID: ${voiceId}`);
  console.log(`📝 Text to convert: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  // Ensure tmp directory exists
  const tmpDir = join(tmpdir(), 'devvoice');
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
    console.log(`📁 Created temp directory: ${tmpDir}`);
  }
  
  const audioPath = join(tmpDir, 'devvoice-tts.mp3');
  console.log(`📁 Target audio path: ${audioPath}`);

  try {
    console.log(`🌐 Calling ElevenLabs API: /text-to-speech/${voiceId}`);
    // Make the API request
    const response = await elevenFetch(`/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    console.log(`📡 API Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error Response: ${errorText}`);
      throw new Error(
        `ElevenLabs TTS API error: ${response.status} ${response.statusText}. ` +
        `Response: ${errorText}`
      );
    }

    console.log(`📥 Downloading audio data...`);
    const audioBuffer = await response.arrayBuffer();
    console.log(`💾 Audio buffer size: ${audioBuffer.byteLength} bytes`);
    
    await writeFile(audioPath, Buffer.from(audioBuffer));
    console.log(`✅ Audio file written: ${audioPath}`);
    
    // Verify file was written
    if (!existsSync(audioPath)) {
      throw new Error(`Audio file was not created at ${audioPath}`);
    }
    const stats = await import('fs/promises').then(m => m.stat(audioPath));
    console.log(`📊 File size: ${stats.size} bytes`);
    
    return audioPath;
  } catch (error) {
    console.error(`❌ TTS generation error:`, error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(`Stack trace:`, error.stack);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`TTS failed: ${error}`);
  }
}

/**
 * Plays an audio file on Windows using PowerShell COM object (silent playback).
 * Falls back to printing the path if playback fails.
 * @deprecated Use speakWithOSTTS instead - this function is kept for backward compatibility
 */
async function playAudioOnWindows(audioPath: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:231',message:'playAudioOnWindows called',data:{audioPath,pathExists:existsSync(audioPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Verify file exists
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file does not exist: ${audioPath}`);
  }
  
  try {
    // Use Windows Media Player via PowerShell for silent MP3 playback
    // Escape backslashes and single quotes for PowerShell
    const escapedPath = audioPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
    
    // Use spawn with timeout to prevent hanging
    return new Promise((resolve, reject) => {
      // Enhanced PowerShell script with detailed logging
      // Windows Media Player playState values:
      // 0 = Undefined, 1 = Stopped, 2 = Paused, 3 = Playing, 4 = ScanForward, 5 = ScanReverse
      // 6 = Buffering, 7 = Waiting, 8 = MediaEnded, 9 = Transitioning, 10 = Ready
      const psScript = `
        try {
          $mediaPlayer = New-Object -ComObject WMPlayer.OCX
          Write-Host "COM object created"
          $mediaPlayer.URL = '${escapedPath}'
          Write-Host "URL set: ${escapedPath}"
          $initialState = $mediaPlayer.playState
          Write-Host "Initial playState: $initialState"
          
          # Wait for media to load (state should become 10 = Ready or 3 = Playing)
          $loadTimeout = (Get-Date).AddSeconds(5)
          while ($mediaPlayer.playState -eq 9 -and (Get-Date) -lt $loadTimeout) {
            Start-Sleep -Milliseconds 100
          }
          $loadState = $mediaPlayer.playState
          Write-Host "After load playState: $loadState"
          
          if ($loadState -eq 9) {
            Write-Error "Media failed to load: stuck in Transitioning state"
            exit 1
          }
          
          # Start playback
          $mediaPlayer.controls.play()
          Write-Host "Play command issued"
          Start-Sleep -Milliseconds 500
          $afterPlayState = $mediaPlayer.playState
          Write-Host "After play playState: $afterPlayState"
          
          # Wait for playback to complete (state 3 = Playing, then 8 = MediaEnded)
          $timeout = (Get-Date).AddSeconds(30)
          $iterations = 0
          while ($mediaPlayer.playState -ne 8 -and $mediaPlayer.playState -ne 1 -and (Get-Date) -lt $timeout) {
            $iterations++
            $currentState = $mediaPlayer.playState
            if ($iterations % 10 -eq 0) {
              Write-Host "Iteration $iterations, playState: $currentState"
            }
            Start-Sleep -Milliseconds 100
          }
          $finalState = $mediaPlayer.playState
          Write-Host "Final playState: $finalState, iterations: $iterations"
          
          if ($finalState -eq 8 -or $finalState -eq 1) {
            Write-Host "Playback completed successfully"
          } elseif ($finalState -eq 3) {
            Write-Error "Playback still in progress but timeout reached"
            exit 1
          } else {
            Write-Error "Playback failed: final state was $finalState (expected 8=MediaEnded or 1=Stopped)"
            exit 1
          }
          $mediaPlayer.close()
        } catch {
          Write-Error "Error: $_"
          exit 1
        }
      `;
      const args = ['-Command', psScript];
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:273',message:'Starting PowerShell playback',data:{audioPath,escapedPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      const child = spawn('powershell', args, {
        windowsHide: true,
        stdio: 'pipe',
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:287',message:'PowerShell stdout',data:{output:data.toString().substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:293',message:'PowerShell stderr',data:{error:data.toString().substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      });
      
      // Timeout after 35 seconds (30s playback + 5s buffer)
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
          reject(new Error('Audio playback timeout'));
        }
      }, 35000);
      
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:310',message:'PowerShell process exited',data:{audioPath,code,signal,stdout:stdout.substring(0,500),stderr:stderr.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (code === 0) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:313',message:'PowerShell playback completed successfully',data:{audioPath,stdout},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          resolve();
        } else {
          const errorMsg = stderr || `PowerShell exited with code ${code}`;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:317',message:'PowerShell playback failed',data:{audioPath,code,signal,stderr,stdout},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          reject(new Error(`Audio playback failed: ${errorMsg}`));
        }
      });
      
      child.on('error', (error) => {
        clearTimeout(timeout);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:270',message:'PowerShell spawn error',data:{audioPath,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        reject(error);
      });
    });
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:275',message:'playAudioOnWindows error',data:{audioPath,errorMessage:error instanceof Error?error.message:String(error),errorStack:error instanceof Error?error.stack:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // If playback fails, throw error so caller can handle it
    throw error;
  }
}

/**
 * Plays the audio file (cross-platform, with Windows support).
 * On failure, prints the file path.
 * @deprecated Use speakWithOSTTS instead - this function is kept for backward compatibility
 */
export async function playAudioFile(audioPath: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tts.ts:100',message:'playAudioFile called',data:{audioPath,platform:process.platform,pathExists:existsSync(audioPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  if (process.platform === 'win32') {
    await playAudioOnWindows(audioPath);
  } else {
    // For non-Windows, just print the path for now
    console.log(`🔊 Audio saved to: ${audioPath}`);
    console.log('   (Playback not implemented for this platform)');
  }
}

/**
 * Speaks text using real-time TTS streaming (WebSocket).
 * This function streams audio directly without saving to disk.
 * 
 * @param text - Text to convert to speech
 * @param opts - Optional settings (voiceId)
 * @returns Promise that resolves when speech is complete
 */
export async function speakRealtime(
  text: string,
  opts?: { voiceId?: string }
): Promise<void> {
  // Import here to avoid circular dependencies
  const { speakRealtime: realtimeSpeak } = await import('./realtime_tts.js');
  
  const voiceId = opts?.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  console.error(`[TTS] Attempting real-time TTS with voice ID: ${voiceId}`);
  console.error(`[TTS] Text length: ${text.length} characters`);
  
  try {
    await realtimeSpeak(text, {
      voiceId,
      enablePlayback: true,
    });
    console.error(`[TTS] Real-time TTS completed successfully`);
  } catch (error) {
    // Fallback to batch TTS if real-time fails
    if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
      throw error;
    }
    
    console.error(`[TTS] Real-time TTS failed:`);
    console.error(`[TTS] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[TTS] Error message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[TTS] Error stack: ${error.stack}`);
    }
    console.warn('⚠️  Real-time TTS failed, falling back to batch TTS:', error instanceof Error ? error.message : error);
    // Fallback to batch TTS
    const audioPath = await speak(text, opts);
    await playAudioFile(audioPath);
  }
}