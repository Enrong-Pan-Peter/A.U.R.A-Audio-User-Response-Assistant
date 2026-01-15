import { spawn } from 'child_process';
import { CommandTemplate } from '../intents/whitelist.js';
import { LastRun } from '../intents/explainFailure.js';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  lastRun?: LastRun; // Include LastRun for failure analysis
}

/**
 * Safely executes a command using spawn (never shell injection).
 * 
 * @param template - Command template with command, args, and cwd
 * @returns Execution result with stdout, stderr, exit code, and LastRun info
 */
export async function executeCommand(template: CommandTemplate): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const { command, args, cwd } = template;
    const startedAt = Date.now();
    const commandString = `${command} ${args.join(' ')}`;
    const workingDir = cwd || process.cwd();
    
    const child = spawn(command, args, {
      cwd: workingDir,
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
      const endedAt = Date.now();
      const exitCode = code ?? 1;
      
      const lastRun: LastRun = {
        command: commandString,
        cwd: workingDir,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        startedAt,
        endedAt,
      };
      
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        success: exitCode === 0,
        lastRun,
      });
    });
    
    child.on('error', (error) => {
      const endedAt = Date.now();
      const errorMessage = error.message;
      
      const lastRun: LastRun = {
        command: commandString,
        cwd: workingDir,
        exitCode: null,
        stdout: '',
        stderr: errorMessage,
        startedAt,
        endedAt,
      };
      
      resolve({
        stdout: '',
        stderr: errorMessage,
        exitCode: 1,
        success: false,
        lastRun,
      });
    });
  });
}
