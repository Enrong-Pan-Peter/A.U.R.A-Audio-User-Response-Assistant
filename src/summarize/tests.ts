import { ExecutionResult } from '../exec/runner.js';

/**
 * Summarizes test output, extracting pass/fail counts and first error.
 */
export function summarizeTests(result: ExecutionResult): string {
  if (!result.success) {
    // Try to extract failure information
    const output = result.stdout + '\n' + result.stderr;
    
    // Look for common test runner patterns
    const jestFailMatch = output.match(/(\d+) failed/i);
    const jestPassMatch = output.match(/(\d+) passed/i);
    const mochaFailMatch = output.match(/(\d+) failing/i);
    const mochaPassMatch = output.match(/(\d+) passing/i);
    
    const failed = jestFailMatch?.[1] || mochaFailMatch?.[1] || 'some';
    const passed = jestPassMatch?.[1] || mochaPassMatch?.[1] || '0';
    
    // Extract first failing test file/error
    const errorMatch = output.match(/(?:FAIL|Error|✕|×)\s+([^\n]+)/i);
    const errorLine = errorMatch ? errorMatch[1].trim() : null;
    
    if (errorLine) {
      return `Tests failed. ${failed} test${failed !== '1' ? 's' : ''} failed, ${passed} passed. First failure: ${errorLine}`;
    }
    
    return `Tests failed. ${failed} test${failed !== '1' ? 's' : ''} failed, ${passed} passed.`;
  }
  
  // Success case
  const output = result.stdout;
  const passMatch = output.match(/(\d+) passed/i) || output.match(/(\d+) passing/i);
  const passCount = passMatch?.[1] || 'all';
  
  return `All tests passed. ${passCount} test${passCount !== '1' ? 's' : ''} passed.`;
}
