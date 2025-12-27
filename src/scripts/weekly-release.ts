import { GoogleGenerativeAI } from '@google/generative-ai';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import https from 'https';

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: string;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>;
  };
}

class WeeklyReleaseAutomation {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private telegramBotToken: string;
  private telegramUserIds: string[];

  constructor() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const userIdsEnv = process.env.TELEGRAM_USER_IDS || '';
    this.telegramUserIds = userIdsEnv.split(',').map(id => id.trim()).filter(id => id);

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    if (!this.telegramBotToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
    }
    if (this.telegramUserIds.length === 0) {
      throw new Error('TELEGRAM_USER_IDS environment variable is required (comma-separated)');
    }

    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  /**
   * Extract git log entries from the past 7 days
   */
  private getGitLogs(): string {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sinceDate = sevenDaysAgo.toISOString().split('T')[0];

      const gitLog = execSync(
        `git log --since="${sinceDate}" --pretty=format:"%h - %s (%an, %ar)"`,
        { encoding: 'utf-8' }
      );

      if (!gitLog.trim()) {
        return 'No commits found in the past 7 days.';
      }

      return gitLog;
    } catch (error: any) {
      console.error('Error getting git logs:', error.message);
      return 'Error retrieving git logs.';
    }
  }

  /**
   * Generate Telegram summary using Gemini AI
   */
  private async generateTelegramSummary(gitLogs: string): Promise<string> {
    const systemPrompt = `You are an enthusiastic product manager for a Telegram Bot.
**Input:** A list of raw technical git commit messages from the last week.
**Task:** Convert these technical logs into a short, exciting, bulleted list for end-users.
**Tone:** Casual, transparent, and active (e.g., 'We've been busy fixing...').
**Rules:**
1. Group items logically (New Features vs. Bug Fixes).
2. Remove all developer jargon (no commit hashes, no variable names).
3. Keep it under 200 words.
4. Start with a hook line like '🚀 Weekly Drop: Here is what we built for you!'.

Return ONLY the formatted message, no additional text.`;

    const prompt = `${systemPrompt}\n\nGit Logs:\n${gitLogs}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error: any) {
      console.error('Error generating Telegram summary:', error.message);
      throw error;
    }
  }

  /**
   * Generate User Guide updates using Gemini AI
   */
  private async generateUserGuideUpdates(gitLogs: string, currentGuide: string): Promise<string> {
    const systemPrompt = `You are a Technical Writer.
**Input A:** The current \`user_guide.md\` content.
**Input B:** The list of new features/fixes from this week's git logs.
**Task:** Output a **Markdown snippet** containing ONLY the necessary updates for the User Guide.
**Logic:**
1. If a specific feature in Input B is NOT present or explained in Input A, write a new section for it.
2. If the feature already exists, ignore it.
3. Return *only* the new appended text. If no updates are needed, return an empty string.

Return ONLY the new markdown content to append, or an empty string if no updates needed.`;

    const prompt = `${systemPrompt}\n\n---\n\n**Input A (Current User Guide):**\n${currentGuide}\n\n---\n\n**Input B (Git Logs):**\n${gitLogs}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      // Return empty string if AI says no updates needed
      if (text.toLowerCase().includes('no updates') || text.toLowerCase().includes('already exists')) {
        return '';
      }
      
      return text;
    } catch (error: any) {
      console.error('Error generating User Guide updates:', error.message);
      throw error;
    }
  }

  /**
   * Read USER_GUIDE.md file
   */
  private readUserGuide(): string {
    try {
      const guidePath = join(process.cwd(), 'USER_GUIDE.md');
      return readFileSync(guidePath, 'utf-8');
    } catch (error: any) {
      console.error('Error reading USER_GUIDE.md:', error.message);
      return '';
    }
  }

  /**
   * Append updates to USER_GUIDE.md
   */
  private appendToUserGuide(updates: string): void {
    if (!updates.trim()) {
      console.log('No updates to append to USER_GUIDE.md');
      return;
    }

    try {
      const guidePath = join(process.cwd(), 'USER_GUIDE.md');
      const currentGuide = this.readUserGuide();
      
      // Append updates with a separator
      const separator = '\n\n---\n\n## Recent Updates\n\n';
      const updatedGuide = currentGuide + separator + updates;
      
      writeFileSync(guidePath, updatedGuide, 'utf-8');
      console.log('✅ USER_GUIDE.md updated successfully');
    } catch (error: any) {
      console.error('Error updating USER_GUIDE.md:', error.message);
      throw error;
    }
  }

  /**
   * Send message to Telegram users
   */
  private async sendTelegramMessage(message: string, userGuideUrl?: string): Promise<void> {
    const telegramApiUrl = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;

    // Build inline keyboard
    const inlineKeyboard: Array<Array<{ text: string; url: string }>> = [];
    
    if (userGuideUrl) {
      inlineKeyboard.push([
        { text: '📖 Read Updated User Guide', url: userGuideUrl }
      ]);
    }
    
    inlineKeyboard.push([
      { 
        text: '💬 Provide Feedback', 
        url: 'https://t.me/bryanseto?text=Hey%20Bryan,%20regarding%20the%20new%20updates...' 
      }
    ]);

    const payload: TelegramMessage = {
      chat_id: '',
      text: message,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    };

    // Send to each user
    for (const userId of this.telegramUserIds) {
      payload.chat_id = userId;
      
      try {
        await this.sendHttpRequest(telegramApiUrl, payload);
        console.log(`✅ Message sent to user ${userId}`);
      } catch (error: any) {
        console.error(`❌ Error sending message to user ${userId}:`, error.message);
      }
    }
  }

  /**
   * Send HTTP POST request
   */
  private sendHttpRequest(url: string, data: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const postData = JSON.stringify(data);

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Main execution flow
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Weekly Release Automation...\n');

    try {
      // Step 1: Extract git logs
      console.log('📝 Extracting git logs from past 7 days...');
      const gitLogs = this.getGitLogs();
      console.log(`Found ${gitLogs.split('\n').length} commit(s)\n`);

      if (gitLogs.includes('No commits found')) {
        console.log('⚠️  No commits found. Skipping release automation.');
        return;
      }

      // Step 2: Generate Telegram summary
      console.log('🤖 Generating Telegram summary with AI...');
      const telegramSummary = await this.generateTelegramSummary(gitLogs);
      console.log('✅ Telegram summary generated\n');

      // Step 3: Generate User Guide updates
      console.log('📚 Reading USER_GUIDE.md...');
      const currentGuide = this.readUserGuide();
      
      console.log('🤖 Generating User Guide updates with AI...');
      const guideUpdates = await this.generateUserGuideUpdates(gitLogs, currentGuide);
      
      if (guideUpdates.trim()) {
        console.log('✅ User Guide updates generated');
        this.appendToUserGuide(guideUpdates);
      } else {
        console.log('ℹ️  No User Guide updates needed');
      }

      // Step 4: Send Telegram message
      console.log('\n📱 Sending Telegram messages...');
      
      // Get repository URL for user guide link
      const repoUrl = process.env.GITHUB_REPOSITORY 
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/blob/main/USER_GUIDE.md`
        : undefined;
      
      await this.sendTelegramMessage(telegramSummary, repoUrl);
      console.log('\n✅ Weekly Release Automation completed successfully!');
      
    } catch (error: any) {
      console.error('\n❌ Error in Weekly Release Automation:', error.message);
      process.exit(1);
    }
  }
}

// Run the automation if this file is executed directly
if (require.main === module) {
  const automation = new WeeklyReleaseAutomation();
  automation.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { WeeklyReleaseAutomation };

