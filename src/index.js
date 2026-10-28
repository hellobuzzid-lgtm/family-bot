import { config } from './config.js';
import { MemoryManager } from './services/memoryManager.js';
import { FinanceManager } from './services/financeManager.js';
import { GoalTracker } from './services/goalTracker.js';
import { RoutineManager } from './services/routineManager.js';
import { GoogleSheetsService } from './services/googleSheetsService.js';
import { MasterPromptBuilder } from './core/masterPrompt.js';
import { GeminiService } from './services/geminiService.js';
import { WhatsAppBot } from './bot/whatsappBot.js';
import { Scheduler } from './services/scheduler.js';

console.log('================================================================');
console.log('🌟 AI PERSONAL LIFE PARTNER v2.0 🌟');
console.log('Personal Assistant, Financial Advisor, Life Coach, Business Consultant,');
console.log('Relationship Mediator, Long-Term Memory & Continuous Learning AI');
console.log('================================================================');
console.log(`👤 Owner (${config.ownerName}): ${config.ownerPhone || 'Not set'}`);
console.log(`💍 Partner (${config.partnerName}): ${config.partnerPhone || 'Not set'}`);
console.log(`📱 Bot Number: ${config.botPhone || 'Not set'}`);
console.log(`🤖 Gemini Model: ${config.geminiModel}`);
console.log(`🕒 Timezone: ${config.timezone} | City: ${config.cityName}`);
console.log(`📂 Storage Path: ${config.storageDir}`);
console.log(`📊 Google Sheets: ${config.googleSheetWebhookUrl ? 'Configured ✅' : 'Not configured (Local DB active)'}`);
console.log('================================================================\n');

async function main() {
  try {
    // 1. Initialize core state & database managers
    const googleSheetsService = new GoogleSheetsService();
    const memoryManager = new MemoryManager();
    const financeManager = new FinanceManager(googleSheetsService);
    const goalTracker = new GoalTracker(googleSheetsService);
    const routineManager = new RoutineManager(googleSheetsService);

    // 2. Initialize prompt builder
    const promptBuilder = new MasterPromptBuilder(
      memoryManager,
      financeManager,
      goalTracker,
      routineManager
    );

    // 3. Initialize AI reasoning service
    const geminiService = new GeminiService(
      promptBuilder,
      memoryManager,
      financeManager,
      goalTracker,
      routineManager
    );

    // 4. Initialize WhatsApp Bot Engine
    const whatsappBot = new WhatsAppBot(geminiService);

    // 5. Initialize Automated Life Scheduler
    const scheduler = new Scheduler(
      whatsappBot,
      routineManager,
      financeManager,
      goalTracker
    );

    // 6. Start WhatsApp Bot
    await whatsappBot.start();

    // 7. Start Scheduler
    scheduler.start();

    console.log('🚀 [System] AI Personal Life Partner initialized and running!');

    // Handle graceful shutdown
    const handleShutdown = (signal) => {
      console.log(`\n[System] Received ${signal}. Shutting down gracefully...`);
      scheduler.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ [System] Fatal initialization error:', err);
    process.exit(1);
  }
}

main();
