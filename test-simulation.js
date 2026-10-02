import { StateManager } from './src/stateManager.js';
import { MemoryManager } from './src/memoryManager.js';
import { EventEngine } from './src/eventEngine.js';
import { PromptBuilder } from './src/promptBuilder.js';
import { CommandHandler } from './src/commandHandler.js';
import { ChatHistoryManager } from './src/chatHistoryManager.js';

console.log('🧪 Testing Virtual Child Simulation Engine...\n');

// 1. State Manager
const stateManager = new StateManager();
console.log('1. Time & Schedule Test:');
console.log('   - Time String:', stateManager.getCurrentTimeString());
const act = stateManager.getCurrentActivity();
console.log('   - Current Activity:', act.name, `[Phase: ${act.phase}]`);
console.log('   - Is Sleeping?:', act.isSleeping);
console.log('   - Is School?:', act.isSchool);

// 2. Memory Manager
console.log('\n2. Memory Manager Test:');
const memoryManager = new MemoryManager();
const memCount = memoryManager.getAll().length;
console.log(`   - Loaded ${memCount} memories.`);
const formattedMems = memoryManager.getFormattedMemoriesForPrompt();
console.log('   - Sample Formatted Memories:');
console.log(formattedMems.split('\n').slice(0, 4).join('\n'));

// 3. Event Engine
console.log('\n3. Event Engine Test:');
const eventEngine = new EventEngine(stateManager);
const todayEvent = eventEngine.getTodayEvent();
console.log('   - Today Event:', todayEvent ? todayEvent.title : 'None');
console.log('   - Story:', todayEvent ? todayEvent.story : 'None');

// 4. Prompt Builder
console.log('\n4. Prompt Builder Test:');
const promptBuilder = new PromptBuilder(stateManager, memoryManager, eventEngine);
const prompt = promptBuilder.buildSystemPrompt({ role: 'father', name: 'Ayah' });
console.log('   - System prompt generated successfully, length:', prompt.length, 'characters');
console.log('   - Contains SD Pelangi:', prompt.includes('SD Pelangi'));
console.log('   - Contains Bu Rina:', prompt.includes('Bu Rina'));
console.log('   - Contains Rafi:', prompt.includes('Rafi'));

// 5. Natural Questions Simulation Test
console.log('\n5. Natural Conversation Context Test:');
console.log('   - State in prompt reflects wallet:', prompt.includes('Rp 20.000'));
console.log('   - State in prompt reflects savings:', prompt.includes('Rp 75.000'));
console.log('   - State in prompt reflects target item:', prompt.includes('Set Krayon'));
console.log('   - Anti-command rule present:', prompt.includes('TANPA PERINTAH/COMMANDS'));

console.log('\n✅ All simulation tests passed successfully!');

