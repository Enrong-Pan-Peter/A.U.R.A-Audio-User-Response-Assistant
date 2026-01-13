import { spawn } from 'child_process';
import { CommandTemplate } from '../intents/whitelist.js';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

/**
 * Safely executes a command using spawn (never shell injection).
 * 
 * @param template - Command template with command, args, and cwd
 * @returns Execution result with stdout, stderr, and exit code
 */
export async function executeCommand(template: CommandTemplate): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const { command, args, cwd } = template;
    
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      stdio: 'pipe',
      shell: false, // Never use shell to prevent injection
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        success: exitCode === 0,
      });
    });
    
    child.on('error', (error) => {
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        success: false,
      });
    });
  });
}
