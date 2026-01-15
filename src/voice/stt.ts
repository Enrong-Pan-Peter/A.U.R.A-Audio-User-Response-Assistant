import { readFile } from 'fs/promises';
import { elevenFetch, getElevenLabsApiKey } from './elevenlabs.js';

/**
 * Transcribes audio using ElevenLabs Speech-to-Text batch API.
 * 
 * @param wavPath - Path to the WAV audio file to transcribe
 * @returns Promise resolving to the transcribed text
 */
export async function transcribeAudio(wavPath: string): Promise<string> {
  // Check API key first (will throw if missing)
  try {
    getElevenLabsApiKey();
  } catch (error) {
    throw new Error('ELEVENLABS_API_KEY not set. Cannot transcribe audio.');
  }

  // Create abort controller for timeout (60 seconds)
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, 60000);

  try {
    // Read the audio file
    const audioBuffer = await readFile(wavPath);
    
    // Create FormData with Blob (Node.js 18+ supports FormData and Blob)
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'en');
    formData.append('webhook', 'false');

    // Make the API request
    const response = await elevenFetch('/speech-to-text', {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
    });

    clearTimeout(timeoutHandle);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs STT API error: ${response.status} ${response.statusText}. ` +
        `Response: ${errorText}`
      );
    }

    const result = await response.json() as any;
    
    // Handle response format
    // The API can return either { text: "..." } or { transcripts: { channel_0: "..." } }
    if (result.text) {
      return result.text.trim();
    } else if (result.transcripts && result.transcripts.channel_0) {
      return result.transcripts.channel_0.trim();
    } else {
      throw new Error(`Unexpected API response format: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    clearTimeout(timeoutHandle);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Transcription timeout after 60 seconds');
      }
      throw error;
    }
    throw new Error(`Transcription failed: ${error}`);
  }
}
