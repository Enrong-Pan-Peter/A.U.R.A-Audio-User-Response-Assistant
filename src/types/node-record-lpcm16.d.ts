/**
 * Type declarations for node-record-lpcm16
 * This package doesn't have official type definitions, so we provide our own.
 */

declare module 'node-record-lpcm16' {
  export interface RecordOptions {
    sampleRateHertz?: number;
    threshold?: number;
    verbose?: boolean;
    recordProgram?: string;
    silence?: string;
  }

  export interface Recording {
    stream(): NodeJS.ReadableStream;
    stop(): void;
  }

  export function record(options?: RecordOptions): Recording;
}
