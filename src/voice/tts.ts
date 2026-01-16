import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { playAudio, PlaybackOptions } from '../audio/playback.js';
import { streamPlayAudio } from '../audio/streamPlay.js';
import { elevenFetch, getElevenLabsApiKey } from './elevenlabs.js';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

export type PlayMode = 'stream' | 'file';

export interface SpeakOptions {
  /** Voice ID to use (default: Rachel) */
  voiceId?: string;
  /** Whether to play audio automatically (default: true) */
  play?: boolean;
  /** Playback mode: 'stream' pipes to ffplay (no files), 'file' saves and plays file (default: 'stream') */
  playMode?: PlayMode;
  /** Whether to keep the audio file after playback (default: false, only applies to file mode) */
  keepAudio?: boolean;
  /** Custom player command (overrides platform default, only applies to file mode) */
  player?: string;
}

/**
 * Converts text to speech using ElevenLabs API and optionally plays it.
 * 
 * @param text - Text to convert to speech
 * @param opts - Optional settings (voiceId, play, keepAudio, player)
 * @returns Promise resolving to the path of the saved audio file
 */
export async function speak(
  text: string,
  opts: SpeakOptions = {}
): Promise<string> {
  const {
    voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
    play = true,
    playMode = 'stream',
    keepAudio = false,
    player,
  } = opts;

  // Check API key (will throw if missing)
  try {
    getElevenLabsApiKey();
  } catch (error) {
    throw new Error('ELEVENLABS_API_KEY not set. Cannot generate speech.');
  }

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
        model_id: process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL,
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
    const audioData = Buffer.from(audioBuffer);
    
    // Stream mode: pipe directly to ffplay without saving
    if (play && playMode === 'stream') {
      try {
        await streamPlayAudio(audioData, { format: 'mp3' });
        // In stream mode, no file is created, so return empty string or a placeholder
        return '';
      } catch (streamError) {
        // If streaming fails, fall back to file mode
        console.warn(
          '⚠️  Streaming playback failed, falling back to file mode:',
          streamError instanceof Error ? streamError.message : streamError
        );
        // Fall through to file mode
      }
    }
    
    // File mode: save to disk and play
    // Ensure tmp directory exists
    const tmpDir = join(tmpdir(), 'devvoice');
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true });
    }
    
    // Use unique filename to avoid conflicts
    const audioPath = join(tmpDir, `devvoice-tts-${randomUUID()}.mp3`);
    await writeFile(audioPath, audioData);
    
    // Play audio if requested
    if (play) {
      try {
        const playbackOptions: PlaybackOptions = player ? { player } : {};
        await playAudio(audioPath, playbackOptions);
        
        // Clean up file after successful playback if not keeping it
        if (!keepAudio) {
          try {
            await unlink(audioPath);
          } catch (cleanupError) {
            // Ignore cleanup errors - file will remain
          }
        }
      } catch (playbackError) {
        // Log error but don't fail - file is still saved
        console.error(
          '⚠️  Audio playback failed:',
          playbackError instanceof Error ? playbackError.message : playbackError
        );
        console.log(`📁 Audio file saved to: ${audioPath}`);
        // Don't clean up on playback failure - user might want the file
      }
    } else {
      console.log(`🔇 Muted: Audio saved to ${audioPath}`);
      // Clean up file if muted and not keeping it
      if (!keepAudio) {
        try {
          await unlink(audioPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }
    
    return audioPath;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`TTS failed: ${error}`);
  }
}

/**
 * Plays the audio file (cross-platform).
 * @deprecated Use speak() with play option instead, or import playAudio directly
 */
export async function playAudioFile(audioPath: string): Promise<void> {
  try {
    await playAudio(audioPath);
  } catch (error) {
    console.error(
      '⚠️  Playback failed:',
      error instanceof Error ? error.message : error
    );
    console.log(`📁 Audio file saved to: ${audioPath}`);
  }
}
