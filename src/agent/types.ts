import { Intent } from '../intents/types.js';
import { SessionMemory } from '../session/memory.js';

/**
 * Result from the AI agent for planning and explanation.
 */
export interface AgentResult {
  intent: Intent;
  params?: Record<string, string>;
  planSteps: string[];
  explanation?: string;
  confidence: number;
  clarifyingQuestion?: string;
}

/**
 * Context provided to the agent for better understanding.
 */
export interface AgentContext {
  userText: string;
  sessionMemory: SessionMemory;
  availableIntents: Intent[];
}
