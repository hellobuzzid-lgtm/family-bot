import { config } from './config.js';
import { StateManager } from './stateManager.js';
import { MemoryManager } from './memoryManager.js';
import { EventEngine } from './eventEngine.js';
import { ChatHistoryManager } from './chatHistoryManager.js';
import { PromptBuilder } from './promptBuilder.js';
import { GeminiService } from './geminiService.js';
import { CommandHandler } from './commandHandler.js';
import { WhatsAppBot } from './whatsappBot.js';
import { Scheduler } from './scheduler.js';

console.log(`
==========================================================
🧒 NEX FAMILY — VIRTUAL CHILD AI BOT
==========================================================
Identitas Anak : ${config.childName} (6 Tahun)
Ayah           : ${config.fatherName}
Ibu            : ${config.motherName}
Zona Waktu     : ${config.timezone}
Model AI       : ${config.geminiModel}
Mode Otonom    : ${config.autonomousEnabled ? 'Aktif (Pesan Spontan Terjadwal)' : 'Non-Aktif'}
==========================================================
`);

// 1. Initialize State and Storage Managers
const stateManager = new StateManager();
const memoryManager = new MemoryManager();
const eventEngine = new EventEngine(stateManager);
const chatHistoryManager = new ChatHistoryManager();

// 2. Initialize Prompt and AI Services
const promptBuilder = new PromptBuilder(stateManager, memoryManager, eventEngine);
const geminiService = new GeminiService(stateManager, memoryManager, eventEngine, promptBuilder);

// 3. Initialize Command Handler
const commandHandler = new CommandHandler(stateManager, memoryManager, eventEngine);

// 4. Initialize WhatsApp Bot Engine
const whatsappBot = new WhatsAppBot(
  stateManager,
  memoryManager,
  eventEngine,
  geminiService,
  chatHistoryManager,
  commandHandler
);

// 5. Initialize Autonomous Scheduler
const scheduler = new Scheduler(
  stateManager,
  eventEngine,
  geminiService,
  chatHistoryManager,
  whatsappBot
);

// Start systems
async function bootstrap() {
  try {
    // Print current state summary
    const state = stateManager.getState();
    const activity = stateManager.getCurrentActivity();
    console.log(`[Init] Waktu Sekarang : ${stateManager.getCurrentTimeString()}`);
    console.log(`[Init] Status Harian   : ${activity.name} (${activity.phase})`);
    console.log(`[Init] Mood Virtual    : ${state.mood.current} ${state.mood.emoji}`);
    console.log(`[Init] Saldo Dompet    : ${stateManager.formatRupiah(state.finances.pocketMoneyBalance)}`);
    console.log(`[Init] Celengan Ayam   : ${stateManager.formatRupiah(state.finances.savingsBalance)} / Target: ${stateManager.formatRupiah(state.finances.savingsTarget)}`);

    // Start WhatsApp Bot
    await whatsappBot.start();

    // Start Scheduler
    scheduler.start();

  } catch (error) {
    console.error('❌ [Fatal] Error during startup:', error);
    process.exit(1);
  }
}

bootstrap();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Menutup bot WhatsApp dengan aman...');
  scheduler.stop();
  stateManager.saveState();
  memoryManager.saveMemories();
  eventEngine.saveEvents();
  process.exit(0);
});
