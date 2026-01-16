import { AgentResult } from '../agent/types.js';
import { explainFailureLLM } from '../intents/explainFailureLLM.js';
import { Intent } from '../intents/types.js';
import { CommandTemplate } from '../intents/whitelist.js';
import { getDetails, SessionMemory } from '../session/memory.js';
import { DEFAULT_RESPONSE_STYLE, shouldIncludeSnippets } from '../session/responseStyle.js';

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
  shouldExit?: boolean; // If true, indicates this response should exit the chat
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
    Intent.CODEBASE_QA,
    Intent.INTERACTIVE_MODE,
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
      // Generate conversational explanation from lastRun if available
      if (memory.lastRun) {
        const style = memory.responseStyle || DEFAULT_RESPONSE_STYLE;
        responseText = await explainFailureLLM(
          memory.lastRun.command,
          memory.lastRun.cwd,
          memory.lastRun.exitCode,
          memory.lastRun.stderr,
          memory.lastRun.stdout,
          style
        );
        // Enter diagnosis mode for follow-up questions
        memory.inDiagnosisMode = true;
        // Check if response contains a question (simple heuristic)
        if (responseText.includes('?') || responseText.toLowerCase().includes('would you like')) {
          memory.lastAssistantQuestion = responseText;
        }
      } else if (memory.lastFailure) {
        const style = memory.responseStyle || DEFAULT_RESPONSE_STYLE;
        // Fallback: use lastFailure data
        responseText = await explainFailureLLM(
          `Last ${memory.lastFailure.intent}`,
          process.cwd(),
          memory.lastFailure.exitCode,
          memory.lastFailure.stderr,
          memory.lastFailure.stdout,
          style
        );
        memory.inDiagnosisMode = true;
        if (responseText.includes('?') || responseText.toLowerCase().includes('would you like')) {
          memory.lastAssistantQuestion = responseText;
        }
      } else {
        responseText = 'No failure recorded yet. Please run a command that fails (like "run build" or "run tests"), then ask me to explain the failure.';
        memory.inDiagnosisMode = false;
      }
      break;

    case Intent.DETAILS:
      responseText = getDetails(memory);
      break;

    case Intent.HELP:
      responseText = 'Available commands: run tests, git status, run lint, run build, create branch, commit, explain failure, details, codebase questions (e.g., "where is X", "how does Y work"), repeat, help, exit.';
      break;

    case Intent.REPEAT_LAST:
      if (memory.lastSummary) {
        responseText = memory.lastSummary;
      } else {
        responseText = 'No previous summary to repeat.';
      }
      break;

    case Intent.CODEBASE_QA:
      // Extract query from agent result params or planSteps
      // The agent should extract the query from the user's question
      const query = agentResult.params?.query || 
                   agentResult.planSteps.join(' ') || 
                   'codebase question';
      const style = memory.responseStyle || DEFAULT_RESPONSE_STYLE;
      const includeSnippets = shouldIncludeSnippets(query, style);
      
      const { answerCodebaseQuestion } = await import('../intents/codebaseQA.js');
      const qaResult = await answerCodebaseQuestion(query, process.cwd(), {
        responseStyle: style,
        includeSnippets,
      });
      responseText = qaResult.answer;
      
      // Check if this response indicates an exit (e.g., "Thank you, bye")
      const shouldExit = qaResult.shouldExit || false;
      
      // Add file references if available (but don't duplicate if already in answer)
      if (includeSnippets && qaResult.referencedFiles.length > 0 && !responseText.includes('Referenced files')) {
        const fileRefs = qaResult.referencedFiles
          .map(ref => `  - ${ref.file} (lines ${ref.lines.join(', ')})`)
          .join('\n');
        responseText += `\n\n**Referenced files:**\n${fileRefs}`;
      }
      
      // Add follow-up suggestion if available
      if (qaResult.followUpSuggestion && !responseText.includes(qaResult.followUpSuggestion) && style.verbosity !== 'short') {
        responseText += `\n\n${qaResult.followUpSuggestion}`;
      }
      
      // Return with shouldExit flag if set
      return {
        type: 'info',
        intent: shouldExit ? Intent.EXIT : intent,
        responseText,
        shouldExit,
      };

    case Intent.INTERACTIVE_MODE:
      // This is handled in chat.ts by checking the intent
      responseText = 'Switching to interactive mode. You can now talk naturally without push-to-talk.';
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
    shouldExit: false,
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
    switch (intent) {
      case Intent.MAKE_COMMIT:
        errorText = 'Cannot commit: no staged changes. Please stage files first using git add.';
        break;
      case Intent.RUN_TESTS:
        errorText = 'Cannot run tests: no test script found in package.json. Add a "test" script to your package.json to enable this command.';
        break;
      case Intent.RUN_LINT:
        errorText = 'Cannot run lint: no lint script found in package.json. Add a "lint" script to your package.json to enable this command.';
        break;
      case Intent.RUN_BUILD:
        errorText = 'Cannot run build: no build script found in package.json. Add a "build" script to your package.json to enable this command.';
        break;
      case Intent.CREATE_BRANCH:
        errorText = 'Cannot create branch: branch name is required. Please specify a branch name (e.g., "create branch feature-x").';
        break;
      default:
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
