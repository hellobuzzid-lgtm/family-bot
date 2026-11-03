import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow, formatIndoDate } from '../utils/formatters.js';

const remindersFilePath = path.join(config.dataDir, 'reminders.json');

/**
 * Activity Statuses as strictly defined in Section 3:
 * - TERJADWAL: Belum waktunya dilakukan
 * - MENUNGGU KONFIRMASI: Waktu aktivitas sudah tiba
 * - SELESAI: Sudah dikonfirmasi selesai
 * - TIDAK TERLAKSANA: Dikonfirmasi tidak dilakukan
 * - DIJADWALKAN ULANG: Jadwal dipindahkan
 * - DIBATALKAN: Aktivitas dibatalkan
 * - BELUM DIKONFIRMASI: Belum ada jawaban setelah waktu pengingat tiba
 */
export const ACTIVITY_STATUS = {
  SCHEDULED: 'TERJADWAL',
  WAITING_CONFIRMATION: 'MENUNGGU KONFIRMASI',
  COMPLETED: 'SELESAI',
  SKIPPED: 'TIDAK TERLAKSANA',
  RESCHEDULED: 'DIJADWALKAN ULANG',
  CANCELLED: 'DIBATALKAN',
  UNCONFIRMED: 'BELUM DIKONFIRMASI'
};

export class ReminderManager {
  constructor(googleSheetsService = null, routineManager = null, taskManager = null, goalTracker = null) {
    this.googleSheetsService = googleSheetsService;
    this.routineManager = routineManager;
    this.taskManager = taskManager;
    this.goalTracker = goalTracker;
    this.reminders = this.loadReminders();
    this.pendingClarifications = new Map(); // Stores pending reminder requests that need time clarification
    this.lastAwaitingConfirmation = new Map(); // Tracks last reminder sent awaiting confirmation per user
  }

  setDependencies({ googleSheetsService, routineManager, taskManager, goalTracker }) {
    if (googleSheetsService) this.googleSheetsService = googleSheetsService;
    if (routineManager) this.routineManager = routineManager;
    if (taskManager) this.taskManager = taskManager;
    if (goalTracker) this.goalTracker = goalTracker;
  }

  loadReminders() {
    try {
      if (!fs.existsSync(remindersFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(remindersFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[ReminderManager] Error loading reminders.json:', err.message);
      return [];
    }
  }

  saveReminders() {
    try {
      fs.writeFileSync(remindersFilePath, JSON.stringify(this.reminders, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ReminderManager] Error saving reminders.json:', err.message);
    }
  }

  /**
   * Parse natural language reminder string into structured date/time/repeat or detect ambiguity.
   */
  parseNaturalReminder(text, baseNow = null) {
    if (!text) return null;
    const now = baseNow || getNow();
    const clean = text.toLowerCase().trim();

    // 1. Check for recurring keywords
    let repeat = 'none';
    let repeatDay = null;
    if (/(?:setiap|tiap)\s*hari/i.test(clean)) {
      repeat = 'daily';
    } else if (/(?:setiap|tiap)\s*senin/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'senin';
    } else if (/(?:setiap|tiap)\s*selasa/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'selasa';
    } else if (/(?:setiap|tiap)\s*rabu/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'rabu';
    } else if (/(?:setiap|tiap)\s*kamis/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'kamis';
    } else if (/(?:setiap|tiap)\s*jumat|jum'at/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'jumat';
    } else if (/(?:setiap|tiap)\s*sabtu/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'sabtu';
    } else if (/(?:setiap|tiap)\s*minggu/i.test(clean)) {
      repeat = 'weekly';
      repeatDay = 'minggu';
    } else if (/(?:setiap|tiap)\s*bulan/i.test(clean)) {
      repeat = 'monthly';
    }

    // 2. Extract specific hour & minute if present
    // Matches: "jam 9 pagi", "jam 09.00", "pukul 15:30", "jam 10 malam", "jam 4 sore"
    let targetTime = null;
    let targetDate = now.format('YYYY-MM-DD');

    const exactTimeMatch = clean.match(/(?:jam|pukul|pkl\.?)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?\b/i);
    if (exactTimeMatch) {
      let hour = parseInt(exactTimeMatch[1], 10);
      const minute = exactTimeMatch[2] ? parseInt(exactTimeMatch[2], 10) : 0;
      const period = exactTimeMatch[3]?.toLowerCase();

      if (period === 'malam' && hour < 12) hour += 12;
      else if (period === 'sore' && hour < 12 && hour < 6) hour += 12;
      else if (period === 'siang' && hour < 10) hour += 12;

      targetTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    // 3. Extract relative time offsets: "30 menit lagi", "1 jam lagi", "2 jam lagi"
    const minuteOffsetMatch = clean.match(/(\d+)\s*menit\s*lagi\b/i);
    const hourOffsetMatch = clean.match(/(\d+|satu|dua|tiga)\s*jam\s*lagi\b/i);

    if (minuteOffsetMatch) {
      const mins = parseInt(minuteOffsetMatch[1], 10);
      const targetMoment = now.add(mins, 'minute');
      targetDate = targetMoment.format('YYYY-MM-DD');
      targetTime = targetMoment.format('HH:mm');
    } else if (hourOffsetMatch) {
      let hrs = 1;
      const val = hourOffsetMatch[1].toLowerCase();
      if (val === 'satu') hrs = 1;
      else if (val === 'dua') hrs = 2;
      else if (val === 'tiga') hrs = 3;
      else hrs = parseInt(val, 10) || 1;

      const targetMoment = now.add(hrs, 'hour');
      targetDate = targetMoment.format('YYYY-MM-DD');
      targetTime = targetMoment.format('HH:mm');
    }

    // 4. Extract relative date keywords: "besok pagi", "besok siang", "besok malam", "besok", "lusa", "akhir pekan", "minggu depan"
    const isTomorrow = /\bbesok\b/i.test(clean);
    const isDayAfterTomorrow = /\blusa\b/i.test(clean);
    const isWeekend = /\b(?:akhir\s*pekan|weekend)\b/i.test(clean);
    const isNextWeek = /\bminggu\s*depan\b/i.test(clean);
    const isTonight = /\bmalam\s*ini\b/i.test(clean);
    const isThisAfternoon = /\bsore\s*ini\b/i.test(clean);

    if (isTomorrow) {
      targetDate = now.add(1, 'day').format('YYYY-MM-DD');
      if (!targetTime) {
        if (/besok\s*pagi/i.test(clean)) targetTime = '08:00';
        else if (/besok\s*siang/i.test(clean)) targetTime = '13:00';
        else if (/besok\s*sore/i.test(clean)) targetTime = '16:30';
        else if (/besok\s*malam/i.test(clean)) targetTime = '20:00';
      }
    } else if (isDayAfterTomorrow) {
      targetDate = now.add(2, 'day').format('YYYY-MM-DD');
      if (!targetTime) targetTime = '08:00';
    } else if (isWeekend) {
      // Find upcoming Saturday
      const dayOfWeek = now.day();
      const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
      targetDate = now.add(daysUntilSaturday, 'day').format('YYYY-MM-DD');
      if (!targetTime) targetTime = '09:00';
    } else if (isNextWeek) {
      // Upcoming Monday
      const dayOfWeek = now.day();
      const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
      targetDate = now.add(daysUntilMonday, 'day').format('YYYY-MM-DD');
      if (!targetTime) targetTime = '09:00';
    } else if (isTonight) {
      targetDate = now.format('YYYY-MM-DD');
      if (!targetTime) targetTime = '20:00';
    } else if (isThisAfternoon) {
      targetDate = now.format('YYYY-MM-DD');
      if (!targetTime) targetTime = '16:00';
    }

    // 5. Clean activity title from raw text
    let activity = text
      .replace(/\b(?:nex|bot|tolong|bantu|coba)\b/gi, '')
      .replace(/\b(?:ingatkan|ingetin|remind|jadwalkan|masukkan\s*ke\s*jadwal|bikin\s*pengingat)(?:\s*(?:saya|aku|gw))?\b/gi, '')
      .replace(/\b(?:besok\s*(?:pagi|siang|sore|malam)?|lusa|nanti|sebentar\s*lagi|sore\s*ini|malam\s*ini|akhir\s*pekan|weekend|minggu\s*depan)\b/gi, '')
      .replace(/\b(?:jam|pukul|pkl\.?)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:pagi|siang|sore|malam)?\b/gi, '')
      .replace(/\b(?:\d+|satu|dua|tiga)\s*(?:menit|jam)\s*lagi\b/gi, '')
      .replace(/\b(?:setiap|tiap)\s*(?:hari|senin|selasa|rabu|kamis|jumat|sabtu|minggu|bulan)\b/gi, '')
      .replace(/\b(?:untuk|buat|tentang)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!activity) {
      activity = 'Aktivitas terjadwal';
    } else {
      activity = activity.charAt(0).toUpperCase() + activity.slice(1);
    }

    // 6. Ambiguity check (Section 2: If time is ambiguous like "Nanti ingatkan...", bot MUST ask clarification)
    const isAmbiguousLater = /\b(?:nanti|sebentar\s*lagi)\b/i.test(clean) && !targetTime && !minuteOffsetMatch && !hourOffsetMatch;
    const isNoTimeSpecified = !targetTime;

    if (isAmbiguousLater || (isNoTimeSpecified && !isTomorrow && !isDayAfterTomorrow && !isTonight && !isThisAfternoon && !isWeekend && !isNextWeek)) {
      return {
        requiresClarification: true,
        activity,
        targetDate,
        repeat,
        clarificationQuestion: `Baik, mau saya ingatkan jam berapa untuk *${activity}*?`
      };
    }

    return {
      requiresClarification: false,
      activity,
      dueDate: targetDate,
      dueTime: targetTime || '09:00',
      repeat,
      repeatDay
    };
  }

  /**
   * Create new reminder and save persistently.
   */
  createReminder({
    activity,
    dueDate,
    dueTime,
    repeat = 'none',
    repeatDay = null,
    priority = 'medium',
    owner = 'owner',
    notes = ''
  }) {
    if (!activity || !dueTime) return null;

    const id = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newRem = {
      id,
      activity: activity.trim(),
      dueDate: dueDate || getNow().format('YYYY-MM-DD'),
      dueTime: dueTime.trim(),
      repeat: repeat || 'none',
      repeatDay: repeatDay || null,
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      status: ACTIVITY_STATUS.SCHEDULED,
      notifiedAt: null,
      confirmedAt: null,
      confirmationAnswer: null,
      rescheduledTo: null,
      skipReason: null,
      retryCount: 0,
      maxRetries: 1, // At most 1 gentle follow-up reminder
      owner: owner || 'owner',
      notes: notes || '',
      createdAt: getNow().format('YYYY-MM-DD HH:mm:ss')
    };

    this.reminders.push(newRem);
    this.saveReminders();

    // Also sync to RoutineManager daily schedule if it's for today
    if (this.routineManager && newRem.dueDate === getNow().format('YYYY-MM-DD')) {
      try {
        this.routineManager.addCustomActivity({
          name: newRem.activity,
          time: newRem.dueTime,
          priority: newRem.priority,
          frequency: newRem.repeat,
          notes: newRem.notes || 'Pengingat otomatis NEX'
        });
      } catch (err) {
        console.warn('[ReminderManager] Sync to RoutineManager failed:', err.message);
      }
    }

    console.log(`[ReminderManager] ✅ Created reminder: "${newRem.activity}" at ${newRem.dueDate} ${newRem.dueTime} [${newRem.status}]`);
    return newRem;
  }

  /**
   * Modify existing reminder in-place (no duplicates).
   */
  modifyReminder(idOrActivity, updates = {}) {
    const rem = this.findReminder(idOrActivity);
    if (!rem) return { success: false, message: 'Pengingat tidak ditemukan.' };

    const oldTime = rem.dueTime;
    const oldDate = rem.dueDate;

    if (updates.newTime) rem.dueTime = updates.newTime;
    if (updates.newDate) rem.dueDate = updates.newDate;
    if (updates.repeat) rem.repeat = updates.repeat;
    if (updates.activity) rem.activity = updates.activity;
    if (updates.status) rem.status = updates.status;

    if (updates.newTime || updates.newDate) {
      rem.status = ACTIVITY_STATUS.RESCHEDULED;
      rem.rescheduledTo = `${rem.dueDate} ${rem.dueTime}`;
      rem.notifiedAt = null; // Re-arm reminder notification
      rem.retryCount = 0;
    }

    this.saveReminders();
    console.log(`[ReminderManager] 🔄 Modified reminder "${rem.activity}" (${oldDate} ${oldTime} -> ${rem.dueDate} ${rem.dueTime})`);
    return { success: true, reminder: rem, oldTime, oldDate };
  }

  /**
   * Reschedule or postpone reminder ("Tunda satu jam", "Ubah jadi jam 10", "Majukan 30 menit")
   */
  rescheduleReminder(idOrActivity, modificationText) {
    const rem = this.findReminder(idOrActivity);
    if (!rem) return { success: false, message: 'Pengingat tidak ditemukan.' };

    const clean = String(modificationText).toLowerCase();
    const now = getNow();

    // "Tunda satu jam" / "tunda 1 jam"
    const postponeMatch = clean.match(/tunda\s*(\d+|satu|dua|tiga)?\s*jam/i);
    // "Majukan 30 menit"
    const advanceMinMatch = clean.match(/majukan\s*(\d+)\s*menit/i);
    // "Ubah jadi jam 10" / "ganti jam 14.00"
    const changeHourMatch = clean.match(/(?:ubah|ganti|jadikan|pindahkan|geser)\s*(?:ke|jadi|menjadi)?\s*(?:jam|pukul)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?/i);
    // "Ingatkan lagi besok"
    const tomorrowMatch = /besok/i.test(clean);

    let newDueDate = rem.dueDate;
    let newDueTime = rem.dueTime;

    if (postponeMatch) {
      let hrs = 1;
      const val = postponeMatch[1];
      if (val === 'dua') hrs = 2;
      else if (val === 'tiga') hrs = 3;
      else if (val) hrs = parseInt(val, 10) || 1;

      const [h, m] = rem.dueTime.split(':').map(Number);
      const postponedMoment = now.hour(h).minute(m).add(hrs, 'hour');
      newDueTime = postponedMoment.format('HH:mm');
      newDueDate = postponedMoment.format('YYYY-MM-DD');
    } else if (advanceMinMatch) {
      const mins = parseInt(advanceMinMatch[1], 10);
      const [h, m] = rem.dueTime.split(':').map(Number);
      const advancedMoment = now.hour(h).minute(m).subtract(mins, 'minute');
      newDueTime = advancedMoment.format('HH:mm');
    } else if (changeHourMatch) {
      let hour = parseInt(changeHourMatch[1], 10);
      const minute = changeHourMatch[2] ? parseInt(changeHourMatch[2], 10) : 0;
      const period = changeHourMatch[3]?.toLowerCase();

      if (period === 'malam' && hour < 12) hour += 12;
      else if (period === 'sore' && hour < 12 && hour < 6) hour += 12;
      else if (period === 'siang' && hour < 10) hour += 12;

      newDueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } else if (tomorrowMatch) {
      newDueDate = now.add(1, 'day').format('YYYY-MM-DD');
    }

    return this.modifyReminder(rem.id, {
      newDate: newDueDate,
      newTime: newDueTime
    });
  }

  /**
   * Cancel / delete reminder
   */
  cancelReminder(idOrActivity) {
    const rem = this.findReminder(idOrActivity);
    if (!rem) return { success: false, message: 'Pengingat tidak ditemukan.' };

    rem.status = ACTIVITY_STATUS.CANCELLED;
    this.saveReminders();
    console.log(`[ReminderManager] ❌ Cancelled reminder: "${rem.activity}"`);
    return { success: true, reminder: rem };
  }

  /**
   * Handle user confirmation response: "Sudah", "Belum", "Lewati", "Jadwalkan ulang" (Section 3)
   */
  handleConfirmationResponse(userResponseText, userRole = 'owner') {
    const clean = String(userResponseText).toLowerCase().trim();

    // Check if there is an active reminder awaiting confirmation
    const awaitingRem = this.getLastAwaitingConfirmation(userRole);
    if (!awaitingRem) {
      return null;
    }

    // 1. User says SUDAH (Completed)
    const isCompleted = /(?:^|\s)(?:sudah|udah|done|beres|selesai|tuntas|kelar)(?:$|\s|[!.,])/i.test(clean);
    if (isCompleted) {
      awaitingRem.status = ACTIVITY_STATUS.COMPLETED;
      awaitingRem.confirmedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
      awaitingRem.confirmationAnswer = 'sudah';
      this.saveReminders();

      // Sync completed activity with Habit Tracker, Task Manager, and Goals
      this.syncCompletedActivity(awaitingRem);
      this.lastAwaitingConfirmation.delete(userRole);

      return {
        handled: true,
        status: ACTIVITY_STATUS.COMPLETED,
        reminder: awaitingRem,
        message: `Mantap, Bro! Aktivitas *${awaitingRem.activity}* telah ditandai *SELESAI* ✅.\n\nData progres target dan evaluasi harian telah diperbarui secara otomatis.`
      };
    }

    // 2. User says BELUM (Not yet)
    const isNotYet = /(?:^|\s)(?:belum|blm|enggak|nggak|gak|tidak|not\s*yet)(?:$|\s|[!.,])/i.test(clean);
    if (isNotYet) {
      return {
        handled: true,
        status: 'ASK_RESCHEDULE_OR_SKIP',
        reminder: awaitingRem,
        message: `Aktivitas *${awaitingRem.activity}* belum dilakukan.\n\nApakah kamu ingin *menjadwalkan ulang* (tunda waktu) atau *melewatkan* aktivitas ini hari ini? (Ketik *"Jadwalkan ulang"* atau *"Lewati"*).`
      };
    }

    // 3. User says LEWATI (Skip)
    const isSkip = /(?:^|\s)(?:lewati|skip|batalkan|tidak\s*terlaksana|nggak\s*sempat)(?:$|\s|[!.,])/i.test(clean);
    if (isSkip) {
      awaitingRem.status = ACTIVITY_STATUS.SKIPPED;
      awaitingRem.confirmationAnswer = 'lewati';
      awaitingRem.skipReason = clean.replace(/lewati|skip/gi, '').trim() || 'Dilewati pengguna';
      this.saveReminders();
      this.lastAwaitingConfirmation.delete(userRole);

      return {
        handled: true,
        status: ACTIVITY_STATUS.SKIPPED,
        reminder: awaitingRem,
        message: `Baik, aktivitas *${awaitingRem.activity}* dicatat sebagai *TIDAK TERLAKSANA* hari ini. Tetap jaga fokus untuk aktivitas dan prioritas berikutnya!`
      };
    }

    // 4. User says RESCHEDULE
    const isReschedule = /(?:^|\s)(?:jadwalkan\s*ulang|reschedule|tunda|geser|nanti\s*aja)(?:$|\s|[!.,])/i.test(clean);
    if (isReschedule) {
      // Default postpone 1 hour if not specified
      const resResult = this.rescheduleReminder(awaitingRem.id, clean.includes('jam') ? clean : 'tunda 1 jam');
      this.lastAwaitingConfirmation.delete(userRole);

      return {
        handled: true,
        status: ACTIVITY_STATUS.RESCHEDULED,
        reminder: resResult.reminder,
        message: `Siap! Aktivitas *${awaitingRem.activity}* telah dijadwalkan ulang ke pukul *${resResult.reminder.dueTime} WIB*. Saya akan ingatkan kembali nanti.`
      };
    }

    return null;
  }

  syncCompletedActivity(rem) {
    const actLower = rem.activity.toLowerCase();

    // 1. Sync with Habit Tracker
    if (this.routineManager) {
      if (actLower.includes('olahraga') || actLower.includes('workout')) {
        this.routineManager.logHabit({ habit: 'workout', value: rem.activity, notes: 'Konfirmasi pengingat' });
      } else if (actLower.includes('air') || actLower.includes('minum')) {
        this.routineManager.logHabit({ habit: 'water', value: '1', notes: 'Konfirmasi pengingat' });
      } else if (actLower.includes('skincare')) {
        const type = actLower.includes('malam') ? 'skincare_night' : 'skincare_morning';
        this.routineManager.logHabit({ habit: type, value: 'done', notes: 'Konfirmasi pengingat' });
      } else if (actLower.includes('sholat') || actLower.includes('salat')) {
        this.routineManager.logHabit({ habit: 'prayer', value: rem.activity, notes: 'Konfirmasi pengingat' });
      }
      this.routineManager.updateActivityStatus(rem.activity, 'completed');
    }

    // 2. Sync with Task Manager
    if (this.taskManager) {
      this.taskManager.completeTask(rem.activity);
    }

    // 3. Sync with Goal Tracker
    if (this.goalTracker) {
      if (actLower.includes('olahraga') || actLower.includes('workout')) {
        this.goalTracker.updateGoalProgress('olahraga', 1, 'Latihan fisik tuntas');
      }
    }
  }

  /**
   * Retrieve reminders that are due right now (exact minute) and not yet notified
   */
  getRemindersDueNow(currentTimeStr = null, currentDateStr = null) {
    const nowTime = currentTimeStr || getNow().format('HH:mm');
    const nowDate = currentDateStr || getNow().format('YYYY-MM-DD');

    return this.reminders.filter(rem => {
      if (rem.status !== ACTIVITY_STATUS.SCHEDULED && rem.status !== ACTIVITY_STATUS.RESCHEDULED) {
        return false;
      }

      // Check recurring
      if (rem.repeat === 'daily') {
        return rem.dueTime === nowTime && rem.notifiedAt !== `${nowDate} ${nowTime}`;
      }

      return rem.dueDate === nowDate && rem.dueTime === nowTime && !rem.notifiedAt;
    });
  }

  /**
   * Mark reminder as notified and set status to MENUNGGU KONFIRMASI
   */
  markNotified(reminderId, role = 'owner') {
    const rem = this.reminders.find(r => r.id === reminderId);
    if (!rem) return;

    rem.status = ACTIVITY_STATUS.WAITING_CONFIRMATION;
    rem.notifiedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
    this.lastAwaitingConfirmation.set(role, rem);
    this.saveReminders();
    console.log(`[ReminderManager] 🔔 Marked notified: "${rem.activity}" -> ${ACTIVITY_STATUS.WAITING_CONFIRMATION}`);
  }

  getLastAwaitingConfirmation(role = 'owner') {
    return this.lastAwaitingConfirmation.get(role) || null;
  }

  findReminder(idOrActivity) {
    if (!idOrActivity) return null;
    const clean = String(idOrActivity).toLowerCase().trim();
    return this.reminders.find(r => r.id === idOrActivity || r.activity.toLowerCase().includes(clean));
  }

  getTodayRemindersSummary(dateStr = null) {
    const targetDate = dateStr || getNow().format('YYYY-MM-DD');
    const todays = this.reminders.filter(r => r.dueDate === targetDate || r.repeat === 'daily');

    if (todays.length === 0) {
      return 'Tidak ada pengingat khusus yang dijadwalkan hari ini.';
    }

    return todays.map(r => {
      let icon = '📅';
      if (r.status === ACTIVITY_STATUS.COMPLETED) icon = '✅';
      else if (r.status === ACTIVITY_STATUS.SKIPPED) icon = '❌';
      else if (r.status === ACTIVITY_STATUS.RESCHEDULED) icon = '⏳';
      else if (r.status === ACTIVITY_STATUS.WAITING_CONFIRMATION) icon = '⏰';

      return `• [${r.dueTime} WIB] ${r.activity} (${icon} ${r.status})`;
    }).join('\n');
  }

  getEvaluationStats(dateStr = null) {
    const targetDate = dateStr || getNow().format('YYYY-MM-DD');
    const todays = this.reminders.filter(r => r.dueDate === targetDate || r.repeat === 'daily');

    const total = todays.length;
    const completed = todays.filter(r => r.status === ACTIVITY_STATUS.COMPLETED).length;
    const skipped = todays.filter(r => r.status === ACTIVITY_STATUS.SKIPPED).length;
    const rescheduled = todays.filter(r => r.status === ACTIVITY_STATUS.RESCHEDULED).length;
    const unconfirmed = todays.filter(r => r.status === ACTIVITY_STATUS.UNCONFIRMED || r.status === ACTIVITY_STATUS.WAITING_CONFIRMATION).length;

    return {
      total,
      completed,
      skipped,
      rescheduled,
      unconfirmed,
      complianceRate: total > 0 ? `${Math.round((completed / total) * 100)}%` : '100%'
    };
  }
}
