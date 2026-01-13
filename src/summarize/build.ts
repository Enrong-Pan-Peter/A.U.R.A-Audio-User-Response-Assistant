import { ExecutionResult } from '../exec/runner.js';

/**
 * Summarizes build output.
 */
export function summarizeBuild(result: ExecutionResult): string {
  if (!result.success) {
    const output = result.stdout + '\n' + result.stderr;
    
    // Try to extract first error block
    const errorMatch = output.match(/(?:error|failed|✖|×)\s+([^\n]+(?:\n[^\n]+){0,3})/i);
    if (errorMatch) {
      const errorText = errorMatch[1].trim().split('\n')[0];
      return `Build failed. First error: ${errorText}`;
    }
    
    return `Build failed. Check output for details.`;
  }
  
  // Look for success indicators
  const output = result.stdout.toLowerCase();
  if (output.includes('success') || output.includes('built')) {
    return 'Build succeeded.';
  }
  
  return 'Build completed successfully.';
}
