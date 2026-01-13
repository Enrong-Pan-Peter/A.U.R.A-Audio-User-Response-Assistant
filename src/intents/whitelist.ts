import { Intent } from './types.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export interface CommandTemplate {
  command: string;
  args: string[];
  cwd?: string;
}

/**
 * Maps intents to safe, whitelisted commands.
 * Detects package manager and available scripts.
 */
export async function getCommandForIntent(
  intent: Intent,
  params: Record<string, string> | undefined,
  repoPath: string
): Promise<CommandTemplate | null> {
  const packageJsonPath = join(repoPath, 'package.json');
  const hasPackageJson = existsSync(packageJsonPath);
  
  let packageManager: 'pnpm' | 'npm' | null = null;
  if (hasPackageJson) {
    if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
    } else if (existsSync(join(repoPath, 'package-lock.json'))) {
      packageManager = 'npm';
    }
  }
  
  switch (intent) {
    case Intent.RUN_TESTS:
      if (packageManager && hasPackageJson) {
        const scripts = getPackageScripts(packageJsonPath);
        if (scripts.test) {
          return {
            command: packageManager,
            args: ['test'],
            cwd: repoPath,
          };
        }
      }
      return null;
      
    case Intent.RUN_LINT:
      if (packageManager && hasPackageJson) {
        const scripts = getPackageScripts(packageJsonPath);
        if (scripts.lint) {
          return {
            command: packageManager,
            args: packageManager === 'pnpm' ? ['lint'] : ['run', 'lint'],
            cwd: repoPath,
          };
        }
      }
      return null;
      
    case Intent.RUN_BUILD:
      if (packageManager && hasPackageJson) {
        const scripts = getPackageScripts(packageJsonPath);
        if (scripts.build) {
          return {
            command: packageManager,
            args: packageManager === 'pnpm' ? ['build'] : ['run', 'build'],
            cwd: repoPath,
          };
        }
      }
      return null;
      
    case Intent.GIT_STATUS:
      return {
        command: 'git',
        args: ['status', '--porcelain'],
        cwd: repoPath,
      };
      
    case Intent.CREATE_BRANCH:
      if (!params?.name) {
        return null;
      }
      // Sanitize branch name (only alphanumeric, hyphens, underscores)
      const branchName = params.name.replace(/[^a-z0-9\-_]/gi, '');
      if (!branchName) {
        return null;
      }
      return {
        command: 'git',
        args: ['checkout', '-b', branchName],
        cwd: repoPath,
      };
      
    case Intent.MAKE_COMMIT:
      if (!params?.message) {
        return null;
      }
      // Check for staged changes
      if (!hasStagedChanges(repoPath)) {
        return null; // Will be handled by caller to inform user
      }
      // Sanitize commit message (escape quotes)
      const message = params.message.replace(/"/g, '\\"');
      return {
        command: 'git',
        args: ['commit', '-m', message],
        cwd: repoPath,
      };
      
    default:
      return null;
  }
}

/**
 * Reads package.json scripts.
 */
function getPackageScripts(packageJsonPath: string): Record<string, string> {
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

/**
 * Checks if there are staged changes in the git repository.
 */
function hasStagedChanges(repoPath: string): boolean {
  try {
    const result = execSync('git diff --cached --quiet', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return false; // Exit code 0 means no staged changes
  } catch {
    return true; // Exit code non-zero means there are staged changes
  }
}
