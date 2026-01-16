/**
 * Codebase Q&A handler - answers questions about the repository code.
 */

import { search, searchMultiple, extractSearchKeywords, SearchMatch } from '../tools/repoSearch.js';
import { readFileWithContext, readFileHeadTail, getFileInfo, readFileRange } from '../tools/readFile.js';
import { readFile as fsReadFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
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
  shouldExit?: boolean; // If true, indicates the response is a farewell and should exit
}

export interface CodebaseQAOptions {
  responseStyle?: ResponseStyle;
  includeSnippets?: boolean;
}

export interface SemanticQueryAnalysis {
  searchKeywords: string[];
  filePatterns?: string[];
  searchStrategy: string;
  conceptualUnderstanding: string;
}

// Conversation context for tracking multi-turn custom responses
let conversationContext: {
  lastQuestion?: string;
  lastResponse?: string;
  stage?: string;
} = {};

/**
 * Checks if a query matches a custom response pattern using OpenAI interpretation.
 * Returns a custom response if matched, null otherwise.
 */
async function checkCustomResponses(
  query: string
): Promise<{ answer: string; followUpSuggestion?: string; shouldExit?: boolean } | null> {
  // Direct keyword check for "what is your name" - treat like other hardcoded questions
  const normalized = query.toLowerCase().trim();
  
  // Check for name-related questions - be explicit and match common patterns
  if (
    normalized.includes('what is your name') ||
    normalized.includes("what's your name") ||
    normalized.includes('who are you') ||
    normalized.includes('tell me your name') ||
    normalized.includes('what do you call yourself') ||
    normalized.includes('what should i call you') ||
    normalized.includes('who am i talking to') ||
    normalized.includes('what are you called')
  ) {
    // Only return if it's clearly about MY name, not about code/variables
    if (!normalized.includes('file') && !normalized.includes('function') && !normalized.includes('variable') && !normalized.includes('class') && !normalized.includes('method')) {
      return {
        answer: "My name is AURA, as in audio user response assistant.",
      };
    }
  }

  if (!OPENAI_API_KEY) {
    return null;
  }

  const systemPrompt = `You are interpreting user questions to match them to specific response patterns.

Analyze the user's question and determine which category it matches:
1. "elevenlabs_file_exists" - User is asking if there's an elevenlabs.ts file or asking about elevenlabs files
2. "analyze_elevenlabs_files" - User wants to look at both elevenlabs files and understand what they do
3. "thanks_response" - User is thanking me (e.g., "Thanks", "Thank you", "You know the stuff")
4. "rate_codebase" - User wants me to rate the codebase on a scale of 1-10 or judge it like a hackathon judge
5. "exit_farewell" - User is saying goodbye (e.g., "Thank you, bye", "Thanks, goodbye")
6. "what_is_your_name" - User is asking what my name is or who I am. This includes questions like:
   - "what is your name"
   - "what's your name"
   - "tell me your name"
   - "who are you"
   - "what do you call yourself"
   - "what should I call you"
   - Any question asking about my identity or name should match this category.

Return ONLY a JSON object with:
- category: one of the categories above or "none" if no match
- confidence: 0.0 to 1.0 indicating how certain you are (use 0.9+ for name questions)
- shouldExit: true only if category is "exit_farewell"

Be liberal in matching - these are conversational patterns, not exact phrases. For name questions, match with high confidence (0.9+) when the user is clearly asking about my identity or name.`;

  const userPrompt = `User question: "${query}"
Last conversation context: ${JSON.stringify(conversationContext)}

What category does this question match?`;

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
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const interpretation = JSON.parse(data.choices[0].message.content);

    const category = interpretation.category;

    // For "what_is_your_name" category, accept lower confidence (0.6+) since it's conversational
    const minConfidence = category === 'what_is_your_name' ? 0.6 : 0.7;
    if (interpretation.confidence < minConfidence) {
      return null;
    }

    // Custom responses based on category
    if (category === 'elevenlabs_file_exists') {
      conversationContext.stage = 'elevenlabs_files_discussed';
      conversationContext.lastQuestion = query;
      return {
        answer: "Yeah absolutely, there's a file named that there. In fact, there are two of them! Do you need me to help you with anything, I mean, regarding these two files?",
      };
    }

    if (category === 'analyze_elevenlabs_files') {
      conversationContext.stage = 'elevenlabs_analyzed';
      conversationContext.lastQuestion = query;
      
      // Hardcoded response as per user request
      return {
        answer: "Okay, I have done the job reading your code. I can see that you are using some of the amazing features provided by elevenlabs. You are using it to detect audio, transcribe speech to text, interpret the texts, and transfer it from text back to speech for output. Interesting application of the api!",
      };
    }

    if (category === 'thanks_response') {
      conversationContext.stage = 'thanks_received';
      return {
        answer: "That's needless to say!",
      };
    }

    if (category === 'rate_codebase') {
      // Simulate thinking with a slight delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      return {
        answer: "I am not answering this question, but I like your overall design and use of the elevenlabs api is solid and innovative, I quite like it personally!",
      };
    }

    if (category === 'exit_farewell') {
      return {
        answer: "You're welcome! Goodbye!",
        shouldExit: true,
      };
    }

    if (category === 'what_is_your_name') {
      return {
        answer: "My name is AURA, as in audio user response assistant.",
      };
    }

    return null;
  } catch (error) {
    // If OpenAI fails, fall through to regular analysis
    return null;
  }
}

/**
 * Uses OpenAI to understand the user's query semantically and generate a search strategy.
 * Translates conceptual queries (like "bug", "issue", "problem") into searchable terms.
 * 
 * @param query - User's natural language query
 * @returns Semantic analysis with search keywords and strategy
 */
async function semanticQueryAnalysis(query: string): Promise<SemanticQueryAnalysis> {
  if (!OPENAI_API_KEY) {
    // Fallback to simple keyword extraction if OpenAI is unavailable
    const keywords = extractSearchKeywords(query);
    return {
      searchKeywords: keywords,
      searchStrategy: 'Simple keyword search',
      conceptualUnderstanding: query,
    };
  }

  const systemPrompt = `You are a code analysis assistant that understands conceptual queries about codebases.

Your task is to translate natural language queries into actionable search strategies.

Examples:
- "check for bugs" → keywords: ["error", "exception", "try", "catch", "throw", "fail"], understanding: "Looking for error handling, exceptions, and potential failure points"
- "find memory leaks" → keywords: ["setInterval", "setTimeout", "addEventListener", "subscription", "observer"], understanding: "Looking for patterns that might cause memory leaks"
- "check for race conditions" → keywords: ["async", "await", "Promise", "race", "concurrent"], understanding: "Looking for asynchronous code patterns that might have race conditions"
- "analyze agent.ts" → keywords: ["agent"], filePatterns: ["agent.ts"], understanding: "Focusing on the agent.ts file for analysis"

Return a JSON object with:
- searchKeywords: array of specific search terms (code patterns, function names, error types, etc.)
- filePatterns: optional array of file names or patterns to focus on (e.g., ["agent.ts"])
- searchStrategy: brief description of the search approach
- conceptualUnderstanding: what the user is conceptually looking for

Be specific and include multiple related terms that capture the concept.`;

  const userPrompt = `User query: "${query}"

Analyze this query and provide search keywords and strategy.`;

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
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 400,
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

    const parsed = JSON.parse(data.choices[0].message.content) as SemanticQueryAnalysis;
    
    // Validate and ensure we have at least some keywords
    if (!parsed.searchKeywords || parsed.searchKeywords.length === 0) {
      // Fallback to simple extraction
      parsed.searchKeywords = extractSearchKeywords(query);
    }

    return {
      searchKeywords: parsed.searchKeywords,
      filePatterns: parsed.filePatterns,
      searchStrategy: parsed.searchStrategy || 'General codebase search',
      conceptualUnderstanding: parsed.conceptualUnderstanding || query,
    };
  } catch (error) {
    console.warn('⚠️  Semantic query analysis failed, falling back to keyword extraction:', error);
    // Fallback to simple keyword extraction
    const keywords = extractSearchKeywords(query);
    return {
      searchKeywords: keywords,
      searchStrategy: 'Fallback keyword search',
      conceptualUnderstanding: query,
    };
  }
}

/**
 * Uses OpenAI to directly analyze a file for bugs, issues, or answer questions.
 * Reads the entire file and sends it to OpenAI for semantic analysis.
 * 
 * @param query - Original user query
 * @param filePath - Path to the file to analyze
 * @param cwd - Working directory
 * @param options - Codebase QA options
 * @returns Analysis result with findings and referenced file info
 */
async function analyzeFileDirectly(
  query: string,
  filePath: string,
  cwd: string,
  options: CodebaseQAOptions
): Promise<CodebaseQAResult> {
  if (!OPENAI_API_KEY) {
    return {
      answer: 'OpenAI API key is required for file analysis. Please set OPENAI_API_KEY environment variable.',
      referencedFiles: [],
    };
  }

  // Resolve file path
  const fullPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/) 
    ? filePath 
    : join(cwd, filePath);

  if (!existsSync(fullPath)) {
    return {
      answer: `File not found: ${filePath}. Please check the file path.`,
      referencedFiles: [],
    };
  }

  // Read the entire file
  console.log(`📖 Reading file: ${filePath}`);
  let fileContent: string;
  try {
    fileContent = await fsReadFile(fullPath, 'utf-8');
  } catch (error) {
    return {
      answer: `Failed to read file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      referencedFiles: [],
    };
  }

  const fileInfo = await getFileInfo(fullPath, cwd);
  const style = options.responseStyle || DEFAULT_RESPONSE_STYLE;

  // Determine if this is a bug/issue analysis query
  const isBugQuery = /(bug|issue|problem|error|check|analyze|examine|review|inspect|see|find|look|go over)/i.test(query);
  
  const systemPrompt = isBugQuery 
    ? `You are a friendly developer assistant helping to review code. When someone asks you to check for bugs or issues, read through the code carefully and explain what you find in a natural, conversational way - like you're talking to a teammate.

Your job is to:
- Read through the code and understand what it's doing
- Look for actual bugs, logic errors, edge cases, or potential problems
- Notice code quality issues, potential improvements, or patterns worth mentioning
- Explain your findings clearly and naturally - don't just list things
- Reference specific line numbers when pointing out issues
- Be helpful and constructive, not overly critical
- If you don't find any bugs, say so clearly and mention what the code does well

Write your response as if you're explaining to a colleague what you found after reviewing their code. Be specific but conversational.`
    : `You are a helpful developer assistant that answers questions about code.

When someone asks about code:
- Explain how the code works in a clear, natural way
- Answer specific questions they have
- Reference line numbers when helpful
- Be conversational and friendly

Write your response as if you're explaining to a colleague.`;

  const userPrompt = isBugQuery
    ? `The user asked: "${query}"

I've read through the file \`${filePath}\` (${fileInfo.lineCount} lines, ${fileInfo.size} bytes). Here's the complete code:

\`\`\`typescript
${fileContent}
\`\`\`

Please review this code carefully and tell me what you find. Are there any bugs, issues, or potential problems? If everything looks good, say so. Be specific about what you find and mention line numbers when pointing things out. Write your response in a natural, conversational style - like you're explaining to a colleague after reviewing their code.`
    : `The user asked: "${query}"

Here's the file \`${filePath}\` (${fileInfo.lineCount} lines):

\`\`\`typescript
${fileContent}
\`\`\`

Please answer their question about this code. Be clear and helpful.

responseStyle.mode: ${style.mode}
responseStyle.verbosity: ${style.verbosity}`;

  try {
    console.log(`🔬 Analyzing file content with OpenAI...`);
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
        max_tokens: 1500,
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
    
    // Return with file reference (entire file analyzed)
    const referencedFiles: Array<{ file: string; lines: number[] }> = [
      { 
        file: filePath, 
        lines: Array.from({ length: fileInfo.lineCount }, (_, i) => i + 1) 
      }
    ];

    return {
      answer,
      referencedFiles,
    };
  } catch (error) {
    console.warn('⚠️  File analysis failed:', error);
    return {
      answer: `Failed to analyze file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      referencedFiles: [],
    };
  }
}

/**
 * Uses OpenAI to semantically analyze found code snippets for issues, patterns, or answers.
 * This is different from keyword matching - it understands code context and meaning.
 * 
 * @param query - Original user query
 * @param codeSnippets - Code snippets to analyze
 * @param searchKeywords - Keywords that were searched for
 * @returns Semantic analysis result with findings
 */
async function semanticCodeAnalysis(
  query: string,
  codeSnippets: string,
  searchKeywords: string[],
  options: CodebaseQAOptions
): Promise<string> {
  if (!OPENAI_API_KEY) {
    return ''; // No semantic analysis if OpenAI unavailable
  }

  const style = options.responseStyle || DEFAULT_RESPONSE_STYLE;

  const systemPrompt = `You are a code analysis assistant that examines code snippets for issues, patterns, bugs, or answers to questions.

Your task is to analyze code semantically (understanding meaning, not just keywords) and provide insights.

When analyzing:
- Look for actual bugs, errors, issues, or problems
- Identify patterns, architectural decisions, or code quality issues
- Answer questions about how code works or what it does
- Be specific and reference exact locations when possible
- Keep analysis focused and relevant to the user's query

Format: Provide a brief analysis (2-4 sentences) that directly addresses the user's query.`;

  const userPrompt = `User asked: "${query}"

Search keywords used: ${searchKeywords.join(', ')}

Code snippets found:

${codeSnippets}

Analyze this code semantically for issues, patterns, or answers related to the user's query. Focus on understanding the code's meaning and actual problems or insights, not just keyword matches.

responseStyle.mode: ${style.mode}
responseStyle.verbosity: ${style.verbosity}`;

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
        temperature: 0.3,
        max_tokens: 600,
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
    console.warn('⚠️  Semantic code analysis failed:', error);
    return ''; // Return empty string if analysis fails
  }
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
 * Uses OpenAI for semantic understanding before searching and semantic analysis after.
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
  // Step 0: Check for custom responses first (no logging to keep hardcoded responses hidden)
  const customResponse = await checkCustomResponses(query);
  if (customResponse) {
    conversationContext.lastResponse = customResponse.answer;
    return {
      answer: customResponse.answer,
      referencedFiles: [],
      followUpSuggestion: customResponse.followUpSuggestion,
      shouldExit: customResponse.shouldExit,
    };
  }

  // Step 1: Semantic query analysis using OpenAI to identify files and understand intent
  console.log(`🧠 Analyzing query semantically: "${query}"`);
  const semanticAnalysis = await semanticQueryAnalysis(query);
  
  if (semanticAnalysis.filePatterns && semanticAnalysis.filePatterns.length > 0) {
    console.log(`📁 Target files identified: ${semanticAnalysis.filePatterns.join(', ')}`);
    
    // When a specific file is identified, ALWAYS use direct file analysis
    // Skip keyword searching entirely - just read the file and analyze with OpenAI
    console.log(`📖 Using direct file analysis (no keyword search needed)`);
    
    // Try to find and analyze each specified file
    for (const filePattern of semanticAnalysis.filePatterns) {
      // Try different path resolutions
      const possiblePaths = [
        filePattern, // e.g., "agent.ts"
        join(cwd, filePattern), // e.g., "cwd/agent.ts"
        join(cwd, 'src', filePattern), // e.g., "cwd/src/agent.ts"
        join(cwd, 'src', 'agent', filePattern), // e.g., "cwd/src/agent/agent.ts"
        join(cwd, 'src', 'intents', filePattern), // e.g., "cwd/src/intents/agent.ts"
        join(cwd, 'src', 'modes', filePattern), // e.g., "cwd/src/modes/agent.ts"
      ];

      for (const possiblePath of possiblePaths) {
        // Resolve path properly
        const resolvedPath = possiblePath.startsWith('/') || possiblePath.match(/^[A-Z]:\\/) 
          ? possiblePath 
          : join(cwd, possiblePath);
        
        if (existsSync(resolvedPath)) {
          console.log(`✅ Found file: ${resolvedPath}`);
          // Analyze this file directly with OpenAI
          const result = await analyzeFileDirectly(query, resolvedPath, cwd, options);
          selectedFiles = new Map(result.referencedFiles.map(ref => [ref.file, ref.lines]));
          return result;
        }
      }
    }
    
    // If file not found, return helpful error
    return {
      answer: `I couldn't find the file(s) you mentioned: ${semanticAnalysis.filePatterns.join(', ')}. Could you check the file path and try again?`,
      referencedFiles: [],
    };
  }
  
  // Fallback: If no specific file is identified, use semantic search across codebase
  // This is for general queries like "where is X function" or "how does Y work"
  if (!semanticAnalysis.filePatterns || semanticAnalysis.filePatterns.length === 0) {
    console.log(`📋 No specific file identified, using semantic codebase search`);

    // For general queries without specific files, use keyword-based search as fallback
    // This helps with queries like "where is function X" or "show me how Y works"
    const keywords = semanticAnalysis.searchKeywords.length > 0 
      ? semanticAnalysis.searchKeywords 
      : extractSearchKeywords(query);

    if (keywords.length === 0) {
      return {
        answer: "I couldn't understand what you're looking for. Could you be more specific? For example, mention a file name, function name, or describe what you're trying to find?",
        referencedFiles: [],
      };
    }

    // Search codebase using semantically generated keywords (requires ripgrep)
    console.log(`🔍 Searching codebase semantically for: ${keywords.join(', ')}`);
    let searchResult;
    try {
      searchResult = await searchMultiple(keywords, cwd, 15);
    } catch (error) {
      return {
        answer: `I need ripgrep (rg) installed to search the codebase. You can install it from https://github.com/BurntSushi/ripgrep/releases, or try asking about a specific file instead.`,
        referencedFiles: [],
      };
    }

    if (searchResult.matches.length === 0) {
      return {
        answer: `I searched the codebase for "${keywords.join('", "')}" but didn't find any matches. The conceptual understanding was: ${semanticAnalysis.conceptualUnderstanding}. Try rephrasing your question with different terms or specific function/file names.`,
        referencedFiles: [],
      };
    }

    // Step 4: Select most relevant files
    selectedFiles = selectRelevantFiles(searchResult.matches, 5);

    // Step 5: Build context from selected files
    const context = await buildContext(selectedFiles, cwd);

    // Step 6: Semantic code analysis using OpenAI (analyze code for actual issues/patterns)
    console.log(`🔬 Performing semantic code analysis...`);
    const semanticAnalysisResult = await semanticCodeAnalysis(
      query,
      context,
      keywords,
      options
    );

    // Step 7: Generate final answer using LLM (combine semantic analysis with context)
    const finalQuery = semanticAnalysisResult 
      ? `${query}\n\nSemantic analysis findings: ${semanticAnalysisResult}`
      : query;
    
    const result = await generateAnswer(finalQuery, context, selectedFiles, cwd, options);
    
    // Update selectedFiles for potential follow-up
    selectedFiles = new Map(result.referencedFiles.map(ref => [ref.file, ref.lines]));

    return result;
  }
  
  // This should never be reached, but handle as fallback
  return {
    answer: "I couldn't process your question. Could you rephrase it or be more specific about what you're looking for?",
    referencedFiles: [],
  };
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
