import * as readline from 'readline';

/**
 * Live transcript UI component that updates in-place in the terminal.
 */
export class LiveTranscriptUI {
  private rl: readline.Interface;
  private currentLine: string = '';
  private prefix: string;
  private isActive = false;
  private isClosed = false;

  constructor(prefix: string = '💬 Listening... ') {
    this.prefix = prefix;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start displaying live transcript.
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.currentLine = '';
    this.update(this.currentLine);
  }

  /**
   * Update the current transcript line in-place.
   */
  update(text: string): void {
    if (!this.isActive) {
      return;
    }

    this.currentLine = text;
    
    // Move cursor to beginning of line and clear it
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    
    // Write new content
    const displayText = text || '[listening...]';
    process.stdout.write(this.prefix + displayText);
  }

  /**
   * Add text to the current transcript (for incremental updates).
   */
  append(text: string): void {
    if (!this.isActive) {
      return;
    }

    this.currentLine += text;
    this.update(this.currentLine);
  }

  /**
   * Replace the current transcript with new text.
   */
  replace(text: string): void {
    if (!this.isActive) {
      return;
    }

    this.currentLine = text;
    this.update(this.currentLine);
  }

  /**
   * Commit a final transcript segment as a stable line.
   */
  commitFinal(text: string): void {
    if (!this.isActive) {
      return;
    }

    const finalText = text.trim();
    if (!finalText) {
      this.currentLine = '';
      this.update(this.currentLine);
      return;
    }

    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${finalText}\n`);
    this.currentLine = '';
    this.update(this.currentLine);
  }

  /**
   * Finalize and return the final transcript.
   */
  finalize(): string {
    if (!this.isActive) {
      return this.currentLine;
    }

    // Move to new line
    process.stdout.write('\n');
    this.isActive = false;
    this.close();

    return this.currentLine.trim();
  }

  /**
   * Stop displaying live transcript and cleanup.
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    // Clear the line and move to new line
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write('\n');
    
    this.isActive = false;
    this.close();
  }

  /**
   * Close the readline interface to release listeners.
   */
  close(): void {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    this.rl.close();
  }

  /**
   * Get current transcript text.
   */
  get text(): string {
    return this.currentLine;
  }

  /**
   * Check if currently active.
   */
  get active(): boolean {
    return this.isActive;
  }
}
