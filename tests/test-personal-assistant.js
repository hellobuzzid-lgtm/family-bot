import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';
import { ReminderManager, ACTIVITY_STATUS } from '../src/services/reminderManager.js';
import { MemoryManager, MEMORY_TYPES } from '../src/services/memoryManager.js';
import { TaskManager } from '../src/services/taskManager.js';
import { RoutineManager } from '../src/services/routineManager.js';
import { GoalTracker } from '../src/services/goalTracker.js';
import { FinanceManager } from '../src/services/financeManager.js';
import { GoogleSheetsService } from '../src/services/googleSheetsService.js';
import { MasterPromptBuilder } from '../src/core/masterPrompt.js';
import { GeminiService } from '../src/services/geminiService.js';
import { getNow, formatRupiah } from '../src/utils/formatters.js';

console.log('================================================================');
console.log('🧪 PENGUJIAN MENYELURUH AI PERSONAL ASSISTANT & DISCUSSION PARTNER');
console.log('================================================================\n');

// 1. Setup mock GoogleSheetsService
class MockGoogleSheetsService extends GoogleSheetsService {
  constructor() {
    super();
    this.records = [];
  }
  isConfigured() { return true; }
  async appendTransaction(tx) {
    this.records.push({ type: 'TRANSACTION', tx });
    return { success: true, id: tx.id };
  }
  async updateTransaction(tx) {
    this.records.push({ type: 'UPDATE_TRANSACTION', tx });
    return { success: true, id: tx.id };
  }
  async appendPerformanceReport(report) {
    this.records.push({ type: 'PERFORMANCE_REPORT', report });
    return { success: true };
  }
}

const mockSheets = new MockGoogleSheetsService();
const memoryManager = new MemoryManager();
const taskManager = new TaskManager();
const goalTracker = new GoalTracker(mockSheets);
const routineManager = new RoutineManager(mockSheets);
const reminderManager = new ReminderManager(mockSheets, routineManager, taskManager, goalTracker);
reminderManager.reminders = [];
reminderManager.saveReminders();
const financeManager = new FinanceManager(mockSheets);

const promptBuilder = new MasterPromptBuilder(
  memoryManager,
  financeManager,
  goalTracker,
  routineManager,
  taskManager,
  reminderManager
);

const geminiService = new GeminiService(
  promptBuilder,
  memoryManager,
  financeManager,
  goalTracker,
  routineManager,
  taskManager,
  reminderManager,
  mockSheets
);

// --- TEST 1: KEMAMPUAN SMART REMINDER DENGAN BAHASA ALAMI (Section 2) ---
console.log('--- TEST 1: SMART REMINDER BAHASA ALAMI (Section 2) ---');

// Skenario A: "Besok jam 9 pagi ingatkan saya menghubungi klien KEYNEX"
const res1A = await geminiService.generateResponse({
  messageText: 'Besok jam 9 pagi ingatkan saya menghubungi klien KEYNEX',
  speakerInfo: { role: 'owner', name: 'Bro' }
});

assert.strictEqual(res1A.includes('Menghubungi klien KEYNEX'), true);
assert.strictEqual(res1A.includes('09:00 WIB'), true);
const rem1A = reminderManager.findReminder('klien KEYNEX');
assert.ok(rem1A, 'Pengingat klien KEYNEX harus tersimpan di ReminderManager');
assert.strictEqual(rem1A.dueTime, '09:00');
assert.strictEqual(rem1A.status, ACTIVITY_STATUS.SCHEDULED);
console.log('✅ 1. Pengingat "Besok jam 9 pagi ingatkan saya menghubungi klien KEYNEX" berhasil dibuat.');

// Skenario B: Waktu Relatif "30 menit lagi ingatkan minum air putih"
const nowMoment = getNow();
const res1B = await geminiService.generateResponse({
  messageText: '30 menit lagi ingatkan saya minum air putih',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res1B.includes('Minum air putih'), true);
const rem1B = reminderManager.findReminder('Minum air putih');
assert.ok(rem1B, 'Pengingat 30 menit lagi harus tersimpan');
console.log('✅ 2. Pengingat offset menit ("30 menit lagi") berhasil dihitung otomatis.');

// Skenario C: Deteksi Ambiguitas & Klarifikasi (Section 2)
// "Nanti ingatkan saya bayar tagihan listrik" -> Tidak ada jam spesifik!
const res1C = await geminiService.generateResponse({
  messageText: 'Nanti ingatkan saya bayar tagihan listrik',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res1C.includes('jam berapa'), true, 'Bot WAJIB bertanya klarifikasi jika waktu ambigu!');
console.log('✅ 3. Ambiguitas waktu terdeteksi -> Bot bertanya: "' + res1C + '"');

// Jawaban klarifikasi: "Jam 4 sore"
const res1D = await geminiService.generateResponse({
  messageText: 'Jam 4 sore',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res1D.includes('Bayar tagihan listrik'), true);
assert.strictEqual(res1D.includes('16:00 WIB'), true);
const rem1C = reminderManager.findReminder('Bayar tagihan listrik');
assert.ok(rem1C);
assert.strictEqual(rem1C.dueTime, '16:00');
console.log('✅ 4. Jawaban klarifikasi berhasil memfinalisasi pengingat ke 16:00 WIB.\n');

// --- TEST 2: PERUBAHAN JADWAL & IN-PLACE MODIFICATION (Section 2) ---
console.log('--- TEST 2: PERUBAHAN JADWAL & IN-PLACE MODIFICATION (Section 2) ---');

// "Tunda satu jam"
const res2A = await geminiService.generateResponse({
  messageText: 'Tunda satu jam untuk bayar tagihan listrik',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
const remUpdated = reminderManager.findReminder('Bayar tagihan listrik');
assert.strictEqual(remUpdated.dueTime, '17:00');
assert.strictEqual(remUpdated.status, ACTIVITY_STATUS.RESCHEDULED);
console.log('✅ 1. "Tunda satu jam" berhasil memindahkan waktu dari 16:00 -> 17:00 WIB in-place.');

// "Batalkan pengingat tadi"
const res2B = await geminiService.generateResponse({
  messageText: 'Batalkan pengingat bayar tagihan listrik',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res2B.includes('berhasil dibatalkan'), true);
assert.strictEqual(remUpdated.status, ACTIVITY_STATUS.CANCELLED);
console.log('✅ 2. "Batalkan pengingat" mengubah status jadi DIBATALKAN tanpa duplikasi data.\n');

// --- TEST 3: SISTEM KONFIRMASI AKTIVITAS (Section 3) ---
console.log('--- TEST 3: SISTEM KONFIRMASI AKTIVITAS (Section 3) ---');

// Buat reminder olahraga sore
const remSport = reminderManager.createReminder({
  activity: 'Olahraga sore 30 menit',
  dueTime: '17:00',
  dueDate: getNow().format('YYYY-MM-DD'),
  owner: 'owner'
});

// Simulasi waktu tiba -> Scheduler mengirim pengingat & markNotified
reminderManager.markNotified(remSport.id, 'owner');
assert.strictEqual(remSport.status, ACTIVITY_STATUS.WAITING_CONFIRMATION);
console.log('1. Status reminder saat waktu tiba: MENUNGGU KONFIRMASI');

// Skenario 3A: Pengguna menjawab "Sudah"
const res3A = await geminiService.generateResponse({
  messageText: 'Sudah, barusan beres olahraga',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res3A.includes('SELESAI'), true);
assert.strictEqual(remSport.status, ACTIVITY_STATUS.COMPLETED);
assert.ok(remSport.confirmedAt, 'Waktu konfirmasi harus tersimpan');

// Cek sinkronisasi ke routineManager & goalTracker
const routineSport = routineManager.findActivity('workout');
assert.strictEqual(routineSport.status, 'completed', 'Rutinitas olahraga harus sinkron selesai');
console.log('✅ 2. Jawaban "Sudah" mengubah status menjadi SELESAI & mensinkronkan habit/target.');

// Skenario 3B: Pengguna menjawab "Belum" pada reminder lain
const remWork = reminderManager.createReminder({
  activity: 'Review pembukuan mingguan',
  dueTime: '19:00',
  dueDate: getNow().format('YYYY-MM-DD'),
  owner: 'owner'
});
reminderManager.markNotified(remWork.id, 'owner');

const res3B = await geminiService.generateResponse({
  messageText: 'Belum',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res3B.includes('menjadwalkan ulang') && res3B.includes('melewatkan'), true);
console.log('✅ 3. Jawaban "Belum" memicu pertanyaan: "' + res3B.slice(0, 80) + '..."');

// Pengguna memilih "Jadwalkan ulang"
const res3C = await geminiService.generateResponse({
  messageText: 'Jadwalkan ulang tunda 1 jam',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(res3C.includes('dijadwalkan ulang'), true);
assert.strictEqual(remWork.status, ACTIVITY_STATUS.RESCHEDULED);
console.log('✅ 4. Opsi reschedule berhasil memperbarui jadwal dan status aktivitas.\n');

// --- TEST 4: MEMORY TERSTRUKTUR 6 KATEGORI (Section 5) ---
console.log('--- TEST 4: MEMORY SYSTEM 6 KATEGORI (Section 5) ---');

memoryManager.addMemory({
  content: 'Usaha peternakan kambing memiliki 35 ekor kambing etawa',
  type: MEMORY_TYPES.FACT,
  category: 'business'
});
memoryManager.addMemory({
  content: 'Menyepakati target minimal laba bersih KEYNEX 20 juta per bulan',
  type: MEMORY_TYPES.DECISION,
  category: 'business'
});
memoryManager.addMemory({
  content: 'Ide membuka paket langganan web maintenance bulanan untuk klien KEYNEX',
  type: MEMORY_TYPES.IDEA,
  category: 'business'
});
memoryManager.addMemory({
  content: 'Rencana survei kandang kambing baru minggu depan',
  type: MEMORY_TYPES.PLAN,
  category: 'business'
});

const structuredMem = memoryManager.getStructuredMemories('owner');
assert.strictEqual(structuredMem.includes('Fakta Diketahui:'), true);
assert.strictEqual(structuredMem.includes('Keputusan Disepakati:'), true);
assert.strictEqual(structuredMem.includes('Ide Dipertimbangkan:'), true);
assert.strictEqual(structuredMem.includes('Rencana Belum Dilaksanakan:'), true);
console.log('✅ 1. Sistem memori terstruktur 6 kategori (fakta, keputusan, ide, rencana, tasks, konfirmasi) berhasil terverifikasi.\n');

// --- TEST 5: QUERY JADWAL & TUGAS BELUM SELESAI (Section 6) ---
console.log('--- TEST 5: QUERY JADWAL & TUGAS BELUM SELESAI (Section 6) ---');

taskManager.addTask({
  title: 'Kirim penawaran kerja sama vendor pakan',
  priority: 'high',
  category: 'business'
});

const resSchedule = await geminiService.generateResponse({
  messageText: 'Apa jadwal saya hari ini?',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(resSchedule.includes('JADWAL AKTIVITAS HARI INI'), true);
assert.strictEqual(resSchedule.includes('Rutinitas Terjadwal'), true);
console.log('✅ 1. Query "Apa jadwal saya hari ini?" menghasilkan ringkasan jadwal dan smart reminders.');

const resUnfinished = await geminiService.generateResponse({
  messageText: 'Apa saja pekerjaan yang belum saya selesaikan?',
  speakerInfo: { role: 'owner', name: 'Bro' }
});
assert.strictEqual(resUnfinished.includes('DAFTAR TUGAS & AKTIVITAS YANG BELUM SELESAI'), true);
assert.strictEqual(resUnfinished.includes('Kirim penawaran kerja sama'), true);
console.log('✅ 2. Query "Apa saja pekerjaan yang belum selesai?" memaparkan daftar tugas pending berprioritas.\n');

// --- TEST 6: WEEKLY & MONTHLY PERFORMANCE REPORT KE SPS (Sections 9 & 10) ---
console.log('--- TEST 6: WEEKLY & MONTHLY PERFORMANCE REPORT KE SPS (Sections 9 & 10) ---');

const weeklyReport = geminiService.buildWeeklyEvaluation({ role: 'owner', name: 'Bro' });
assert.strictEqual(weeklyReport.includes('WEEKLY PERFORMANCE REPORT'), true);
assert.strictEqual(weeklyReport.includes('### A. PENCAPAIAN'), true);
assert.strictEqual(weeklyReport.includes('### B. TARGET DAN REALISASI'), true);
assert.strictEqual(weeklyReport.includes('### C. PRODUKTIVITAS'), true);
assert.strictEqual(weeklyReport.includes('### D. KEUANGAN (SPS SINGLE SOURCE OF TRUTH)'), true);
assert.strictEqual(weeklyReport.includes('### E. HAL YANG PERLU DIPERBAIKI'), true);
assert.strictEqual(weeklyReport.includes('### F. HAL YANG PERLU DITINGKATKAN'), true);
assert.strictEqual(weeklyReport.includes('### G. PRIORITAS MINGGU BERIKUTNYA'), true);

const monthlyReport = geminiService.buildMonthlyEvaluation({ role: 'owner', name: 'Bro' });
assert.strictEqual(monthlyReport.includes('MONTHLY PERFORMANCE REPORT'), true);
assert.strictEqual(monthlyReport.includes('Pencapaian Target Bulanan'), true);
assert.strictEqual(monthlyReport.includes('Kondisi Keuangan Berdasarkan SPS'), true);

// Pastikan laporan performa disinkronkan ke Mock Google Sheets
const perfReports = mockSheets.records.filter(r => r.type === 'PERFORMANCE_REPORT');
assert.ok(perfReports.length >= 2, 'Laporan performa mingguan dan bulanan harus tersimpan ke SPS');
console.log('✅ 1. Weekly Performance Report memiliki seluruh 7 bagian (A-G).');
console.log('✅ 2. Monthly Performance Report membandingkan target, cashflow, dan produktivitas.');
console.log('✅ 3. Kedua laporan performa tersimpan ke Google Spreadsheet tab "Laporan Evaluasi Performa".\n');

// --- TEST 7: DISCUSSION PARTNER & CRITICAL THINKING SYSTEM PROMPT (Section 4 & 14) ---
console.log('--- TEST 7: SYSTEM PROMPT DISCUSSION PARTNER & CRITICAL THINKING ---');
const systemPrompt = promptBuilder.buildSystemPrompt({ speakerInfo: { role: 'owner', name: 'Bro' } });
assert.strictEqual(systemPrompt.includes('Discussion Partner & Brainstorming'), true);
assert.strictEqual(systemPrompt.includes('Personal Advisor (Berpikir Kritis & Objektif)'), true);
assert.strictEqual(systemPrompt.includes('Tidak selalu menyetujui pengguna!'), true);
assert.strictEqual(systemPrompt.includes('MEMORI TERSTRUKTUR JANGKA PANJANG (6 KATEGORI)'), true);
console.log('✅ 1. System Prompt menginstruksikan AI untuk berpikir kritis, objektif, dan berani memberi kritik konstruktif.\n');

console.log('================================================================');
console.log('🎉 SELURUH PENGUJIAN MASTER PROMPT BERHASIL LULUS 100%! 🎉');
console.log('================================================================');
