import { Intent } from '../intents/types.js';
import { CommandTemplate } from '../exec/runner.js';

/**
 * Application state for managing command flow and confirmations.
 */
export enum AppState {
  LISTENING_FOR_COMMAND = 'LISTENING_FOR_COMMAND',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
}

/**
 * Pending action that requires confirmation before execution.
 */
export interface PendingAction {
  intent: Intent;
  description: string;
  commandTemplate: CommandTemplate;
  params?: Record<string, string>;
}
