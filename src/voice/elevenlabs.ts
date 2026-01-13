/**
 * ElevenLabs API client helpers
 */

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

/**
 * Gets the ElevenLabs API key from environment variables.
 * Throws a friendly error if the key is missing.
 */
export function getElevenLabsApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ELEVENLABS_API_KEY not set. Please set it in your .env file or environment variables.'
    );
  }
  return apiKey;
}

/**
 * Makes a fetch request to the ElevenLabs API with proper authentication headers.
 * 
 * @param path - API endpoint path (e.g., '/text-to-speech/voice-id')
 * @param init - Fetch options (headers, body, method, etc.)
 * @returns Promise resolving to the Response
 */
export async function elevenFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const apiKey = getElevenLabsApiKey();
  const url = `${ELEVENLABS_API_BASE}${path}`;
  
  const headers = new Headers(init.headers);
  headers.set('xi-api-key', apiKey);
  
  return fetch(url, {
    ...init,
    headers,
  });
}
