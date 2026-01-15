import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

export interface PlaybackOptions {
  /** Custom player command (overrides platform default) */
  player?: string;
}

/**
 * Plays an audio file using platform-specific commands.
 * Supports macOS (afplay), Windows (PowerShell/start), and Linux (mpg123/aplay/paplay).
 * Resolves when playback finishes (or starts, depending on platform capabilities).
 * 
 * Cross-platform audio playback utility for DevVoice CLI.
 * 
 * @param filePath - Path to the audio file (MP3 or WAV)
 * @param options - Optional playback settings
 * @returns Promise that resolves when playback completes or starts
 * @throws Error if playback fails (file path is included in error message)
 */
export async function playAudio(
  filePath: string,
  options: PlaybackOptions = {}
): Promise<void> {
  const osPlatform = platform();
  
  // If custom player is specified, use it
  if (options.player) {
    try {
      await execAsync(`${options.player} "${filePath}"`);
      return;
    } catch (error) {
      throw new Error(
        `Custom player failed: ${error instanceof Error ? error.message : String(error)}. ` +
        `File saved to: ${filePath}`
      );
    }
  }
  
  let command: string;
  let waitForCompletion = true;
  
  switch (osPlatform) {
    case 'darwin': // macOS
      // afplay blocks until playback completes
      command = `afplay "${filePath}"`;
      waitForCompletion = true;
      break;
      
    case 'win32': // Windows
      // Use PowerShell with Windows Media Player COM object
      // This waits for playback to complete (playState 3 = stopped/finished)
      // Escape path for PowerShell: single quotes need doubling, use forward slashes
      const psPath = filePath.replace(/'/g, "''").replace(/\\/g, '/');
      command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $mediaPlayer = New-Object -ComObject WMPlayer.OCX; $mediaPlayer.URL = '${psPath}'; $mediaPlayer.controls.play(); while ($mediaPlayer.playState -ne 3 -and $mediaPlayer.playState -ne 0 -and $mediaPlayer.playState -ne 1) { Start-Sleep -Milliseconds 100 }; if ($mediaPlayer.playState -eq 3) { exit 0 } else { exit 1 } } catch { Write-Host $_.Exception.Message; exit 1 }"`;
      waitForCompletion = true;
      break;
      
    case 'linux':
      // Try mpg123 first (best for MP3), fallback to paplay or aplay
      const linuxPlayers = [
        { cmd: 'mpg123', args: ['-q', filePath] },
        { cmd: 'paplay', args: [filePath] },
        { cmd: 'aplay', args: [filePath] },
      ];
      
      let lastError: Error | null = null;
      for (const player of linuxPlayers) {
        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(player.cmd, player.args, {
              stdio: 'ignore',
            });
            
            proc.on('error', (err) => {
              // Player not found, try next
              lastError = err;
              reject(err);
            });
            
            proc.on('exit', (code) => {
              if (code === 0) {
                resolve();
              } else {
                lastError = new Error(`${player.cmd} exited with code ${code}`);
                reject(lastError);
              }
            });
          });
          // Success - playback completed
          return;
        } catch (err) {
          // Try next player
          continue;
        }
      }
      
      // All players failed
      throw new Error(
        `No audio player available. Install one of: mpg123, paplay, or aplay. ` +
        `File saved to: ${filePath}`
      );
      
    default:
      throw new Error(
        `Audio playback not supported on ${osPlatform}. ` +
        `File saved to: ${filePath}. ` +
        `Use --player flag to specify a custom player command.`
      );
  }
  
  try {
    if (waitForCompletion) {
      // Use execAsync for blocking playback (waits for completion)
      await execAsync(command);
    } else {
      // Use spawn for non-blocking (playback starts but doesn't wait)
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(command.split(' ')[0], command.split(' ').slice(1), {
          shell: true,
          stdio: 'ignore',
        });
        
        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Player exited with code ${code}`));
          }
        });
      });
    }
  } catch (error) {
    // For Windows, try fallback to start command if PowerShell fails
    if (osPlatform === 'win32') {
      try {
        console.log('⚠️  PowerShell playback failed, trying fallback method...');
        await execAsync(`start "" "${filePath}"`);
        // Give it a moment to start, then return (can't wait for completion with start)
        await new Promise(resolve => setTimeout(resolve, 500));
        return;
      } catch (fallbackError) {
        // Both methods failed
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Audio playback failed: ${errorMsg}. ` +
          `File saved to: ${filePath}`
        );
      }
    }
    
    // For other platforms, throw the error
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Audio playback failed: ${errorMsg}. ` +
      `File saved to: ${filePath}`
    );
  }
}
