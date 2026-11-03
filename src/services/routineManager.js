import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';
import { getPrayerTimes } from '../utils/prayerTimes.js';

const routinesFilePath = path.join(config.dataDir, 'routines.json');

export class RoutineManager {
  constructor(googleSheetsService = null) {
    this.googleSheetsService = googleSheetsService;
    this.data = this.loadData();
    this.ensureToday();
  }

  setGoogleSheetsService(service) {
    this.googleSheetsService = service;
  }

  loadData() {
    try {
      if (!fs.existsSync(routinesFilePath)) {
        return this.getDefaultData();
      }
      const raw = fs.readFileSync(routinesFilePath, 'utf-8');
      const loaded = JSON.parse(raw);
      return {
        currentDate: loaded.currentDate || getNow().format('YYYY-MM-DD'),
        todayRoutines: { ...this.getFreshDailyRoutines(), ...(loaded.todayRoutines || {}) },
        scheduleToday: Array.isArray(loaded.scheduleToday) ? loaded.scheduleToday : this.getDefaultDailySchedule(),
        history: loaded.history || {}
      };
    } catch (err) {
      console.error('[RoutineManager] Error reading routines.json, using defaults:', err.message);
      return this.getDefaultData();
    }
  }

  saveData() {
    try {
      fs.writeFileSync(routinesFilePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RoutineManager] Error saving routines.json:', err.message);
    }
  }

  getTodayDateString() {
    return getNow().format('YYYY-MM-DD');
  }

  ensureToday() {
    const todayStr = this.getTodayDateString();
    if (!this.data.history) this.data.history = {};

    if (this.data.currentDate !== todayStr) {
      // Archive yesterday if exists
      if (this.data.currentDate && (this.data.todayRoutines || this.data.scheduleToday)) {
        this.data.history[this.data.currentDate] = {
          routines: { ...this.data.todayRoutines },
          schedule: [...(this.data.scheduleToday || [])],
          compliance: this.calculateCompliance(this.data.scheduleToday || [])
        };
      }
      this.data.currentDate = todayStr;
      this.data.todayRoutines = this.getFreshDailyRoutines();
      this.data.scheduleToday = this.getDefaultDailySchedule(todayStr);
      this.saveData();
    }
  }

  getDefaultDailySchedule(dateStr = '') {
    const d = dateStr || this.getTodayDateString();
    const pt = this.getPrayerTimesToday();

    return [
      {
        id: `sch_${d}_subuh`,
        name: 'Bangun tidur & Sholat Subuh',
        time: pt.subuh || '04:30',
        duration: 30,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Wajib awal hari'
      },
      {
        id: `sch_${d}_water`,
        name: 'Minum air putih & Peregangan tubuh',
        time: '05:15',
        duration: 15,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Target 1-2 gelas pagi'
      },
      {
        id: `sch_${d}_mandi`,
        name: 'Mandi & Skincare pagi (Sunscreen)',
        time: '06:00',
        duration: 30,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Perawatan wajah pagi'
      },
      {
        id: `sch_${d}_briefing`,
        name: 'Sarapan sehat & Daily Briefing',
        time: '06:30',
        duration: 30,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Review rencana harian bersama NEX'
      },
      {
        id: `sch_${d}_work_morning`,
        name: 'Memulai pekerjaan utama / Deep work',
        time: '08:00',
        duration: 210,
        frequency: 'weekdays',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Fokus tuntaskan 3 prioritas bisnis/pekerjaan'
      },
      {
        id: `sch_${d}_dzuhur`,
        name: 'Sholat Dzuhur & Makan siang / Istirahat',
        time: pt.dzuhur || '11:51',
        duration: 60,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Istirahat fisik & ibadah'
      },
      {
        id: `sch_${d}_work_afternoon`,
        name: 'Operasional bisnis & Follow-up pekerjaan',
        time: '13:00',
        duration: 120,
        frequency: 'weekdays',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Eksekusi pesanan, vendor, dan koordinasi'
      },
      {
        id: `sch_${d}_ashar`,
        name: 'Sholat Ashar & Rehat sejenak',
        time: pt.ashar || '15:10',
        duration: 30,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Waktu jeda sore'
      },
      {
        id: `sch_${d}_workout`,
        name: 'Olahraga / Latihan fisik sore',
        time: '17:00',
        duration: 45,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Workout menjaga stamina'
      },
      {
        id: `sch_${d}_maghrib`,
        name: 'Sholat Maghrib & Makan malam',
        time: pt.maghrib || '17:56',
        duration: 60,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Ibadah dan makan malam bergizi'
      },
      {
        id: `sch_${d}_isya`,
        name: 'Sholat Isya',
        time: pt.isya || '19:07',
        duration: 30,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Kewajiban malam'
      },
      {
        id: `sch_${d}_learning`,
        name: 'Belajar / Membaca / Review target',
        time: '19:45',
        duration: 60,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Pengembangan diri 30-60 menit'
      },
      {
        id: `sch_${d}_skincare_night`,
        name: 'Skincare malam (Cuci muka & Pelembap)',
        time: '21:00',
        duration: 15,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Perawatan kulit sebelum tidur'
      },
      {
        id: `sch_${d}_eval`,
        name: 'Daily Evaluation bersama NEX',
        time: '21:30',
        duration: 30,
        frequency: 'daily',
        priority: 'high',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Evaluasi pencapaian, rutinitas, dan cashflow'
      },
      {
        id: `sch_${d}_sleep`,
        name: 'Relaksasi & Persiapan tidur',
        time: '22:15',
        duration: 45,
        frequency: 'daily',
        priority: 'medium',
        status: 'scheduled',
        date: d,
        completedAt: null,
        notes: 'Tidur berkualitas 7-8 jam'
      }
    ];
  }

  // --- SCHEDULE & ACTIVITY MANAGEMENT ---
  getScheduleToday() {
    this.ensureToday();
    return this.data.scheduleToday || [];
  }

  findActivity(idOrName) {
    if (!idOrName) return null;
    this.ensureToday();
    const clean = String(idOrName).toLowerCase().trim();
    return this.data.scheduleToday.find(a =>
      a.id === idOrName ||
      a.id.toLowerCase().includes(clean) ||
      a.name.toLowerCase().includes(clean)
    );
  }

  addCustomActivity({ name, time, duration = 30, priority = 'medium', frequency = 'daily', notes = '' }) {
    this.ensureToday();
    if (!name || !time) return null;

    const newAct = {
      id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: name.trim(),
      time: time.trim(),
      duration: Number(duration) || 30,
      frequency: frequency || 'daily',
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      status: 'scheduled',
      date: this.getTodayDateString(),
      completedAt: null,
      notes: notes || ''
    };

    this.data.scheduleToday.push(newAct);
    // Sort schedule by time
    this.data.scheduleToday.sort((a, b) => a.time.localeCompare(b.time));
    this.saveData();

    console.log(`[RoutineManager] Custom activity added: "${newAct.name}" at ${newAct.time}`);
    return newAct;
  }

  updateActivityStatus(idOrName, status = 'completed', notes = '') {
    this.ensureToday();
    const act = this.findActivity(idOrName);
    if (!act) return { success: false, message: 'Aktivitas tidak ditemukan.' };

    act.status = status;
    if (status === 'completed') {
      act.completedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
    }
    if (notes) {
      act.notes = (act.notes ? act.notes + ' | ' : '') + notes;
    }
    this.saveData();
    console.log(`[RoutineManager] Activity status updated: "${act.name}" -> ${status}`);
    return { success: true, activity: act };
  }

  rescheduleActivity(idOrName, newTime, reason = '') {
    this.ensureToday();
    const act = this.findActivity(idOrName);
    if (!act) return { success: false, message: 'Aktivitas tidak ditemukan.' };

    const oldTime = act.time;
    act.time = newTime;
    act.status = 'rescheduled';
    if (reason) {
      act.notes = (act.notes ? act.notes + ' | ' : '') + `Dijadwalkan ulang dari ${oldTime}: ${reason}`;
    }
    this.data.scheduleToday.sort((a, b) => a.time.localeCompare(b.time));
    this.saveData();
    console.log(`[RoutineManager] Activity rescheduled: "${act.name}" ${oldTime} -> ${newTime}`);
    return { success: true, activity: act, oldTime };
  }

  deleteActivity(idOrName) {
    this.ensureToday();
    const index = this.data.scheduleToday.findIndex(a => a.id === idOrName || a.name.toLowerCase().includes(String(idOrName).toLowerCase()));
    if (index === -1) return { success: false, message: 'Aktivitas tidak ditemukan.' };

    const deleted = this.data.scheduleToday.splice(index, 1)[0];
    this.saveData();
    console.log(`[RoutineManager] Activity deleted: "${deleted.name}"`);
    return { success: true, activity: deleted };
  }

  /**
   * Determine the most relevant activity to do right now based on current time
   */
  getNextScheduledActivity(currentTimeStr = null) {
    this.ensureToday();
    const nowTime = currentTimeStr || getNow().format('HH:mm');
    const schedule = this.data.scheduleToday;

    // 1. Check if an activity is currently active or upcoming next
    const pending = schedule.filter(a => a.status === 'scheduled' || a.status === 'rescheduled');
    if (pending.length === 0) {
      return null;
    }

    // First pending activity on or after now
    const upcoming = pending.find(a => a.time >= nowTime);
    if (upcoming) return upcoming;

    // If all times passed, return the first pending one that was missed
    return pending[0];
  }

  calculateCompliance(scheduleList) {
    if (!scheduleList || scheduleList.length === 0) return { total: 0, completed: 0, percentage: 0 };
    const total = scheduleList.length;
    const completed = scheduleList.filter(a => a.status === 'completed').length;
    const percentage = Math.round((completed / total) * 100);
    return { total, completed, percentage };
  }

  getRoutineComplianceReport() {
    this.ensureToday();
    const schedule = this.data.scheduleToday;
    const stats = this.calculateCompliance(schedule);
    const uncompleted = schedule.filter(a => a.status !== 'completed');

    return {
      totalScheduled: stats.total,
      totalCompleted: stats.completed,
      complianceRate: `${stats.percentage}%`,
      completedItems: schedule.filter(a => a.status === 'completed'),
      uncompletedItems: uncompleted
    };
  }

  // --- HABIT LOGGING (SEAMLESS INTEGRATION) ---
  logHabit({ habit, value, notes = '' }) {
    this.ensureToday();
    const r = this.data.todayRoutines;
    const nowTime = getNow().format('HH:mm');
    const h = (habit || '').toLowerCase().trim();

    if (h.includes('prayer') || h.includes('salat') || h.includes('sholat')) {
      const p = String(value).toLowerCase();
      if (p.includes('subuh')) {
        r.prayers.subuh = true;
        this.updateActivityStatus('subuh', 'completed');
      }
      if (p.includes('dzuhur') || p.includes('zuhur')) {
        r.prayers.dzuhur = true;
        this.updateActivityStatus('dzuhur', 'completed');
      }
      if (p.includes('ashar') || p.includes('asar')) {
        r.prayers.ashar = true;
        this.updateActivityStatus('ashar', 'completed');
      }
      if (p.includes('maghrib')) {
        r.prayers.maghrib = true;
        this.updateActivityStatus('maghrib', 'completed');
      }
      if (p.includes('isya')) {
        r.prayers.isya = true;
        this.updateActivityStatus('isya', 'completed');
      }
    } else if (h.includes('smoking') || h.includes('rokok')) {
      const count = parseInt(String(value).replace(/\D/g, ''), 10) || 1;
      r.smoking.count += count;
      r.smoking.logs.push({
        time: nowTime,
        count,
        trigger: notes || 'Kebiasaan'
      });
    } else if (h.includes('water') || h.includes('minum') || h.includes('air')) {
      const glasses = parseInt(String(value).replace(/\D/g, ''), 10) || 1;
      r.waterGlasses += glasses;
      this.updateActivityStatus('water', 'completed');
    } else if (h.includes('skincare_morning') || (h.includes('skincare') && h.includes('pagi'))) {
      r.skincare.morning = true;
      this.updateActivityStatus('mandi', 'completed');
    } else if (h.includes('skincare_night') || (h.includes('skincare') && (h.includes('malam') || h.includes('malem')))) {
      r.skincare.night = true;
      this.updateActivityStatus('skincare malam', 'completed');
    } else if (h.includes('workout') || h.includes('olahraga')) {
      r.workout.completed = true;
      r.workout.type = String(value || notes || 'Latihan fisik');
      this.updateActivityStatus('workout', 'completed');
    } else if (h.includes('learning') || h.includes('belajar')) {
      r.learning.completed = true;
      r.learning.topic = String(value || notes || 'Keahlian baru');
      r.learning.minutes = parseInt(String(notes).replace(/\D/g, ''), 10) || 25;
      this.updateActivityStatus('learning', 'completed');
    } else if (h.includes('sleep') || h.includes('tidur')) {
      r.sleep.bedTime = nowTime;
      this.updateActivityStatus('sleep', 'completed');
    }

    this.saveData();
    console.log(`[RoutineManager] Habit logged: ${habit} = ${value} (${notes})`);

    if (this.googleSheetsService) {
      this.googleSheetsService.appendHabit({ habit, value, notes }).catch(err => {
        console.warn('[RoutineManager] Failed to sync habit to Google Sheets:', err.message);
      });
    }

    return r;
  }

  getPrayerTimesToday() {
    return getPrayerTimes(getNow());
  }

  getDailyRoutinesSummary() {
    this.ensureToday();
    const r = this.data.todayRoutines;
    const pt = this.getPrayerTimesToday();
    const compliance = this.getRoutineComplianceReport();

    const prayerStatus = [
      `Subuh (${pt.subuh}): ${r.prayers.subuh ? '✅ Sudah' : '⏳ Belum'}`,
      `Dzuhur (${pt.dzuhur}): ${r.prayers.dzuhur ? '✅ Sudah' : '⏳ Belum'}`,
      `Ashar (${pt.ashar}): ${r.prayers.ashar ? '✅ Sudah' : '⏳ Belum'}`,
      `Maghrib (${pt.maghrib}): ${r.prayers.maghrib ? '✅ Sudah' : '⏳ Belum'}`,
      `Isya (${pt.isya}): ${r.prayers.isya ? '✅ Sudah' : '⏳ Belum'}`
    ].join(' | ');

    return `
• Tingkat Kepatuhan Jadwal Hari Ini: ${compliance.complianceRate} (${compliance.totalCompleted}/${compliance.totalScheduled} aktivitas selesai)
• Jadwal & Status Salat 5 Waktu Hari Ini:
  ${prayerStatus}
• Kesehatan & Konsumsi:
  * Air Minum: ${r.waterGlasses} gelas tercatat (target: 8 gelas / 2 liter)
  * Konsumsi Rokok Hari Ini: ${r.smoking.count} batang dilaporkan
• Rutinitas Skincare:
  * Pagi (Sunscreen): ${r.skincare.morning ? '✅ Selesai' : '⏳ Belum'}
  * Malam (Cuci Muka & Pelembap): ${r.skincare.night ? '✅ Selesai' : '⏳ Belum'}
• Aktivitas Pengembangan Diri & Fisik:
  * Olahraga: ${r.workout.completed ? `✅ Sudah (${r.workout.type})` : '⏳ Belum'}
  * Belajar / Skill Harian (20-30 mnt): ${r.learning.completed ? `✅ Selesai (${r.learning.topic})` : '⏳ Belum'}
`.trim();
  }

  getFreshDailyRoutines() {
    return {
      prayers: {
        subuh: false,
        dzuhur: false,
        ashar: false,
        maghrib: false,
        isya: false
      },
      waterGlasses: 0,
      meals: {
        breakfast: false,
        lunch: false,
        dinner: false
      },
      smoking: {
        count: 0,
        logs: []
      },
      workout: {
        completed: false,
        type: '',
        durationMinutes: 0
      },
      skincare: {
        morning: false,
        night: false
      },
      learning: {
        completed: false,
        topic: '',
        minutes: 0
      },
      sleep: {
        bedTime: null,
        wakeTime: null,
        hours: 0
      }
    };
  }

  getDefaultData() {
    const today = getNow().format('YYYY-MM-DD');
    return {
      currentDate: today,
      todayRoutines: this.getFreshDailyRoutines(),
      scheduleToday: this.getDefaultDailySchedule(today),
      history: {}
    };
  }
}
