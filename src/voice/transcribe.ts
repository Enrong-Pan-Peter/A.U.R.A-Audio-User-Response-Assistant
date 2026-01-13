/**
 * Transcription interface for converting audio to text.
 * Uses ElevenLabs Speech-to-Text API.
 */

import { transcribeAudio } from './stt.js';

/**
 * Transcribes audio from a file path using ElevenLabs STT API.
 * 
 * @param audioPath - Path to the audio file (WAV format)
 * @returns Promise resolving to the transcribed text
 */
export async function transcribe(audioPath: string): Promise<string> {
  try {
    return await transcribeAudio(audioPath);
  } catch (error) {
    // Handle missing API key gracefully
    if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
      throw new Error(
        'ELEVENLABS_API_KEY not set. Please set it in your .env file to use transcription.'
      );
    }
    // Re-throw other errors
    throw error;
  }
}
