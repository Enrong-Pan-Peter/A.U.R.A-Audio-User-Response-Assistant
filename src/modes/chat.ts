import { waitForPushToTalk, recordAudio } from '../voice/record.js';
import { transcribe } from '../voice/transcribe.js';
import { streamTranscribe, StreamTranscribeOptions } from '../voice/streamTranscribe.js';
import { routeIntent, createPlan } from '../intents/router.js';
import { getCommandForIntent } from '../intents/whitelist.js';
import { executeCommand } from '../exec/runner.js';
import { summarize } from '../summarize/index.js';
import { speak } from '../voice/tts.js';
import { createMemory, updateMemory, explainFailure, getDetails } from '../session/memory.js';
import { Intent } from '../intents/types.js';
import { planAndExplain } from '../agent/agent.js';
import { existsSync } from 'fs';

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
      let intent: Intent;
      let params: Record<string, string> | undefined;
      let planDescription: string;
      let requiresConfirmation = false;
      
      if (useAgent && process.env.OPENAI_API_KEY) {
        console.log('🤖 Using AI agent for planning...');
        const agentResult = await planAndExplain(transcription, memory);
        
        // Handle low confidence with clarifying question
        if (agentResult.confidence < 0.6 && agentResult.clarifyingQuestion) {
          const questionText = `I'm not sure I understood. ${agentResult.clarifyingQuestion}`;
          console.log(`\n❓ ${questionText}`);
          await safeSpeak(questionText, mute, options);
          continue;
        }
        
        intent = agentResult.intent;
        params = agentResult.params;
        planDescription = agentResult.planSteps.join(' → ');
        
        // Map intent to confirmation requirement
        requiresConfirmation = intent === Intent.CREATE_BRANCH || intent === Intent.MAKE_COMMIT;
        
        // Speak agent's explanation if available (for any intent, not just EXPLAIN_FAILURE)
        if (agentResult.explanation) {
          console.log(`\n💡 ${agentResult.explanation}`);
          await safeSpeak(agentResult.explanation, mute, options);
          
          // For EXPLAIN_FAILURE, explanation is the full response, so continue
          if (intent === Intent.EXPLAIN_FAILURE) {
            continue;
          }
        }
        
        // Also speak the plan description if no explanation was provided
        if (!agentResult.explanation && planDescription) {
          console.log(`\n📋 Plan: ${planDescription}`);
          await safeSpeak(`I will ${planDescription.toLowerCase()}`, mute, options);
        } else if (planDescription) {
          // Log plan even if explanation was spoken
          console.log(`\n📋 Plan: ${planDescription}`);
        }
      } else {
        // Fallback to simple router
        const intentResult = routeIntent(transcription);
        const plan = createPlan(intentResult);
        intent = plan.intent;
        params = plan.params;
        planDescription = plan.description;
        requiresConfirmation = plan.requiresConfirmation;
        
        // Speak plan description for non-agent mode
        console.log(`\n📋 Plan: ${planDescription}`);
        await safeSpeak(`I will ${planDescription.toLowerCase()}`, mute, options);
      }
      
      // Handle special intents
      if (intent === Intent.EXIT) {
        const goodbyeText = 'Goodbye!';
        console.log(goodbyeText);
        await safeSpeak(goodbyeText, mute, options);
        break;
      }
      
      if (intent === Intent.HELP) {
        const helpText = getHelpText();
        console.log(helpText);
        await safeSpeak(helpText, mute, options);
        continue;
      }
      
      if (intent === Intent.REPEAT_LAST) {
        if (memory.lastSummary) {
          console.log(`\n📊 Repeating: ${memory.lastSummary}`);
          await safeSpeak(memory.lastSummary, mute, options);
        } else {
          const noLastText = 'No previous summary to repeat.';
          console.log(noLastText);
          await safeSpeak(noLastText, mute, options);
        }
        continue;
      }
      
      if (intent === Intent.EXPLAIN_FAILURE) {
        // If agent provided explanation, it was already handled above
        // Otherwise use fallback explanation
        const explanation = explainFailure(memory);
        console.log(`\n📊 Explanation: ${explanation}`);
        await safeSpeak(explanation, mute, options);
        continue;
      }
      
      if (intent === Intent.DETAILS) {
        const details = getDetails(memory);
        console.log(`\n📄 Details:\n${details}`);
        // Summarize details for speech (first 200 chars)
        const speechDetails = details.length > 200 ? details.substring(0, 200) + '...' : details;
        await safeSpeak(`Details: ${speechDetails}`, mute, options);
        continue;
      }
      
      if (intent === Intent.UNKNOWN) {
        const unknownText = `I didn't understand that. Try saying "help" for available commands.`;
        console.log(unknownText);
        await safeSpeak(unknownText, mute, options);
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
        await safeSpeak(errorText, mute, options);
        continue;
      }
      
      // Step 6: Confirm if needed
      if (requiresConfirmation) {
        console.log('\n⚠️  This action requires confirmation.');
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
          await safeSpeak(cancelledText, mute, options);
          continue;
        }
      }
      
      // Step 7: Execute
      console.log(`\n⚙️  Executing: ${commandTemplate.command} ${commandTemplate.args.join(' ')}`);
      const result = await executeCommand(commandTemplate);
      
      // Step 8: Update memory
      const summary = summarize(intent, result);
      updateMemory(memory, intent, result, summary);
      
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
