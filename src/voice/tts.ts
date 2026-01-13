import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { elevenFetch, getElevenLabsApiKey } from './elevenlabs.js';

const execAsync = promisify(exec);

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

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
  try {
    getElevenLabsApiKey();
  } catch (error) {
    throw new Error('ELEVENLABS_API_KEY not set. Cannot generate speech.');
  }

  const voiceId = opts?.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  
  // Ensure tmp directory exists
  const tmpDir = join(tmpdir(), 'devvoice');
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }
  
  const audioPath = join(tmpDir, 'devvoice-tts.mp3');

  try {
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs TTS API error: ${response.status} ${response.statusText}. ` +
        `Response: ${errorText}`
      );
    }

    const audioBuffer = await response.arrayBuffer();
    await writeFile(audioPath, Buffer.from(audioBuffer));
    
    return audioPath;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`TTS failed: ${error}`);
  }
}

/**
 * Plays an audio file on Windows using start command (for mp3).
 * Falls back to printing the path if playback fails.
 */
async function playAudioOnWindows(audioPath: string): Promise<void> {
  try {
    // Use start command to play mp3 on Windows
    await execAsync(`start "" "${audioPath}"`);
  } catch (error) {
    // If playback fails, just print the path
    console.log(`⚠️  Could not play audio. File saved to: ${audioPath}`);
  }
}

/**
 * Plays the audio file (cross-platform, with Windows support).
 * On failure, prints the file path.
 */
export async function playAudioFile(audioPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await playAudioOnWindows(audioPath);
  } else {
    // For non-Windows, just print the path for now
    console.log(`🔊 Audio saved to: ${audioPath}`);
    console.log('   (Playback not implemented for this platform)');
  }
}
