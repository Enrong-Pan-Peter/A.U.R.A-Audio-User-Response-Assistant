import { spawn } from 'child_process';
import { promisify } from 'util';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
  context?: string; // Surrounding lines for context
}

export interface SearchResult {
  matches: SearchMatch[];
  totalMatches: number;
}

/**
 * Searches the repository using ripgrep (rg).
 * Returns top matches with file, line number, and content.
 * 
 * @param pattern - Search pattern (regex or plain text)
 * @param cwd - Working directory (repository root)
 * @param maxResults - Maximum number of results to return (default: 30)
 * @param fileType - Optional file type filter (e.g., 'ts', 'js', 'tsx')
 * @returns Search results with matches
 */
export async function search(
  pattern: string,
  cwd: string = process.cwd(),
  maxResults: number = 30,
  fileType?: string
): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '--line-number', // Include line numbers
      '--no-heading',  // Don't print file headings
      '--color', 'never', // Disable color
      '--max-count', maxResults.toString(), // Limit results
    ];

    // Add file type filter if specified
    if (fileType) {
      args.push('--type', fileType);
    }

    // Add pattern (ripgrep handles regex by default)
    args.push(pattern);

    const child = spawn('rg', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // ripgrep returns 0 for matches, 1 for no matches, 2 for errors
      if (code === 2) {
        reject(new Error(`ripgrep error: ${stderr}`));
        return;
      }

      // Parse output: format is "file:line:content"
      const matches: SearchMatch[] = [];
      const lines = stdout.trim().split('\n').filter(line => line.trim());

      for (const line of lines) {
        // Match format: "file:line:content"
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const [, file, lineNum, content] = match;
          matches.push({
            file: file.trim(),
            line: parseInt(lineNum, 10),
            content: content.trim(),
          });
        }
      }

      resolve({
        matches,
        totalMatches: matches.length,
      });
    });

    child.on('error', (error) => {
      // If ripgrep is not installed, provide helpful error
      if (error.message.includes('ENOENT') || error.message.includes('spawn rg')) {
        reject(new Error('ripgrep (rg) is not installed. Install it from https://github.com/BurntSushi/ripgrep/releases'));
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Searches for multiple patterns and combines results.
 * Useful for finding related code across different terms.
 * 
 * @param patterns - Array of search patterns
 * @param cwd - Working directory
 * @param maxResultsPerPattern - Max results per pattern (default: 10)
 * @returns Combined search results
 */
export async function searchMultiple(
  patterns: string[],
  cwd: string = process.cwd(),
  maxResultsPerPattern: number = 10
): Promise<SearchResult> {
  const allMatches: SearchMatch[] = [];
  const seen = new Set<string>(); // Track file:line to avoid duplicates

  for (const pattern of patterns) {
    try {
      const result = await search(pattern, cwd, maxResultsPerPattern);
      for (const match of result.matches) {
        const key = `${match.file}:${match.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          allMatches.push(match);
        }
      }
    } catch (error) {
      // Continue with other patterns if one fails
      console.warn(`Search pattern "${pattern}" failed:`, error);
    }
  }

  return {
    matches: allMatches,
    totalMatches: allMatches.length,
  };
}

/**
 * Extracts keywords from a natural language query for searching.
 * 
 * @param query - User's question
 * @returns Array of search keywords/phrases
 */
export function extractSearchKeywords(query: string): string[] {
  const normalized = query.toLowerCase();
  const keywords: string[] = [];

  // Extract quoted strings (exact phrases)
  const quotedMatches = query.match(/"([^"]+)"/g);
  if (quotedMatches) {
    quotedMatches.forEach(match => {
      keywords.push(match.replace(/"/g, ''));
    });
  }

  // Extract function/class/variable names (CamelCase, snake_case, etc.)
  const identifierMatches = query.match(/\b([A-Z][a-zA-Z0-9]+|[a-z]+_[a-z]+|[A-Z_]+)\b/g);
  if (identifierMatches) {
    identifierMatches.forEach(match => {
      if (match.length > 2) { // Filter out very short matches
        keywords.push(match);
      }
    });
  }

  // Extract important words (skip common stop words)
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'where', 'when', 'why', 'how', 'does', 'work', 'from', 'to', 'in', 'of', 'for', 'with', 'about']);
  
  const words = query.split(/\s+/).filter(word => {
    const clean = word.toLowerCase().replace(/[^\w]/g, '');
    return clean.length > 2 && !stopWords.has(clean);
  });

  keywords.push(...words.slice(0, 5)); // Take top 5 words

  // Remove duplicates and return
  return Array.from(new Set(keywords)).slice(0, 5);
}
