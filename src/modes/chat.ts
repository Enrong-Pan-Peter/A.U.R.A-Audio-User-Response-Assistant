import { existsSync } from 'fs';
import { planAndExplain } from '../agent/agent.js';
import { dispatchAgentResult, DispatchedResult } from '../dispatcher/dispatcher.js';
import { executeCommand } from '../exec/runner.js';
import { createPlan, routeIntent } from '../intents/router.js';
import { Intent } from '../intents/types.js';
import { getConfirmation } from '../session/confirmation.js';
import { createMemory, updateMemory } from '../session/memory.js';
import { applyStyleDirective } from '../session/responseStyle.js';
import { AppState, PendingAction } from '../session/state.js';
import { summarize } from '../summarize/index.js';
import { recordAudio, waitForPushToTalk } from '../voice/record.js';
import { streamTranscribe } from '../voice/streamTranscribe.js';
import { transcribe } from '../voice/transcribe.js';
import { speak } from '../voice/tts.js';

import { PlayMode } from '../voice/tts.js';

export interface ChatOptions {
  keepAudio?: boolean;
  player?: string;
  playMode?: PlayMode;
  live?: boolean; // Enable live transcription (default: true)
  silenceMs?: number; // Silence timeout in milliseconds (default: 1000)
  sttModel?: string; // Realtime STT model id
}

/**
 * Safely calls speak() without breaking the chat loop if it fails.
 */
async function safeSpeak(
  text: string,
  mute: boolean,
  options: ChatOptions = {}
): Promise<void> {
  if (mute) return;
  try {
    await speak(text, {
      play: !mute,
      playMode: options.playMode || 'stream',
      keepAudio: options.keepAudio,
      player: options.player,
    });
  } catch (error) {
    // Log but don't throw - we want the chat loop to continue
    if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
      console.warn('⚠️  ELEVENLABS_API_KEY not set. Skipping TTS.');
    } else {
      console.error('⚠️  Failed to speak:', error instanceof Error ? error.message : error);
    }
  }
}

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectInteractiveModeTrigger(text: string): boolean {
  const normalized = normalizeTranscript(text);
  const triggerPhrase = 'i need you to talk interactively to me';
  if (normalized.includes(triggerPhrase)) {
    return true;
  }

  if (!normalized.includes('interactive')) {
    return false;
  }

  const triggerTokens = new Set(triggerPhrase.split(' '));
  const inputTokens = new Set(normalized.split(' '));
  let matches = 0;
  triggerTokens.forEach((token) => {
    if (inputTokens.has(token)) {
      matches += 1;
    }
  });

  return matches >= 6;
}

function detectExitInteractiveMode(text: string, intent?: Intent): boolean {
  if (intent === Intent.EXIT) {
    return false; // "exit" should quit via normal intent handling
  }

  const normalized = normalizeTranscript(text);
  return (
    normalized.includes('exit interactive mode') ||
    normalized.includes('stop interactive mode') ||
    normalized.includes('exit interactive')
  );
}

/**
 * Multi-turn chat mode: interactive loop with session memory.
 */
export async function chatMode(
  repoPath: string,
  mute: boolean,
  useAgent: boolean = false,
  options: ChatOptions = {}
): Promise<void> {
  console.log('🎤 DevVoice - Chat Mode');
  console.log(`📁 Repository: ${repoPath}`);
  console.log('💬 Say "exit" to quit\n');
  
  // Validate repo path
  if (!existsSync(repoPath)) {
    console.error(`❌ Repository path does not exist: ${repoPath}`);
    process.exit(1);
  }
  
  const memory = createMemory();
  let currentState: AppState = AppState.LISTENING_FOR_COMMAND;
  let pendingAction: PendingAction | null = null;
  let isInteractiveMode = false;
  
  while (true) {
    try {
      // State machine: handle different states
      if (currentState === AppState.AWAITING_CONFIRMATION) {
        // Handle confirmation state
        if (!pendingAction) {
          // Should not happen, but reset if it does
          currentState = AppState.LISTENING_FOR_COMMAND;
          continue;
        }

        // Get confirmation (voice or typed)
        // Note: The action details were already shown when entering this state
        const useLiveTranscription = options.live !== false;
        const confirmation = await getConfirmation({
          useVoice: true,
          useLiveTranscription,
          silenceMs: options.silenceMs || 2000,
        });

        if (confirmation === 'yes') {
          // Execute the pending action
          console.log(`\n⚙️  Executing: ${pendingAction.commandTemplate.command} ${pendingAction.commandTemplate.args.join(' ')}`);
          
          try {
            const result = await executeCommand(pendingAction.commandTemplate);
            
            // Update memory
            const summary = summarize(pendingAction.intent, result);
            updateMemory(memory, pendingAction.intent, result, summary);
            
            // Summarize and speak
            console.log(`\n📊 Summary: ${summary}`);
            await safeSpeak(summary, mute, options);
            
            // Show full output if verbose
            if (result.stdout) {
              console.log('\n📄 Output:');
              console.log(result.stdout);
            }
            if (result.stderr) {
              console.log('\n⚠️  Errors:');
              console.log(result.stderr);
            }
          } catch (error) {
            console.error('❌ Execution failed:', error);
            const errorText = `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
            await safeSpeak(errorText, mute, options);
          }
          
          // Clear pending action and return to listening
          pendingAction = null;
          currentState = AppState.LISTENING_FOR_COMMAND;
          if (!isInteractiveMode) {
            console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
          }
          continue;
        } else if (confirmation === 'no') {
          // Cancel the action
          const cancelledText = 'Action cancelled.';
          console.log(`\n❌ ${cancelledText}`);
          await safeSpeak(cancelledText, mute, options);
          
          // Clear pending action and return to listening
          pendingAction = null;
          currentState = AppState.LISTENING_FOR_COMMAND;
          if (!isInteractiveMode) {
            console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
          }
          continue;
        } else {
          // Unclear - reprompt
          const unclearText = "I didn't understand. Please say 'yes' to proceed or 'no' to cancel.";
          console.log(`\n❓ ${unclearText}`);
          await safeSpeak(unclearText, mute, options);
          // Stay in AWAITING_CONFIRMATION state
          continue;
        }
      }

      // LISTENING_FOR_COMMAND state
      // Step 1: Wait for push-to-talk (skip when live transcription is enabled)
      const useLiveTranscription = options.live !== false; // Default to true
      if (!isInteractiveMode && !useLiveTranscription) {
        await waitForPushToTalk();
      }
      
      // Step 2 & 3: Record and transcribe (with live transcription if enabled)
      let transcription: string;
      let audioPath: string | undefined;
      
      if (useLiveTranscription) {
        try {
          console.log(isInteractiveMode ? '🔴 Recording... (interactive mode — speak now)' : '🎤 Listening... (Press Enter to stop)');
          const result = await streamTranscribe({
            live: true,
            silenceMs: options.silenceMs || 1000,
            onManualStop: () => false, // Manual stop handled internally
            modelId: options.sttModel,
          });
          
          transcription = result.transcript;
          audioPath = result.audioPath;
          
          if (transcription) {
            console.log(`\n💬 Heard: "${transcription}"`);
          } else {
            if (!isInteractiveMode) {
              console.log('\n⚠️  No transcription received');
            }
            continue;
          }
        } catch (error) {
          console.error('❌ Streaming transcription failed:', error instanceof Error ? error.message : error);
          if (isInteractiveMode) {
            isInteractiveMode = false;
            const message = 'I had trouble transcribing. Switching back to push-to-talk.';
            console.log(`⚠️  ${message}`);
            await safeSpeak(message, mute, options);
          }
          // Fall back to batch transcription
          console.log('⚠️  Falling back to batch transcription...');
          try {
            audioPath = await recordAudio({ durationSeconds: 8 });
            transcription = await transcribe(audioPath);
            console.log(`\n💬 Heard: "${transcription}"`);
          } catch (fallbackError) {
            console.error('❌ Batch transcription also failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
            if (fallbackError instanceof Error && fallbackError.message.includes('ELEVENLABS_API_KEY')) {
              console.log('⚠️  Continuing chat loop...');
            }
            if (isInteractiveMode) {
              isInteractiveMode = false;
              const message = 'I had trouble transcribing. Switching back to push-to-talk.';
              console.log(`⚠️  ${message}`);
              await safeSpeak(message, mute, options);
            }
            continue;
          }
        }
      } else {
        // Batch transcription (original behavior)
        console.log(isInteractiveMode ? '🔴 Recording... (interactive mode — speak now)' : '🔴 Recording... (up to 8 seconds)');
        audioPath = await recordAudio({ durationSeconds: 8 });
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
          if (isInteractiveMode) {
            isInteractiveMode = false;
            const message = 'I had trouble transcribing. Switching back to push-to-talk.';
            console.log(`⚠️  ${message}`);
            await safeSpeak(message, mute, options);
          }
          continue;
        }
      }
      
      if (detectInteractiveModeTrigger(transcription)) {
        isInteractiveMode = true;
        console.log('🎧 Switching to interactive mode');
        await safeSpeak('Switching to interactive mode', mute, options);
        continue;
      }

      if (isInteractiveMode && detectExitInteractiveMode(transcription)) {
        isInteractiveMode = false;
        console.log('🛑 Exiting interactive mode');
        await safeSpeak('Exiting interactive mode', mute, options);
        continue;
      }

      // Apply response style directives (e.g., "be detailed", "short")
      const styleDirective = applyStyleDirective(transcription, memory.responseStyle);
      if (styleDirective.changed) {
        memory.responseStyle = styleDirective.style;
        if (styleDirective.onlyDirective) {
          const ackText = styleDirective.ackText || 'Got it.';
          console.log(`\n💬 ${ackText}`);
          await safeSpeak(ackText, mute, options);
          continue;
        }
        if (styleDirective.cleanedText) {
          transcription = styleDirective.cleanedText;
        }
      }

      // Step 4: Plan using AI agent or fallback router
      // Step 4: Plan using AI agent or fallback router and dispatch
      let dispatchedResult: DispatchedResult;
      
      // Check if we're in diagnosis mode and user is responding to a follow-up question
      if (memory.inDiagnosisMode && memory.lastAssistantQuestion) {
        // Simple heuristic: if user response is short and doesn't match a clear new intent, treat as follow-up
        const normalized = transcription.toLowerCase().trim();
        const isNewIntent = normalized.match(/^(run|git|create|commit|help|exit|quit|stop)/i) ||
                           normalized.length > 50; // Long responses are likely new requests
        
        if (!isNewIntent) {
          // Treat as follow-up to diagnosis question
          console.log('💬 Continuing diagnosis conversation...');
          
          // For now, provide a simple response acknowledging the follow-up
          // In a full implementation, this could use LLM to continue the conversation
          const followUpResponse = `Thanks for that information. Based on your response, here's what I'd suggest:\n\n`;
          const suggestion = memory.lastRun 
            ? `Since you're dealing with: \`${memory.lastRun.command}\`\n\nTry the steps I mentioned earlier. If you'd like me to run a diagnostic command, just say "yes" or tell me which command to run.`
            : `Review the error output and try the suggested fixes. If you need more help, describe what you've tried.`;
          
          console.log(`\n💬 ${followUpResponse}${suggestion}`);
          await safeSpeak(followUpResponse + suggestion, mute, options);
          
          // Clear diagnosis mode after one follow-up to avoid infinite loops
          memory.inDiagnosisMode = false;
          memory.lastAssistantQuestion = undefined;
          
          console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
          continue;
        } else {
          // Clear diagnosis mode - user wants to do something new
          memory.inDiagnosisMode = false;
          memory.lastAssistantQuestion = undefined;
        }
      }
      
      if (useAgent && process.env.OPENAI_API_KEY) {
        console.log('🤖 Using AI agent for planning...');
        const agentResult = await planAndExplain(transcription, memory);
        console.log(`📋 Agent result received: intent=${agentResult.intent}, confidence=${agentResult.confidence}`);
        
        // Handle low confidence with clarifying question
        if (agentResult.confidence < 0.6 && agentResult.clarifyingQuestion) {
          const questionText = `I'm not sure I understood. ${agentResult.clarifyingQuestion}`;
          console.log(`\n❓ ${questionText}`);
          await safeSpeak(questionText, mute, options);
          continue;
        }
        
        // Dispatch agent result
        console.log(`🔄 Dispatching intent: ${agentResult.intent}`);
        dispatchedResult = await dispatchAgentResult(agentResult, memory, repoPath);
      } else {
        // Fallback to simple router
        const intentResult = routeIntent(transcription);
        const plan = createPlan(intentResult);
        
        // Convert router result to agent result format for dispatcher
        // For CODEBASE_QA, extract query from transcription
        const params = plan.params || {};
        if (plan.intent === Intent.CODEBASE_QA && !params.query) {
          params.query = transcription;
        }
        
        const mockAgentResult = {
          intent: plan.intent,
          params,
          planSteps: [plan.description],
          explanation: undefined,
          confidence: intentResult.confidence,
        };
        
        console.log(`🔄 Dispatching intent (router): ${plan.intent}`);
        dispatchedResult = await dispatchAgentResult(mockAgentResult, memory, repoPath);
      }

      // Step 5: Handle dispatched result
      if (dispatchedResult.type === 'info') {
        // Informational intent - print and speak response immediately
        console.log(`\n💬 Response: ${dispatchedResult.responseText}`);
        await safeSpeak(dispatchedResult.responseText, mute, options);
        
        // Handle EXIT intent specially
        if (dispatchedResult.intent === Intent.EXIT) {
          break;
        }
        
        // For other info intents, continue to next iteration (ask for next command)
        if (!isInteractiveMode) {
          console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
          console.log(`🔄 Returning to listening state...`);
        }
        continue;
      }
      
      // Action intent - proceed with execution flow
      console.log(`\n📋 Plan: ${dispatchedResult.plan}`);
      await safeSpeak(`I will ${dispatchedResult.plan.toLowerCase()}`, mute, options);
      
      // Step 6: Handle confirmation requirement
      if (dispatchedResult.requiresConfirmation) {
        // Store pending action and switch to confirmation state
        pendingAction = {
          intent: dispatchedResult.intent,
          description: dispatchedResult.plan,
          commandTemplate: dispatchedResult.commandTemplate,
          params: dispatchedResult.params,
        };
        
        currentState = AppState.AWAITING_CONFIRMATION;
        
        // Show what will be executed
        const confirmationPrompt = `\n⚠️  This action requires confirmation:\n   ${dispatchedResult.plan}\n   Say "yes" to proceed or "no" to cancel.`;
        console.log(confirmationPrompt);
        await safeSpeak(`This action requires confirmation. ${dispatchedResult.plan}. Say yes to proceed or no to cancel.`, mute, options);
        
        // Continue loop - next iteration will handle AWAITING_CONFIRMATION state
        continue;
      }
      
      // Step 7: Execute (no confirmation needed)
      console.log(`\n⚙️  Executing: ${dispatchedResult.commandTemplate.command} ${dispatchedResult.commandTemplate.args.join(' ')}`);
      const result = await executeCommand(dispatchedResult.commandTemplate);
      
      // Step 8: Update memory
      const summary = summarize(dispatchedResult.intent, result);
      updateMemory(memory, dispatchedResult.intent, result, summary);
      
      // Step 9: Summarize and speak
      console.log(`\n📊 Summary: ${summary}`);
      await safeSpeak(summary, mute, options);
      
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
      if (!isInteractiveMode) {
        console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
        console.log(`🔄 Returning to listening state...`);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      const errorText = `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
      await safeSpeak(errorText, mute, options);
      // Continue loop instead of exiting
    }
  }
}

function getHelpText(): string {
  return `Available commands: run tests, git status, run lint, run build, create branch, commit, explain failure, details, repeat, help, exit.`;
}
