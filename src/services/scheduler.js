import cron from 'node-cron';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

export class Scheduler {
  constructor(whatsappBot, routineManager, financeManager, goalTracker, taskManager = null, geminiService = null, reminderManager = null) {
    this.whatsappBot = whatsappBot;
    this.routineManager = routineManager;
    this.financeManager = financeManager;
    this.goalTracker = goalTracker;
    this.taskManager = taskManager;
    this.geminiService = geminiService;
    this.reminderManager = reminderManager;
    this.tasks = [];
    this.lastNotifiedPrayers = new Set();
  }

  setGeminiService(geminiService) {
    this.geminiService = geminiService;
  }

  setTaskManager(taskManager) {
    this.taskManager = taskManager;
  }

  setReminderManager(reminderManager) {
    this.reminderManager = reminderManager;
  }

  start() {
    if (!config.autonomousReminders) {
      console.log('[Scheduler] Autonomous reminders disabled in config.');
      return;
    }

    console.log(`[Scheduler] Starting Autonomous Life Assistant Scheduler (Timezone: ${config.timezone})...`);

    // 1. Check prayer times & smart custom reminders every minute (Section 2 & 3)
    const minuteCheckTask = cron.schedule('* * * * *', async () => {
      await this.checkPrayerTimes();
      await this.checkCustomReminders();
    }, { timezone: config.timezone });
    this.tasks.push(minuteCheckTask);

    // 2. DAILY BRIEFING (06:30 WIB) — Section 7
    const morningBriefingTask = cron.schedule('30 6 * * *', async () => {
      console.log('[Scheduler] ☀️ Dispatching Automated Daily Briefing (06:30 WIB)...');
      let briefingText = '';
      if (this.geminiService) {
        briefingText = this.geminiService.buildDailyBriefing({ role: 'owner', name: config.ownerName });
      } else {
        briefingText = '☀️ *DAILY BRIEFING PAGI*\n\nSelamat pagi Bro! Waktunya memulai rutinitas pagi, sarapan sehat, minum air, dan bersiap eksekusi target utama hari ini.';
      }
      await this.sendReminder(briefingText);
    }, { timezone: config.timezone });
    this.tasks.push(morningBriefingTask);

    // 3. Work Start Reminder (08:00 WIB)
    const workStartTask = cron.schedule('0 8 * * 1-6', async () => {
      const topTasks = this.taskManager ? this.taskManager.getTopPriorities(1, 'owner') : [];
      const topTaskTitle = topTasks[0] ? topTasks[0].title : 'tugas prioritas bisnismu';
      await this.sendReminder(
        `💼 *WAKTUNYA MEMULAI PEKERJAAN (08:00 WIB)*\n\n` +
        `Bro, jam kerja utama sudah dimulai. Prioritas pertama hari ini: *${topTaskTitle}*.\n` +
        `Fokus tuntaskan pekerjaan penting sebelum membuka distraksi media sosial. Semangat eksekusi!`
      );
    }, { timezone: config.timezone });
    this.tasks.push(workStartTask);

    // 4. Siang / Lunch & Water Check (12:00 WIB)
    const lunchTask = cron.schedule('0 12 * * *', async () => {
      await this.sendReminder(
        '🍱 *WAKTU ISTIRAHAT & MAKAN SIANG (12:00 WIB)*\n\n' +
        'Bro, sudah tengah hari. Istirahatkan pikiran, makan siang bergizi, minum air putih, dan tunaikan sholat Dzuhur jika belum. Jangan sampai terlalu fokus kerja hingga mengabaikan asupan fisik.'
      );
    }, { timezone: config.timezone });
    this.tasks.push(lunchTask);

    // 5. Olahraga Sore & Workout (17:00 WIB)
    const workoutTask = cron.schedule('0 17 * * *', async () => {
      const workoutDone = this.routineManager?.data?.todayRoutines?.workout?.completed;
      if (!workoutDone) {
        await this.sendReminder(
          '🏃‍♂️ *PENGINGAT OLAHRAGA SORE (17:00 WIB)*\n\n' +
          'Bro, jam kerja mulai mereda. Waktunya olahraga fisik 30-45 menit untuk menjaga stamina dan membakar kalori. Ingat komitmen target kesehatan mingguan lo!'
        );
      }
    }, { timezone: config.timezone });
    this.tasks.push(workoutTask);

    // 6. DAILY EVALUATION (21:30 WIB) — Section 8
    const dailyEvaluationTask = cron.schedule('30 21 * * *', async () => {
      console.log('[Scheduler] 🌙 Dispatching Automated Daily Evaluation (21:30 WIB)...');
      let evalText = '';
      if (this.geminiService) {
        evalText = this.geminiService.buildDailyEvaluation({ role: 'owner', name: config.ownerName });
      } else {
        evalText = '🌙 *DAILY EVALUATION MALAM*\n\nBro, jam evaluasi harian telah tiba. Mari periksa aktivitas, target, dan pencatatan transaksi hari ini.';
      }
      await this.sendReminder(evalText);
    }, { timezone: config.timezone });
    this.tasks.push(dailyEvaluationTask);

    // 7. Skincare Malam & Waktu Tidur (22:30 WIB)
    const bedtimeTask = cron.schedule('30 22 * * *', async () => {
      const skincareDone = this.routineManager?.data?.todayRoutines?.skincare?.night;
      await this.sendReminder(
        `😴 *PERSIAPAN ISTIRAHAT & TIDUR (22:30 WIB)*\n\n` +
        `Bro, sudah larut malam. ${skincareDone ? 'Skincare malam sudah selesai ✅.' : 'Jangan lupa skincare malam (cuci muka & pelembap) ya.'}\n` +
        `Istirahatkan pikiran dan tubuh lo agar besok pagi bangun dengan energi penuh. Selamat istirahat!`
      );
    }, { timezone: config.timezone });
    this.tasks.push(bedtimeTask);

    // 8. Evaluasi Mingguan (Setiap Minggu jam 20:00 WIB) — Section 9
    const weeklyReviewTask = cron.schedule('0 20 * * 0', async () => {
      console.log('[Scheduler] 📊 Dispatching Automated Weekly Evaluation (Minggu 20:00 WIB)...');
      let weeklyText = '';
      if (this.geminiService) {
        weeklyText = this.geminiService.buildWeeklyEvaluation({ role: 'owner', name: config.ownerName });
      }
      if (weeklyText) {
        await this.sendReminder(weeklyText);
      }
    }, { timezone: config.timezone });
    this.tasks.push(weeklyReviewTask);

    console.log('✅ [Scheduler] All 8 autonomous assistant schedules active (Briefing, Work, Lunch, Workout, Eval, Sleep, Weekly, Prayers).');
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
        console.log(`[Scheduler] 🕌 Waktu salat ${p.name} (${p.time}) Kota Jambi telah tiba.`);

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
          `🕌 *WAKTU SALAT ${p.name.toUpperCase()} KOTA JAMBI (${p.time} WIB)*\n\n` +
          `Bro, azan salat ${p.name} sudah berkumandang. Ambil wudhu dan tunaikan kewajiban terlebih dahulu ya. Urusan duniawi bisa menunggu, tapi panggilan ibadah jangan ditunda.`
        );
      }
    }

    if (this.lastNotifiedPrayers.size > 20) {
      this.lastNotifiedPrayers.clear();
    }
  }

  async checkCustomReminders() {
    if (!this.reminderManager) return;
    try {
      const now = getNow();
      const nowTime = now.format('HH:mm');
      const nowDate = now.format('YYYY-MM-DD');

      const dueReminders = this.reminderManager.getRemindersDueNow(nowTime, nowDate);
      for (const rem of dueReminders) {
        console.log(`[Scheduler] ⏰ Dispatching Reminder: "${rem.activity}" (${rem.dueTime} WIB)`);
        this.reminderManager.markNotified(rem.id, rem.owner);

        const promptMsg =
          `⏰ *WAKTU AKTIVITAS TIBA (${rem.dueTime} WIB)*\n\n` +
          `Aktivitas: *${rem.activity}*\n\n` +
          `Apakah kamu sudah melakukan aktivitas ini hari ini?\n` +
          `👉 _Ketik *Sudah* jika sudah selesai, atau *Belum* jika belum dilakukan._`;

        await this.sendReminder(promptMsg);
      }
    } catch (err) {
      console.error('[Scheduler] Error checking custom reminders:', err.message);
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
