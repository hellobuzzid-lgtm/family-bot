import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { FinanceManager } from '../src/services/financeManager.js';
import { GeminiService } from '../src/services/geminiService.js';
import { formatRupiah } from '../src/utils/formatters.js';

console.log('================================================================');
console.log('🧪 PENGUJIAN MENYELURUH SISTEM KEUANGAN & KOREKSI TRANSAKSI');
console.log('================================================================\n');

// Mock GoogleSheetsService to capture sync calls
class MockGoogleSheetsService {
  constructor() {
    this.appended = [];
    this.updated = [];
    this.deleted = [];
    this.reconciled = [];
  }
  async appendTransaction(tx) { this.appended.push(tx); return { success: true }; }
  async updateTransaction(tx) { this.updated.push(tx); return { success: true }; }
  async deleteTransaction(id) { this.deleted.push(id); return { success: true }; }
  async reconcileAllTransactions(txs) { this.reconciled.push(txs); return { success: true }; }
}

const mockSheets = new MockGoogleSheetsService();
const fm = new FinanceManager(mockSheets);

// Reset memory state for pristine testing
fm.data = fm.getDefaultData();
fm.recalculateAllBalances();

console.log('--- TEST KASUS A: Koreksi Jenis Transaksi (Pemasukan -> Pengeluaran) ---');
// 1. Catat Pemasukan Rp 5.000.000 (Beli sepeda)
const txA = fm.recordTransaction({
  type: 'income',
  amount: 5000000,
  description: 'Beli sepeda',
  category: 'Lain-lain',
  isBusiness: false,
  owner: 'owner'
});
assert.strictEqual(txA.success, true);
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
const correctA = fm.correctTransaction(matchA.transaction.id, {
  type: 'expense'
}, { reason: 'Salah seharusnya pengeluaran' });

assert.strictEqual(correctA.success, true);
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
const correctB = fm.correctTransaction(matchB.transaction.id, {
  amount: 3000000
}, { reason: 'Ralat nominal jadi 3jt' });

assert.strictEqual(correctB.success, true);
assert.strictEqual(correctB.transaction.amount, 3000000);
// Saldo akhir harus 0 - 3.000.000 = -3.000.000 (BUKAN -8.000.000!)
assert.strictEqual(fm.data.balances.personalBalance, -3000000, 'Total pengeluaran harus tepat Rp3.000.000, bukan Rp8.000.000');
console.log('1. Nominal dikoreksi jadi Rp 3.000.000 -> Saldo:', formatRupiah(fm.data.balances.personalBalance));
console.log('✅ KASUS B BERHASIL (Total pengeluaran tepat Rp3.000.000, bukan Rp8.000.000)\n');

console.log('--- TEST KASUS C: Koreksi Tanggal (Pindah Periode Mingguan & Bulanan) ---');
// 1. Buat transaksi di bulan Oktober (misal 2026-10-25)
const txC = fm.recordTransaction({
  type: 'expense',
  amount: 250000,
  description: 'Belanja akhir bulan',
  date: '2026-10-25 10:00:00'
});

const monthlyBefore = fm.data.transactions.filter(t => t.status === 'active' && t.date.startsWith('2026-10'));
assert.strictEqual(monthlyBefore.length, 2);

// 2. Pindahkan tanggal ke bulan berikutnya (2026-11-05)
fm.correctTransaction(txC.transaction.id, {
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
fm.correctTransaction(txC.transaction.id, { amount: 300000 }, { reason: 'Koreksi ke-1' });
fm.correctTransaction(txC.transaction.id, { amount: 400000 }, { reason: 'Koreksi ke-2' });
fm.correctTransaction(txC.transaction.id, { description: 'Belanja awal bulan fix' }, { reason: 'Koreksi ke-3' });

const finalTxC = fm.data.transactions.find(t => t.id === txC.transaction.id);
assert.strictEqual(finalTxC.amount, 400000);
assert.strictEqual(finalTxC.description, 'Belanja awal bulan fix');
assert.strictEqual(finalTxC.correctionHistory.length, 4); // 1 tanggal + 3 perubahan
// Total transaksi aktif tetap 2
const totalActiveD = fm.data.transactions.filter(t => t.status === 'active').length;
assert.strictEqual(totalActiveD, 2, 'Jumlah transaksi aktif tidak boleh membengkak');
console.log('1. Koreksi 4x berhasil tercatat pada audit trail dengan 1 transaksi tunggal aktif.');
console.log('✅ KASUS D BERHASIL (Audit trail lengkap, transaksi tetap 1 ID)\n');

console.log('--- TEST KASUS E: Konsistensi Seluruh Laporan (SSOT) ---');
// Reset dataset untuk pengujian konsistensi matematis
fm.data = fm.getDefaultData();
fm.data.initialBalances.personalBalance = 10000000; // Saldo awal Rp10jt

// Transaksi 1: Pemasukan Rp 5.000.000
fm.recordTransaction({ type: 'income', amount: 5000000, description: 'Gaji freelance', date: '2026-10-26 09:00:00' });
// Transaksi 2: Pengeluaran Rp 2.000.000
const txKoreksi = fm.recordTransaction({ type: 'expense', amount: 2000000, description: 'Sewa alat', date: '2026-10-27 10:00:00' });
// Transaksi 3: Tabungan Rp 1.000.000
fm.recordTransaction({ type: 'savings', amount: 1000000, description: 'Tabungan nikah', date: '2026-10-28 11:00:00' });

// Saldo Awal (10jt) + Masuk (5jt) - Keluar (2jt) - Tabungan (1jt) = 12jt
assert.strictEqual(fm.data.balances.personalBalance, 12000000);
assert.strictEqual(fm.data.balances.savingsBalance, 1000000);

// Sekarang koreksi sewa alat dari 2jt menjadi 4jt
fm.correctTransaction(txKoreksi.transaction.id, { amount: 4000000 }, { reason: 'Penyesuaian invoice sewa' });

// Saldo baru = 10jt + 5jt - 4jt - 1jt = 10jt
assert.strictEqual(fm.data.balances.personalBalance, 10000000, 'Saldo harus otomatis sinkron 10jt');

// Periksa rekap mingguan & bulanan
const weeklyE = fm.getWeeklyRecap('owner');
const monthlyE = fm.getMonthlyRecap('owner');

assert.strictEqual(weeklyE.income, 5000000);
assert.strictEqual(weeklyE.expense, 4000000);
assert.strictEqual(weeklyE.net, 1000000); // 5jt - 4jt = 1jt

assert.strictEqual(monthlyE.income, 5000000);
assert.strictEqual(monthlyE.expense, 4000000);
assert.strictEqual(monthlyE.savings, 1000000);
assert.strictEqual(monthlyE.net, 1000000);

console.log('1. Saldo SSOT:', formatRupiah(fm.data.balances.personalBalance));
console.log('2. Rekap Mingguan: In', formatRupiah(weeklyE.income), '| Out', formatRupiah(weeklyE.expense), '| Net', formatRupiah(weeklyE.net));
console.log('3. Rekap Bulanan : In', formatRupiah(monthlyE.income), '| Out', formatRupiah(monthlyE.expense), '| Net', formatRupiah(monthlyE.net));
console.log('✅ KASUS E BERHASIL (Saldo, Rekap Mingguan, Rekap Bulanan 100% konsisten)\n');

console.log('--- TEST KASUS F: Pesan Ambigu (Disambiguasi Transaksi Mirip) ---');
// Buat dua transaksi dengan nama & nominal yang mirip
const txF1 = fm.recordTransaction({ type: 'expense', amount: 50000, description: 'Beli kopi Starbucks', date: '2026-10-29 08:00:00' });
const txF2 = fm.recordTransaction({ type: 'expense', amount: 50000, description: 'Beli kopi Janji Jiwa', date: '2026-10-29 13:00:00' });

const ambiguousCheck = fm.findTransactionForCorrection({
  text: 'Ralat beli kopi tadi harusnya 40rb',
  amount: 40000,
  owner: 'owner'
});

assert.strictEqual(ambiguousCheck.status, 'ambiguous', 'Sistem wajib mendeteksi kondisi ambigu!');
assert.strictEqual(ambiguousCheck.candidates.length >= 2, true, 'Harus mengembalikan daftar kandidat untuk konfirmasi pengguna');
console.log('1. Terdeteksi ambigu:', ambiguousCheck.candidates.map(c => `[ID: ${c.id}] ${c.description}`).join(' vs '));
console.log('✅ KASUS F BERHASIL (Sistem tidak menebak sembarangan dan meminta konfirmasi)\n');

console.log('--- TEST BONUS: Idempotensi & Pencegahan Transaksi Ganda ---');
const idemKey = 'msg_whatsapp_unique_12345';
const res1 = fm.recordTransaction({ type: 'expense', amount: 75000, description: 'Makan malam', idempotencyKey: idemKey });
const res2 = fm.recordTransaction({ type: 'expense', amount: 75000, description: 'Makan malam', idempotencyKey: idemKey });

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
const txUserIncome = fm.recordTransaction({
  type: 'income',
  amount: 50000,
  category: 'Pemasukan',
  description: 'Pemasukan Rp50.000',
  owner: 'owner'
});

const geminiService = new GeminiService(null, null, fm, null, null);
geminiService.checkAndFallbackParseTransaction(
  'dikoreksi jadi Pengeluaran beli ayam Rp50000',
  { role: 'owner' }
);

const txUserUpdated = fm.data.transactions.find(t => t.id === txUserIncome.transaction.id);
assert.strictEqual(txUserUpdated.type, 'expense', 'Jenis transaksi harus berubah dari income menjadi expense');
assert.strictEqual(txUserUpdated.amount, 50000, 'Nominal harus tetap 50000');
assert.strictEqual(txUserUpdated.description, 'Beli ayam', 'Keterangan harus diperbarui menjadi Beli ayam');
assert.strictEqual(txUserUpdated.category, 'Makanan', 'Kategori harus otomatis menjadi Makanan');
assert.strictEqual(txUserUpdated.correctionHistory.length >= 1, true, 'Riwayat koreksi harus tercatat');
console.log('1. Berhasil dikoreksi in-place:', txUserUpdated.id, txUserUpdated.type, txUserUpdated.amount, txUserUpdated.description, txUserUpdated.category);
console.log('✅ TEST KASUS NYATA PENGGUNA BERHASIL LULUS\n');

console.log('--- TEST AUDIT NOMINAL TRANSAKSI (TES 1 - 5 SESUAI INSTRUKSI) ---');
import { parseAmount, extractAmount } from '../src/utils/formatters.js';

// Tes 1: Input: 2 juta. Hasil: Rp2.000.000.
const t1 = parseAmount('2 juta');
assert.strictEqual(t1, 2000000, 'Tes 1 Gagal: 2 juta harus 2.000.000');
console.log('✅ Tes 1: Input "2 juta" -> Hasil: Rp' + t1.toLocaleString('id-ID'));

// Tes 2: Input: 2jt. Hasil: Rp2.000.000.
const t2 = parseAmount('2jt');
assert.strictEqual(t2, 2000000, 'Tes 2 Gagal: 2jt harus 2.000.000');
console.log('✅ Tes 2: Input "2jt" -> Hasil: Rp' + t2.toLocaleString('id-ID'));

// Tes 3: Input: 1,5 juta. Hasil: Rp1.500.000.
const t3 = parseAmount('1,5 juta');
assert.strictEqual(t3, 1500000, 'Tes 3 Gagal: 1,5 juta harus 1.500.000');
console.log('✅ Tes 3: Input "1,5 juta" -> Hasil: Rp' + t3.toLocaleString('id-ID'));

// Tes 4: Input: 500 ribu. Hasil: Rp500.000.
const t4 = parseAmount('500 ribu');
assert.strictEqual(t4, 500000, 'Tes 4 Gagal: 500 ribu harus 500.000');
console.log('✅ Tes 4: Input "500 ribu" -> Hasil: Rp' + t4.toLocaleString('id-ID'));

// Tes 5: Input: 2.000.000. Hasil: Rp2.000.000.
const t5 = parseAmount('2.000.000');
assert.strictEqual(t5, 2000000, 'Tes 5 Gagal: 2.000.000 harus 2.000.000');
console.log('✅ Tes 5: Input "2.000.000" -> Hasil: Rp' + t5.toLocaleString('id-ID'));

console.log('\n--- TEST KASUS JUAL KAMBING: "bro catat jual kambing 2jt" ---');
const goatResult = geminiService.checkAndFallbackParseTransaction(
  'bro catat jual kambing 2jt',
  { role: 'owner' }
);
assert.strictEqual(goatResult.recorded, true, 'Transaksi jual kambing harus tercatat!');
assert.strictEqual(goatResult.transaction.amount, 2000000, 'Nominal harus tepat Rp2.000.000, BUKAN Rp2.000 atau Rp2!');
assert.strictEqual(goatResult.transaction.type, 'income', 'Harus tercatat sebagai income!');
assert.strictEqual(goatResult.transaction.isBusiness, true, 'Harus terdeteksi sebagai transaksi bisnis!');
assert.strictEqual(goatResult.transaction.description, 'Jual kambing', 'Deskripsi harus "Jual kambing"!');
console.log('1. Berhasil dicatat:', goatResult.transaction.id, goatResult.transaction.type, goatResult.transaction.amount, goatResult.transaction.description);
console.log('✅ TEST KASUS JUAL KAMBING BERHASIL LULUS 100%\n');

console.log('--- TEST INTEGRASI SEMUA MODUL (SALDO AWAL, UTANG, CICILAN, TRANSFER) ---');
// 1. Saldo Awal
const initBalances = fm.setInitialBalance({ personal: '10 juta', business: '5jt' });
assert.strictEqual(initBalances.personalBalance, 10000000, 'Saldo awal personal harus 10.000.000');
assert.strictEqual(initBalances.businessBalance, 5000000, 'Saldo awal business harus 5.000.000');
console.log('✅ 1. Saldo awal terverifikasi: Personal Rp 10.000.000 | Business Rp 5.000.000');

// 2. Utang & Piutang
const debt = fm.addDebt({ creditor: 'Bank Mandiri', totalAmount: '12 juta', monthlyInstallment: '1 juta' });
assert.strictEqual(debt.totalAmount, 12000000, 'Total utang harus 12.000.000');
assert.strictEqual(debt.monthlyInstallment, 1000000, 'Cicilan bulanan harus 1.000.000');
console.log('✅ 2. Modul Utang terverifikasi: Total Rp 12.000.000 | Cicilan Rp 1.000.000');

// 3. Pembayaran Cicilan
const payRes = fm.payDebt({ debtId: debt.id, amount: '1 juta' });
assert.strictEqual(payRes.success, true);
assert.strictEqual(payRes.debt.remainingAmount, 11000000, 'Sisa utang harus 11.000.000');
console.log('✅ 3. Modul Pembayaran Cicilan terverifikasi: Sisa Utang Rp 11.000.000');

// 4. Transfer
const transferRes = geminiService.checkAndFallbackParseTransaction(
  'transfer keluar untuk tabungan 500rb',
  { role: 'owner' }
);
assert.strictEqual(transferRes.recorded, true);
assert.strictEqual(transferRes.transaction.amount, 500000, 'Nominal transfer harus 500.000');
console.log('✅ 4. Modul Transfer/Savings terverifikasi: Nominal Rp 500.000');

console.log('================================================================');
console.log('🎉 SELURUH SKENARIO PENGUJIAN LULUS 100%! 🎉');
console.log('================================================================');
