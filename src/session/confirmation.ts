/**
 * Confirmation parsing utilities.
 * Supports both voice and typed input.
 */

export type ConfirmationResult = 'yes' | 'no' | 'unclear';

const YES_PATTERNS = [
  'yes', 'yep', 'yeah', 'y', 'confirm', 'confirmed', 'do it', 'proceed', 
  'go ahead', 'sure', 'ok', 'okay', 'alright', 'affirmative', 'correct',
  'right', 'true', 'execute', 'run it'
];

const NO_PATTERNS = [
  'no', 'nope', 'nah', 'n', 'cancel', 'cancelled', 'stop', 'never mind',
  "don't", 'dont', 'abort', 'abandon', 'skip', 'ignore', 'false', 'wrong',
  'negative', 'decline', 'reject'
];

/**
 * Parses confirmation input (voice or typed) to determine yes/no/unclear.
 * 
 * @param input - User input text
 * @returns 'yes', 'no', or 'unclear'
 */
export function parseConfirmation(input: string): ConfirmationResult {
  const normalized = input.toLowerCase().trim();

  // Check for yes patterns
  for (const pattern of YES_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'yes';
    }
  }

  // Check for no patterns
  for (const pattern of NO_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'no';
    }
  }

  // Single character shortcuts
  if (normalized === 'y') {
    return 'yes';
  }
  if (normalized === 'n') {
    return 'no';
  }

  return 'unclear';
}

/**
 * Prompts user for confirmation via typed input.
 * Returns immediately with the result.
 * 
 * @returns Promise resolving to 'yes', 'no', or 'unclear'
 */
export async function promptTypedConfirmation(): Promise<ConfirmationResult> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const originalRawMode = stdin.isRaw;
    const originalEncoding = stdin.readableEncoding;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const handler = (key: string) => {
      // Handle Enter key
      if (key === '\r' || key === '\n') {
        stdin.removeListener('data', handler);
        stdin.setRawMode(originalRawMode);
        stdin.pause();
        stdin.setEncoding(originalEncoding as BufferEncoding);
        resolve('unclear'); // Enter without y/n is unclear
        return;
      }

      // Handle Ctrl+C
      if (key === '\u0003') {
        stdin.removeListener('data', handler);
        stdin.setRawMode(originalRawMode);
        stdin.pause();
        stdin.setEncoding(originalEncoding as BufferEncoding);
        resolve('no');
        return;
      }

      // Check for y/n
      const lower = key.toLowerCase();
      if (lower === 'y') {
        stdin.removeListener('data', handler);
        stdin.setRawMode(originalRawMode);
        stdin.pause();
        stdin.setEncoding(originalEncoding as BufferEncoding);
        resolve('yes');
      } else if (lower === 'n') {
        stdin.removeListener('data', handler);
        stdin.setRawMode(originalRawMode);
        stdin.pause();
        stdin.setEncoding(originalEncoding as BufferEncoding);
        resolve('no');
      }
      // Otherwise keep listening
    };

    stdin.on('data', handler);
  });
}

/**
 * Gets confirmation from user via voice or typed input.
 * Supports both methods - typed input (y/n) takes priority, voice is fallback.
 * 
 * @param options - Configuration options
 * @returns Promise resolving to 'yes', 'no', or 'unclear'
 */
export async function getConfirmation(options: {
  useVoice?: boolean;
  useLiveTranscription?: boolean;
  silenceMs?: number;
} = {}): Promise<ConfirmationResult> {
  const { useVoice = true, useLiveTranscription = true, silenceMs = 2000 } = options;

  // Show prompt
  console.log('💬 Say "yes" to proceed or "no" to cancel (or type y/n)');

  return new Promise<ConfirmationResult>((resolve) => {
    const stdin = process.stdin;
    let resolved = false;
    let typedHandler: ((key: string) => void) | null = null;
    const originalRawMode = stdin.isRaw;
    const originalEncoding = stdin.readableEncoding;

    // Setup typed input listener (takes priority)
    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      typedHandler = (key: string) => {
        const lower = key.toLowerCase();
        if (lower === 'y' && !resolved) {
          resolved = true;
          if (typedHandler) {
            stdin.removeListener('data', typedHandler);
          }
          stdin.setRawMode(originalRawMode);
          stdin.pause();
          stdin.setEncoding(originalEncoding as BufferEncoding);
          resolve('yes');
        } else if (lower === 'n' && !resolved) {
          resolved = true;
          if (typedHandler) {
            stdin.removeListener('data', typedHandler);
          }
          stdin.setRawMode(originalRawMode);
          stdin.pause();
          stdin.setEncoding(originalEncoding as BufferEncoding);
          resolve('no');
        }
        // Ignore other keys
      };

      stdin.on('data', typedHandler);
    }

    // Also listen for voice if enabled
    if (useVoice) {
      (async () => {
        try {
          const { streamTranscribe } = await import('../voice/streamTranscribe.js');
          const { transcribe } = await import('../voice/transcribe.js');
          const { recordAudio } = await import('../voice/record.js');

          if (useLiveTranscription) {
            console.log('🎤 Listening... (Press Enter to stop, or type y/n)');
            const result = await streamTranscribe({
              live: true,
              silenceMs,
            });
            
            if (!resolved) {
              resolved = true;
              if (typedHandler && stdin.isTTY) {
                stdin.removeListener('data', typedHandler);
                stdin.setRawMode(originalRawMode);
                stdin.pause();
                stdin.setEncoding(originalEncoding as BufferEncoding);
              }
              resolve(parseConfirmation(result.transcript));
            }
          } else {
            console.log('🔴 Recording... (or type y/n)');
            const audioPath = await recordAudio({ durationSeconds: 3 });
            const transcript = await transcribe(audioPath);
            
            if (!resolved) {
              resolved = true;
              if (typedHandler && stdin.isTTY) {
                stdin.removeListener('data', typedHandler);
                stdin.setRawMode(originalRawMode);
                stdin.pause();
                stdin.setEncoding(originalEncoding as BufferEncoding);
              }
              resolve(parseConfirmation(transcript));
            }
          }
        } catch (error) {
          // If voice fails and no typed input, return unclear
          if (!resolved) {
            resolved = true;
            if (typedHandler && stdin.isTTY) {
              stdin.removeListener('data', typedHandler);
              stdin.setRawMode(originalRawMode);
              stdin.pause();
              stdin.setEncoding(originalEncoding as BufferEncoding);
            }
            console.warn('⚠️  Voice input failed');
            resolve('unclear');
          }
        }
      })();
    } else {
      // Voice disabled - wait for Enter to finalize typed input
      if (stdin.isTTY) {
        const enterHandler = (key: string) => {
          if ((key === '\r' || key === '\n') && !resolved) {
            resolved = true;
            if (typedHandler) {
              stdin.removeListener('data', typedHandler);
            }
            stdin.removeListener('data', enterHandler);
            stdin.setRawMode(originalRawMode);
            stdin.pause();
            stdin.setEncoding(originalEncoding as BufferEncoding);
            resolve('unclear'); // Enter without y/n is unclear
          }
        };
        stdin.on('data', enterHandler);
      } else {
        resolve('unclear');
      }
    }
  });
}
