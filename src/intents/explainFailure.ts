/**
 * Detailed failure explanation using command output analysis.
 */

export interface LastRun {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  endedAt: number;
}

/**
 * Extracts key error lines from stderr/stdout.
 */
function extractErrorLines(stderr: string, stdout: string): string[] {
  const errorLines: string[] = [];
  
  // Prioritize stderr
  if (stderr) {
    const stderrLines = stderr.split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Look for common error indicators
        const lower = line.toLowerCase();
        return lower.includes('error') ||
               lower.includes('failed') ||
               lower.includes('fatal') ||
               lower.includes('exception') ||
               lower.includes('cannot') ||
               lower.includes('not found') ||
               lower.includes('permission denied') ||
               lower.includes('syntax error') ||
               lower.includes('type error') ||
               lower.includes('undefined') ||
               /^\d+:\d+/.test(line); // Line numbers like "12:34"
      })
      .slice(0, 5); // Take first 5 error lines
    
    errorLines.push(...stderrLines);
  }
  
  // Also check stdout for errors (some tools print errors to stdout)
  if (stdout && errorLines.length < 3) {
    const stdoutLines = stdout.split('\n')
      .map(line => line.trim())
      .filter(line => {
        const lower = line.toLowerCase();
        return (lower.includes('error') || lower.includes('failed')) &&
               !errorLines.includes(line);
      })
      .slice(0, 3 - errorLines.length);
    
    errorLines.push(...stdoutLines);
  }
  
  return errorLines.length > 0 ? errorLines : ['No specific error messages found'];
}

/**
 * Identifies likely causes based on error patterns.
 */
function identifyCauses(command: string, exitCode: number | null, stderr: string, stdout: string): string[] {
  const causes: string[] = [];
  const combined = (stderr + '\n' + stdout).toLowerCase();
  
  // Build/test failures
  if (command.includes('build') || command.includes('compile')) {
    if (combined.includes('module not found') || combined.includes('cannot find module')) {
      causes.push('Missing dependency - module not installed or not found');
    }
    if (combined.includes('syntax error') || combined.includes('parse error')) {
      causes.push('Syntax error in source code');
    }
    if (combined.includes('type error') || combined.includes('type mismatch')) {
      causes.push('TypeScript or type checking error');
    }
    if (combined.includes('permission denied')) {
      causes.push('File permission issue');
    }
    if (combined.includes('out of memory') || combined.includes('heap')) {
      causes.push('Memory limit exceeded during build');
    }
  }
  
  // Test failures
  if (command.includes('test')) {
    if (combined.includes('assertion') || combined.includes('expected')) {
      causes.push('Test assertion failed');
    }
    if (combined.includes('timeout')) {
      causes.push('Test execution timeout');
    }
    if (combined.includes('cannot find module') || combined.includes('module not found')) {
      causes.push('Test dependency missing');
    }
  }
  
  // Git failures
  if (command.includes('git')) {
    if (combined.includes('not a git repository')) {
      causes.push('Not in a git repository');
    }
    if (combined.includes('nothing to commit')) {
      causes.push('No changes staged for commit');
    }
    if (combined.includes('permission denied')) {
      causes.push('Git permission issue');
    }
    if (combined.includes('merge conflict')) {
      causes.push('Merge conflict detected');
    }
  }
  
  // Generic failures
  if (exitCode === 1 && causes.length === 0) {
    causes.push('Command failed with exit code 1');
  }
  if (exitCode === null || exitCode === 127) {
    causes.push('Command not found or not executable');
  }
  
  return causes.length > 0 ? causes : ['Unknown error - check output for details'];
}

/**
 * Generates concrete next steps based on the failure.
 */
function generateNextSteps(command: string, exitCode: number | null, stderr: string, stdout: string): string[] {
  const steps: string[] = [];
  const combined = (stderr + '\n' + stdout).toLowerCase();
  
  // Build failures
  if (command.includes('build') || command.includes('compile')) {
    if (combined.includes('module not found') || combined.includes('cannot find module')) {
      steps.push('Run: npm install (or pnpm install / yarn install) to install missing dependencies');
      steps.push('Check package.json for correct dependency names');
    }
    if (combined.includes('syntax error') || combined.includes('parse error')) {
      steps.push('Check the file and line number mentioned in the error');
      steps.push('Fix the syntax error (missing brackets, quotes, etc.)');
    }
    if (combined.includes('type error')) {
      steps.push('Review TypeScript errors in your IDE');
      steps.push('Fix type mismatches or add proper type annotations');
    }
    if (combined.includes('permission denied')) {
      steps.push('Check file permissions: chmod +x <file> or run with sudo if needed');
    }
  }
  
  // Test failures
  if (command.includes('test')) {
    steps.push('Review the failing test output above');
    steps.push('Check test expectations and fix the code or test');
    if (combined.includes('timeout')) {
      steps.push('Increase test timeout or optimize slow tests');
    }
  }
  
  // Git failures
  if (command.includes('git')) {
    if (combined.includes('nothing to commit')) {
      steps.push('Stage files first: git add <files>');
      steps.push('Then try committing again');
    }
    if (combined.includes('not a git repository')) {
      steps.push('Initialize git: git init');
    }
    if (combined.includes('merge conflict')) {
      steps.push('Resolve conflicts: git status to see conflicted files');
      steps.push('Edit conflicted files and run: git add <files> && git commit');
    }
  }
  
  // Generic steps if no specific ones
  if (steps.length === 0) {
    steps.push('Review the error output above for specific details');
    steps.push('Check command syntax and required parameters');
    steps.push('Verify all dependencies are installed');
  }
  
  return steps.slice(0, 5); // Limit to 5 steps
}

/**
 * Generates a detailed failure explanation from the last command run.
 * 
 * @param lastRun - Information about the last command execution
 * @returns Detailed explanation with error analysis and next steps
 */
export function explainFailure(lastRun: LastRun): string {
  const { command, cwd, exitCode, stdout, stderr } = lastRun;
  
  // Build the explanation
  let explanation = `\n🔍 Failure Analysis\n`;
  explanation += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // Command info
  explanation += `Command: ${command}\n`;
  explanation += `Working Directory: ${cwd}\n`;
  explanation += `Exit Code: ${exitCode ?? 'null (process error)'}\n`;
  explanation += `Duration: ${((lastRun.endedAt - lastRun.startedAt) / 1000).toFixed(2)}s\n\n`;
  
  // Extract key error lines
  const errorLines = extractErrorLines(stderr, stdout);
  if (errorLines.length > 0) {
    explanation += `Key Errors:\n`;
    errorLines.forEach((line, i) => {
      explanation += `  ${i + 1}. ${line}\n`;
    });
    explanation += `\n`;
  }
  
  // Identify likely causes
  const causes = identifyCauses(command, exitCode, stderr, stdout);
  if (causes.length > 0) {
    explanation += `Likely Causes:\n`;
    causes.forEach((cause, i) => {
      explanation += `  ${i + 1}. ${cause}\n`;
    });
    explanation += `\n`;
  }
  
  // Generate next steps
  const steps = generateNextSteps(command, exitCode, stderr, stdout);
  if (steps.length > 0) {
    explanation += `Next Steps:\n`;
    steps.forEach((step, i) => {
      explanation += `  ${i + 1}. ${step}\n`;
    });
    explanation += `\n`;
  }
  
  // Full output reference
  if (stderr || stdout) {
    explanation += `Full Output:\n`;
    if (stderr) {
      explanation += `  stderr: ${stderr.split('\n').slice(0, 10).join('\n  ')}${stderr.split('\n').length > 10 ? '\n  ...' : ''}\n`;
    }
    if (stdout && !stderr) {
      explanation += `  stdout: ${stdout.split('\n').slice(0, 10).join('\n  ')}${stdout.split('\n').length > 10 ? '\n  ...' : ''}\n`;
    }
  }
  
  return explanation;
}
