import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

/**
 * Plays an audio file using platform-specific commands.
 * Supports macOS (afplay), Windows (PowerShell), and Linux (mpg123/aplay).
 * 
 * @param audioPath - Path to the audio file
 */
export async function playAudio(audioPath: string): Promise<void> {
  const osPlatform = platform();
  
  let command: string;
  
  switch (osPlatform) {
    case 'darwin': // macOS
      command = `afplay "${audioPath}"`;
      break;
      
    case 'win32': // Windows
      // Use Windows Media Player via PowerShell for MP3 playback
      // Escape backslashes for PowerShell
      const escapedPath = audioPath.replace(/\\/g, '\\\\');
      command = `powershell -Command "$mediaPlayer = New-Object -ComObject WMPlayer.OCX; $mediaPlayer.URL = '${escapedPath}'; $mediaPlayer.controls.play(); while ($mediaPlayer.playState -ne 3) { Start-Sleep -Milliseconds 100 }"`;
      break;
      
    case 'linux':
      // Try mpg123 first (for MP3), fallback to aplay (for WAV)
      command = `mpg123 -q "${audioPath}" || aplay "${audioPath}" 2>/dev/null || echo "Audio playback not available. Install mpg123 or aplay."`;
      break;
      
    default:
      console.log(`⚠️  Audio playback not supported on ${osPlatform}. File saved to: ${audioPath}`);
      return;
  }
  
  try {
    await execAsync(command);
  } catch (error) {
    // If playback fails, just print the path
    console.log(`⚠️  Could not play audio. File saved to: ${audioPath}`);
    console.error('Playback error:', error);
  }
}
