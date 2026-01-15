/**
 * Generates conversational, ChatGPT-style failure explanations using LLM.
 */

import { extractRelevantErrors } from '../utils/extractRelevantErrors.js';

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
  stdout: string
): string | null {
  const combined = (stderr + '\n' + stdout).toLowerCase();
  
  // pnpm not found
  if (combined.includes('spawn pnpm') && combined.includes('enoent')) {
    return `It looks like **pnpm** isn't installed or not available in your PATH.

Here's how to fix it:

**Windows:**
1. Enable corepack: \`corepack enable\`
2. Or install pnpm globally: \`npm install -g pnpm\`
3. Close and reopen your terminal
4. Verify: \`pnpm -v\`
5. Check PATH: \`where pnpm\` (Windows) or \`which pnpm\` (Mac/Linux)

Would you like me to check if pnpm is in your PATH by running \`where pnpm\`?`;
  }
  
  // npm not found
  if (combined.includes('spawn npm') && combined.includes('enoent')) {
    return `**npm** isn't found in your PATH. This usually means Node.js isn't installed or not properly configured.

**To fix:**
1. Install Node.js from https://nodejs.org/
2. Restart your terminal
3. Verify: \`node -v\` and \`npm -v\`

Would you like me to check your Node.js installation?`;
  }
  
  // Module not found (common)
  if (combined.includes('cannot find module') || combined.includes('module not found')) {
    const moduleMatch = combined.match(/cannot find module ['"]([^'"]+)['"]/i) ||
                        combined.match(/module not found: ([^\s]+)/i);
    const moduleName = moduleMatch ? moduleMatch[1] : 'a module';
    
    return `The build failed because it can't find **${moduleName}**. This usually means:
- The dependency isn't installed
- The package.json is missing the dependency
- node_modules needs to be refreshed

**Quick fix:**
\`\`\`
npm install
# or
pnpm install
# or
yarn install
\`\`\`

After installing, try running the build again. If it still fails, the module might need to be added to your package.json dependencies.`;
  }
  
  // Permission denied
  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return `You're getting a **permission denied** error. This usually happens when:
- A file or directory doesn't have the right permissions
- You're trying to write to a protected location

**To fix:**
- On Mac/Linux: Check file permissions with \`ls -la\` and fix with \`chmod\`
- On Windows: Run your terminal as Administrator if needed
- Check if the file/directory is read-only

Can you share which file or command is causing the permission issue?`;
  }
  
  // Git: nothing to commit
  if (combined.includes('nothing to commit') && command.includes('git')) {
    return `There's nothing to commit because no changes are staged.

**To commit your changes:**
\`\`\`
git add <files>
git commit -m "your message"
\`\`\`

Or to see what files have changed:
\`\`\`
git status
\`\`\`

Would you like me to check your git status?`;
  }
  
  // Git: not a repository
  if (combined.includes('not a git repository')) {
    return `You're not in a git repository. 

**To initialize one:**
\`\`\`
git init
\`\`\`

Or navigate to an existing repository directory.`;
  }
  
  // TypeScript/compilation errors
  if (combined.includes('typescript') && (combined.includes('error ts') || combined.includes('type error'))) {
    return `You have **TypeScript compilation errors**. The build is failing because of type mismatches or syntax issues.

**To fix:**
1. Check the specific file and line number mentioned in the error
2. Fix the type error (often missing types, wrong types, or undefined values)
3. Run the build again

The error output above should show the exact file and line. Would you like me to help identify the specific error?`;
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
  stdout: string
): Promise<string> {
  // Try fast path first
  const fastPath = getFastPathExplanation(command, exitCode, stderr, stdout);
  if (fastPath) {
    return fastPath;
  }
  
  // If no OpenAI API key, fall back to simple explanation
  if (!OPENAI_API_KEY) {
    return generateSimpleExplanation(command, exitCode, stderr, stdout);
  }
  
  // Extract relevant errors
  const errorContext = extractRelevantErrors(stderr, stdout, 1500);
  
  if (errorContext.relevantLines.length === 0) {
    return `The command \`${command}\` failed with exit code ${exitCode ?? 'unknown'}, but I couldn't find specific error messages in the output. 

Check the full output above for details, or try running the command again with more verbose logging.`;
  }
  
  // Build LLM prompt
  const systemPrompt = `You are a helpful developer assistant. When a command fails, provide a clear, conversational explanation that:
1. Summarizes the root cause in plain English (1-2 sentences)
2. Quotes only the most relevant error line(s) as evidence
3. Provides clear, copy-paste ready fix steps
4. Asks at most ONE follow-up question if needed
5. Optionally offers to perform an auto-fix action (e.g., "I can run X—confirm?")

Be concise, friendly, and actionable. Don't dump logs—focus on what went wrong and how to fix it.`;

  const userPrompt = `The following command failed:

**Command:** \`${command}\`
**Working Directory:** ${cwd}
**Exit Code:** ${exitCode ?? 'null (process error)'}

**Relevant Error Output:**
\`\`\`
${errorContext.relevantLines.join('\n')}
\`\`\`

Provide a helpful explanation of what went wrong and how to fix it. Be conversational and actionable.`;

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
        max_tokens: 500,
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

    return data.choices[0].message.content.trim();
  } catch (error) {
    console.warn('⚠️  LLM explanation failed, using simple explanation:', error);
    return generateSimpleExplanation(command, exitCode, stderr, stdout);
  }
}

/**
 * Generates a simple explanation without LLM.
 */
function generateSimpleExplanation(
  command: string,
  exitCode: number | null,
  stderr: string,
  stdout: string
): string {
  const errorContext = extractRelevantErrors(stderr, stdout, 500);
  
  let explanation = `The command \`${command}\` failed`;
  if (exitCode !== null) {
    explanation += ` with exit code ${exitCode}`;
  }
  explanation += '.\n\n';
  
  if (errorContext.relevantLines.length > 0) {
    explanation += '**Key errors:**\n';
    errorContext.relevantLines.slice(0, 5).forEach(line => {
      explanation += `- ${line}\n`;
    });
    explanation += '\n';
  }
  
  explanation += 'Check the error output above for details. Common fixes:\n';
  explanation += '- Install missing dependencies: `npm install` or `pnpm install`\n';
  explanation += '- Check file permissions\n';
  explanation += '- Verify the command syntax and required parameters\n';
  
  return explanation;
}
