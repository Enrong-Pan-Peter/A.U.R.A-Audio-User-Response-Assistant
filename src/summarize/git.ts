import { ExecutionResult } from '../exec/runner.js';

/**
 * Summarizes git status output.
 */
export function summarizeGitStatus(result: ExecutionResult): string {
  if (!result.success) {
    return `Git status failed: ${result.stderr || 'Unknown error'}`;
  }
  
  const lines = result.stdout.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    return 'Working directory is clean. No changes.';
  }
  
  const modified: string[] = [];
  const untracked: string[] = [];
  
  for (const line of lines) {
    const status = line.substring(0, 2);
    const file = line.substring(3).trim();
    
    if (status.includes('??')) {
      untracked.push(file);
    } else if (status.trim()) {
      modified.push(file);
    }
  }
  
  const modCount = modified.length;
  const untrackedCount = untracked.length;
  
  let summary = `Found ${modCount} modified file${modCount !== 1 ? 's' : ''}`;
  if (untrackedCount > 0) {
    summary += ` and ${untrackedCount} untracked file${untrackedCount !== 1 ? 's' : ''}`;
  }
  summary += '.';
  
  // List up to 5 files
  const allFiles = [...modified.slice(0, 5), ...untracked.slice(0, 5 - modified.length)];
  if (allFiles.length > 0) {
    summary += ` Files: ${allFiles.join(', ')}`;
    if (modCount + untrackedCount > 5) {
      summary += ` and ${modCount + untrackedCount - 5} more`;
    }
  }
  
  return summary;
}
