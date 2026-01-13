/**
 * Intent types for command routing
 */

export enum Intent {
  RUN_TESTS = 'RUN_TESTS',
  GIT_STATUS = 'GIT_STATUS',
  RUN_LINT = 'RUN_LINT',
  RUN_BUILD = 'RUN_BUILD',
  CREATE_BRANCH = 'CREATE_BRANCH',
  MAKE_COMMIT = 'MAKE_COMMIT',
  EXPLAIN_FAILURE = 'EXPLAIN_FAILURE',
  DETAILS = 'DETAILS',
  REPEAT_LAST = 'REPEAT_LAST',
  HELP = 'HELP',
  EXIT = 'EXIT',
  UNKNOWN = 'UNKNOWN',
}

export interface IntentResult {
  intent: Intent;
  params?: Record<string, string>;
  confidence: number;
}

export interface CommandPlan {
  intent: Intent;
  description: string;
  requiresConfirmation: boolean;
  params?: Record<string, string>;
}
