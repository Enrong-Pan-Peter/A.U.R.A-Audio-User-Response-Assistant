import { Intent } from '../intents/types.js';
import { ExecutionResult } from '../exec/runner.js';
import { summarizeTests } from './tests.js';
import { summarizeGitStatus } from './git.js';
import { summarizeLint } from './lint.js';
import { summarizeBuild } from './build.js';
import { summarizeGeneric } from './generic.js';

/**
 * Summarizes command output based on intent.
 */
export function summarize(
  intent: Intent,
  result: ExecutionResult
): string {
  switch (intent) {
    case Intent.RUN_TESTS:
      return summarizeTests(result);
      
    case Intent.GIT_STATUS:
      return summarizeGitStatus(result);
      
    case Intent.RUN_LINT:
      return summarizeLint(result);
      
    case Intent.RUN_BUILD:
      return summarizeBuild(result);
      
    default:
      return summarizeGeneric(result);
  }
}
