#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { chatMode } from './modes/chat.js';
import { listenMode } from './modes/listen.js';

const program = new Command();

program
  .name('devvoice')
  .description('Voice-first developer assistant for local git repositories')
  .version('1.0.0');

program
  .command('listen')
  .description('Single-turn voice command execution')
  .option('--repo <path>', 'Repository path (default: current directory)')
  .option('--mute', 'Disable text-to-speech output')
  .option('--no-agent', 'Disable AI agent (use simple keyword matching)')
  .action(async (options) => {
    const repoPath = options.repo || process.cwd();
    const mute = options.mute || false;
    // Use agent if OPENAI_API_KEY is set and --no-agent flag is not present
    const useAgent = !!(process.env.OPENAI_API_KEY && options.agent !== false);
    await listenMode(repoPath, mute, useAgent);
  });

program
  .command('chat')
  .description('Multi-turn interactive voice chat with real-time streaming')
  .option('--repo <path>', 'Repository path (default: current directory)')
  .option('--mute', 'Disable text-to-speech output')
  .option('--no-agent', 'Disable AI agent (use simple keyword matching)')
  .option('--batch', 'Use batch STT/TTS instead of real-time streaming')
  .action(async (options) => {
    const repoPath = options.repo || process.cwd();
    const mute = options.mute || false;
    // Always use OpenAI agent if OPENAI_API_KEY is set (unless --no-agent flag is present)
    const useAgent = !!(process.env.OPENAI_API_KEY && options.agent !== false);
    const useRealtime = !options.batch; // Use real-time by default
    await chatMode(repoPath, mute, useAgent, useRealtime);
  });

program.parse();
