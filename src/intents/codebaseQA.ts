/**
 * Codebase Q&A handler - answers questions about the repository code.
 */

import { search, searchMultiple, extractSearchKeywords, SearchMatch } from '../tools/repoSearch.js';
import { readFileWithContext, readFileHeadTail, getFileInfo } from '../tools/readFile.js';
import {
  DEFAULT_RESPONSE_STYLE,
  ResponseStyle,
  getMaxSentences,
  limitToSentences,
  normalizeResponseText,
} from '../session/responseStyle.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export interface CodebaseQAResult {
  answer: string;
  referencedFiles: Array<{ file: string; lines: number[] }>;
  followUpSuggestion?: string;
}

export interface CodebaseQAOptions {
  responseStyle?: ResponseStyle;
  includeSnippets?: boolean;
}

/**
 * Selects the most relevant files from search results.
 * Prioritizes files with multiple matches and common file patterns.
 * 
 * @param matches - Search matches
 * @param maxFiles - Maximum number of files to select (default: 5)
 * @returns Selected file paths with their match lines
 */
function selectRelevantFiles(matches: SearchMatch[], maxFiles: number = 5): Map<string, number[]> {
  // Group matches by file
  const fileMatches = new Map<string, number[]>();
  
  for (const match of matches) {
    if (!fileMatches.has(match.file)) {
      fileMatches.set(match.file, []);
    }
    fileMatches.get(match.file)!.push(match.line);
  }

  // Score files by: number of matches, file type priority, file name relevance
  const scoredFiles = Array.from(fileMatches.entries()).map(([file, lines]) => {
    let score = lines.length; // More matches = higher score
    
    // Prioritize source files over config/build files
    if (file.match(/\.(ts|tsx|js|jsx)$/)) score += 10;
    if (file.match(/\.(md|txt|json|yaml|yml)$/)) score -= 5;
    if (file.includes('node_modules') || file.includes('dist') || file.includes('.git')) score -= 20;
    
    // Prioritize files with descriptive names
    if (file.match(/(record|transcribe|tts|agent|router|exec|run)/i)) score += 5;
    
    return { file, lines, score };
  });

  // Sort by score and take top files
  scoredFiles.sort((a, b) => b.score - a.score);
  
  const selected = new Map<string, number[]>();
  for (const { file, lines } of scoredFiles.slice(0, maxFiles)) {
    selected.set(file, lines);
  }

  return selected;
}

/**
 * Builds context from selected files for LLM prompt.
 * 
 * @param selectedFiles - Map of file paths to line numbers
 * @param cwd - Working directory
 * @returns Formatted context string
 */
async function buildContext(
  selectedFiles: Map<string, number[]>,
  cwd: string
): Promise<string> {
  const contexts: string[] = [];

  for (const [file, lineNumbers] of selectedFiles) {
    try {
      // Get context around each match
      const contextMap = await readFileWithContext(file, lineNumbers, 5, cwd);
      
      const snippets: string[] = [];
      for (const [lineNum, snippet] of contextMap) {
        snippets.push(`Lines ${lineNum - 5}-${lineNum + 5}:\n\`\`\`\n${snippet}\n\`\`\``);
      }
      
      contexts.push(`**File: ${file}**\n${snippets.join('\n\n')}`);
    } catch (error) {
      // If we can't read the file, try to get basic info
      try {
        const info = await getFileInfo(file, cwd);
        if (info.exists) {
          contexts.push(`**File: ${file}** (${info.lineCount} lines, ${info.size} bytes) - Could not read specific lines`);
        }
      } catch {
        // Skip this file
      }
    }
  }

  return contexts.join('\n\n---\n\n');
}

/**
 * Generates a conversational answer to a codebase question using LLM.
 * 
 * @param query - User's question
 * @param context - Code snippets and file references
 * @param selectedFiles - Map of selected files with line numbers
 * @param cwd - Working directory
 * @returns Conversational answer with references
 */
async function generateAnswer(
  query: string,
  context: string,
  selectedFiles: Map<string, number[]>,
  cwd: string,
  options: CodebaseQAOptions
): Promise<CodebaseQAResult> {
  const style = options.responseStyle || DEFAULT_RESPONSE_STYLE;
  const includeSnippets = options.includeSnippets ?? false;

  if (!OPENAI_API_KEY) {
    const files = Array.from(selectedFiles.keys());
    const shortList = files.slice(0, 3).join(', ');
    const fallback = includeSnippets
      ? `I found relevant code:\n\n${context}`
      : `I found relevant code in ${files.length} file(s): ${shortList}. Want me to show the exact lines?`;
    return {
      answer: finalizeAnswer(fallback, style),
      referencedFiles: Array.from(selectedFiles).map(([file, lines]) => ({ file, lines })),
    };
  }

  const systemPrompt = `You are a helpful developer assistant that answers questions about codebases.

Rules:
- Default to concise: max 4 sentences, no headers, no long lists.
- Be natural and conversational.
- Prefer explanation first, snippet second.
- Only include code snippets if includeSnippets is true or it's necessary to answer.
- Offer at most one short follow-up question.
- If responseStyle.mode is "steps", you may use a short numbered list (max 3 items).
- If responseStyle.mode is "logs", you may include a single short code snippet.
- If responseStyle.verbosity is "short", keep it to 1-2 sentences.`;

  const userPrompt = `User asked: "${query}"

Here's relevant code from the repository:

${context}

Please provide a helpful answer that references the specific files and lines shown above.

responseStyle.mode: ${style.mode}
responseStyle.verbosity: ${style.verbosity}
includeSnippets: ${includeSnippets ? 'yes' : 'no'}`;

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
        max_tokens: 800,
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

    const answer = finalizeAnswer(data.choices[0].message.content.trim(), style);
    
    // Extract referenced files from context
    const referencedFiles: Array<{ file: string; lines: number[] }> = [];
    for (const [file, lines] of selectedFiles) {
      referencedFiles.push({ file, lines });
    }

    // Extract follow-up suggestion if present
    let followUpSuggestion: string | undefined;
    if (answer.toLowerCase().includes('want me to') || answer.toLowerCase().includes('would you like')) {
      const match = answer.match(/(?:want me to|would you like)[^?]+[?]/i);
      if (match) {
        followUpSuggestion = match[0];
      }
    }

    return {
      answer,
      referencedFiles,
      followUpSuggestion,
    };
  } catch (error) {
    console.warn('⚠️  LLM answer generation failed:', error);
    return {
      answer: finalizeAnswer(
        includeSnippets
          ? `I found relevant code:\n\n${context}`
          : 'I found relevant code in the repo. Want me to show the exact lines?',
        style
      ),
      referencedFiles: Array.from(selectedFiles).map(([file, lines]) => ({ file, lines })),
    };
  }
}

// Store selected files for follow-up
let selectedFiles: Map<string, number[]> = new Map();

/**
 * Answers a question about the codebase by searching and analyzing code.
 * 
 * @param query - User's question
 * @param cwd - Working directory (repository root)
 * @returns Answer with file references
 */
export async function answerCodebaseQuestion(
  query: string,
  cwd: string = process.cwd(),
  options: CodebaseQAOptions = {}
): Promise<CodebaseQAResult> {
  // Extract search keywords from query
  const keywords = extractSearchKeywords(query);
  
  if (keywords.length === 0) {
    return {
      answer: "I couldn't extract meaningful search terms from your question. Could you rephrase it with specific function names, file names, or concepts you're looking for?",
      referencedFiles: [],
    };
  }

  // Search for each keyword
  console.log(`🔍 Searching codebase for: ${keywords.join(', ')}`);
  const searchResult = await searchMultiple(keywords, cwd, 15);

  if (searchResult.matches.length === 0) {
    return {
      answer: `I searched the codebase for "${keywords.join('", "')}" but didn't find any matches. Try rephrasing your question with different terms or specific function/file names.`,
      referencedFiles: [],
    };
  }

  // Select most relevant files
  selectedFiles = selectRelevantFiles(searchResult.matches, 5);

  // Build context from selected files
  const context = await buildContext(selectedFiles, cwd);

  // Generate answer using LLM
  const result = await generateAnswer(query, context, selectedFiles, cwd, options);
  
  // Update selectedFiles for potential follow-up
  selectedFiles = new Map(result.referencedFiles.map(ref => [ref.file, ref.lines]));

  return result;
}

function finalizeAnswer(text: string, style: ResponseStyle): string {
  const normalized = normalizeResponseText(text);
  const maxSentences = getMaxSentences(style);
  return limitToSentences(normalized, maxSentences);
}

/**
 * Gets the last selected files for follow-up operations.
 */
export function getLastSelectedFiles(): Map<string, number[]> {
  return selectedFiles;
}
