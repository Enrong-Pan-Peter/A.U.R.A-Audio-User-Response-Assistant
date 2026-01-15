import { Intent } from '../intents/types.js';
import { SessionMemory } from '../session/memory.js';
import { AgentResult } from './types.js';
import {
  DEFAULT_RESPONSE_STYLE,
  getMaxSentences,
  limitToSentences,
  normalizeResponseText,
} from '../session/responseStyle.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Plans actions and explains errors using AI agent (OpenAI) or fallback.
 * 
 * @param userText - User's voice input text
 * @param sessionMemory - Current session memory for context
 * @returns Promise resolving to agent result with intent, plan, and explanation
 */
export async function planAndExplain(
  userText: string,
  sessionMemory: SessionMemory
): Promise<AgentResult> {
  if (!OPENAI_API_KEY) {
    // Fallback to mock agent if API key is missing
    return mockAgent(userText, sessionMemory);
  }

  try {
    return await openAIAgent(userText, sessionMemory);
  } catch (error) {
    console.warn('⚠️  AI agent error, falling back to mock:', error);
    return mockAgent(userText, sessionMemory);
  }
}

/**
 * OpenAI-powered agent for natural language understanding.
 */
async function openAIAgent(
  userText: string,
  sessionMemory: SessionMemory
): Promise<AgentResult> {
  const availableIntents = Object.values(Intent).filter(
    intent => intent !== Intent.UNKNOWN
  );
  const responseStyle = sessionMemory.responseStyle || DEFAULT_RESPONSE_STYLE;

  const systemPrompt = `You are a helpful developer assistant that understands voice commands for git and development tasks.

CRITICAL RULES:
1. You can ONLY choose from these intents: ${availableIntents.join(', ')}
2. NEVER output raw shell commands or command strings
3. Extract parameters like branch names and commit messages from user text
4. Return JSON with: intent, params (object), planSteps (array of strings), explanation (optional), confidence (0-1)
5. If confidence < 0.6, include a clarifyingQuestion instead of executing
6. When writing the "explanation" field, keep it concise and conversational by default (2-4 sentences max)

Available intents:
- RUN_TESTS: Run test suite
- GIT_STATUS: Check git status
- RUN_LINT: Run linter
- RUN_BUILD: Build project
- CREATE_BRANCH: Create new git branch (requires params.name)
- MAKE_COMMIT: Create git commit (requires params.message)
- EXPLAIN_FAILURE: Explain why last command failed
- DETAILS: Show more details about last output
- CODEBASE_QA: Answer questions about the codebase (requires params.query)
- REPEAT_LAST: Repeat last summary
- HELP: Show help
- EXIT: Exit the application

${sessionMemory.lastFailure ? `Last failure context: ${JSON.stringify(sessionMemory.lastFailure, null, 2)}` : ''}
${sessionMemory.lastAction ? `Last action: ${sessionMemory.lastAction}` : ''}`;

  const userPrompt = `User said: "${userText}"

Analyze this request and return a JSON object with:
- intent: one of the available intents
- params: object with extracted parameters:
  * For CREATE_BRANCH: {name: "branch-name"}
  * For MAKE_COMMIT: {message: "commit message"}
  * For CODEBASE_QA: {query: "the user's question about the codebase"}
- planSteps: array of human-readable steps that will be executed (e.g., ["Check git status", "List modified files"])
- explanation: a natural language explanation of what you will do (e.g., "I'll check the git status and show you any modified files" or "I'll run the test suite and report the results"). This will be spoken to the user, so make it conversational and clear.
- confidence: number between 0 and 1
- clarifyingQuestion: optional question if confidence < 0.6

IMPORTANT: 
- Always provide an "explanation" field with a clear, conversational description of what action will be taken. This explanation will be spoken aloud to the user.
- For CODEBASE_QA intent, extract the user's question and put it in params.query (e.g., if user says "where is recording timeout", set params.query to "where is recording timeout").
 - responseStyle.mode is "${responseStyle.mode}" and responseStyle.verbosity is "${responseStyle.verbosity}". Keep the explanation aligned with that.

Return ONLY valid JSON, no markdown, no code blocks.`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  interface OpenAIResponse {
    choices: Array<{
      message: {
        content: string;
      };
    }>;
  }

  const data = await response.json() as OpenAIResponse;
  const content = data.choices[0].message.content;
  
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse AI response: ${content}`);
  }

  // Validate and sanitize the response
  const intent = validateIntent(parsed.intent);
  const confidence = Math.max(0, Math.min(1, parsed.confidence || 0.5));
  
  // If confidence is low, return with clarifying question
  if (confidence < 0.6 && parsed.clarifyingQuestion) {
    return {
      intent: Intent.UNKNOWN, // Don't execute if low confidence
      planSteps: [],
      confidence,
      clarifyingQuestion: parsed.clarifyingQuestion,
    };
  }

  return {
    intent,
    params: parsed.params || {},
    planSteps: Array.isArray(parsed.planSteps) ? parsed.planSteps : [],
    explanation: parsed.explanation,
    confidence,
  };
}

/**
 * Mock/fallback agent using simple keyword matching (same as router).
 * Used when OpenAI API is unavailable.
 */
async function mockAgent(
  userText: string,
  sessionMemory: SessionMemory
): Promise<AgentResult> {
  // Import router functions for fallback
  const { routeIntent, createPlan } = await import('../intents/router.js');
  
  const intentResult = routeIntent(userText);
  const plan = createPlan(intentResult);
  
  // Generate simple plan steps based on intent
  const planSteps = generatePlanSteps(plan.intent, plan.params);
  
  // Generate explanation if it's an EXPLAIN_FAILURE intent
  const style = sessionMemory.responseStyle || DEFAULT_RESPONSE_STYLE;
  let explanation: string | undefined;
  if (plan.intent === Intent.EXPLAIN_FAILURE && sessionMemory.lastFailure) {
    explanation = `The last command (${sessionMemory.lastFailure.intent}) failed with exit code ${sessionMemory.lastFailure.exitCode}. ${sessionMemory.lastFailure.stderr || sessionMemory.lastFailure.stdout || 'No additional error details available.'}`;
    explanation = limitToSentences(normalizeResponseText(explanation), getMaxSentences(style));
  }
  
  return {
    intent: plan.intent,
    params: plan.params,
    planSteps,
    explanation,
    confidence: intentResult.confidence,
  };
}

/**
 * Validates that the intent from AI is one of the allowed intents.
 */
function validateIntent(intentString: string): Intent {
  const intent = intentString as Intent;
  if (Object.values(Intent).includes(intent)) {
    return intent;
  }
  console.warn(`Invalid intent from AI: ${intentString}, defaulting to UNKNOWN`);
  return Intent.UNKNOWN;
}

/**
 * Generates human-readable plan steps for an intent.
 */
function generatePlanSteps(
  intent: Intent,
  params?: Record<string, string>
): string[] {
  switch (intent) {
    case Intent.RUN_TESTS:
      return ['Detect package manager', 'Run test suite', 'Report results'];
    case Intent.GIT_STATUS:
      return ['Check git status', 'List modified and untracked files'];
    case Intent.RUN_LINT:
      return ['Detect package manager', 'Run linter', 'Report issues'];
    case Intent.RUN_BUILD:
      return ['Detect package manager', 'Build project', 'Report build status'];
    case Intent.CREATE_BRANCH:
      return [`Create and checkout branch: ${params?.name || 'new branch'}`];
    case Intent.MAKE_COMMIT:
      return [`Create commit with message: "${params?.message || 'commit message'}"`];
    case Intent.EXPLAIN_FAILURE:
      return ['Analyze last failure', 'Explain error'];
    case Intent.DETAILS:
      return ['Retrieve last command output', 'Display details'];
    case Intent.REPEAT_LAST:
      return ['Retrieve last summary', 'Repeat summary'];
    case Intent.HELP:
      return ['Display available commands'];
    case Intent.EXIT:
      return ['Exit application'];
    default:
      return ['Process request'];
  }
}
