import { waitForPushToTalk, recordAudio, streamAudio } from '../voice/record.js';
import { transcribe } from '../voice/transcribe.js';
import { getCommandForIntent } from '../intents/whitelist.js';
import { executeCommand } from '../exec/runner.js';
import { summarize } from '../summarize/index.js';
import { speak, playAudioFile, speakRealtime } from '../voice/tts.js';
import { createMemory, updateMemory, explainFailure, getDetails } from '../session/memory.js';
import { Intent } from '../intents/types.js';
import { planAndExplain } from '../agent/agent.js';
import { existsSync } from 'fs';
import { createRealtimeSTTConnection } from '../voice/realtime_stt.js';

/**
 * Helper function for fuzzy matching (similar to router.ts matches function).
 * Kept for fallback router when OpenAI agent is not available.
 */
function matches(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * Interruptible version of safeSpeak that monitors user input during TTS.
 * Returns user transcription if interrupted, null if completed normally.
 * 
 * @param text - Text to speak
 * @param mute - Whether to mute output
 * @param useRealtime - Whether to use real-time TTS
 * @param enableInterrupt - Whether to enable interruption detection
 * @returns User transcription string if interrupted, null if completed normally
 */
async function interruptibleSafeSpeak(
  text: string,
  mute: boolean,
  useRealtime: boolean = true,
  enableInterrupt: boolean = false
): Promise<string | null> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:68',message:'interruptibleSafeSpeak called',data:{textLength:text.length,mute,useRealtime,enableInterrupt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
  // #endregion
  
  if (mute || !enableInterrupt) {
    // If mute or interruption not enabled, just call regular safeSpeak
    await safeSpeak(text, mute, useRealtime);
    return null;
  }
  
  // Only enable interruption if real-time STT is available
  if (!useRealtime || !process.env.ELEVENLABS_API_KEY) {
    // Fallback to non-interruptible TTS
    await safeSpeak(text, mute, useRealtime);
    return null;
  }
  
  // Create AbortController for cancelling TTS
  const abortController = new AbortController();
  let interruptedTranscript: string | null = null;
  let sttConnection: any = null;
  let audioCleanup: (() => void) | null = null;
  let resolved = false;
  
  type CleanupFunction = () => void;
  
  try {
    // Import required modules
    const { createRealtimeSTTConnection } = await import('../voice/realtime_stt.js');
    const { streamAudio } = await import('../voice/record.js');
    
    // Start monitoring user input in parallel with TTS
    let resolveInterrupt: ((value: string | null) => void) | null = null;
    const interruptionPromise = new Promise<string | null>((res, rej) => {
      resolveInterrupt = res;
      sttConnection = createRealtimeSTTConnection({
        onTranscript: (transcriptText: string, isFinal: boolean) => {
          // Only interrupt on actual speech (not empty or noise)
          const trimmed = transcriptText.trim();
          if (trimmed && trimmed.length > 2 && !resolved) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:99',message:'User speech detected during TTS, interrupting',data:{transcriptText:trimmed,isFinal},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
            // #endregion
            
            // User started speaking - interrupt TTS
            resolved = true;
            abortController.abort();
            
            // Clean up STT connection
            if (audioCleanup) {
              audioCleanup();
              audioCleanup = null;
            }
            if (sttConnection) {
              sttConnection.close();
              sttConnection = null;
            }
            
            // Get final transcript if available, otherwise use current
            if (resolveInterrupt) {
              if (isFinal && trimmed) {
                interruptedTranscript = trimmed;
                resolveInterrupt(interruptedTranscript);
              } else {
                // Commit transcript to get final version
                if (sttConnection && sttConnection.connected) {
                  sttConnection.commitTranscript();
                  // Wait a bit for final transcript
                  setTimeout(() => {
                    if (resolveInterrupt) resolveInterrupt(trimmed);
                  }, 500);
                  return;
                }
                interruptedTranscript = trimmed;
                resolveInterrupt(interruptedTranscript);
              }
            }
          }
        },
        onError: (error: Error) => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:153',message:'STT error during TTS monitoring',data:{errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
          // #endregion
          if (!resolved && resolveInterrupt) {
            resolved = true;
            // Don't reject - just stop monitoring, TTS will continue
            if (audioCleanup) {
              audioCleanup();
              audioCleanup = null;
            }
            if (sttConnection) {
              sttConnection.close();
              sttConnection = null;
            }
            resolveInterrupt(null);
          }
        },
      });
      
      // Connect and start streaming
      sttConnection.connect()
        .then(async () => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:176',message:'STT connected for TTS interruption monitoring',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
          // #endregion
          
          audioCleanup = await streamAudio({
            sampleRate: 16000,
            onChunk: (chunk: Buffer) => {
              if (!resolved && sttConnection && sttConnection.connected) {
                sttConnection.streamAudioChunk(chunk);
              }
            },
            onError: (error: Error) => {
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:189',message:'Audio stream error during TTS monitoring',data:{errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
              // #endregion
              if (!resolved && resolveInterrupt) {
                resolved = true;
                if (audioCleanup) {
                  audioCleanup();
                  audioCleanup = null;
                }
                if (sttConnection) {
                  sttConnection.close();
                  sttConnection = null;
                }
                resolveInterrupt(null);
              }
            },
          });
        })
        .catch((error: Error) => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:207',message:'STT connection failed for TTS monitoring',data:{errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
          // #endregion
          if (!resolved && resolveInterrupt) {
            resolved = true;
            resolveInterrupt(null); // Continue with TTS even if monitoring fails
          }
        });
    });
    
    // Start TTS with abort signal in parallel
    const ttsPromise = (async () => {
      try {
        // Use OS native TTS (ElevenLabs disabled for testing)
        const { speakWithOSTTS } = await import('../voice/tts.js');
        await speakWithOSTTS(text, abortController.signal);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:201',message:'TTS completed normally',data:{textLength:text.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
      } catch (error) {
        if (!abortController.signal.aborted) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:205',message:'TTS error',data:{errorMessage:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
          // #endregion
          throw error;
        }
      }
    })();
    
    // Race between interruption and TTS completion
    const result = await Promise.race([
      interruptionPromise,
      ttsPromise.then(() => null),
    ]);
    
    // Clean up
    if (!resolved) {
      resolved = true;
      const cleanupFn: (() => void) | null = audioCleanup;
      audioCleanup = null;
      if (cleanupFn !== null && typeof cleanupFn === 'function') {
        try {
          (cleanupFn as () => void)();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
      const connection = sttConnection;
      sttConnection = null;
      if (connection) {
        try {
          connection.close();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    }
    
    return result;
  } catch (error) {
    // Clean up on error
    if (!resolved) {
      resolved = true;
      abortController.abort();
      const cleanupFn: (() => void) | null = audioCleanup;
      audioCleanup = null;
      if (cleanupFn !== null) {
        try {
          (cleanupFn as () => void)();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
      const connection = sttConnection;
      sttConnection = null;
      if (connection) {
        try {
          connection.close();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    }
    
    // Log but don't throw - fallback to regular TTS
    console.warn('⚠️  Interruptible TTS failed, falling back:', error instanceof Error ? error.message : error);
    await safeSpeak(text, mute, useRealtime);
    return null;
  }
}

/**
 * Safely calls speak() without breaking the chat loop if it fails.
 * Uses real-time TTS if available, falls back to batch TTS.
 * Optionally supports interruption detection.
 */
async function safeSpeak(
  text: string,
  mute: boolean,
  useRealtime: boolean = true,
  enableInterrupt: boolean = false
): Promise<string | null> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:17',message:'safeSpeak called',data:{textLength:text.length,mute,useRealtime,hasElevenLabsKey:!!process.env.ELEVENLABS_API_KEY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (mute) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:291',message:'safeSpeak: mute is true, returning early',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    return null;
  }
  
  // If interruption is enabled, use interruptible version
  if (enableInterrupt) {
    return await interruptibleSafeSpeak(text, mute, useRealtime, true);
  }
  try {
    // Use OS native TTS directly (ElevenLabs disabled for testing)
    if (!mute) {
      // Use OS native TTS directly - no files needed!
      // This speaks directly through Windows SAPI (System.Speech.SpeechSynthesizer)
      // or macOS 'say' command, or Linux 'espeak'/'spd-say'
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:295',message:'safeSpeak: using OS TTS (default)',data:{textLength:text.length,platform:process.platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      const { speakWithOSTTS } = await import('../voice/tts.js');
      await speakWithOSTTS(text);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:300',message:'safeSpeak: OS TTS completed',data:{textLength:text.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    } else {
      console.log(`🔇 Muted: Would speak: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    }
    return null;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:38',message:'safeSpeak: error caught',data:{errorMessage:error instanceof Error?error.message:String(error),errorStack:error instanceof Error?error.stack:undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    // Log but don't throw - we want the chat loop to continue
    if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
      console.warn('⚠️  ELEVENLABS_API_KEY not set. Skipping TTS.');
    } else {
      console.error('⚠️  Failed to speak:', error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/**
 * Multi-turn chat mode: interactive loop with session memory.
 * Supports both real-time streaming and batch processing.
 */
export async function chatMode(
  repoPath: string, 
  mute: boolean, 
  useAgent: boolean = false,
  useRealtime: boolean = true
): Promise<void> {
  console.log('🎤 DevVoice - Chat Mode');
  console.log(`📁 Repository: ${repoPath}`);
  console.log('💬 Say "exit" to quit\n');
  
  // Validate repo path
  if (!existsSync(repoPath)) {
    console.error(`❌ Repository path does not exist: ${repoPath}`);
    process.exit(1);
  }
  
  // Validate API keys and provide audio feedback
  const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  
  if (!hasElevenLabsKey) {
    console.warn('⚠️  ELEVENLABS_API_KEY not set. Real-time transcription will not work.');
  }
  
  if (useAgent && !hasOpenAIKey) {
    console.warn('⚠️  OPENAI_API_KEY not set. AI agent will not work. Falling back to keyword router.');
    useAgent = false;
  } else if (useAgent && hasOpenAIKey) {
    // Test OpenAI API key with a simple call
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });
      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:84',message:'Testing OpenAI API key',data:{modelName},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      
      await openai.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:93',message:'OpenAI API key validated successfully',data:{modelName},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      console.log(`✅ OpenAI API key validated with model: ${modelName}`);
    } catch (error) {
      console.warn('⚠️  OpenAI API key validation failed:', error instanceof Error ? error.message : error);
      console.warn('⚠️  Make sure OPENAI_API_KEY is set correctly in your .env file.');
      console.warn('⚠️  You can set OPENAI_MODEL in .env to specify a model (e.g., OPENAI_MODEL=gpt-4o-mini or gpt-4o)');
      console.warn('⚠️  Falling back to keyword router.');
      useAgent = false;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:110',message:'OpenAI API key validation failed',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run10',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
    }
  }
  
  const memory = createMemory();
  let isInteractiveMode = false; // Mode state: false = push-to-talk, true = interactive
  
  while (true) {
    let transcription: string = '';
    try {
      
      // Step 1 & 2: Record and transcribe (real-time or batch)
      // In interactive mode, skip waitForPushToTalk and start recording immediately
      if (isInteractiveMode) {
        // Interactive mode: Start recording immediately without waiting for Enter
        console.log('🔴 Recording... (interactive mode - speak now)');
        
        if (useRealtime && process.env.ELEVENLABS_API_KEY) {
          // Real-time STT path in interactive mode
          try {
            transcription = await transcribeRealtime();
            console.log(`\n💬 Heard: "${transcription}"`);
          } catch (error) {
            console.error('❌ Real-time transcription failed:', error instanceof Error ? error.message : error);
            console.warn('⚠️  Falling back to batch transcription...');
            
            // Fallback to batch
            const audioPath = await recordAudio({ durationSeconds: 8 });
            console.log('✅ Recording complete');
            console.log('📝 Transcribing...');
            
            transcription = await transcribe(audioPath);
            console.log(`\n💬 Heard: "${transcription}"`);
          }
        } else {
          // Batch STT path in interactive mode
          const audioPath = await recordAudio({ durationSeconds: 8 });
          console.log('✅ Recording complete');
          console.log('📝 Transcribing...');
          
          try {
            transcription = await transcribe(audioPath);
            console.log(`\n💬 Heard: "${transcription}"`);
          } catch (error) {
            console.error('❌ Transcription failed:', error instanceof Error ? error.message : error);
            if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
              console.log('⚠️  Continuing chat loop...');
            }
            continue;
          }
        }
      } else {
        // Push-to-talk mode: Wait for Enter first
        if (useRealtime && process.env.ELEVENLABS_API_KEY) {
          // Real-time STT path
          try {
      await waitForPushToTalk();
            console.log('🔴 Recording... (speak now, will transcribe in real-time)');
            
            transcription = await transcribeRealtime();
            console.log(`\n💬 Heard: "${transcription}"`);
          } catch (error) {
            console.error('❌ Real-time transcription failed:', error instanceof Error ? error.message : error);
            console.warn('⚠️  Falling back to batch transcription...');
            
            // Fallback to batch
            await waitForPushToTalk();
      console.log('🔴 Recording... (up to 8 seconds)');
      const audioPath = await recordAudio({ durationSeconds: 8 });
      console.log('✅ Recording complete');
            console.log('📝 Transcribing...');
            
            transcription = await transcribe(audioPath);
            console.log(`\n💬 Heard: "${transcription}"`);
          }
        } else {
          // Batch STT path
          await waitForPushToTalk();
          console.log('🔴 Recording... (up to 8 seconds)');
          const audioPath = await recordAudio({ durationSeconds: 8 });
          console.log('✅ Recording complete');
      console.log('📝 Transcribing...');
          
      try {
        transcription = await transcribe(audioPath);
        console.log(`\n💬 Heard: "${transcription}"`);
      } catch (error) {
        console.error('❌ Transcription failed:', error instanceof Error ? error.message : error);
        if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
          console.log('⚠️  Continuing chat loop...');
        }
        continue;
          }
        }
      }
      
      
      // Step 3: Plan using OpenAI agent (always use if available, fallback handled in agent.ts)
      let intent: Intent;
      let params: Record<string, string> | undefined;
      let planDescription: string;
      let requiresConfirmation = false;
      
      if (useAgent && process.env.OPENAI_API_KEY) {
        console.log('🤖 Using OpenAI AI agent for planning...');
        const agentResult = await planAndExplain(transcription, memory);
        
        // Handle low confidence with clarifying question
        if (agentResult.confidence < 0.6 && agentResult.clarifyingQuestion) {
          const questionText = `I'm not sure I understood. ${agentResult.clarifyingQuestion}`;
          console.log(`\n❓ ${questionText}`);
          await safeSpeak(questionText, mute, useRealtime);
          continue;
        }
        
        intent = agentResult.intent;
        params = agentResult.params;
        planDescription = agentResult.planSteps.join(' → ');
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:553',message:'Intent determined from OpenAI agent',data:{intent,hasParams:!!params,planDescription},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // Handle mode switching intents immediately (before other special intents)
        if (intent === Intent.SWITCH_TO_INTERACTIVE_MODE) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:559',message:'SWITCH_TO_INTERACTIVE_MODE detected',data:{currentMode:isInteractiveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          isInteractiveMode = true;
          const switchText = 'Switching to interactive mode';
          console.log(`\n🔄 ${switchText}`);
          await safeSpeak(switchText, mute, useRealtime, false); // Don't allow interruption during mode switch
          continue; // Skip processing the trigger phrase as a command
        }
        
        if (intent === Intent.EXIT_INTERACTIVE_MODE) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:568',message:'EXIT_INTERACTIVE_MODE detected',data:{currentMode:isInteractiveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          isInteractiveMode = false;
          const exitText = 'Exiting interactive mode. Returning to push-to-talk mode.';
          console.log(`\n🔄 ${exitText}`);
          await safeSpeak(exitText, mute, useRealtime, false); // Don't allow interruption during mode switch
          continue; // Don't continue - let the user know the mode has changed
        }
        
        // Map intent to confirmation requirement
        requiresConfirmation = intent === Intent.CREATE_BRANCH || intent === Intent.MAKE_COMMIT;
        
        // Use AI explanation for EXPLAIN_FAILURE if available
        if (agentResult.explanation && intent === Intent.EXPLAIN_FAILURE) {
          console.log(`\n💡 Explanation: ${agentResult.explanation}`);
          const interruption = await safeSpeak(agentResult.explanation, mute, useRealtime, isInteractiveMode);
          if (interruption) {
            transcription = interruption;
            continue;
          }
          continue;
        }
      } else {
        // Fallback: Import router only when needed
        const { routeIntent, createPlan } = await import('../intents/router.js');
        const intentResult = routeIntent(transcription);
        const plan = createPlan(intentResult);
        intent = plan.intent;
        params = plan.params;
        planDescription = plan.description;
        requiresConfirmation = plan.requiresConfirmation;
      }
      
      console.log(`\n📋 Plan: ${planDescription}`);
      
      // Handle special intents
      if (intent === Intent.EXIT) {
        // If in interactive mode, exit interactive mode first
        if (isInteractiveMode) {
          isInteractiveMode = false;
          const exitText = 'Exiting interactive mode. Returning to push-to-talk mode.';
          console.log(`\n🔄 ${exitText}`);
          await safeSpeak(exitText, mute, useRealtime, false); // Don't allow interruption during mode switch
        }
        const goodbyeText = 'Goodbye!';
        console.log(goodbyeText);
        await safeSpeak(goodbyeText, mute, useRealtime, false); // Don't allow interruption during exit
        break;
      }
      
      if (intent === Intent.HELP) {
        const helpText = getHelpText();
        console.log(helpText);
        const interruption = await safeSpeak(helpText, mute, useRealtime, isInteractiveMode);
        if (interruption) {
          transcription = interruption;
          continue;
        }
        continue;
      }
      
      if (intent === Intent.REPEAT_LAST) {
        if (memory.lastSummary) {
          console.log(`\n📊 Repeating: ${memory.lastSummary}`);
          const interruption = await safeSpeak(memory.lastSummary, mute, useRealtime, isInteractiveMode);
          if (interruption) {
            transcription = interruption;
            continue;
          }
        } else {
          const noLastText = 'No previous summary to repeat.';
          console.log(noLastText);
          const interruption = await safeSpeak(noLastText, mute, useRealtime, isInteractiveMode);
          if (interruption) {
            transcription = interruption;
            continue;
          }
        }
        continue;
      }
      
      if (intent === Intent.EXPLAIN_FAILURE) {
        // If agent provided explanation, it was already handled above
        // Otherwise use fallback explanation
        const explanation = explainFailure(memory);
        console.log(`\n📊 Explanation: ${explanation}`);
        const interruption = await safeSpeak(explanation, mute, useRealtime, isInteractiveMode);
        if (interruption) {
          transcription = interruption;
          continue;
        }
        continue;
      }
      
      if (intent === Intent.DETAILS) {
        const details = getDetails(memory);
        console.log(`\n📄 Details:\n${details}`);
        // Summarize details for speech (first 200 chars)
        const speechDetails = details.length > 200 ? details.substring(0, 200) + '...' : details;
        const interruption = await safeSpeak(`Details: ${speechDetails}`, mute, useRealtime, isInteractiveMode);
        if (interruption) {
          transcription = interruption;
          continue;
        }
        continue;
      }
      
      if (intent === Intent.UNKNOWN) {
        const unknownText = `I didn't understand that. Try saying "help" for available commands.`;
        console.log(unknownText);
        const interruption = await safeSpeak(unknownText, mute, useRealtime, isInteractiveMode);
        if (interruption) {
          transcription = interruption;
          continue;
        }
        continue;
      }
      
      // Step 5: Get command
      const commandTemplate = await getCommandForIntent(intent, params, repoPath);
      
      if (!commandTemplate) {
        let errorText: string;
        if (intent === Intent.MAKE_COMMIT) {
          errorText = 'Cannot commit: no staged changes. Please stage files first using git add.';
        } else {
          errorText = `Cannot execute ${intent}. Command not available or parameters missing.`;
        }
        console.log(`❌ ${errorText}`);
        const interruption = await safeSpeak(errorText, mute, useRealtime, isInteractiveMode);
        if (interruption) {
          transcription = interruption;
          continue;
        }
        continue;
      }
      
      // Step 4: Confirm if needed
      if (requiresConfirmation) {
        console.log('\n⚠️  This action requires confirmation.');
        if (!isInteractiveMode) {
        await waitForPushToTalk();
        }
        console.log('🔴 Recording confirmation...');
        let confirmText: string;
        if (isInteractiveMode && useRealtime && process.env.ELEVENLABS_API_KEY) {
          try {
            confirmText = await transcribeRealtime();
          } catch (error) {
            const confirmAudioPath = await recordAudio({ durationSeconds: 5 });
            confirmText = await transcribe(confirmAudioPath);
          }
        } else {
          if (!isInteractiveMode) {
            await waitForPushToTalk();
          }
        const confirmAudioPath = await recordAudio({ durationSeconds: 5 });
          confirmText = await transcribe(confirmAudioPath);
        }
        console.log(`💬 Confirmation: "${confirmText}"`);
        
        const normalized = confirmText.toLowerCase();
        if (!normalized.includes('confirm') && !normalized.includes('proceed') && !normalized.includes('yes')) {
          const cancelledText = 'Action cancelled.';
          console.log(`❌ ${cancelledText}`);
          const interruption = await safeSpeak(cancelledText, mute, useRealtime, isInteractiveMode);
          if (interruption) {
            transcription = interruption;
            continue;
          }
          continue;
        }
      }
      
      // Step 5: Execute
      console.log(`\n⚙️  Executing: ${commandTemplate.command} ${commandTemplate.args.join(' ')}`);
      const result = await executeCommand(commandTemplate);
      
      // Step 6: Update memory
      const summary = summarize(intent, result);
      updateMemory(memory, intent, result, summary);
      
      // Step 7: Summarize and speak (enable interruption in interactive mode)
      console.log(`\n📊 Summary: ${summary}`);
      const interruption = await safeSpeak(summary, mute, useRealtime, isInteractiveMode);
      
      // Handle interruption: process user input immediately
      if (interruption) {
        console.log(`\n🔊 Interrupted! User said: "${interruption}"`);
        // Process the interruption as new input
        transcription = interruption;
        continue; // Skip the rest and process the interruption
      }
      
      // Show full output if verbose
      if (result.stdout) {
        console.log('\n📄 Output:');
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.log('\n⚠️  Errors:');
        console.log(result.stderr);
      }
      
      // Step 10: Ask for next action
      // In interactive mode, don't print "Press Enter" message and don't wait for Enter
      // The loop will automatically continue to the next iteration (auto-resume recording)
      if (!isInteractiveMode) {
      console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
      } else {
        console.log('\n💬 Listening... (interactive mode - speak now)');
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      const errorText = `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
      const interruption = await safeSpeak(errorText, mute, useRealtime, isInteractiveMode);
      if (interruption) {
        // Use the interruption as new transcription for next iteration
        // Note: transcription variable is declared in the loop scope, so we can't set it here
        // Instead, we'll process it in the next iteration
        console.log(`\n🔊 Error interrupted! User said: "${interruption}"`);
        // Start new iteration with the interruption
        transcription = interruption;
        // Fall through to process the interruption
        // Note: This requires transcription to be accessible here
      }
      // Continue loop instead of exiting - but we need transcription to be in scope
    }
  }
}

/**
 * Transcribes audio using real-time STT WebSocket.
 * Waits for user to speak and returns final transcript.
 */
async function transcribeRealtime(): Promise<string> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:357',message:'transcribeRealtime called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    let finalTranscript = '';
    let audioCleanup: (() => void) | null = null;
    
    const sttConnection = createRealtimeSTTConnection({
      onTranscript: (text: string, isFinal: boolean) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:367',message:'onTranscript callback',data:{text,isFinal,textTrimmed:text.trim(),resolved},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        
        // Ignore if already resolved
        if (resolved) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:333',message:'onTranscript callback but already resolved, ignoring',data:{text,isFinal},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          return;
        }
        
        // Filter out common TTS feedback phrases that might be picked up
        // Only remove if they appear at the start (more precise filtering)
        let filteredText = text.trim();
        
        // Remove "recording started" or "recording stopped" only if they appear at the beginning
        filteredText = filteredText.replace(/^(recording started|recording stopped)[\s,.-]*/gi, '');
        
        // Also remove if the entire text is just these phrases
        if (/^(recording (started|stopped)[\s,.-]*)+$/gi.test(filteredText)) {
          filteredText = '';
        }
        
        filteredText = filteredText.trim();
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:348',message:'Transcript filtered',data:{originalText:text,filteredText,isFinal},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        
        // Show partial transcripts in console (only if not filtered out)
        if (!isFinal && filteredText) {
          process.stdout.write(`\r💬 Partial: "${filteredText}"`);
        }
        
        // When we get a final/committed transcript, resolve
        if (isFinal && filteredText && !resolved) {
          resolved = true;
          finalTranscript = filteredText;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:408',message:'Final transcript received, resolving',data:{finalTranscript,originalText:text},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          // Cleanup immediately
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (maxRecordingTime) clearTimeout(maxRecordingTime);
          if (audioCleanup) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:416',message:'Calling audioCleanup',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            audioCleanup();
            audioCleanup = null;
          }
          sttConnection.close();
          
          resolve(finalTranscript);
        }
      },
      onError: (error: Error) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:428',message:'onError callback',data:{error:error.message,resolved},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (maxRecordingTime) clearTimeout(maxRecordingTime);
          if (audioCleanup) {
            audioCleanup();
            audioCleanup = null;
          }
          sttConnection.close();
          reject(error);
        }
      },
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    let maxRecordingTime: NodeJS.Timeout | null = null;

    sttConnection.connect()
      .then(async () => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:450',message:'STT connected, starting audio stream',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        // Maximum recording time: 8 seconds
        maxRecordingTime = setTimeout(() => {
          if (!resolved) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:457',message:'Max recording time reached, committing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            if (sttConnection.connected) {
              sttConnection.commitTranscript();
            }
          }
        }, 8000);
        
        // Start streaming audio
        audioCleanup = await streamAudio({
          sampleRate: 16000,
          onChunk: (chunk: Buffer) => {
            // Early return if already resolved to prevent processing after cleanup
            if (resolved) {
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:472',message:'Audio chunk received but already resolved, ignoring',data:{chunkSize:chunk.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              return;
            }
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:478',message:'Audio chunk received',data:{chunkSize:chunk.length,isConnected:sttConnection.connected,resolved},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            if (sttConnection.connected && !resolved) {
              sttConnection.streamAudioChunk(chunk);
              // Reset timeout on each chunk (simple silence detection)
              if (timeoutHandle) clearTimeout(timeoutHandle);
              timeoutHandle = setTimeout(() => {
                if (!resolved && sttConnection.connected) {
                  // #region agent log
                  fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:487',message:'Silence timeout, committing transcript',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'E'})}).catch(()=>{});
                  // #endregion
                  sttConnection.commitTranscript();
                }
              }, 2000); // Commit after 2 seconds of silence
            }
          },
          onError: (error: Error) => {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:496',message:'Audio stream error',data:{error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            if (!resolved) {
              resolved = true;
              if (timeoutHandle) clearTimeout(timeoutHandle);
              if (maxRecordingTime) clearTimeout(maxRecordingTime);
              if (audioCleanup) {
                audioCleanup();
                audioCleanup = null;
              }
              sttConnection.close();
              reject(error);
            }
          },
        });
      })
      .catch((error) => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1e40d4a9-c2e9-421f-955d-44febad8f877',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.ts:514',message:'STT connect failed',data:{error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (maxRecordingTime) clearTimeout(maxRecordingTime);
          if (audioCleanup) {
            audioCleanup();
            audioCleanup = null;
          }
          reject(error);
        }
      });
  });
}

function getHelpText(): string {
  return `Available commands: run tests, git status, run lint, run build, create branch, commit, explain failure, details, repeat, help, exit.`;
}
