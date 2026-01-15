/**
 * Extracts the most relevant error lines from command output.
 * Focuses on actual errors, not noise.
 */

export interface ErrorContext {
  relevantLines: string[];
  totalChars: number;
}

/**
 * Extracts relevant error lines from stderr and stdout.
 * Includes surrounding context lines for better understanding.
 * 
 * @param stderr - Standard error output
 * @param stdout - Standard output
 * @param maxChars - Maximum characters to extract (default: 1500)
 * @returns Relevant error lines with context
 */
export function extractRelevantErrors(
  stderr: string,
  stdout: string,
  maxChars: number = 1500
): ErrorContext {
  const errorIndicators = [
    'error',
    'failed',
    'fatal',
    'cannot',
    'can\'t',
    'cannot find',
    'module not found',
    'not found',
    'enoent',
    'err!',
    'typeerror',
    'referenceerror',
    'syntaxerror',
    'parseerror',
    'permission denied',
    'eacces',
    'eexist',
    'spawn',
    'command not found',
    'undefined',
    'null reference',
    'exception',
    'traceback',
    'stack trace',
  ];

  const allLines: Array<{ line: string; source: 'stderr' | 'stdout'; index: number }> = [];
  
  // Process stderr (higher priority)
  if (stderr) {
    const stderrLines = stderr.split('\n');
    stderrLines.forEach((line, index) => {
      allLines.push({ line: line.trim(), source: 'stderr', index });
    });
  }
  
  // Process stdout (lower priority, but check for errors)
  if (stdout) {
    const stdoutLines = stdout.split('\n');
    stdoutLines.forEach((line, index) => {
      allLines.push({ line: line.trim(), source: 'stdout', index });
    });
  }

  // Find lines with error indicators
  const errorLineIndices = new Set<number>();
  
  allLines.forEach((item, index) => {
    const lower = item.line.toLowerCase();
    const hasError = errorIndicators.some(indicator => lower.includes(indicator));
    
    if (hasError && item.line.length > 0) {
      errorLineIndices.add(index);
      
      // Include 1-2 lines before and after for context
      if (index > 0) errorLineIndices.add(index - 1);
      if (index > 1) errorLineIndices.add(index - 2);
      if (index < allLines.length - 1) errorLineIndices.add(index + 1);
      if (index < allLines.length - 2) errorLineIndices.add(index + 2);
    }
  });

  // Extract relevant lines
  const relevantLines: string[] = [];
  let totalChars = 0;
  
  // Sort indices to maintain order
  const sortedIndices = Array.from(errorLineIndices).sort((a, b) => a - b);
  
  for (const index of sortedIndices) {
    if (index >= 0 && index < allLines.length) {
      const item = allLines[index];
      const lineWithContext = item.source === 'stderr' 
        ? `[stderr] ${item.line}`
        : `[stdout] ${item.line}`;
      
      if (totalChars + lineWithContext.length + 1 <= maxChars) {
        relevantLines.push(lineWithContext);
        totalChars += lineWithContext.length + 1; // +1 for newline
      } else {
        break;
      }
    }
  }

  // If we didn't find any error lines, include the last few lines of stderr
  if (relevantLines.length === 0 && stderr) {
    const lastLines = stderr.split('\n').slice(-5).map(line => `[stderr] ${line.trim()}`);
    for (const line of lastLines) {
      if (totalChars + line.length + 1 <= maxChars) {
        relevantLines.push(line);
        totalChars += line.length + 1;
      }
    }
  }

  return {
    relevantLines,
    totalChars,
  };
}
