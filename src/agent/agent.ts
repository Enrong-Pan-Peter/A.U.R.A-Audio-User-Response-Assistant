import { Intent } from '../intents/types.js';
import { SessionMemory } from '../session/memory.js';
import { AgentResult } from './types.js';
import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Default to gpt-4o-mini (cost-effective and fast)
const getOpenAIModel = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Plans actions and explains errors using AI agent (OpenAI) or fallback.
 * 
 * @param userText - User's voice input text (transcript from ElevenLabs STT)
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
    // Check if it's a rate limit error
    if (error instanceof Error && (
      error.message.includes('429') || 
      error.message.includes('rate limit') ||
      error.message.includes('quota')
    )) {
      console.warn('⚠️  OpenAI API rate limit exceeded. Using fallback agent.');
    }
    return mockAgent(userText, sessionMemory);
  }
}

/**
 * OpenAI-powered agent for natural language understanding.
 * Processes transcript text (not audio) to understand user intent.
 */
async function openAIAgent(
  userText: string,
  sessionMemory: SessionMemory
): Promise<AgentResult> {
  const availableIntents = Object.values(Intent).filter(
    intent => intent !== Intent.UNKNOWN
  );

  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY!,
  });
  const modelName = getOpenAIModel();
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent.ts:55',message:'Using OpenAI model',data:{modelName},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
  // #endregion

  const systemPrompt = `You are a helpful developer assistant that understands voice commands for git and development tasks.

CRITICAL RULES:
1. You can ONLY choose from these intents: ${availableIntents.join(', ')}
2. NEVER output raw shell commands or command strings
3. Extract parameters like branch names and commit messages from user text
4. Return JSON with: intent, params (object), planSteps (array of strings), explanation (optional), confidence (0-1)
5. If confidence < 0.6, include a clarifyingQuestion instead of executing

Available intents:
- RUN_TESTS: Run test suite
- GIT_STATUS: Check git status
- RUN_LINT: Run linter
- RUN_BUILD: Build project
- CREATE_BRANCH: Create new git branch (requires params.name)
- MAKE_COMMIT: Create git commit (requires params.message)
- EXPLAIN_FAILURE: Explain why last command failed
- DETAILS: Show more details about last output
- REPEAT_LAST: Repeat last summary
- HELP: Show help
- EXIT: Exit the application
- SWITCH_TO_INTERACTIVE_MODE: User wants to switch to interactive/continuous conversation mode (e.g., "i want to speak to you interactively", "switch to interactive mode", "talk to me interactively")
- EXIT_INTERACTIVE_MODE: User wants to exit interactive mode and return to push-to-talk mode (e.g., "exit interactive mode", "stop interactive mode", "go back to push to talk")
- SWITCH_TO_INTERACTIVE_MODE: User wants to switch to interactive mode (continuous conversation without pressing Enter)
- EXIT_INTERACTIVE_MODE: User wants to exit interactive mode and return to push-to-talk mode

${sessionMemory.lastFailure ? `Last failure context: ${JSON.stringify(sessionMemory.lastFailure, null, 2)}` : ''}
${sessionMemory.lastAction ? `Last action: ${sessionMemory.lastAction}` : ''}

Analyze the user's request and return a JSON object with:
- intent: one of the available intents
- params: object with extracted parameters (e.g., {name: "branch-name"} for CREATE_BRANCH, {message: "commit message"} for MAKE_COMMIT)
- planSteps: array of human-readable steps that will be executed (e.g., ["Check git status", "List modified files"])
- explanation: optional explanation (especially for EXPLAIN_FAILURE intent)
- confidence: number between 0 and 1
- clarifyingQuestion: optional question if confidence < 0.6

Return ONLY valid JSON, no markdown, no code blocks.`;

  const userPrompt = `User said: "${userText}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI API returned empty response');
    }

    let parsed: any;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanContent);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent.ts:115',message:'OpenAI response parsed',data:{parsedIntent:parsed.intent,hasIntent:!!parsed.intent,parsedKeys:Object.keys(parsed),fullParsed:JSON.stringify(parsed).substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent.ts:118',message:'Failed to parse OpenAI response',data:{error:e instanceof Error?e.message:String(e),content:content.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to parse OpenAI response: ${content}`);
    }

    // Handle null intent - when OpenAI doesn't recognize the command
    const confidence = Math.max(0, Math.min(1, parsed.confidence || 0.5));
    
    if (!parsed.intent || parsed.intent === null) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'agent.ts:127',message:'OpenAI returned null intent, using UNKNOWN with clarifying question',data:{parsedKeys:Object.keys(parsed),hasClarifyingQuestion:!!parsed.clarifyingQuestion},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      // Return UNKNOWN intent with clarifying question if available
      return {
        intent: Intent.UNKNOWN,
        params: parsed.params || {},
        planSteps: [],
        confidence,
        clarifyingQuestion: parsed.clarifyingQuestion || "I didn't understand that command. Try saying 'help' for available commands.",
      };
    }
    
    const intent = validateIntent(parsed.intent);
    
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
  } catch (error) {
    if (error instanceof Error) {
      // Handle rate limit errors
      if (error.message.includes('429') || error.message.includes('quota')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
      throw error;
    }
    throw new Error(`OpenAI API error: ${error}`);
  }
}

/**
 * Mock/fallback agent using simple keyword matching (same as router).
 * Used when OpenAI API is unavailable or rate limited.
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
  let explanation: string | undefined;
  if (plan.intent === Intent.EXPLAIN_FAILURE && sessionMemory.lastFailure) {
    explanation = `The last command (${sessionMemory.lastFailure.intent}) failed with exit code ${sessionMemory.lastFailure.exitCode}. ${sessionMemory.lastFailure.stderr || sessionMemory.lastFailure.stdout || 'No additional error details available.'}`;
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
function validateIntent(intentString: string | null | undefined): Intent {
  if (!intentString) {
    console.warn(`Invalid intent from AI: null/undefined, defaulting to UNKNOWN`);
    return Intent.UNKNOWN;
  }
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
