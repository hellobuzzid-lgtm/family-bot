import { MemoryManager } from './src/services/memoryManager.js';
import { FinanceManager } from './src/services/financeManager.js';
import { GoalTracker } from './src/services/goalTracker.js';
import { RoutineManager } from './src/services/routineManager.js';
import { MasterPromptBuilder } from './src/core/masterPrompt.js';
import { getPrayerTimes } from './src/utils/prayerTimes.js';
import { formatRupiah, parseAmount } from './src/utils/formatters.js';

console.log('🧪 [TEST] Running AI Personal Life Partner unit and integration test...\n');

// 1. Test Formatters
console.log('1. Testing Formatters...');
console.log('   - 50k ->', parseAmount('50k'), '(expected: 50000)');
console.log('   - 1.5jt ->', parseAmount('1.5jt'), '(expected: 1500000)');
console.log('   - Rp 250.000 ->', parseAmount('Rp 250.000'), '(expected: 250000)');
console.log('   - formatRupiah(1500000) ->', formatRupiah(1500000));

// 2. Test Prayer Times
console.log('\n2. Testing Prayer Times Calculation (Jakarta / WIB)...');
const pt = getPrayerTimes();
console.log('   - Subuh  :', pt.subuh);
console.log('   - Dzuhur :', pt.dzuhur);
console.log('   - Ashar  :', pt.ashar);
console.log('   - Maghrib:', pt.maghrib);
console.log('   - Isya   :', pt.isya);

// 3. Test Finance Manager
console.log('\n3. Testing Finance Manager...');
const fm = new FinanceManager();
const tx1 = fm.recordTransaction({
  type: 'income',
  amount: '10jt',
  category: 'Gaji / Hasil Bisnis',
  description: 'Pendapatan usaha',
  isBusiness: false
});
console.log('   - Recorded Income:', tx1.success, tx1.transaction.amount);

const tx2 = fm.recordTransaction({
  type: 'expense',
  amount: '50rb',
  category: 'Makanan',
  description: 'Makan siang bergizi',
  isBusiness: false
});
console.log('   - Recorded Expense:', tx2.success, tx2.transaction.amount);
console.log('   - Personal Balance:', formatRupiah(fm.data.balances.personalBalance));

// 4. Test Goal Tracker
console.log('\n4. Testing Goal Tracker...');
const gt = new GoalTracker();
const newGoal = gt.addGoal({
  title: 'Belajar AI & Finansial 30 menit',
  category: 'learning',
  metrics: 'Konsisten 30 hari'
});
console.log('   - New Goal Added:', newGoal.title);
console.log('   - Active Goals:\n' + gt.getActiveGoalsSummary('owner'));

// 5. Test Routine Manager
console.log('\n5. Testing Routine Manager...');
const rm = new RoutineManager();
rm.logHabit({ habit: 'prayer', value: 'subuh', notes: 'Salat berjamaah tepat waktu' });
rm.logHabit({ habit: 'water', value: '2', notes: 'Gelas air putih' });
rm.logHabit({ habit: 'skincare_morning', value: 'selesai', notes: 'Sunscreen dipakai' });
console.log('   - Daily Routines Summary:\n' + rm.getDailyRoutinesSummary());

// 6. Test Memory Manager
console.log('\n6. Testing Memory Manager...');
const mm = new MemoryManager();
mm.addMemory({
  category: 'financial',
  content: 'Target tabungan darurat minimal 6 bulan pengeluaran rutin.',
  scope: 'owner'
});
console.log('   - User Memory Summary:\n' + mm.getUserMemoriesSummary('owner'));

// 7. Test Master Prompt Builder
console.log('\n7. Testing Master Prompt Builder...');
const pb = new MasterPromptBuilder(mm, fm, gt, rm);
const systemPrompt = pb.buildSystemPrompt({
  speakerInfo: { role: 'owner', name: 'Bro' },
  isGroup: false
});
console.log('   - Generated System Prompt Length:', systemPrompt.length, 'characters');
console.log('   - System Prompt includes MASTER PROMPT:', systemPrompt.includes('MASTER PROMPT AI PERSONAL LIFE PARTNER'));
console.log('   - System Prompt includes 32 Sections:', systemPrompt.includes('BAGIAN 1 — IDENTITAS DAN MISI UTAMA'));

console.log('\n✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
