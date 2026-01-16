import WebSocket from 'ws';
import {
  getElevenLabsWebSocketHeaders,
  getRealtimeSTTWebSocketUrl,
} from '../voice/elevenlabs.js';

export interface RealtimeScribeOptions {
  sampleRate?: number;
  languageCode?: string;
  debug?: boolean;
  vadCommitStrategy?: boolean;
  modelId?: string;
}

type PartialHandler = (text: string) => void;
type FinalHandler = (text: string) => void;

export class RealtimeScribeClient {
  private ws: WebSocket | null = null;
  private options: RealtimeScribeOptions;
  private partialHandlers: PartialHandler[] = [];
  private finalHandlers: FinalHandler[] = [];
  private debug: boolean;
  private sampleRate: number;

  currentPartialText = '';
  finalTranscriptParts: string[] = [];

  constructor(options: RealtimeScribeOptions = {}) {
    this.options = options;
    this.debug = !!options.debug;
    this.sampleRate = options.sampleRate || 16000;
  }

  async connect(): Promise<void> {
    if (this.ws) {
      return;
    }

    const url = getRealtimeSTTWebSocketUrl({
      sampleRate: this.sampleRate,
      languageCode: this.options.languageCode,
      vadCommitStrategy: this.options.vadCommitStrategy,
      audioFormat: 'pcm_16000',
      modelId: this.options.modelId,
    });
    const headers = getElevenLabsWebSocketHeaders();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      this.ws = ws;

      ws.on('open', () => resolve());
      ws.on('error', (err: Error) => reject(err));
      ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
      ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  sendAudio(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = {
      message_type: 'input_audio_chunk',
      audio_base_64: chunk.toString('base64'),
      sample_rate: this.sampleRate,
      commit: false,
    };

    this.ws.send(JSON.stringify(payload));
  }

  onPartial(cb: PartialHandler): void {
    this.partialHandlers.push(cb);
  }

  onFinal(cb: FinalHandler): void {
    this.finalHandlers.push(cb);
  }

  async close(): Promise<void> {
    if (!this.ws) {
      return;
    }

    const ws = this.ws;

    if (ws.readyState === WebSocket.OPEN) {
      const payload = {
        message_type: 'input_audio_chunk',
        audio_base_64: '',
        sample_rate: this.sampleRate,
        commit: true,
      };
      ws.send(JSON.stringify(payload));
      ws.close();
    }

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      setTimeout(() => resolve(), 1000);
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    const raw = data.toString();
    if (this.debug) {
      console.log(`[stt:ws] ${raw}`);
    }

    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const messageType = message.message_type || message.type;
    if (messageType === 'partial_transcript') {
      const text = String(message.text || '');
      this.currentPartialText = text;
      this.partialHandlers.forEach((cb) => cb(text));
      return;
    }

    if (
      messageType === 'committed_transcript' ||
      messageType === 'committed_transcript_with_timestamps'
    ) {
      const text = String(message.text || '').trim();
      if (text) {
        this.finalTranscriptParts.push(text);
        this.currentPartialText = '';
        this.finalHandlers.forEach((cb) => cb(text));
      }
      return;
    }
  }
}
