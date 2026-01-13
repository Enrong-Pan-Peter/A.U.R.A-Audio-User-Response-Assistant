import { ExecutionResult } from '../exec/runner.js';

/**
 * Generic summarizer for unknown intents or fallback.
 */
export function summarizeGeneric(result: ExecutionResult): string {
  if (!result.success) {
    const error = result.stderr || result.stdout || 'Unknown error';
    const firstLine = error.split('\n')[0].trim();
    return `Command failed: ${firstLine}`;
  }
  
  const output = result.stdout.trim();
  if (!output) {
    return 'Command completed successfully.';
  }
  
  // Return first few lines
  const lines = output.split('\n').slice(0, 3);
  return lines.join('. ');
}
