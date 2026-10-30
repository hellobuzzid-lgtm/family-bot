import cron from 'node-cron';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

export class Scheduler {
  constructor(whatsappBot, routineManager, financeManager, goalTracker) {
    this.whatsappBot = whatsappBot;
    this.routineManager = routineManager;
    this.financeManager = financeManager;
    this.goalTracker = goalTracker;
    this.tasks = [];
    this.lastNotifiedPrayers = new Set();
  }

  start() {
    if (!config.autonomousReminders) {
      console.log('[Scheduler] Autonomous reminders disabled in config.');
      return;
    }

    console.log(`[Scheduler] Starting Autonomous Life Reminders (Timezone: ${config.timezone})...`);

    // 1. Check prayer times every minute
    const prayerCheckTask = cron.schedule('* * * * *', async () => {
      await this.checkPrayerTimes();
    }, { timezone: config.timezone });
    this.tasks.push(prayerCheckTask);

    // 2. Morning Briefing & Skincare Pagi (07:15 WIB)
    const morningTask = cron.schedule('15 7 * * *', async () => {
      await this.sendReminder(
        'Bro, selamat pagi. Sebelum mulai aktivitas, pastikan sarapan yang cukup, minum air putih, dan jangan lupa sunscreen pagi lo biar kulit tetap terlindungi. Hari ini ada target penting apa yang mau kita tuntaskan?'
      );
    }, { timezone: config.timezone });
    this.tasks.push(morningTask);

    // 3. Siang / Lunch & Water Check (12:30 WIB)
    const lunchTask = cron.schedule('30 12 * * *', async () => {
      await this.sendReminder(
        'Bro, sudah siang. Istirahat sejenak, makan siang yang bergizi dan minum air. Jangan sampai terlalu fokus kerjaan sampai melupakan asupan fisik.'
      );
    }, { timezone: config.timezone });
    this.tasks.push(lunchTask);

    // 4. Sore / Progress & Hubungan (17:30 WIB)
    const afternoonTask = cron.schedule('30 17 * * *', async () => {
      await this.sendReminder(
        'Sore bro. Jam kerja mulai mereda. Jangan lupa tanyakan kabar atau luangkan perhatian kecil untuk pasangan ya. Membangun masa depan bukan cuma soal kerja keras, tapi juga menjaga orang yang ada di samping lo.'
      );
    }, { timezone: config.timezone });
    this.tasks.push(afternoonTask);

    // 5. Malam / Evaluasi Harian & Catatan Kas (21:15 WIB)
    const dailyEvaluationTask = cron.schedule('15 21 * * *', async () => {
      await this.sendReminder(
        'Bro, waktunya evaluasi harian singkat:\n1. Ada transaksi pemasukan atau pengeluaran hari ini yang belum dicatat? Kalau ada langsung kirim ya biar laporan keuangan tetap akurat.\n2. Target apa yang berhasil lo eksekusi hari ini?\n3. Ada hal yang masih tertunda untuk besok?'
      );
    }, { timezone: config.timezone });
    this.tasks.push(dailyEvaluationTask);

    // 6. Skincare Malam & Waktu Tidur (22:30 WIB)
    const bedtimeTask = cron.schedule('30 22 * * *', async () => {
      await this.sendReminder(
        'Bro, sudah jam setengah sebelas malam. Selesaikan skincare malam lo (cuci muka dan pelembap), lalu istirahatkan pikiran dan tubuh. Kalau ada kerjaan yang belum beres dan bukan darurat, lanjutkan besok dengan energi penuh. Selamat istirahat.'
      );
    }, { timezone: config.timezone });
    this.tasks.push(bedtimeTask);

    // 7. Evaluasi Mingguan (Setiap Minggu jam 10:00 WIB)
    const weeklyReviewTask = cron.schedule('0 10 * * 0', async () => {
      const finSummary = this.financeManager.getFinancialSummary('owner');
      const activeGoals = this.goalTracker.getActiveGoalsSummary('owner');
      await this.sendReminder(
        `Bro, ini evaluasi mingguan kita:\n\n📊 KEUANGAN SAAT INI:\n${finSummary}\n\n🎯 TARGET AKTIF:\n${activeGoals}\n\nCoba evaluasi: apa yang membaik minggu ini, apa yang masih tertahan, dan apa 3 prioritas utama lo untuk minggu depan?`
      );
    }, { timezone: config.timezone });
    this.tasks.push(weeklyReviewTask);

    console.log('✅ [Scheduler] All 7 automated schedules active.');
  }

  stop() {
    this.tasks.forEach(t => t.stop());
    this.tasks = [];
    console.log('[Scheduler] Scheduler stopped.');
  }

  async checkPrayerTimes() {
    const now = getNow();
    const nowTime = now.format('HH:mm');
    const todayDate = now.format('YYYY-MM-DD');
    const prayerTimes = this.routineManager.getPrayerTimesToday();

    const prayers = [
      { name: 'Subuh', time: prayerTimes.subuh },
      { name: 'Dzuhur', time: prayerTimes.dzuhur },
      { name: 'Ashar', time: prayerTimes.ashar },
      { name: 'Maghrib', time: prayerTimes.maghrib },
      { name: 'Isya', time: prayerTimes.isya }
    ];

    for (const p of prayers) {
      const key = `${todayDate}_${p.name}_${p.time}`;
      if (nowTime === p.time && !this.lastNotifiedPrayers.has(key)) {
        this.lastNotifiedPrayers.add(key);
        console.log(`[Scheduler] 🕌 Waktu salat ${p.name} (${p.time}) telah tiba.`);
        
        // Catat pengingat salat otomatis ke Rutinitas & Kebiasaan (Database & Google Spreadsheet)
        if (this.routineManager) {
          try {
            this.routineManager.logHabit({
              habit: 'prayer_reminder',
              value: `Salat ${p.name}`,
              notes: `Pengingat otomatis waktu salat ${p.name} (${p.time} WIB) Kota Jambi`
            });
          } catch (err) {
            console.warn('[Scheduler] Gagal mencatat log rutinitas salat:', err.message);
          }
        }

        await this.sendReminder(
          `Bro, waktu salat ${p.name} sudah masuk (${p.time} WIB). Ambil wudhu dan tunaikan kewajiban terlebih dahulu ya. Kerjaan bisa menunggu, tapi panggilan ibadah jangan ditunda.`
        );
      }
    }

    // Clean old prayer keys
    if (this.lastNotifiedPrayers.size > 20) {
      this.lastNotifiedPrayers.clear();
    }
  }

  async sendReminder(message) {
    if (!this.whatsappBot?.sock) return;
    try {
      const targets = new Set();
      if (config.targetGroupJid) targets.add(config.targetGroupJid);
      if (config.ownerJid) targets.add(config.ownerJid);

      for (const target of targets) {
        await this.whatsappBot.sendMessageWithTyping(target, message);
      }
    } catch (err) {
      console.error('[Scheduler] Error sending reminder:', err.message);
    }
  }
}
