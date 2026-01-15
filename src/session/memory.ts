import { Intent } from '../intents/types.js';
import { ExecutionResult } from '../exec/runner.js';
import { LastRun } from '../intents/explainFailure.js';

/**
 * Session memory for chat mode.
 * Stores last action, output, and failure information.
 */
export interface SessionMemory {
  lastAction: Intent | null;
  lastStdout: string;
  lastStderr: string;
  lastExitCode: number;
  lastSummary: string;
  lastFailure: {
    intent: Intent;
    stdout: string;
    stderr: string;
    exitCode: number;
  } | null;
  lastRun: LastRun | null; // Store detailed last run info for failure analysis
  lastAssistantQuestion?: string; // Store follow-up question from assistant for context
  inDiagnosisMode?: boolean; // Track if we're in a diagnosis conversation
}

export function createMemory(): SessionMemory {
  return {
    lastAction: null,
    lastStdout: '',
    lastStderr: '',
    lastExitCode: 0,
    lastSummary: '',
    lastFailure: null,
    lastRun: null,
    lastAssistantQuestion: undefined,
    inDiagnosisMode: false,
  };
}

export function updateMemory(
  memory: SessionMemory,
  intent: Intent,
  result: ExecutionResult,
  summary: string
): void {
  memory.lastAction = intent;
  memory.lastStdout = result.stdout;
  memory.lastStderr = result.stderr;
  memory.lastExitCode = result.exitCode;
  memory.lastSummary = summary;
  
  // Always store lastRun for failure analysis
  if (result.lastRun) {
    memory.lastRun = result.lastRun;
  }
  
  if (!result.success) {
    memory.lastFailure = {
      intent,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
}

/**
 * Explains the last failure using stored memory.
 */
export function explainFailure(memory: SessionMemory): string {
  if (!memory.lastFailure) {
    return 'No failure recorded. Last command succeeded.';
  }
  
  const { intent, stderr, stdout, exitCode } = memory.lastFailure;
  
  let explanation = `Last failure was during ${intent}. Exit code: ${exitCode}.`;
  
  if (stderr) {
    const errorLines = stderr.split('\n').filter(line => line.trim()).slice(0, 3);
    explanation += ` Error: ${errorLines.join('. ')}`;
  } else if (stdout) {
    const outputLines = stdout.split('\n').filter(line => line.trim()).slice(0, 3);
    explanation += ` Output: ${outputLines.join('. ')}`;
  }
  
  return explanation;
}

/**
 * Gets detailed output from last action.
 */
export function getDetails(memory: SessionMemory): string {
  if (!memory.lastAction) {
    return 'No previous action to show details for.';
  }
  
  const output = memory.lastStdout || memory.lastStderr;
  if (!output) {
    return 'No output available from last action.';
  }
  
  // Return last 20 lines
  const lines = output.split('\n');
  const relevantLines = lines.slice(-20);
  return relevantLines.join('\n');
}
