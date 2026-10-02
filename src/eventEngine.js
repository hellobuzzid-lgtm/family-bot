import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { config } from './config.js';

const eventsFilePath = path.join(config.dataDir, 'events.json');

export class EventEngine {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.events = this.loadEvents();
    this.ensureTodayEvent();
  }

  loadEvents() {
    try {
      if (!fs.existsSync(eventsFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(eventsFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[EventEngine] Error reading events.json:', err.message);
      return [];
    }
  }

  saveEvents() {
    try {
      fs.writeFileSync(eventsFilePath, JSON.stringify(this.events, null, 2), 'utf-8');
    } catch (err) {
      console.error('[EventEngine] Failed to save events.json:', err.message);
    }
  }

  getTodayDateString() {
    return dayjs().tz(config.timezone).format('YYYY-MM-DD');
  }

  ensureTodayEvent() {
    const todayStr = this.getTodayDateString();
    const todayEvent = this.events.find(e => e.date === todayStr);

    if (!todayEvent) {
      this.generateNewDailyEvent(todayStr);
    }
  }

  generateNewDailyEvent(todayStr) {
    const now = dayjs().tz(config.timezone);
    const dayOfWeek = now.day(); // 0: Sunday, 1: Monday, ... 6: Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Pick previous event for continuity
    const previousEvent = this.events.length > 0 ? this.events[this.events.length - 1] : null;

    const weekdayTemplates = [
      {
        title: 'Membawa Krayon Baru ke Sekolah',
        story: 'Tadi di sekolah belajar mewarnai pohon dan buah apel. Naya memuji krayon warna hijau yang dipakai rapi.',
        mood: 'Senang',
        friend: 'Naya'
      },
      {
        title: 'Main Kejar-kejaran saat Istirahat',
        story: 'Tadi istirahat kedua main kejar-kejaran sama Rafi di pinggir lapangan. Rafi sempat tersandung daun pisang kering tapi ketawa.',
        mood: 'Gembira',
        friend: 'Rafi'
      },
      {
        title: 'Penghapus Dinosaurus Dika',
        story: 'Dika bawa penghapus baru bentuk kepala dinosaurus T-Rex. Lucu banget dan sempat dimainin kayak boneka di atas meja.',
        mood: 'Ceria & Sedikit Jahil',
        friend: 'Dika'
      },
      {
        title: 'Mendengarkan Dongeng dari Sinta',
        story: 'Sinta bawa buku dongeng tentang tupai yang suka menabung kacang. Bukunya tebal banyak gambarnya.',
        mood: 'Penasaran',
        friend: 'Sinta'
      },
      {
        title: 'Pujian Membaca Lancar dari Bu Rina',
        story: 'Bu Rina manggil ke depan kelas buat membaca cerita pendek di buku tema. Tadi lancar dan dapat tepuk tangan teman sekelas.',
        mood: 'Bangga & Malu-malu',
        friend: 'Bu Rina'
      },
      {
        title: 'Tugas Menempel Kertas Origami',
        story: 'Ada tugas seni budaya menempel potongan origami warna-warni bentuk ikan. Tadi jari kena lem sedikit tapi bersih lagi dicuci.',
        mood: 'Semangat',
        friend: 'Naya'
      },
      {
        title: 'Lupa Bawa Penggaris',
        story: 'Tadi sempat panik waktu Bu Rina suruh bikin garis lurus karena penggaris tertinggal di rumah, untung Rafi minjemin penggarisnya.',
        mood: 'Lega',
        friend: 'Rafi'
      }
    ];

    const weekendTemplates = [
      {
        title: 'Membangun Istana Balok / Lego',
        story: 'Tadi pagi bikin istana besar dari balok susun di ruang tengah, ada garasi mobil mainannya juga.',
        mood: 'Senang & Kreatif',
        friend: null
      },
      {
        title: 'Nonton Kartun Pagi Hari',
        story: 'Pagi tadi nonton kartun seru sambil makan biskuit susu di sofa. Karakter kartunnya lucu banget bikin ketawa.',
        mood: 'Santai & Gembira',
        friend: null
      },
      {
        title: 'Melihat Kucing Belang di Halaman',
        story: 'Ada kucing loreng belang tidur di atas keset teras depan rumah. Tadi sempat dikasih lihat dari jendela.',
        mood: 'Gemes & Bahagia',
        friend: null
      },
      {
        title: 'Menggambar Hadiah untuk Ayah & Ibu',
        story: 'Tadi menggambar di kertas sketsa gambar keluarga bertiga (Ayah, Ibu, dan anak) pegangan tangan di bawah pohon rindang.',
        mood: 'Sayang & Kangen',
        friend: null
      }
    ];

    const list = isWeekend ? weekendTemplates : weekdayTemplates;
    const randomIndex = Math.floor(Math.random() * list.length);
    const chosen = list[randomIndex];

    const newEvent = {
      id: `evt_${Date.now()}`,
      date: todayStr,
      timeOfDay: isWeekend ? 'pagi' : 'siang',
      title: chosen.title,
      story: chosen.story,
      moodEffect: chosen.mood,
      relatedFriend: chosen.friend,
      sharedWithParents: false,
      createdAt: new Date().toISOString()
    };

    this.events.push(newEvent);
    // Keep max 60 days history
    if (this.events.length > 60) {
      this.events = this.events.slice(-60);
    }
    this.saveEvents();

    // Update state
    this.stateManager.updateLastEvent(newEvent.title, newEvent.story);
    this.stateManager.updateMood(chosen.mood, '😊', 8, `Terpengaruh kejadian: ${chosen.title}`);

    // Update friend interaction if applicable
    if (chosen.friend) {
      const state = this.stateManager.getState();
      const friendObj = state.virtualLife.friends.find(f => f.name.toLowerCase() === chosen.friend.toLowerCase());
      if (friendObj) {
        friendObj.lastInteraction = chosen.story;
        this.stateManager.saveState();
      }
    }

    console.log(`[EventEngine] Generated today's virtual event for ${todayStr}: "${chosen.title}"`);
    return newEvent;
  }

  getRecentEventsSummary(limit = 3) {
    if (!this.events || this.events.length === 0) return 'Belum ada kejadian virtual tercatat.';
    const slice = this.events.slice(-limit).reverse();
    return slice.map(e => `• [${e.date} - ${e.title}]: ${e.story}`).join('\n');
  }

  getTodayEvent() {
    const todayStr = this.getTodayDateString();
    return this.events.find(e => e.date === todayStr) || null;
  }

  markTodayEventShared() {
    const todayEvent = this.getTodayEvent();
    if (todayEvent) {
      todayEvent.sharedWithParents = true;
      this.saveEvents();
    }
  }
}
