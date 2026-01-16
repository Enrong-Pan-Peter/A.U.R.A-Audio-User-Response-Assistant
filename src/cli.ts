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
  .option('--mute', 'Disable text-to-speech output (same as --no-play)')
  .option('--no-play', 'Disable audio playback')
  .option('--play-mode <mode>', 'Playback mode: stream (pipe to ffplay, no files) or file (save and play)', 'stream')
  .option('--keep-audio', 'Keep audio files after playback (only applies to file mode, default: auto-cleanup)')
  .option('--player <command>', 'Custom audio player command (only applies to file mode, overrides platform default)')
  .option('--live', 'Enable live transcription with partial updates (default: true)')
  .option('--no-live', 'Disable live transcription, use batch mode')
  .option('--silence-ms <number>', 'Silence timeout in milliseconds before finalizing (default: 3000)', '3000')
  .option('--stt-model <id>', 'Realtime STT model id (overrides ELEVENLABS_STT_MODEL)')
  .option('--no-agent', 'Disable AI agent (use simple keyword matching)')
  .action(async (options) => {
    const repoPath = options.repo || process.cwd();
    const mute = options.mute || options.noPlay || false;
    const keepAudio = options.keepAudio || false;
    const player = options.player;
    const playMode = (options.playMode === 'file' || options.playMode === 'stream') 
      ? options.playMode 
      : 'stream';
    const live = options.noLive ? false : (options.live !== false); // Default to true unless --no-live
    const silenceMs = parseInt(options.silenceMs || '3000', 10);
    const sttModel = options.sttModel || process.env.ELEVENLABS_STT_MODEL;
    // Use agent if OPENAI_API_KEY is set and --no-agent flag is not present
    const useAgent = !!(process.env.OPENAI_API_KEY && options.agent !== false);
    await listenMode(repoPath, mute, useAgent, { keepAudio, player, playMode, live, silenceMs, sttModel });
  });

program
  .command('chat')
  .description('Multi-turn interactive voice chat')
  .option('--repo <path>', 'Repository path (default: current directory)')
  .option('--mute', 'Disable text-to-speech output (same as --no-play)')
  .option('--no-play', 'Disable audio playback')
  .option('--play-mode <mode>', 'Playback mode: stream (pipe to ffplay, no files) or file (save and play)', 'stream')
  .option('--keep-audio', 'Keep audio files after playback (only applies to file mode, default: auto-cleanup)')
  .option('--player <command>', 'Custom audio player command (only applies to file mode, overrides platform default)')
  .option('--live', 'Enable live transcription with partial updates (default: true)')
  .option('--no-live', 'Disable live transcription, use batch mode')
  .option('--silence-ms <number>', 'Silence timeout in milliseconds before finalizing (default: 3000)', '3000')
  .option('--stt-model <id>', 'Realtime STT model id (overrides ELEVENLABS_STT_MODEL)')
  .option('--no-agent', 'Disable AI agent (use simple keyword matching)')
  .action(async (options) => {
    const repoPath = options.repo || process.cwd();
    const mute = options.mute || options.noPlay || false;
    const keepAudio = options.keepAudio || false;
    const player = options.player;
    const playMode = (options.playMode === 'file' || options.playMode === 'stream') 
      ? options.playMode 
      : 'stream';
    const live = options.noLive ? false : (options.live !== false); // Default to true unless --no-live
    const silenceMs = parseInt(options.silenceMs || '3000', 10);
    const sttModel = options.sttModel || process.env.ELEVENLABS_STT_MODEL;
    // Use agent if OPENAI_API_KEY is set and --no-agent flag is not present
    const useAgent = !!(process.env.OPENAI_API_KEY && options.agent !== false);
    await chatMode(repoPath, mute, useAgent, { keepAudio, player, playMode, live, silenceMs, sttModel });
  });

program.parse();
