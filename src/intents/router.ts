import { Intent, IntentResult, CommandPlan } from './types.js';

/**
 * Routes user text to an intent with parameters.
 * Uses simple keyword matching and fuzzy matching.
 */
export function routeIntent(text: string): IntentResult {
  const normalized = text.toLowerCase().trim();
  
  // Exit intent
  if (matches(normalized, ['exit', 'quit', 'stop', 'bye', 'goodbye'])) {
    return { intent: Intent.EXIT, confidence: 1.0 };
  }
  
  // Help intent
  if (matches(normalized, ['help', 'what can you do', 'commands', 'options'])) {
    return { intent: Intent.HELP, confidence: 1.0 };
  }
  
  // Repeat last
  if (matches(normalized, ['repeat', 'say that again', 'repeat last', 'what did you say'])) {
    return { intent: Intent.REPEAT_LAST, confidence: 1.0 };
  }
  
  // Details
  if (matches(normalized, ['details', 'more details', 'show details', 'tell me more', 'explain more'])) {
    return { intent: Intent.DETAILS, confidence: 1.0 };
  }
  
  // Explain failure
  if (matches(normalized, ['explain failure', 'why did it fail', 'what went wrong', 'explain the error', 'what failed'])) {
    return { intent: Intent.EXPLAIN_FAILURE, confidence: 1.0 };
  }
  
  // Run tests
  if (matches(normalized, ['run tests', 'test', 'tests', 'run test suite', 'execute tests'])) {
    return { intent: Intent.RUN_TESTS, confidence: 0.9 };
  }
  
  // Git status
  if (matches(normalized, ['git status', 'status', 'git state', 'what changed', 'show changes', 'check status'])) {
    return { intent: Intent.GIT_STATUS, confidence: 0.9 };
  }
  
  // Run lint
  if (matches(normalized, ['run lint', 'lint', 'check lint', 'linter', 'run linter'])) {
    return { intent: Intent.RUN_LINT, confidence: 0.9 };
  }
  
  // Run build
  if (matches(normalized, ['run build', 'build', 'compile', 'build project'])) {
    return { intent: Intent.RUN_BUILD, confidence: 0.9 };
  }
  
  // Create branch
  const branchMatch = normalized.match(/create branch (?:called |named )?([a-z0-9\-_]+)/i);
  if (branchMatch || matches(normalized, ['create branch', 'new branch', 'make branch'])) {
    const branchName = branchMatch ? branchMatch[1] : extractBranchName(normalized);
    if (branchName) {
      return { intent: Intent.CREATE_BRANCH, params: { name: branchName }, confidence: 0.8 };
    }
    return { intent: Intent.CREATE_BRANCH, confidence: 0.7 }; // Branch name missing
  }
  
  // Make commit
  const commitMatch = normalized.match(/commit (?:with message |message )?["']?([^"']+)["']?/i);
  if (commitMatch || matches(normalized, ['commit', 'make commit', 'create commit'])) {
    const message = commitMatch ? commitMatch[1] : extractCommitMessage(normalized);
    if (message) {
      return { intent: Intent.MAKE_COMMIT, params: { message }, confidence: 0.8 };
    }
    return { intent: Intent.MAKE_COMMIT, confidence: 0.7 }; // Message missing
  }
  
  return { intent: Intent.UNKNOWN, confidence: 0.0 };
}

/**
 * Checks if text matches any of the keywords (fuzzy matching).
 */
function matches(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * Extracts branch name from text.
 */
function extractBranchName(text: string): string | null {
  // Try to find a branch name pattern
  const patterns = [
    /branch (?:called |named )?([a-z0-9\-_]+)/i,
    /([a-z0-9\-_]+) branch/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Extracts commit message from text.
 */
function extractCommitMessage(text: string): string | null {
  // Try to find message after "commit" or "message"
  const patterns = [
    /commit (?:with message |message )?["']?([^"']+)["']?/i,
    /message ["']?([^"']+)["']?/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

/**
 * Creates a command plan from an intent result.
 */
export function createPlan(intentResult: IntentResult): CommandPlan {
  const { intent, params } = intentResult;
  
  const plans: Record<Intent, Omit<CommandPlan, 'intent'>> = {
    [Intent.RUN_TESTS]: {
      description: 'Run test suite',
      requiresConfirmation: false,
    },
    [Intent.GIT_STATUS]: {
      description: 'Check git status',
      requiresConfirmation: false,
    },
    [Intent.RUN_LINT]: {
      description: 'Run linter',
      requiresConfirmation: false,
    },
    [Intent.RUN_BUILD]: {
      description: 'Build project',
      requiresConfirmation: false,
    },
    [Intent.CREATE_BRANCH]: {
      description: params?.name ? `Create branch: ${params.name}` : 'Create new branch',
      requiresConfirmation: true,
      params,
    },
    [Intent.MAKE_COMMIT]: {
      description: params?.message ? `Commit with message: "${params.message}"` : 'Create commit',
      requiresConfirmation: true,
      params,
    },
    [Intent.EXPLAIN_FAILURE]: {
      description: 'Explain last failure',
      requiresConfirmation: false,
    },
    [Intent.DETAILS]: {
      description: 'Show more details about last output',
      requiresConfirmation: false,
    },
    [Intent.REPEAT_LAST]: {
      description: 'Repeat last summary',
      requiresConfirmation: false,
    },
    [Intent.HELP]: {
      description: 'Show help',
      requiresConfirmation: false,
    },
    [Intent.EXIT]: {
      description: 'Exit',
      requiresConfirmation: false,
    },
    [Intent.UNKNOWN]: {
      description: 'Unknown command',
      requiresConfirmation: false,
    },
    [Intent.SWITCH_TO_INTERACTIVE_MODE]: {
      description: 'Switch to interactive/continuous conversation mode',
      requiresConfirmation: false,
    },
    [Intent.EXIT_INTERACTIVE_MODE]: {
      description: 'Exit interactive mode and return to push-to-talk mode',
      requiresConfirmation: false,
    },
  };
  
  return {
    intent,
    ...plans[intent],
  };
}
