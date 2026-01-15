/**
 * Real-time Speech-to-Text using ElevenLabs Scribe v2 Realtime API
 */

import WebSocket from 'ws';
import { getRealtimeSTTWebSocketUrl, getElevenLabsWebSocketHeaders, getElevenLabsApiKey } from './elevenlabs.js';

export interface RealtimeSTTConfig {
  modelId?: string;
  languageCode?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
}

export class RealtimeSTTConnection {
  private ws: WebSocket | null = null;
  private config: RealtimeSTTConfig;
  private isConnected = false;

  constructor(config: RealtimeSTTConfig = {}) {
    this.config = {
      modelId: config.modelId || 'scribe_v2',
      languageCode: config.languageCode || 'en',
      ...config,
    };
  }

  /**
   * Establishes WebSocket connection to ElevenLabs real-time STT API.
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.ws) {
      return;
    }

    try {
      getElevenLabsApiKey(); // Validate API key exists
    } catch (error) {
      throw new Error('ELEVENLABS_API_KEY not set. Cannot establish real-time STT connection.');
    }

    const url = getRealtimeSTTWebSocketUrl();
    const headers = getElevenLabsWebSocketHeaders();

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:45',message:'STT connect attempt',data:{url,hasHeaders:!!headers,headerKeys:Object.keys(headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers,
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        // Set binary type to ensure proper binary handling
        this.ws!.binaryType = 'arraybuffer';
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:54',message:'WebSocket opened',data:{readyState:this.ws?.readyState,binaryType:this.ws?.binaryType},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        // Wait for session_started before sending config (if needed)
        // Actually, based on API docs, config might be optional - let's try without it first
        // this.sendConfig();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:67',message:'WebSocket message received',data:{isBuffer:Buffer.isBuffer(data),dataLength:Buffer.isBuffer(data)?data.length:data.toString().length,dataPreview:Buffer.isBuffer(data)?'<binary>':data.toString().substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        try {
          // Try to parse as JSON (control messages)
          const message = JSON.parse(data.toString());
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:75',message:'Parsed message',data:{messageType:message.message_type||message.type,hasText:!!message.text,isFinal:message.is_final,fullMessage:JSON.stringify(message)},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          this.handleMessage(message);
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:81',message:'Failed to parse message (might be binary audio)',data:{error:error instanceof Error?error.message:String(error),isBuffer:Buffer.isBuffer(data)},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          // If it's binary data (audio response), we can ignore it for now
          // The API might send binary audio back, but we're only interested in text transcripts
          if (!Buffer.isBuffer(data)) {
            console.error('Failed to parse STT message:', error);
          }
        }
      });

      this.ws.on('error', (error: Error) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:75',message:'WebSocket error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        this.isConnected = false;
        if (this.config.onError) {
          this.config.onError(error);
        } else {
          reject(error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:95',message:'WebSocket closed',data:{code,reason:reason.toString(),wasConnected:this.isConnected},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        this.isConnected = false;
      });
    });
  }

  /**
   * Sends initial configuration to the STT API.
   * Based on session_started response, the API expects specific format.
   */
  private sendConfig(): void {
    if (!this.ws || !this.isConnected) return;

    // ElevenLabs real-time STT expects config in this format based on API docs
    const config = {
      type: 'config',
      model_id: this.config.modelId, // Use model_id not model
      language_code: this.config.languageCode,
      sample_rate: 16000,
      audio_format: 'pcm_16000',
    };

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:108',message:'Sending config',data:{config:JSON.stringify(config)},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    this.ws.send(JSON.stringify(config));
  }

  /**
   * Handles incoming messages from the STT API.
   * ElevenLabs uses message_type field, not type.
   */
  private handleMessage(message: any): void {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:125',message:'handleMessage called',data:{messageType:message.message_type||message.type,hasOnTranscript:!!this.config.onTranscript,fullMessage:JSON.stringify(message)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    const messageType = message.message_type || message.type;
    
    // Handle session_started - API is ready, we can now send audio
    if (messageType === 'session_started') {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:137',message:'Session started - ready for audio',data:{sessionId:message.session_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      // Optionally send config after session_started if we want to override defaults
      // For now, let's use API defaults and see if that works
      return;
    }
    
    // Handle transcript messages
    // ElevenLabs sends: partial_transcript (interim), committed_transcript (final)
    if (messageType === 'transcript' || messageType === 'partial_transcript' || messageType === 'final_transcript' || messageType === 'committed_transcript') {
      const text = message.text || '';
      // committed_transcript is the final transcript (equivalent to isFinal=true)
      const isFinal = messageType === 'final_transcript' || messageType === 'committed_transcript' || message.is_final || false;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:143',message:'Transcript received',data:{text,isFinal,textLength:text.length,messageType},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (this.config.onTranscript) {
        this.config.onTranscript(text, isFinal);
      }
    } else if (messageType === 'input_error' || messageType === 'error') {
      const error = new Error(message.error || message.message || 'STT API error');
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:148',message:'Error message received',data:{errorMessage:error.message,messageType},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (this.config.onError) {
        this.config.onError(error);
      }
    }
  }

  /**
   * Sends audio chunk to the STT API.
   * ElevenLabs real-time STT expects JSON messages with base64-encoded audio.
   * 
   * @param audioChunk - PCM audio data as Buffer
   * @param commit - Whether to commit this audio segment (finalize transcript)
   */
  streamAudioChunk(audioChunk: Buffer, commit: boolean = false): void {
    if (!this.ws || !this.isConnected) {
      throw new Error('WebSocket not connected. Call connect() first.');
    }

    // ElevenLabs real-time STT API expects JSON messages with base64-encoded audio
    const audioBase64 = audioChunk.toString('base64');
    const message = {
      message_type: 'input_audio_chunk',
      audio_base_64: audioBase64,
      commit: commit,
      sample_rate: 16000,
    };

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:197',message:'Sending audio chunk (JSON with base64)',data:{chunkSize:audioChunk.length,base64Length:audioBase64.length,commit,messageType:message.message_type},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error(`WebSocket not open. State: ${this.ws.readyState}`);
    }
  }

  /**
   * Commits the current transcript (finalizes it).
   * Sends an empty audio chunk with commit=true.
   */
  commitTranscript(): void {
    if (!this.ws || !this.isConnected) {
      throw new Error('WebSocket not connected. Call connect() first.');
    }

    // Send commit message with empty audio chunk
    const message = {
      message_type: 'input_audio_chunk',
      audio_base_64: '', // Empty audio to trigger commit
      commit: true,
      sample_rate: 16000,
    };

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime_stt.ts:220',message:'Committing transcript',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Closes the WebSocket connection.
   */
  close(): void {
    if (this.ws) {
      this.isConnected = false;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Checks if the connection is active.
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Creates a new real-time STT connection.
 */
export function createRealtimeSTTConnection(config: RealtimeSTTConfig = {}): RealtimeSTTConnection {
  return new RealtimeSTTConnection(config);
}
