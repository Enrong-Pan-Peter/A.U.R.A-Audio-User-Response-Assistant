# DevVoice - Hackathon Demo Script

**Target Duration: 1-1.5 minutes**

---

## Script

Hey! We built **AURA** — a voice-first developer assistant for hands-free coding workflow.

**What we built:**

It's an AI pair programmer you talk to. Speak naturally — like "run tests" or "create branch feature-auth" — and it executes safely, then speaks the results back.

**What problems it solves:**

When coding, your hands are on the keyboard. Switching to terminal breaks your flow. AURA lets you stay in your editor and just talk. Ask codebase questions in plain English like "check for bugs in agent.ts" or "explain why this failed", and it searches your code and explains it.

**How it works:**

For speech-to-text, we use **ElevenLabs' Realtime API** — their `scribe_v2_realtime` model over WebSockets for live transcription with partial updates. For text-to-speech, **ElevenLabs'** `eleven_flash_v2_5` model gives natural-sounding responses that stream directly to your speakers. **OpenAI's GPT-4o-mini** understands your natural language, maps it to intents, and powers codebase semantic search. Runs in single-turn or multi-turn chat modes, safety-first with whitelisted commands. Built with TypeScript in Node.js.

---

## Key Talking Points (Quick Reference)

**Technologies to emphasize:**
- ElevenLabs Realtime API (scribe_v2_realtime) - WebSocket-based live transcription
- ElevenLabs TTS (eleven_flash_v2_5) - Natural-sounding voice responses
- OpenAI GPT-4o-mini - Natural language understanding and codebase Q&A
- WebSockets - Real-time bidirectional communication
- TypeScript/Node.js - Modern CLI development

**What it does:**
- Voice commands for git and development tasks
- Live transcription with partial updates
- Natural language understanding
- Codebase Q&A with semantic search
- Two modes: single-turn and multi-turn chat
- Safety-first whitelist execution

**Problems solved:**
- Hands-free git operations while coding
- No need to switch to terminal
- Natural language codebase queries
- Real-time feedback on what you're saying

---

## Tips for Recording

1. **Show it in action** - Have the terminal open and demonstrate saying a command like "run tests"
2. **Highlight the live transcription** - Point out how text appears as you speak
3. **Show the audio response** - Let it speak the results back
4. **Be conversational** - Don't just read the script, make it feel natural
5. **Speed up if needed** - You can talk faster for the technology part, but keep the intro/outro clear