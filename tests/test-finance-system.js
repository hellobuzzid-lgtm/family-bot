import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { FinanceManager } from '../src/services/financeManager.js';
import { GeminiService } from '../src/services/geminiService.js';
import { TaskManager } from '../src/services/taskManager.js';
import { RoutineManager } from '../src/services/routineManager.js';
import { GoalTracker } from '../src/services/goalTracker.js';
import { MasterPromptBuilder } from '../src/core/masterPrompt.js';
import { formatRupiah, parseAmount, extractAmount, isConfirmationText, getNow } from '../src/utils/formatters.js';

console.log('================================================================');
console.log('🧪 PENGUJIAN MENYELURUH SISTEM KEUANGAN, AI ASSISTANT & SPS SSOT');
console.log('================================================================\n');

// Mock GoogleSheetsService to capture sync calls
class MockGoogleSheetsService {
  constructor() {
    this.appended = [];
    this.updated = [];
    this.deleted = [];
    this.reconciled = [];
  }
  isConfigured() { return true; }
  async appendTransaction(tx) { this.appended.push(tx); return { success: true, result: { status: 'success' } }; }
  async updateTransaction(tx) { this.updated.push(tx); return { success: true, result: { status: 'success' } }; }
  async deleteTransaction(id) { this.deleted.push(id); return { success: true, result: { status: 'success' } }; }
  async reconcileAllTransactions(txs) { this.reconciled.push(txs); return { success: true }; }
  async appendHabit(h) { return { success: true }; }
  async appendGoal(g) { return { success: true }; }
  async fetchSpreadsheetFinances(source = null) {
    return {
      success: true,
      data: {
        status: 'success',
        spreadsheetName: 'Mock Sheet',
        totalTransactions: 10,
        balances: { personal: 10000000, business: 5000000, total: 15000000 }
      }
    };
  }
}

const mockSheets = new MockGoogleSheetsService();
const fm = new FinanceManager(mockSheets);
const tm = new TaskManager();
const rm = new RoutineManager(mockSheets);
const gt = new GoalTracker(mockSheets);
const pb = new MasterPromptBuilder(null, fm, gt, rm, tm);
const geminiService = new GeminiService(pb, null, fm, gt, rm, tm);

// Reset memory state for pristine testing
fm.data = fm.getDefaultData();
fm.recalculateAllBalances();

console.log('--- TEST KASUS A: Koreksi Jenis Transaksi (Pemasukan -> Pengeluaran) ---');
// 1. Catat Pemasukan Rp 5.000.000 (Beli sepeda)
const txA = await fm.recordTransaction({
  type: 'income',
  amount: 5000000,
  description: 'Beli sepeda',
  category: 'Lain-lain',
  isBusiness: false,
  owner: 'owner',
  date: '2026-10-20 10:00:00'
});
assert.strictEqual(txA.success, true);
assert.strictEqual(txA.spsConfirmed, true, 'SPS harus mengonfirmasi penyimpanan');
assert.strictEqual(fm.data.balances.personalBalance, 5000000, 'Saldo harus bertambah Rp5.000.000');
console.log('1. Tercatat Pemasukan Rp 5.000.000 -> Saldo:', formatRupiah(fm.data.balances.personalBalance));

// 2. Pengguna berkata: "Salah, seharusnya pengeluaran beli sepeda 5 juta"
const matchA = fm.findTransactionForCorrection({
  text: 'Salah, seharusnya pengeluaran beli sepeda 5 juta',
  amount: 5000000,
  owner: 'owner'
});
assert.strictEqual(matchA.status, 'found', 'Harus menemukan transaksi target');
assert.strictEqual(matchA.transaction.id, txA.transaction.id);

// 3. Koreksi transaksi lama
const correctA = await fm.correctTransaction(matchA.transaction.id, {
  type: 'expense'
}, { reason: 'Salah seharusnya pengeluaran' });

assert.strictEqual(correctA.success, true);
assert.strictEqual(correctA.spsConfirmed, true);
assert.strictEqual(correctA.transaction.type, 'expense');
assert.strictEqual(correctA.transaction.amount, 5000000);
// Saldo akhir harus Saldo Awal (0) - Pengeluaran (5.000.000) = -5.000.000
assert.strictEqual(fm.data.balances.personalBalance, -5000000, 'Saldo harus berkurang Rp5.000.000 dari saldo awal');

// Pastikan tidak ada transaksi duplikat!
const activeCountA = fm.data.transactions.filter(t => t.status === 'active').length;
assert.strictEqual(activeCountA, 1, 'Hanya boleh ada 1 transaksi aktif, bukan terduplikasi!');
console.log('2. Dikoreksi menjadi Pengeluaran Rp 5.000.000 -> Saldo:', formatRupiah(fm.data.balances.personalBalance));
console.log('✅ KASUS A BERHASIL (Pemasukan Rp0, Pengeluaran Rp5.000.000, Saldo konsisten, ID tidak berubah)\n');

console.log('--- TEST KASUS B: Koreksi Nominal (Rp 5.000.000 -> Rp 3.000.000) ---');
// 1. Pengguna mengoreksi nominal sepeda tadi dari 5jt menjadi 3jt
const matchB = fm.findTransactionForCorrection({
  text: 'Ralat sepeda harganya 3 juta, bukan 5 juta',
  amount: 3000000,
  owner: 'owner'
});
assert.strictEqual(matchB.status, 'found');
const correctB = await fm.correctTransaction(matchB.transaction.id, {
  amount: 3000000
}, { reason: 'Ralat nominal jadi 3jt' });

assert.strictEqual(correctB.success, true);
assert.strictEqual(correctB.transaction.amount, 3000000);
assert.strictEqual(fm.data.balances.personalBalance, -3000000, 'Total pengeluaran harus tepat Rp3.000.000, bukan Rp8.000.000');
console.log('1. Nominal dikoreksi jadi Rp 3.000.000 -> Saldo:', formatRupiah(fm.data.balances.personalBalance));
console.log('✅ KASUS B BERHASIL (Total pengeluaran tepat Rp3.000.000, bukan Rp8.000.000)\n');

console.log('--- TEST KASUS C: Koreksi Tanggal (Pindah Periode Mingguan & Bulanan) ---');
// 1. Buat transaksi di bulan Oktober (misal 2026-10-25)
const txC = await fm.recordTransaction({
  type: 'expense',
  amount: 250000,
  description: 'Belanja akhir bulan',
  date: '2026-10-25 10:00:00'
});

const monthlyBefore = fm.data.transactions.filter(t => t.status === 'active' && t.date.startsWith('2026-10'));
assert.strictEqual(monthlyBefore.length, 2);

// 2. Pindahkan tanggal ke bulan berikutnya (2026-11-05)
await fm.correctTransaction(txC.transaction.id, {
  date: '2026-11-05 10:00:00'
}, { reason: 'Pindah periode tanggal' });

const octTxs = fm.data.transactions.filter(t => t.status === 'active' && t.date.startsWith('2026-10'));
const novTxs = fm.data.transactions.filter(t => t.status === 'active' && t.date.startsWith('2026-11'));
assert.strictEqual(octTxs.length, 1, 'Transaksi harus keluar dari periode Oktober');
assert.strictEqual(novTxs.length, 1, 'Transaksi harus masuk ke periode November');
console.log('1. Tanggal dipindahkan ke November -> Transaksi Oktober:', octTxs.length, '| Transaksi November:', novTxs.length);
console.log('✅ KASUS C BERHASIL (Laporan kedua periode berpindah secara akurat)\n');

console.log('--- TEST KASUS D: Koreksi Berulang Pada ID yang Sama ---');
// 1. Koreksi kembali txC berturut-turut
await fm.correctTransaction(txC.transaction.id, { amount: 300000 }, { reason: 'Koreksi ke-1' });
await fm.correctTransaction(txC.transaction.id, { amount: 400000 }, { reason: 'Koreksi ke-2' });
await fm.correctTransaction(txC.transaction.id, { description: 'Belanja awal bulan fix' }, { reason: 'Koreksi ke-3' });

const finalTxC = fm.data.transactions.find(t => t.id === txC.transaction.id);
assert.strictEqual(finalTxC.amount, 400000);
assert.strictEqual(finalTxC.description, 'Belanja awal bulan fix');
assert.strictEqual(finalTxC.correctionHistory.length, 4);
const totalActiveD = fm.data.transactions.filter(t => t.status === 'active').length;
assert.strictEqual(totalActiveD, 2, 'Jumlah transaksi aktif tidak boleh membengkak');
console.log('1. Koreksi 4x berhasil tercatat pada audit trail dengan 1 transaksi tunggal aktif.');
console.log('✅ KASUS D BERHASIL (Audit trail lengkap, transaksi tetap 1 ID)\n');

console.log('--- TEST KASUS E: Konsistensi Seluruh Laporan (SSOT) ---');
fm.data = fm.getDefaultData();
fm.data.initialBalances.personalBalance = 10000000;

const todayNow = getNow().format('YYYY-MM-DD HH:mm:ss');
await fm.recordTransaction({ type: 'income', amount: 5000000, description: 'Gaji freelance', date: todayNow });
const txKoreksi = await fm.recordTransaction({ type: 'expense', amount: 2000000, description: 'Sewa alat', date: todayNow });
await fm.recordTransaction({ type: 'savings', amount: 1000000, description: 'Tabungan nikah', date: todayNow });

assert.strictEqual(fm.data.balances.personalBalance, 12000000);
assert.strictEqual(fm.data.balances.savingsBalance, 1000000);

await fm.correctTransaction(txKoreksi.transaction.id, { amount: 4000000 }, { reason: 'Penyesuaian invoice sewa' });
assert.strictEqual(fm.data.balances.personalBalance, 10000000, 'Saldo harus otomatis sinkron 10jt');

const weeklyE = fm.getWeeklyRecap('owner');
const monthlyE = fm.getMonthlyRecap('owner');

assert.strictEqual(weeklyE.income, 5000000);
assert.strictEqual(weeklyE.expense, 4000000);
assert.strictEqual(weeklyE.net, 1000000);

assert.strictEqual(monthlyE.income, 5000000);
assert.strictEqual(monthlyE.expense, 4000000);
assert.strictEqual(monthlyE.savings, 1000000);
assert.strictEqual(monthlyE.net, 1000000);

console.log('1. Saldo SSOT:', formatRupiah(fm.data.balances.personalBalance));
console.log('2. Rekap Mingguan: In', formatRupiah(weeklyE.income), '| Out', formatRupiah(weeklyE.expense), '| Net', formatRupiah(weeklyE.net));
console.log('3. Rekap Bulanan : In', formatRupiah(monthlyE.income), '| Out', formatRupiah(monthlyE.expense), '| Net', formatRupiah(monthlyE.net));
console.log('✅ KASUS E BERHASIL (Saldo, Rekap Mingguan, Rekap Bulanan 100% konsisten)\n');

console.log('--- TEST KASUS F: Pesan Ambigu (Disambiguasi Transaksi Mirip) ---');
await fm.recordTransaction({ type: 'expense', amount: 50000, description: 'Beli kopi Starbucks', date: '2026-10-29 08:00:00' });
await fm.recordTransaction({ type: 'expense', amount: 50000, description: 'Beli kopi Janji Jiwa', date: '2026-10-29 13:00:00' });

const ambiguousCheck = fm.findTransactionForCorrection({
  text: 'Ralat beli kopi tadi harusnya 40rb',
  amount: 40000,
  owner: 'owner'
});

assert.strictEqual(ambiguousCheck.status, 'ambiguous', 'Sistem wajib mendeteksi kondisi ambigu!');
assert.strictEqual(ambiguousCheck.candidates.length >= 2, true);
console.log('1. Terdeteksi ambigu:', ambiguousCheck.candidates.map(c => `[ID: ${c.id}] ${c.description}`).join(' vs '));
console.log('✅ KASUS F BERHASIL (Sistem tidak menebak sembarangan dan meminta konfirmasi)\n');

console.log('--- TEST BONUS: Idempotensi & Pencegahan Transaksi Ganda ---');
const idemKey = 'msg_whatsapp_unique_12345';
const res1 = await fm.recordTransaction({ type: 'expense', amount: 75000, description: 'Makan malam', idempotencyKey: idemKey });
const res2 = await fm.recordTransaction({ type: 'expense', amount: 75000, description: 'Makan malam', idempotencyKey: idemKey });

assert.strictEqual(res1.isDuplicate, undefined);
assert.strictEqual(res2.isDuplicate, true, 'Eksekusi kedua harus dicegah oleh idempotencyKey');
assert.strictEqual(res1.transaction.id, res2.transaction.id, 'ID transaksi harus sama persis');
console.log('1. Idempotensi berhasil mencegah duplikasi pesan ganda.');
console.log('✅ TEST IDEMPOTENSI BERHASIL\n');

console.log('--- TEST AUDIT & REKONSILIASI DATABASE (Section 8) ---');
const auditReport = fm.auditAndReconcile();
assert.strictEqual(typeof auditReport.reconciledBalances.personalBalance, 'number');
console.log('1. Laporan Audit:', auditReport);
console.log('✅ AUDIT & REKONSILIASI BERHASIL\n');

console.log('--- TEST KASUS NYATA: "Pemasukan Rp50.000" dikoreksi "dikoreksi jadi Pengeluaran beli ayam Rp50000" ---');
const txUserIncome = await fm.recordTransaction({
  type: 'income',
  amount: 50000,
  category: 'Pemasukan',
  description: 'Pemasukan Rp50.000',
  owner: 'owner'
});

await geminiService.checkAndFallbackParseTransaction(
  'dikoreksi jadi Pengeluaran beli ayam Rp50000',
  { role: 'owner' }
);

const txUserUpdated = fm.data.transactions.find(t => t.id === txUserIncome.transaction.id);
assert.strictEqual(txUserUpdated.type, 'expense');
assert.strictEqual(txUserUpdated.amount, 50000);
assert.strictEqual(txUserUpdated.description, 'Beli ayam');
assert.strictEqual(txUserUpdated.category, 'Makanan');
assert.strictEqual(txUserUpdated.correctionHistory.length >= 1, true);
console.log('1. Berhasil dikoreksi in-place:', txUserUpdated.id, txUserUpdated.type, txUserUpdated.amount, txUserUpdated.description, txUserUpdated.category);
console.log('✅ TEST KASUS NYATA PENGGUNA BERHASIL LULUS\n');

console.log('--- TEST AUDIT NOMINAL TRANSAKSI (TES 1 - 5 SESUAI INSTRUKSI) ---');
// Tes 1: Input: 2 juta. Hasil: Rp2.000.000.
const t1 = parseAmount('2 juta');
assert.strictEqual(t1, 2000000);
console.log('✅ Tes 1: Input "2 juta" -> Hasil: Rp' + t1.toLocaleString('id-ID'));

// Tes 2: Input: 2jt. Hasil: Rp2.000.000.
const t2 = parseAmount('2jt');
assert.strictEqual(t2, 2000000);
console.log('✅ Tes 2: Input "2jt" -> Hasil: Rp' + t2.toLocaleString('id-ID'));

// Tes 3: Input: 1,5 juta. Hasil: Rp1.500.000.
const t3 = parseAmount('1,5 juta');
assert.strictEqual(t3, 1500000);
console.log('✅ Tes 3: Input "1,5 juta" -> Hasil: Rp' + t3.toLocaleString('id-ID'));

// Tes 4: Input: 500 ribu. Hasil: Rp500.000.
const t4 = parseAmount('500 ribu');
assert.strictEqual(t4, 500000);
console.log('✅ Tes 4: Input "500 ribu" -> Hasil: Rp' + t4.toLocaleString('id-ID'));

// Tes 5: Input: 2.000.000. Hasil: Rp2.000.000.
const t5 = parseAmount('2.000.000');
assert.strictEqual(t5, 2000000);
console.log('✅ Tes 5: Input "2.000.000" -> Hasil: Rp' + t5.toLocaleString('id-ID'));

// Tes Kasus Pengguna: 1jt 200 -> Rp1.200.000
const tUser1 = parseAmount('1jt 200');
assert.strictEqual(tUser1, 1200000);
console.log('✅ Tes User 1: Input "1jt 200" -> Hasil: Rp' + tUser1.toLocaleString('id-ID'));

// Tes Kasus Pengguna: 1jt 50 rb -> Rp1.050.000
const tUser2 = parseAmount('1jt 50 rb');
assert.strictEqual(tUser2, 1050000);
console.log('✅ Tes User 2: Input "1jt 50 rb" -> Hasil: Rp' + tUser2.toLocaleString('id-ID'));

// Tes Kasus Pengguna: Multi-Transaksi "pemasukan 1jt 200 dan pengeluaran 1jt 50 rb"
console.log('\n--- TEST KASUS PENGGUNA: "pemasukan 1jt 200 dan pengeluaran 1jt 50 rb" ---');
const multiTxResult = await geminiService.checkAndFallbackParseTransaction(
  'pemasukan 1jt 200 dan pengeluaran 1jt 50 rb',
  { role: 'owner' }
);
assert.strictEqual(multiTxResult.recorded, true);
assert.strictEqual(multiTxResult.isMulti, true);
assert.strictEqual(multiTxResult.transactions.length, 2);

const incTx = multiTxResult.transactions.find(t => t.type === 'income');
const expTx = multiTxResult.transactions.find(t => t.type === 'expense');
assert.strictEqual(incTx.amount, 1200000, 'Pemasukan harus tepat Rp1.200.000, bukan Rp1.000.000');
assert.strictEqual(expTx.amount, 1050000, 'Pengeluaran harus tepat Rp1.050.000, bukan Rp1.000.000');
console.log('1. Multi-transaksi berhasil dicatat terpisah:');
console.log(`   - Pemasukan  : Rp ${incTx.amount.toLocaleString('id-ID')} (ID: ${incTx.id})`);
console.log(`   - Pengeluaran: Rp ${expTx.amount.toLocaleString('id-ID')} (ID: ${expTx.id})`);
console.log('✅ TEST KASUS PENGGUNA BERHASIL LULUS 100%\n');

console.log('\n--- TEST KASUS JUAL KAMBING: "bro catat jual kambing 2jt" ---');
const goatResult = await geminiService.checkAndFallbackParseTransaction(
  'bro catat jual kambing 2jt',
  { role: 'owner' }
);
assert.strictEqual(goatResult.recorded, true);
assert.strictEqual(goatResult.transaction.amount, 2000000);
assert.strictEqual(goatResult.transaction.type, 'income');
assert.strictEqual(goatResult.transaction.isBusiness, true);
assert.strictEqual(goatResult.transaction.description, 'Jual kambing');
console.log('1. Berhasil dicatat:', goatResult.transaction.id, goatResult.transaction.type, goatResult.transaction.amount, goatResult.transaction.description);
console.log('✅ TEST KASUS JUAL KAMBING BERHASIL LULUS 100%\n');

console.log('--- TEST ISOLASI SUMBER PENDAPATAN (CONTOH KEYNEX - Section 1) ---');
// Catat 2 transaksi KEYNEX dan 1 transaksi ternak kambing
await fm.recordTransaction({
  type: 'income',
  amount: 4500000,
  description: 'Order website KEYNEX',
  category: 'KEYNEX',
  isBusiness: true
});
await fm.recordTransaction({
  type: 'expense',
  amount: 500000,
  description: 'Sewa server hosting KEYNEX',
  category: 'KEYNEX',
  isBusiness: true
});
await fm.recordTransaction({
  type: 'income',
  amount: 3000000,
  description: 'Penjualan kambing qurban',
  category: 'Ternak',
  isBusiness: true
});

const keynexFin = fm.getFinancesBySource('KEYNEX');
assert.strictEqual(keynexFin.income, 4500000, 'Pendapatan KEYNEX harus murni 4.500.000');
assert.strictEqual(keynexFin.expense, 500000, 'Pengeluaran KEYNEX harus 500.000');
assert.strictEqual(keynexFin.net, 4000000, 'Laba bersih KEYNEX harus 4.000.000');
assert.strictEqual(keynexFin.transactionCount, 2, 'KEYNEX tidak boleh bercampur dengan ternak kambing!');
console.log('1. Isolasi KEYNEX Terverifikasi: Income Rp 4.500.000 | Expense Rp 500.000 | Laba Rp 4.000.000');
console.log('✅ TEST ISOLASI SUMBER PENDAPATAN BERHASIL LULUS 100%\n');

console.log('--- TEST RESPON KONFIRMASI (Ya, Benar, Setuju tidak diproses ulang) ---');
assert.strictEqual(isConfirmationText('ya'), true);
assert.strictEqual(isConfirmationText('Benar'), true);
assert.strictEqual(isConfirmationText('Setuju'), true);
assert.strictEqual(isConfirmationText('oke'), true);
assert.strictEqual(isConfirmationText('sip bro'), true);

const confirmRes = await geminiService.checkAndFallbackParseTransaction('Ya, benar', { role: 'owner' });
assert.strictEqual(confirmRes, null, 'Konfirmasi murni TIDAK BOLEH memicu pencatatan transaksi!');
console.log('1. Konfirmasi "Ya, benar" diabaikan dari parsing nominal.');
console.log('✅ TEST KONFIRMASI AMAN BERHASIL LULUS\n');

console.log('--- TEST TASK MANAGER & TOP 3 PRIORITAS (Section 3 & 4) ---');
const tNew = tm.addTask({ title: 'Kirim invoice klien KEYNEX', priority: 'high', category: 'business' });
assert.strictEqual(tNew.priority, 'high');
const topPriorities = tm.getTopPriorities(3, 'owner');
assert.strictEqual(topPriorities.length >= 1, true);
console.log('1. Top priorities terdaftar:', topPriorities.map(t => t.title));
console.log('✅ TEST TASK MANAGER BERHASIL LULUS\n');

console.log('--- TEST PROAKTIF: "Apa yang harus saya lakukan sekarang?" (Section 3 & 11) ---');
const whatToDo = geminiService.buildWhatShouldIDoNow({ role: 'owner', name: 'Bro' });
assert.strictEqual(whatToDo.includes('PANDUAN ARAHAN SEKARANG'), true);
assert.strictEqual(whatToDo.includes('WIB'), true);
console.log('1. Panduan Proaktif Tergenerate:\n', whatToDo.slice(0, 150) + '...\n');
console.log('✅ TEST PROAKTIF PANDUAN BERHASIL LULUS\n');

console.log('--- TEST DAILY BRIEFING & DAILY EVALUATION (Section 7 & 8) ---');
const briefing = geminiService.buildDailyBriefing({ role: 'owner', name: 'Bro' });
assert.strictEqual(briefing.includes('DAILY BRIEFING'), true);
assert.strictEqual(briefing.includes('Ringkasan Keuangan (SPS SSOT)'), true);
assert.strictEqual(briefing.includes('Tiga Pekerjaan Paling Penting'), true);
console.log('1. Daily Briefing Valid ✅');

const dailyEval = geminiService.buildDailyEvaluation({ role: 'owner', name: 'Bro' });
assert.strictEqual(dailyEval.includes('DAILY EVALUATION'), true);
assert.strictEqual(dailyEval.includes('Jumlah Rutinitas Dijadwalkan'), true);
assert.strictEqual(dailyEval.includes('Perkembangan Kebiasaan'), true);
console.log('2. Daily Evaluation Valid ✅');
console.log('✅ TEST DAILY BRIEFING & EVALUATION BERHASIL LULUS\n');

console.log('================================================================');
console.log('🎉 SELURUH SKENARIO PENGUJIAN LULUS 100%! 🎉');
console.log('================================================================');
