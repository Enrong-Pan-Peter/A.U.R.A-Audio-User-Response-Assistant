import { waitForPushToTalk, recordAudio } from '../voice/record.js';
import { transcribe } from '../voice/transcribe.js';
import { streamTranscribe, StreamTranscribeOptions } from '../voice/streamTranscribe.js';
import { routeIntent, createPlan } from '../intents/router.js';
import { getCommandForIntent } from '../intents/whitelist.js';
import { executeCommand } from '../exec/runner.js';
import { summarize } from '../summarize/index.js';
import { speak } from '../voice/tts.js';
import { createMemory, updateMemory } from '../session/memory.js';
import { Intent } from '../intents/types.js';
import { planAndExplain } from '../agent/agent.js';
import { existsSync } from 'fs';
import { dispatchAgentResult, DispatchedResult } from '../dispatcher/dispatcher.js';

import { PlayMode } from '../voice/tts.js';

export interface ChatOptions {
  keepAudio?: boolean;
  player?: string;
  playMode?: PlayMode;
  live?: boolean; // Enable live transcription (default: true)
  silenceMs?: number; // Silence timeout in milliseconds (default: 1000)
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
  
  while (true) {
    try {
      // Step 1: Wait for push-to-talk
      await waitForPushToTalk();
      
      // Step 2 & 3: Record and transcribe (with live transcription if enabled)
      let transcription: string;
      let audioPath: string | undefined;
      
      const useLiveTranscription = options.live !== false; // Default to true
      
      if (useLiveTranscription) {
        try {
          console.log('🎤 Listening... (Press Enter to stop)');
          const result = await streamTranscribe({
            live: true,
            silenceMs: options.silenceMs || 1000,
            onManualStop: () => false, // Manual stop handled internally
          });
          
          transcription = result.transcript;
          audioPath = result.audioPath;
          
          if (transcription) {
            console.log(`\n💬 Heard: "${transcription}"`);
          } else {
            console.log('\n⚠️  No transcription received');
            continue;
          }
        } catch (error) {
          console.error('❌ Streaming transcription failed:', error instanceof Error ? error.message : error);
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
            continue;
          }
        }
      } else {
        // Batch transcription (original behavior)
        console.log('🔴 Recording... (up to 8 seconds)');
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
          continue;
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
        const mockAgentResult = {
          intent: plan.intent,
          params: plan.params,
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
        console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
        console.log(`🔄 Returning to listening state...`);
        continue;
      }
      
      // Action intent - proceed with execution flow
      console.log(`\n📋 Plan: ${dispatchedResult.plan}`);
      await safeSpeak(`I will ${dispatchedResult.plan.toLowerCase()}`, mute, options);
      
      // Step 6: Confirm if needed
      if (dispatchedResult.requiresConfirmation) {
        console.log('\n⚠️  This action requires confirmation.');
        console.log(`🔄 Entering confirmation state...`);
        await waitForPushToTalk();
        
        let confirmText: string;
        if (useLiveTranscription) {
          console.log('🎤 Listening for confirmation... (Press Enter to stop)');
          const result = await streamTranscribe({
            live: true,
            silenceMs: options.silenceMs || 1000,
          });
          confirmText = result.transcript;
          if (confirmText) {
            console.log(`💬 Confirmation: "${confirmText}"`);
          } else {
            confirmText = '';
          }
        } else {
          console.log('🔴 Recording confirmation...');
          const confirmAudioPath = await recordAudio({ durationSeconds: 5 });
          confirmText = await transcribe(confirmAudioPath);
          console.log(`💬 Confirmation: "${confirmText}"`);
        }
        
        const normalized = confirmText.toLowerCase();
        if (!normalized.includes('confirm') && !normalized.includes('proceed') && !normalized.includes('yes')) {
          const cancelledText = 'Action cancelled.';
          console.log(`❌ ${cancelledText}`);
          console.log(`🔄 Returning to listening state...`);
          await safeSpeak(cancelledText, mute, options);
          continue;
        }
        console.log(`✅ Confirmation received, proceeding with execution...`);
      }
      
      // Step 7: Execute
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
      console.log('\n💬 Anything else? (Press Enter to continue, or say "exit" to quit)');
      console.log(`🔄 Returning to listening state...`);
      
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
