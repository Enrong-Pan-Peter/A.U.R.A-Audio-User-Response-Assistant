/**
 * Generates conversational, ChatGPT-style failure explanations using LLM.
 */

import { extractRelevantErrors } from '../utils/extractRelevantErrors.js';
import {
  DEFAULT_RESPONSE_STYLE,
  ResponseStyle,
  getMaxSentences,
  limitToSentences,
  normalizeResponseText,
} from '../session/responseStyle.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export interface FailureContext {
  command: string;
  cwd: string;
  exitCode: number | null;
  relevantErrors: string[];
}

/**
 * Generates a fast-path deterministic explanation for common errors.
 * Returns null if no fast path matches.
 */
function getFastPathExplanation(
  command: string,
  exitCode: number | null,
  stderr: string,
  stdout: string,
  style: ResponseStyle
): string | null {
  const combined = (stderr + '\n' + stdout).toLowerCase();
  
  // pnpm not found
  if (combined.includes('spawn pnpm') && combined.includes('enoent')) {
    return formatFailureResponse(
      {
        cause: "Looks like your terminal can't find pnpm (not in PATH).",
        fix: 'Enable Corepack or install pnpm, then rerun your command.',
        verify: 'where pnpm',
        question: 'Want me to check it for you?',
      },
      style
    );
  }
  
  // npm not found
  if (combined.includes('spawn npm') && combined.includes('enoent')) {
    return formatFailureResponse(
      {
        cause: "Your terminal can't find npm, so Node.js likely isn't installed or on PATH.",
        fix: 'Install Node.js, then rerun the command.',
        verify: 'node -v && npm -v',
        question: 'Want me to check your Node.js install?',
      },
      style
    );
  }
  
  // Module not found (common)
  if (combined.includes('cannot find module') || combined.includes('module not found')) {
    const moduleMatch = combined.match(/cannot find module ['"]([^'"]+)['"]/i) ||
                        combined.match(/module not found: ([^\s]+)/i);
    const moduleName = moduleMatch ? moduleMatch[1] : 'a module';
    
    return formatFailureResponse(
      {
        cause: `The build failed because it can't find ${moduleName}.`,
        fix: 'Install dependencies (npm/pnpm/yarn install) and try again.',
      },
      style
    );
  }
  
  // Permission denied
  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return formatFailureResponse(
      {
        cause: 'You hit a permission denied error.',
        fix: 'Fix file permissions or run the command with proper privileges.',
        question: 'Want me to identify the exact file path?',
      },
      style
    );
  }
  
  // Git: nothing to commit
  if (combined.includes('nothing to commit') && command.includes('git')) {
    return formatFailureResponse(
      {
        cause: "Git says there's nothing to commit because no changes are staged.",
        fix: 'Stage your files with git add, then commit.',
        verify: 'git status',
        question: 'Want me to check git status?',
      },
      style
    );
  }
  
  // Git: not a repository
  if (combined.includes('not a git repository')) {
    return formatFailureResponse(
      {
        cause: "You're not in a git repository.",
        fix: 'Run git init or move into an existing repo folder.',
      },
      style
    );
  }
  
  // TypeScript/compilation errors
  if (combined.includes('typescript') && (combined.includes('error ts') || combined.includes('type error'))) {
    return formatFailureResponse(
      {
        cause: 'TypeScript compilation failed due to a type or syntax error.',
        fix: 'Open the file/line from the error output and fix the type issue.',
        question: 'Want me to locate the exact file and line?',
      },
      style
    );
  }
  
  return null; // No fast path match
}

/**
 * Generates a conversational failure explanation using LLM.
 * Falls back to fast-path explanations for common errors.
 * 
 * @param command - The command that failed
 * @param cwd - Working directory
 * @param exitCode - Exit code (null if process error)
 * @param stderr - Standard error output
 * @param stdout - Standard output
 * @returns Conversational explanation
 */
export async function explainFailureLLM(
  command: string,
  cwd: string,
  exitCode: number | null,
  stderr: string,
  stdout: string,
  style: ResponseStyle = DEFAULT_RESPONSE_STYLE
): Promise<string> {
  // Try fast path first
  const fastPath = getFastPathExplanation(command, exitCode, stderr, stdout, style);
  if (fastPath) {
    return finalizeFailureResponse(fastPath, style);
  }
  
  // If no OpenAI API key, fall back to simple explanation
  if (!OPENAI_API_KEY) {
    return generateSimpleExplanation(command, exitCode, stderr, stdout, style);
  }
  
  // Extract relevant errors
  const errorContext = extractRelevantErrors(stderr, stdout, 1500);
  
  if (errorContext.relevantLines.length === 0) {
    return finalizeFailureResponse(
      formatFailureResponse(
        {
          cause: `The command ${command} failed, but I couldn't find a clear error line.`,
          fix: 'Try rerunning it with verbose logging or share the full output.',
        },
        style
      ),
      style
    );
  }
  
  // Build LLM prompt
  const systemPrompt = `You are a helpful developer assistant. Respond in a human, conversational tone.

Format for concise responses:
1) Sentence 1: what happened + why (root cause)
2) Sentence 2: simplest fix
3) Sentence 3 (optional): quick verify command
4) Sentence 4 (optional): one yes/no question like "Want me to run X?"

Rules:
- Default is concise: max 4 sentences.
- No headers, no long lists, no code blocks unless asked.
- Include only 1-2 most useful fixes.
- If responseStyle.mode is "steps", you may use a short numbered list (max 3 items).
- If responseStyle.mode is "logs", include the single most relevant error line.
- If responseStyle.verbosity is "short", keep it to 1-2 sentences.`;

  const userPrompt = `The following command failed:

**Command:** \`${command}\`
**Working Directory:** ${cwd}
**Exit Code:** ${exitCode ?? 'null (process error)'}

**Relevant Error Output:**
\`\`\`
${errorContext.relevantLines.join('\n')}
\`\`\`

Provide a helpful explanation of what went wrong and how to fix it. Be conversational and actionable.

responseStyle.mode: ${style.mode}
responseStyle.verbosity: ${style.verbosity}
Include snippets: no unless explicitly asked.`;

  try {
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
        temperature: 0.7,
        max_tokens: style.mode === 'detailed' ? 500 : 220,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string;
        };
      }>;
    };

    return finalizeFailureResponse(data.choices[0].message.content.trim(), style);
  } catch (error) {
    console.warn('⚠️  LLM explanation failed, using simple explanation:', error);
    return generateSimpleExplanation(command, exitCode, stderr, stdout, style);
  }
}

/**
 * Generates a simple explanation without LLM.
 */
function generateSimpleExplanation(
  command: string,
  exitCode: number | null,
  stderr: string,
  stdout: string,
  style: ResponseStyle
): string {
  const errorContext = extractRelevantErrors(stderr, stdout, 500);
  
  const logLine = errorContext.relevantLines[0];
  const cause = exitCode !== null
    ? `The command ${command} failed with exit code ${exitCode}.`
    : `The command ${command} failed to start.`;

  let fix = 'Try rerunning after installing dependencies or checking your environment.';
  if (logLine && logLine.toLowerCase().includes('enoent')) {
    fix = 'Make sure the command exists in your PATH and try again.';
  }

  let response = formatFailureResponse(
    {
      cause,
      fix,
      verify: style.mode === 'logs' && logLine ? undefined : undefined,
      question: undefined,
    },
    style
  );

  if (style.mode === 'logs' && logLine) {
    response += ` Relevant error: ${logLine}.`;
  }

  return finalizeFailureResponse(response, style);
}

function formatFailureResponse(
  parts: { cause: string; fix: string; verify?: string; question?: string },
  style: ResponseStyle
): string {
  if (style.mode === 'steps' && style.verbosity !== 'short') {
    const steps = [parts.fix, parts.verify ? `Verify with ${parts.verify}` : undefined]
      .filter(Boolean)
      .slice(0, 3) as string[];
    return `${parts.cause}\n${steps.map((step, i) => `${i + 1}) ${step}`).join('\n')}`;
  }

  const sentences = [
    parts.cause.replace(/\.*\s*$/, '.'),
    parts.fix.replace(/\.*\s*$/, '.'),
  ];

  if (parts.verify) {
    sentences.push(`Quick check: ${parts.verify}.`);
  }

  if (parts.question) {
    const question = parts.question.trim().endsWith('?')
      ? parts.question.trim()
      : `${parts.question.trim()}?`;
    sentences.push(question);
  }

  return sentences.join(' ');
}

function finalizeFailureResponse(text: string, style: ResponseStyle): string {
  const normalized = normalizeResponseText(text);
  const maxSentences = getMaxSentences(style);
  return limitToSentences(normalized, maxSentences);
}
