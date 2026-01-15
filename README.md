# DevVoice

A voice-first developer assistant CLI tool for local git repositories. Control your development workflow using voice commands with safety-first execution.

## Features

- 🎤 **Voice Input**: Push-to-talk recording (up to 8 seconds per turn)
- 🧠 **Intent-Based Commands**: Safe command execution via whitelist mapping
- 🔊 **Text-to-Speech**: ElevenLabs integration for spoken responses with automatic audio playback
- 💬 **Two Modes**:
  - `listen`: Single-turn command execution
  - `chat`: Multi-turn interactive session with memory
- 🛡️ **Safety First**: Never executes arbitrary shell commands
- 📊 **Smart Summarization**: Extracts key information from command outputs

## Installation

### Prerequisites

- Node.js 18+ and pnpm
- **Audio Recording**: 
  - macOS: Built-in support
  - Linux: `sox` or `rec` (install via `sudo apt-get install sox` or `sudo yum install sox`)
  - Windows: `sox` (install from [sox.sourceforge.net](http://sox.sourceforge.net/))
- **Audio Playback** (required for TTS):
  - **Recommended**: FFmpeg (includes `ffplay`) - enables streaming playback without saving files
    - Download from [ffmpeg.org/download.html](https://ffmpeg.org/download.html)
    - Ensure `ffplay` is in your PATH
    - Streaming mode (default): pipes audio directly to ffplay, no files created
  - **Fallback** (file mode): If ffplay is not found, falls back to platform-specific players:
    - macOS: Built-in (`afplay`) - automatically installed
    - Linux: Install one of `mpg123`, `paplay` (PulseAudio), or `aplay` (ALSA)
      - `sudo apt-get install mpg123` (Debian/Ubuntu)
      - `sudo yum install mpg123` (RHEL/CentOS)
    - Windows: Built-in (Windows Media Player via PowerShell) - automatically available

### Setup

1. Clone or navigate to the project directory:
```bash
cd devvoice
```

2. Install dependencies:
```bash
pnpm install
```

3. Set environment variables:
```bash
# Required for TTS (ElevenLabs)
export ELEVENLABS_API_KEY="your-api-key-here"

# Optional: Custom voice ID (default: Rachel)
export ELEVENLABS_VOICE_ID="your-voice-id"
```

4. Build the project:
```bash
pnpm build
```

## Usage

### Single-Turn Mode (`listen`)

Execute a single voice command and exit:

```bash
pnpm dev listen
# or
pnpm dev listen --repo /path/to/repo
# or
pnpm dev listen --mute  # Disable TTS
# or
pnpm dev listen --no-play  # Disable audio playback
# or
pnpm dev listen --play-mode=stream  # Stream to ffplay (default, no files)
# or
pnpm dev listen --play-mode=file  # Save to file and play (fallback if ffplay not found)
# or
pnpm dev listen --play-mode=stream  # Stream to ffplay (requires FFmpeg, no files)
# or
pnpm dev listen --keep-audio  # Keep audio files after playback (file mode only)
# or
pnpm dev listen --player "custom-player-command"  # Use custom player (file mode only)
```

**Example flow:**
1. Press Enter to start recording
2. Speak your command (e.g., "run tests")
3. Wait for transcription and confirmation (if needed)
4. Command executes and results are spoken
5. Tool exits

### Multi-Turn Mode (`chat`)

Interactive chat session with memory:

```bash
pnpm dev chat
# or
pnpm dev chat --repo /path/to/repo
# or
pnpm dev chat --mute  # Disable TTS playback (same as --no-play)
# or
pnpm dev chat --no-play  # Disable audio playback
# or
pnpm dev chat --play-mode=stream  # Stream to ffplay (default, no files)
# or
pnpm dev chat --play-mode=file  # Save to file and play (fallback if ffplay not found)
# or
pnpm dev chat --keep-audio  # Keep audio files after playback (file mode only)
# or
pnpm dev chat --player "custom-player-command"  # Use custom player (file mode only)
```

**Example flow:**
1. Press Enter to start recording
2. Speak your command
3. Get results and summary
4. Say "exit" to quit, or continue with follow-ups like:
   - "details" - Show more details about last output
   - "explain failure" - Explain why last command failed
   - "repeat" - Repeat last summary
   - "run tests" - Execute another command

## Supported Commands

### Read-Only (No Confirmation Required)

- **`run tests`** - Execute test suite (detects `pnpm test` or `npm test`)
- **`git status`** - Show git status with file changes
- **`run lint`** - Run linter (if configured in package.json)
- **`run build`** - Build project (if configured in package.json)

### Write Actions (Requires Spoken Confirmation)

- **`create branch <name>`** - Create and checkout new git branch
  - Example: "create branch feature-auth"
- **`commit <message>`** - Create git commit with message
  - Example: "commit add user authentication"
  - Note: Requires staged changes

### Session Commands (Chat Mode Only)

- **`details`** - Show detailed output from last command
- **`explain failure`** - Explain why last command failed
- **`repeat`** - Repeat last summary
- **`help`** - Show available commands
- **`exit`** - Exit chat mode

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── modes/
│   ├── listen.ts       # Single-turn mode
│   └── chat.ts         # Multi-turn mode
├── voice/
│   ├── record.ts       # Audio recording
│   └── transcribe.ts   # Speech-to-text (placeholder)
├── tts/
│   ├── elevenlabs.ts   # ElevenLabs TTS integration
│   └── playback.ts     # Cross-platform audio playback
├── intents/
│   ├── types.ts        # Intent type definitions
│   ├── router.ts       # Text → Intent routing
│   └── whitelist.ts    # Intent → Safe command mapping
├── exec/
│   └── runner.ts       # Safe command execution
├── summarize/
│   ├── index.ts        # Summarization router
│   ├── tests.ts        # Test output summarization
│   ├── git.ts          # Git status summarization
│   ├── lint.ts         # Lint output summarization
│   ├── build.ts        # Build output summarization
│   └── generic.ts      # Generic summarization
└── session/
    └── memory.ts       # Chat session memory
```

## Safety Features

1. **Whitelist-Based Execution**: Only predefined commands are executed
2. **No Shell Injection**: Uses `spawn` with explicit command/args (never shell strings)
3. **Parameter Sanitization**: Branch names and commit messages are sanitized
4. **Confirmation Required**: Write actions require spoken confirmation
5. **Intent Validation**: Unknown commands are rejected

## Transcription Integration

The current implementation uses a placeholder transcription that prompts for manual input. To integrate a real STT provider:

1. Edit `src/voice/transcribe.ts`
2. Replace the `transcribe()` function with your provider's API
3. Supported providers:
   - OpenAI Whisper API
   - Google Cloud Speech-to-Text
   - Azure Speech Services
   - AssemblyAI
   - Deepgram

Example (OpenAI Whisper):
```typescript
import FormData from 'form-data';
import fs from 'fs';
import fetch from 'node-fetch';

export async function transcribe(audioPath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioPath));
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  const data = await response.json();
  return data.text;
}
```

## Development

```bash
# Development mode (with tsx)
pnpm dev listen

# Build
pnpm build

# Run built version
pnpm start listen
```

## Troubleshooting

### Audio Recording Fails

- **macOS/Linux**: Ensure `sox` or `rec` is installed
- **Windows**: Install `sox` and ensure it's in PATH
- Check microphone permissions in system settings

### Audio Playback Fails

- **Streaming Mode (Default)**: Requires FFmpeg with `ffplay`
  - Install FFmpeg from [ffmpeg.org/download.html](https://ffmpeg.org/download.html)
  - Ensure `ffplay` is in your PATH
  - If ffplay is not found, automatically falls back to file mode
- **File Mode (Fallback)**: 
  - **Linux**: Install one of the supported players:
    - `mpg123` (recommended for MP3): `sudo apt-get install mpg123` or `sudo yum install mpg123`
    - `paplay` (PulseAudio): Usually pre-installed on modern Linux distributions
    - `aplay` (ALSA): Usually pre-installed
  - **Windows**: Should work automatically with built-in Windows Media Player
    - If PowerShell method fails, automatically falls back to `start` command
  - **macOS**: `afplay` is built-in and should work automatically
  - If playback fails, audio files are saved to temp directory (path is printed)
- Use `--play-mode=file` to force file mode
- Use `--player "your-command"` to specify a custom audio player (file mode only)
- Use `--keep-audio` to preserve audio files for debugging (file mode only)

### Transcription Placeholder

The MVP uses a manual input placeholder. For production, integrate a real STT provider (see Transcription Integration section).

### ElevenLabs API Errors

- Verify `ELEVENLABS_API_KEY` is set correctly
- Check API quota/limits
- Use `--mute` or `--no-play` flag to disable TTS playback for testing

### Audio Playback Options

- **Default behavior**: TTS audio is automatically played after generation using file-based playback (saves to temp file, plays, then deletes)
- **`--play-mode=file`** (default): Save audio to file and play using platform-specific player
- **`--play-mode=stream`**: Stream audio directly to ffplay without saving files (requires FFmpeg)
- **`--play` or default**: Audio playback is enabled by default
- **`--no-play` or `--mute`**: Disable automatic playback (file is still saved)
- **`--keep-audio`**: Keep audio files after playback (file mode only, default: files are auto-deleted after successful playback)
- **`--player <command>`**: Use a custom audio player command (file mode only, overrides platform default)

## License

MIT
