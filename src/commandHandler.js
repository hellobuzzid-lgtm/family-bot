import { config } from './config.js';

export class CommandHandler {
  constructor(stateManager, memoryManager, eventEngine) {
    this.stateManager = stateManager;
    this.memoryManager = memoryManager;
    this.eventEngine = eventEngine;
  }

  isCommand(text) {
    if (!text || typeof text !== 'string') return false;
    return text.trim().startsWith('!');
  }

  async handleCommand(text, speakerInfo) {
    const raw = text.trim().slice(1);
    const parts = raw.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    const callerName = speakerInfo.name || speakerInfo.role || 'Ayah/Ibu';

    switch (cmd) {
      case 'bantuan':
      case 'help':
      case 'menu':
        return `
🌟 *PANDUAN NEX FAMILY — VIRTUAL CHILD BOT* 🌟
Halo ${callerName}! Berikut perintah bantuan untuk memantau & mengatur dunia virtual ${config.childName}:

📌 *Informasi & Status:*
• \`!status\` - Cek kondisi anak (usia, mood, aktivitas, sekolah, saldo)
• \`!saldo\` - Cek uang jajan di dompet, tabungan celengan & target
• \`!jadwal\` - Cek jadwal kegiatan harian anak
• \`!kejadian\` - Cek cerita & peristiwa virtual hari ini
• \`!memori\` - Cek daftar ingatan/kenangan keluarga yang disimpan anak

💰 *Simulasi Keuangan:*
• \`!jajan <jumlah>\` - Beri uang saku virtual (cth: \`!jajan 20000\`)
• \`!nabung <jumlah>\` - Pindahkan uang saku ke celengan (cth: \`!nabung 15000\`)

🎭 *Interaksi Khusus:*
• \`!mood <nama_mood>\` - Set mood anak (cth: \`!mood Ceria\`, \`!mood Manja\`)
• Cukup chat biasa, reply, atau sebut nama "${config.childName}" untuk mengobrol natural!
`.trim();

      case 'status': {
        const state = this.stateManager.getState();
        const activity = this.stateManager.getCurrentActivity();
        const todayEvent = this.eventEngine.getTodayEvent();
        const pocketFmt = this.stateManager.formatRupiah(state.finances.pocketMoneyBalance);
        const savingsFmt = this.stateManager.formatRupiah(state.finances.savingsBalance);
        const targetFmt = this.stateManager.formatRupiah(state.finances.savingsTarget);

        return `
🧒 *STATUS VIRTUAL CHILD AI (${state.identity.name})*
────────────────────────
• *Usia:* ${state.identity.age} tahun
• *Sekolah:* ${state.virtualLife.school.name} (${state.virtualLife.school.grade})
• *Wali Kelas:* ${state.virtualLife.school.teacher}
• *Waktu Saat Ini:* ${this.stateManager.getCurrentTimeString()}
• *Fase Jadwal:* ${activity.name}
  ↳ _${activity.description}_
• *Mood Sekarang:* ${state.mood.current} ${state.mood.emoji} (Intensitas: ${state.mood.intensity}/10)
  ↳ _"${state.mood.reason}"_

💰 *Dompet & Celengan:*
• Uang Jajan: *${pocketFmt}*
• Celengan Ayam: *${savingsFmt}*
• Target: *${targetFmt}* (${state.finances.targetItem})

📖 *Peristiwa Hari Ini:*
_${todayEvent ? todayEvent.story : 'Belum ada kejadian spesial.'}_
────────────────────────
`.trim();
      }

      case 'saldo':
      case 'dompet':
      case 'uang': {
        const state = this.stateManager.getState();
        const pocketFmt = this.stateManager.formatRupiah(state.finances.pocketMoneyBalance);
        const savingsFmt = this.stateManager.formatRupiah(state.finances.savingsBalance);
        const targetFmt = this.stateManager.formatRupiah(state.finances.savingsTarget);
        const progress = Math.min(100, Math.round((state.finances.savingsBalance / state.finances.savingsTarget) * 100));

        return `
💰 *KEUANGAN VIRTUAL ${config.childName}*
────────────────────────
👛 *Dompet Uang Saku:* ${pocketFmt}
🐷 *Celengan Tabungan:* ${savingsFmt}
🎯 *Target Celengan:* ${targetFmt}
📦 *Barang Impian:* ${state.finances.targetItem}
📊 *Progres Tabungan:* [${progress}%] ${'🟩'.repeat(Math.floor(progress / 10))}${'⬜'.repeat(10 - Math.floor(progress / 10))}

_Gunakan \`!jajan <nominal>\` untuk memberi uang saku atau \`!nabung <nominal>\` untuk memasukkannya ke celengan._
`.trim();
      }

      case 'jajan':
      case 'transfer':
      case 'kasih': {
        const amount = parseInt(args[0]?.replace(/\D/g, ''), 10);
        if (!amount || amount <= 0) {
          return `Format salah. Contoh penggunaan: \`!jajan 20000\` (untuk memberi uang jajan Rp20.000).`;
        }
        const newBalance = this.stateManager.addPocketMoney(
          amount,
          `Diberikan oleh ${callerName} lewat transfer virtual`
        );
        const formatted = this.stateManager.formatRupiah(amount);
        const balanceFmt = this.stateManager.formatRupiah(newBalance);

        // Child expresses immense gratitude and joy
        return `Yeayyy! Makasih banyak ya ${callerName}! ❤️ Uang saku ${formatted} udah masuk ke dompet kecil ${config.childName}. Sekarang total uang jajan jadi *${balanceFmt}*! 😆✨`;
      }

      case 'nabung': {
        const amount = parseInt(args[0]?.replace(/\D/g, ''), 10);
        if (!amount || amount <= 0) {
          return `Format salah. Contoh penggunaan: \`!nabung 10000\` (untuk memasukkan Rp10.000 dari dompet ke celengan).`;
        }
        const res = this.stateManager.transferToSavings(amount, `Menabung mandiri dari uang saku`);
        if (!res.success) {
          return `Yahhh... uang di dompet ${config.childName} belum cukup buat ditabung sejumlah itu. ${res.message}`;
        }

        const formatted = this.stateManager.formatRupiah(amount);
        const savingsFmt = this.stateManager.formatRupiah(res.savingsBalance);
        const targetFmt = this.stateManager.formatRupiah(res.target);

        return `Tring! 🪙 ${formatted} berhasil dimasukkan ke celengan ayam! Sekarang tabungan ${config.childName} ada *${savingsFmt}* dari target *${targetFmt}*. Dikit lagi kekumpul! 🥳🐷`;
      }

      case 'mood': {
        const moodName = args.join(' ').trim();
        if (!moodName) {
          return `Silakan sebutkan mood yang diinginkan. Contoh: \`!mood Ceria\`, \`!mood Manja\`, \`!mood Ngantuk\`, \`!mood Sedih Ringan\`.`;
        }
        this.stateManager.updateMood(moodName, '✨', 8, `Diatur oleh ${callerName}`);
        return `Mood ${config.childName} sekarang disesuaikan menjadi: *${moodName}*!`;
      }

      case 'kejadian':
      case 'event': {
        const summary = this.eventEngine.getRecentEventsSummary(5);
        return `
📖 *BUKU HARIAN & KEJADIAN VIRTUAL ${config.childName}*
────────────────────────
${summary}
────────────────────────
_Kejadian virtual ini menjadi bahan cerita anak yang konsisten dari hari ke hari._
`.trim();
      }

      case 'memori':
      case 'ingatan': {
        const memories = this.memoryManager.getAll();
        if (memories.length === 0) {
          return `${config.childName} belum memiliki catatan memori khusus.`;
        }
        const lines = memories.slice(0, 10).map((m, idx) => `${idx + 1}. [${m.category}] ${m.fact}`);
        return `
🧠 *MEMORI & KENANGAN YANG DIINGAT ${config.childName}:*
────────────────────────
${lines.join('\n')}
────────────────────────
_Total ada ${memories.length} memori jangka panjang yang tersimpan._
`.trim();
      }

      case 'jadwal': {
        const state = this.stateManager.getState();
        const schedLines = Object.entries(state.schedule).map(([jam, kegiatan]) => `• *${jam}*: ${kegiatan}`);
        return `
⏰ *JADWAL KEHIDUPAN HARIAN ${config.childName} (6 TAHUN)*
────────────────────────
${schedLines.join('\n')}
────────────────────────
_Jadwal ini digunakan sebagai state internal real-time._
`.trim();
      }

      default:
        return `Perintah \`!${cmd}\` tidak dikenali. Ketik \`!bantuan\` untuk melihat daftar perintah.`;
    }
  }
}
