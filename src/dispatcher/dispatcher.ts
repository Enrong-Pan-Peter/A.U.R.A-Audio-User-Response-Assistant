import { Intent } from '../intents/types.js';
import { AgentResult } from '../agent/types.js';
import { CommandTemplate } from '../exec/runner.js';
import { SessionMemory } from '../session/memory.js';
import { getDetails } from '../session/memory.js';
import { explainFailure } from '../intents/explainFailure.js';

/**
 * Categorizes intents into informational (immediate response) vs action (requires execution).
 */
export type IntentCategory = 'info' | 'action';

/**
 * Informational intent result - immediate response, no execution needed.
 */
export interface InfoIntentResult {
  type: 'info';
  intent: Intent;
  responseText: string;
}

/**
 * Action intent result - requires command execution (with optional confirmation).
 */
export interface ActionIntentResult {
  type: 'action';
  intent: Intent;
  plan: string;
  commandTemplate: CommandTemplate;
  params?: Record<string, string>;
  requiresConfirmation: boolean;
}

/**
 * Dispatched result from agent.
 */
export type DispatchedResult = InfoIntentResult | ActionIntentResult;

/**
 * Determines if an intent is informational (immediate response) or action (requires execution).
 */
function categorizeIntent(intent: Intent): IntentCategory {
  const infoIntents: Intent[] = [
    Intent.EXPLAIN_FAILURE,
    Intent.DETAILS,
    Intent.HELP,
    Intent.REPEAT_LAST,
    Intent.UNKNOWN,
    Intent.EXIT,
  ];
  
  return infoIntents.includes(intent) ? 'info' : 'action';
}

/**
 * Handles informational intents by generating the response text.
 */
async function handleInfoIntent(
  intent: Intent,
  agentResult: AgentResult,
  memory: SessionMemory
): Promise<InfoIntentResult> {
  let responseText: string;

  switch (intent) {
    case Intent.EXPLAIN_FAILURE:
      // Generate real explanation from lastRun if available
      if (memory.lastRun) {
        responseText = explainFailure(memory.lastRun);
      } else if (memory.lastFailure) {
        // Fallback: construct LastRun from lastFailure
        responseText = explainFailure({
          command: `Last ${memory.lastFailure.intent}`,
          cwd: process.cwd(),
          exitCode: memory.lastFailure.exitCode,
          stdout: memory.lastFailure.stdout,
          stderr: memory.lastFailure.stderr,
          startedAt: Date.now() - 10000, // Estimate
          endedAt: Date.now(),
        });
      } else {
        responseText = 'No failure recorded yet. Please run a command that fails (like "run build" or "run tests"), then ask me to explain the failure.';
      }
      break;

    case Intent.DETAILS:
      responseText = getDetails(memory);
      break;

    case Intent.HELP:
      responseText = 'Available commands: run tests, git status, run lint, run build, create branch, commit, explain failure, details, repeat, help, exit.';
      break;

    case Intent.REPEAT_LAST:
      if (memory.lastSummary) {
        responseText = memory.lastSummary;
      } else {
        responseText = 'No previous summary to repeat.';
      }
      break;

    case Intent.UNKNOWN:
      responseText = "I didn't understand that. Try saying \"help\" for available commands.";
      break;

    case Intent.EXIT:
      responseText = 'Goodbye!';
      break;

    default:
      responseText = `Processing ${intent}...`;
  }

  return {
    type: 'info',
    intent,
    responseText,
  };
}

/**
 * Handles action intents by getting the command template.
 */
async function handleActionIntent(
  intent: Intent,
  agentResult: AgentResult,
  repoPath: string
): Promise<DispatchedResult> {
  const { getCommandForIntent } = await import('../intents/whitelist.js');
  const { createPlan } = await import('../intents/router.js');

  // Get command template
  const commandTemplate = await getCommandForIntent(intent, agentResult.params, repoPath);

  if (!commandTemplate) {
    // If no command template, treat as info intent with error message
    let errorText: string;
    if (intent === Intent.MAKE_COMMIT) {
      errorText = 'Cannot commit: no staged changes. Please stage files first using git add.';
    } else {
      errorText = `Cannot execute ${intent}. Command not available or parameters missing.`;
    }
    
    // Return as info intent with error message
    return {
      type: 'info',
      intent,
      responseText: errorText,
    };
  }

  // Get plan to determine if confirmation is needed
  const plan = createPlan({
    intent,
    params: agentResult.params,
    confidence: agentResult.confidence,
  });

  return {
    type: 'action',
    intent,
    plan: agentResult.planSteps.join(' → ') || plan.description,
    commandTemplate,
    params: agentResult.params,
    requiresConfirmation: plan.requiresConfirmation,
  };
}

/**
 * Dispatches an agent result into either an info or action intent.
 * This is the main entry point for handling agent results.
 * 
 * @param agentResult - Result from the AI agent
 * @param memory - Session memory for context
 * @param repoPath - Repository path for command execution
 * @returns Dispatched result (info or action)
 */
export async function dispatchAgentResult(
  agentResult: AgentResult,
  memory: SessionMemory,
  repoPath: string
): Promise<DispatchedResult> {
  const category = categorizeIntent(agentResult.intent);

  if (category === 'info') {
    return await handleInfoIntent(agentResult.intent, agentResult, memory);
  } else {
    return await handleActionIntent(agentResult.intent, agentResult, repoPath);
  }
}
