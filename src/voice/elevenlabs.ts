/**
 * ElevenLabs API client helpers
 */

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_WS_BASE = 'wss://api.elevenlabs.io/v1';

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

export interface RealtimeSTTUrlOptions {
  modelId?: string;
  sampleRate?: number;
  languageCode?: string;
  audioFormat?: 'pcm_16000' | 'pcm_8000' | 'pcm_24000' | 'pcm_44100' | 'pcm_48000';
  includeTimestamps?: boolean;
  vadCommitStrategy?: boolean;
}

export function getRealtimeSTTWebSocketUrl(options: RealtimeSTTUrlOptions = {}): string {
  const params = new URLSearchParams();
  params.set('model_id', options.modelId || 'scribe_v2_realtime');
  params.set('audio_format', options.audioFormat || 'pcm_16000');
  params.set('sample_rate', String(options.sampleRate || 16000));
  if (options.languageCode) {
    params.set('language_code', options.languageCode);
  }
  if (typeof options.includeTimestamps === 'boolean') {
    params.set('include_timestamps', options.includeTimestamps ? 'true' : 'false');
  }
  if (typeof options.vadCommitStrategy === 'boolean') {
    params.set('vad_commit_strategy', options.vadCommitStrategy ? 'true' : 'false');
  }

  return `${ELEVENLABS_WS_BASE}/speech-to-text/realtime?${params.toString()}`;
}

export function getElevenLabsWebSocketHeaders(): Record<string, string> {
  const apiKey = getElevenLabsApiKey();
  return {
    'xi-api-key': apiKey,
  };
}
