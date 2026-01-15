import { readFile as fsReadFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Reads a specific line range from a file.
 * 
 * @param filePath - Path to the file (relative to cwd or absolute)
 * @param startLine - Starting line number (1-indexed)
 * @param endLine - Ending line number (1-indexed, inclusive)
 * @param cwd - Working directory for relative paths
 * @returns File content for the specified range
 */
export async function readFileRange(
  filePath: string,
  startLine: number,
  endLine: number,
  cwd: string = process.cwd()
): Promise<string> {
  const fullPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/) 
    ? filePath 
    : join(cwd, filePath);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const content = await fsReadFile(fullPath, 'utf-8');
  const lines = content.split('\n');

  // Clamp to valid range
  const start = Math.max(1, Math.min(startLine, lines.length));
  const end = Math.max(start, Math.min(endLine, lines.length));

  return lines.slice(start - 1, end).join('\n');
}

/**
 * Reads the head and tail of a file (first N and last M lines).
 * Useful for getting context without reading entire large files.
 * 
 * @param filePath - Path to the file
 * @param headLines - Number of lines from the start (default: 20)
 * @param tailLines - Number of lines from the end (default: 20)
 * @param cwd - Working directory for relative paths
 * @returns Object with head, tail, and total line count
 */
export async function readFileHeadTail(
  filePath: string,
  headLines: number = 20,
  tailLines: number = 20,
  cwd: string = process.cwd()
): Promise<{ head: string; tail: string; totalLines: number }> {
  const fullPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/) 
    ? filePath 
    : join(cwd, filePath);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const content = await fsReadFile(fullPath, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');

  return { head, tail, totalLines };
}

/**
 * Reads a file with context around specific line numbers.
 * Useful for showing code around search matches.
 * 
 * @param filePath - Path to the file
 * @param lineNumbers - Array of line numbers to show context around
 * @param contextLines - Number of lines before/after each match (default: 5)
 * @param cwd - Working directory for relative paths
 * @returns Map of line number to code snippet with context
 */
export async function readFileWithContext(
  filePath: string,
  lineNumbers: number[],
  contextLines: number = 5,
  cwd: string = process.cwd()
): Promise<Map<number, string>> {
  const fullPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/) 
    ? filePath 
    : join(cwd, filePath);

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const content = await fsReadFile(fullPath, 'utf-8');
  const lines = content.split('\n');
  const result = new Map<number, string>();

  for (const lineNum of lineNumbers) {
    if (lineNum < 1 || lineNum > lines.length) {
      continue;
    }

    const start = Math.max(0, lineNum - contextLines - 1);
    const end = Math.min(lines.length, lineNum + contextLines);
    const snippet = lines.slice(start, end).join('\n');
    
    result.set(lineNum, snippet);
  }

  return result;
}

/**
 * Gets file metadata (size, line count, etc.).
 * 
 * @param filePath - Path to the file
 * @param cwd - Working directory for relative paths
 * @returns File metadata
 */
export async function getFileInfo(
  filePath: string,
  cwd: string = process.cwd()
): Promise<{ exists: boolean; size: number; lineCount: number }> {
  const fullPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/) 
    ? filePath 
    : join(cwd, filePath);

  if (!existsSync(fullPath)) {
    return { exists: false, size: 0, lineCount: 0 };
  }

  const content = await fsReadFile(fullPath, 'utf-8');
  return {
    exists: true,
    size: content.length,
    lineCount: content.split('\n').length,
  };
}
