import { existsSync } from 'fs';
import { planAndExplain } from '../agent/agent.js';
import { executeCommand } from '../exec/runner.js';
import { createPlan, routeIntent } from '../intents/router.js';
import { Intent } from '../intents/types.js';
import { getCommandForIntent } from '../intents/whitelist.js';
import { createMemory } from '../session/memory.js';
import { summarize } from '../summarize/index.js';
import { speak, PlayMode } from '../voice/tts.js';
import { recordAudio, waitForPushToTalk } from '../voice/record.js';
import { transcribe } from '../voice/transcribe.js';

export interface ListenOptions {
  keepAudio?: boolean;
  player?: string;
  playMode?: PlayMode;
}

/**
 * Single-turn listen mode: record, transcribe, plan, confirm if needed, execute, summarize, speak.
 */
export async function listenMode(
  repoPath: string,
  mute: boolean,
  useAgent: boolean = false,
  options: ListenOptions = {}
): Promise<void> {
  console.log('🎤 DevVoice - Single Turn Mode');
  console.log(`📁 Repository: ${repoPath}`);
  
  // Validate repo path
  if (!existsSync(repoPath)) {
    console.error(`❌ Repository path does not exist: ${repoPath}`);
    process.exit(1);
  }
  
  try {
    // Step 1: Wait for push-to-talk
    await waitForPushToTalk();
    
    // Step 2: Record audio
    console.log('🔴 Recording... (up to 8 seconds)');
    const audioPath = await recordAudio({ durationSeconds: 8 });
    console.log('✅ Recording complete');
    
    // Step 3: Transcribe
    console.log('📝 Transcribing...');
    const transcription = await transcribe(audioPath);
    console.log(`\n💬 Heard: "${transcription}"`);
    
    // Step 4: Plan using AI agent or fallback router
    let intent: Intent;
    let params: Record<string, string> | undefined;
    let planDescription: string;
    let requiresConfirmation = false;
    const memory = createMemory(); // Empty memory for single-turn mode
    
    if (useAgent && process.env.OPENAI_API_KEY) {
      console.log('🤖 Using AI agent for planning...');
      const agentResult = await planAndExplain(transcription, memory);
      
      // Handle low confidence with clarifying question
      if (agentResult.confidence < 0.6 && agentResult.clarifyingQuestion) {
        const questionText = `I'm not sure I understood. ${agentResult.clarifyingQuestion}`;
        console.log(`\n❓ ${questionText}`);
        if (!mute) {
          await speak(questionText, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
        }
        return;
      }
      
      intent = agentResult.intent;
      params = agentResult.params;
      planDescription = agentResult.planSteps.join(' → ');
      
      // Map intent to confirmation requirement
      requiresConfirmation = intent === Intent.CREATE_BRANCH || intent === Intent.MAKE_COMMIT;
      
      // Speak agent's explanation if available (for any intent, not just EXPLAIN_FAILURE)
      if (agentResult.explanation) {
        console.log(`\n💡 ${agentResult.explanation}`);
        if (!mute) {
          await speak(agentResult.explanation, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
        }
        
        // For EXPLAIN_FAILURE, explanation is the full response, so return
        if (intent === Intent.EXPLAIN_FAILURE) {
          return;
        }
      }
      
      // Also speak the plan description if no explanation was provided
      if (!agentResult.explanation && planDescription) {
        console.log(`\n📋 Plan: ${planDescription}`);
        if (!mute) {
          await speak(`I will ${planDescription.toLowerCase()}`, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
        }
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
      if (!mute) {
        await speak(`I will ${planDescription.toLowerCase()}`, { play: !mute, keepAudio: options.keepAudio, player: options.player });
      }
    }
    
    // Handle special intents that don't require execution
    if (intent === Intent.HELP) {
      const helpText = getHelpText();
      console.log(helpText);
      if (!mute) {
        await speak(helpText, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
      }
      return;
    }
    
    if (intent === Intent.UNKNOWN) {
      const unknownText = `I didn't understand that. Try saying "help" for available commands.`;
      console.log(unknownText);
      if (!mute) {
        await speak(unknownText, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
      }
      return;
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
      if (!mute) {
        await speak(errorText, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
      }
      return;
    }
    
    // Step 6: Confirm if needed
    if (requiresConfirmation) {
      console.log('\n⚠️  This action requires confirmation.');
      await waitForPushToTalk();
      console.log('🔴 Recording confirmation...');
      const confirmAudioPath = await recordAudio({ durationSeconds: 5 });
      const confirmText = await transcribe(confirmAudioPath);
      console.log(`💬 Confirmation: "${confirmText}"`);
      
      const normalized = confirmText.toLowerCase();
      if (!normalized.includes('confirm') && !normalized.includes('proceed') && !normalized.includes('yes')) {
        const cancelledText = 'Action cancelled.';
        console.log(`❌ ${cancelledText}`);
        if (!mute) {
          await speak(cancelledText, { play: !mute, keepAudio: options.keepAudio, player: options.player });
        }
        return;
      }
    }
    
    // Step 7: Execute
    console.log(`\n⚙️  Executing: ${commandTemplate.command} ${commandTemplate.args.join(' ')}`);
    const result = await executeCommand(commandTemplate);
    
    // Step 8: Summarize
    const summary = summarize(intent, result);
    console.log(`\n📊 Summary: ${summary}`);
    
    // Step 9: Speak
    if (!mute) {
      await speak(summary, { play: !mute, playMode: options.playMode || 'stream', keepAudio: options.keepAudio, player: options.player });
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
    
  } catch (error) {
    console.error('❌ Error:', error);
    const errorText = `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
    if (!mute) {
      await speak(errorText, { play: !mute, keepAudio: options.keepAudio, player: options.player });
    }
    process.exit(1);
  }
}

function getHelpText(): string {
  return `Available commands: run tests, git status, run lint, run build, create branch, commit, explain failure, details, repeat, help, exit.`;
}
