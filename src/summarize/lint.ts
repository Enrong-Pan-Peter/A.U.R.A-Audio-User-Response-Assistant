import { ExecutionResult } from '../exec/runner.js';

/**
 * Summarizes lint output.
 */
export function summarizeLint(result: ExecutionResult): string {
  if (!result.success) {
    const output = result.stdout + '\n' + result.stderr;
    
    // Try to extract first error block
    const errorMatch = output.match(/(?:error|warning|✖|×)\s+([^\n]+(?:\n[^\n]+){0,3})/i);
    if (errorMatch) {
      const errorText = errorMatch[1].trim().split('\n')[0];
      return `Lint failed. First error: ${errorText}`;
    }
    
    return `Lint failed. Check output for details.`;
  }
  
  return 'Lint passed. No issues found.';
}
