import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { playAudio } from './playback.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * Converts text to speech using ElevenLabs API and plays it.
 * 
 * @param text - Text to speak
 * @param mute - If true, skip audio playback (still generates file)
 */
export async function speak(text: string, mute: boolean = false): Promise<void> {
  if (!ELEVENLABS_API_KEY) {
    console.warn('⚠️  ELEVENLABS_API_KEY not set. Skipping TTS.');
    return;
  }

  try {
    const audioPath = await generateSpeech(text);
    
    if (!mute) {
      await playAudio(audioPath);
    } else {
      console.log(`🔇 Muted: Audio saved to ${audioPath}`);
    }
  } catch (error) {
    console.error('❌ Error generating or playing speech:', error);
    throw error;
  }
}

/**
 * Generates speech audio file using ElevenLabs API.
 * 
 * @param text - Text to convert to speech
 * @returns Path to the generated audio file
 */
async function generateSpeech(text: string): Promise<string> {
  const response = await fetch(`${ELEVENLABS_API_URL}/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY!,
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
    throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioPath = join(tmpdir(), `devvoice-${randomUUID()}.mp3`);
  
  await writeFile(audioPath, Buffer.from(audioBuffer));
  
  return audioPath;
}
