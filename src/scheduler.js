import cron from 'node-cron';
import dayjs from 'dayjs';
import { config } from './config.js';

export class Scheduler {
  constructor(stateManager, eventEngine, geminiService, chatHistoryManager, whatsappBot) {
    this.stateManager = stateManager;
    this.eventEngine = eventEngine;
    this.geminiService = geminiService;
    this.chatHistoryManager = chatHistoryManager;
    this.whatsappBot = whatsappBot;
    this.cronTask = null;
    this.dailyEventTask = null;
  }

  start() {
    console.log('[Scheduler] Starting autonomous life simulation scheduler...');

    // 1. Spontaneous check every N minutes
    const interval = config.autonomousCheckIntervalMinutes || 20;
    this.cronTask = cron.schedule(`*/${interval} * * * *`, async () => {
      await this.checkSpontaneousMessage();
    });

    // 2. Daily event generation at 00:05 WIB every day
    this.dailyEventTask = cron.schedule('5 0 * * *', () => {
      console.log('[Scheduler] Running midnight transition and daily event generation...');
      this.eventEngine.ensureTodayEvent();
    }, {
      timezone: config.timezone
    });

    console.log(`[Scheduler] Autonomous scheduler active. Checking every ${interval} minutes. Timezone: ${config.timezone}`);
  }

  stop() {
    if (this.cronTask) this.cronTask.stop();
    if (this.dailyEventTask) this.dailyEventTask.stop();
    console.log('[Scheduler] Autonomous scheduler stopped.');
  }

  async checkSpontaneousMessage() {
    if (!config.autonomousEnabled) {
      return;
    }

    if (!this.geminiService.isAvailable()) {
      return;
    }

    const targetJid = this.whatsappBot.getTargetGroupJid();
    if (!targetJid) {
      // No target group resolved yet
      return;
    }

    const state = this.stateManager.getState();
    const currentActivity = this.stateManager.getCurrentActivity();

    // Rule 1: Never speak if sleeping (21:00 - 06:00)
    if (currentActivity.isSleeping) {
      return;
    }

    // Rule 2: Cooldown check between spontaneous messages
    const lastSentIso = state.telemetry?.lastMessageSentAt || state.telemetry?.lastSpontaneousMessageAt;
    if (lastSentIso) {
      const lastSent = dayjs(lastSentIso);
      const hoursSinceLast = dayjs().diff(lastSent, 'hour', true);
      const minHours = config.minHoursBetweenSpontaneous || 3.0;

      if (hoursSinceLast < minHours) {
        return; // Still in cooldown
      }
    }

    // Rule 3: Evaluation by Gemini against rules of engagement
    const recentHistory = this.chatHistoryManager.getRecent(10);
    const evaluation = await this.geminiService.evaluateSpontaneous({
      chatHistory: recentHistory
    });

    if (evaluation.shouldSend && evaluation.message) {
      console.log(`[Scheduler] 🧒 Spontaneous message approved: "${evaluation.message}" (Reason: ${evaluation.reason})`);
      
      // Send to WhatsApp group
      await this.whatsappBot.sendMessageToGroup(targetJid, evaluation.message);
      
      // Update telemetry
      this.stateManager.recordSpontaneousMessage();
      this.chatHistoryManager.addMessage({
        senderJid: 'bot',
        senderName: config.childName,
        role: 'child',
        text: evaluation.message
      });
    } else {
      // Gracefully staying silent as required by Rule 7
      // console.debug(`[Scheduler] Staying silent: ${evaluation.reason}`);
    }
  }
}
