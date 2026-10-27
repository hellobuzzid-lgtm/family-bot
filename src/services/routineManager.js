import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';
import { getPrayerTimes } from '../utils/prayerTimes.js';

const routinesFilePath = path.join(config.dataDir, 'routines.json');

export class RoutineManager {
  constructor() {
    this.data = this.loadData();
    this.ensureToday();
  }

  loadData() {
    try {
      if (!fs.existsSync(routinesFilePath)) {
        return this.getDefaultData();
      }
      const raw = fs.readFileSync(routinesFilePath, 'utf-8');
      return JSON.parse(raw);
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
      if (this.data.currentDate && this.data.todayRoutines) {
        this.data.history[this.data.currentDate] = { ...this.data.todayRoutines };
      }
      this.data.currentDate = todayStr;
      this.data.todayRoutines = this.getFreshDailyRoutines();
      this.saveData();
    }
  }

  logHabit({ habit, value, notes = '' }) {
    this.ensureToday();
    const r = this.data.todayRoutines;
    const nowTime = getNow().format('HH:mm');
    const h = (habit || '').toLowerCase().trim();

    if (h.includes('prayer') || h.includes('salat') || h.includes('sholat')) {
      const p = String(value).toLowerCase();
      if (p.includes('subuh')) r.prayers.subuh = true;
      if (p.includes('dzuhur') || p.includes('zuhur')) r.prayers.dzuhur = true;
      if (p.includes('ashar') || p.includes('asar')) r.prayers.ashar = true;
      if (p.includes('maghrib')) r.prayers.maghrib = true;
      if (p.includes('isya')) r.prayers.isya = true;
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
    } else if (h.includes('skincare_morning') || (h.includes('skincare') && h.includes('pagi'))) {
      r.skincare.morning = true;
    } else if (h.includes('skincare_night') || (h.includes('skincare') && (h.includes('malam') || h.includes('malem')))) {
      r.skincare.night = true;
    } else if (h.includes('workout') || h.includes('olahraga')) {
      r.workout.completed = true;
      r.workout.type = String(value || notes || 'Latihan fisik');
    } else if (h.includes('learning') || h.includes('belajar')) {
      r.learning.completed = true;
      r.learning.topic = String(value || notes || 'Keahlian baru');
      r.learning.minutes = parseInt(String(notes).replace(/\D/g, ''), 10) || 25;
    } else if (h.includes('sleep') || h.includes('tidur')) {
      r.sleep.bedTime = nowTime;
    }

    this.saveData();
    console.log(`[RoutineManager] Habit logged: ${habit} = ${value} (${notes})`);
    return r;
  }

  getPrayerTimesToday() {
    return getPrayerTimes(getNow());
  }

  getDailyRoutinesSummary() {
    this.ensureToday();
    const r = this.data.todayRoutines;
    const pt = this.getPrayerTimesToday();

    const prayerStatus = [
      `Subuh (${pt.subuh}): ${r.prayers.subuh ? '✅ Sudah' : '⏳ Belum'}`,
      `Dzuhur (${pt.dzuhur}): ${r.prayers.dzuhur ? '✅ Sudah' : '⏳ Belum'}`,
      `Ashar (${pt.ashar}): ${r.prayers.ashar ? '✅ Sudah' : '⏳ Belum'}`,
      `Maghrib (${pt.maghrib}): ${r.prayers.maghrib ? '✅ Sudah' : '⏳ Belum'}`,
      `Isya (${pt.isya}): ${r.prayers.isya ? '✅ Sudah' : '⏳ Belum'}`
    ].join(' | ');

    return `
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
    return {
      currentDate: getNow().format('YYYY-MM-DD'),
      todayRoutines: this.getFreshDailyRoutines(),
      history: {}
    };
  }
}
