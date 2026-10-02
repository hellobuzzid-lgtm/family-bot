import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const stateFilePath = path.join(config.dataDir, 'state.json');

export class StateManager {
  constructor() {
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (!fs.existsSync(stateFilePath)) {
        throw new Error('state.json does not exist');
      }
      const raw = fs.readFileSync(stateFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[StateManager] Error reading state.json, using defaults:', err.message);
      return this.getDefaultState();
    }
  }

  saveState() {
    try {
      fs.writeFileSync(stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StateManager] Failed to save state.json:', err.message);
    }
  }

  getState() {
    return this.state;
  }

  getNow() {
    return dayjs().tz(config.timezone);
  }

  getCurrentTimeString() {
    const now = this.getNow();
    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthsIndo = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const dayName = daysIndo[now.day()];
    const date = now.date();
    const monthName = monthsIndo[now.month()];
    const year = now.year();
    const time = now.format('HH:mm');

    return `${dayName}, ${date} ${monthName} ${year}, Pukul ${time} WIB`;
  }

  getCurrentActivity() {
    const now = this.getNow();
    const hour = now.hour();
    const minute = now.minute();
    const timeValue = hour + minute / 60;
    const dayOfWeek = now.day(); // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (timeValue >= 21.0 || timeValue < 6.0) {
      return {
        phase: 'tidur',
        name: 'Tidur Malam',
        description: 'Sedang tidur lelap di kamar. Tidak aktif kecuali dibangunkan.',
        canChatSpontaneously: false,
        isSleeping: true,
        isSchool: false
      };
    } else if (timeValue >= 6.0 && timeValue < 7.0) {
      return {
        phase: 'pagi',
        name: 'Bangun Pagi & Persiapan',
        description: isWeekend
          ? 'Bangun santai, nonton kartun hari libur dan sarapan'
          : 'Bangun pagi, mandi, sarapan roti/nasi goreng, siap-siap ke sekolah SD Pelangi',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else if (timeValue >= 7.0 && timeValue < 12.0) {
      if (isWeekend) {
        return {
          phase: 'libur_pagi',
          name: 'Kegiatan Hari Libur Pagi',
          description: 'Sedang asik main di rumah, menggambar, atau membantu beres-beres mainan',
          canChatSpontaneously: true,
          isSleeping: false,
          isSchool: false
        };
      }
      return {
        phase: 'sekolah',
        name: 'Sedang di Sekolah SD Pelangi',
        description: 'Belajar di kelas bersama Bu Rina dan teman-teman (Rafi, Dika, Naya, Sinta). Kalau jam istirahat (sekitar 09:30-10:00) bisa cerita sedikit.',
        canChatSpontaneously: (timeValue >= 9.5 && timeValue <= 10.0),
        isSleeping: false,
        isSchool: true
      };
    } else if (timeValue >= 12.0 && timeValue < 13.5) {
      return {
        phase: 'siang',
        name: 'Pulang & Istirahat Siang',
        description: 'Baru pulang sekolah, lepas sepatu, makan siang, ganti baju santai',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else if (timeValue >= 13.5 && timeValue < 15.0) {
      return {
        phase: 'santai_siang',
        name: 'Aktivitas Ringan Siang',
        description: 'Santai di rumah, rebahan, membaca buku dongeng, atau mewarnai',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else if (timeValue >= 15.0 && timeValue < 17.5) {
      return {
        phase: 'sore_main',
        name: 'Waktu Bermain Sore',
        description: 'Bermain di halaman / teras, main sepeda kecil, atau main balok lego',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else if (timeValue >= 17.5 && timeValue < 18.5) {
      return {
        phase: 'mandi_makan',
        name: 'Mandi Sore & Makan Malam',
        description: 'Sudah wangi sehabis mandi, makan malam, santai di ruang tengah',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else if (timeValue >= 18.5 && timeValue < 20.0) {
      return {
        phase: 'malam_keluarga',
        name: 'Waktu Bersama Keluarga',
        description: 'Waktu paling hangat untuk ngobrol sama Ayah dan Ibu di grup, cerita seharian',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    } else {
      return {
        phase: 'persiapan_tidur',
        name: 'Persiapan Tidur',
        description: 'Mulai mengantuk, cuci muka, sikat gigi, siap-siap naik ke kasur',
        canChatSpontaneously: true,
        isSleeping: false,
        isSchool: false
      };
    }
  }

  isSleeping() {
    return this.getCurrentActivity().isSleeping;
  }

  isSchool() {
    return this.getCurrentActivity().isSchool;
  }

  updateMood(moodName, emoji = '😊', intensity = 7, reason = '') {
    this.state.mood = {
      current: moodName,
      emoji: emoji,
      intensity: intensity,
      reason: reason || this.state.mood.reason,
      updatedAt: new Date().toISOString()
    };
    this.saveState();
  }

  updateActivity(activityText) {
    this.state.virtualLife.currentActivity = activityText;
    this.saveState();
  }

  updateLastEvent(title, description) {
    this.state.virtualLife.lastEvent = {
      title,
      description,
      timestamp: new Date().toISOString()
    };
    this.saveState();
  }

  updateTelemetry(key, value) {
    if (!this.state.telemetry) this.state.telemetry = {};
    this.state.telemetry[key] = value;
    this.saveState();
  }

  recordMessageSent() {
    const nowIso = new Date().toISOString();
    this.updateTelemetry('lastMessageSentAt', nowIso);
    this.updateTelemetry('lastActiveAt', nowIso);
    this.state.telemetry.totalMessagesSent = (this.state.telemetry.totalMessagesSent || 0) + 1;
    this.saveState();
  }

  recordInteraction() {
    const nowIso = new Date().toISOString();
    this.updateTelemetry('lastActiveAt', nowIso);
    this.state.telemetry.totalInteractions = (this.state.telemetry.totalInteractions || 0) + 1;
    this.saveState();
  }

  recordSpontaneousMessage() {
    const nowIso = new Date().toISOString();
    this.updateTelemetry('lastSpontaneousMessageAt', nowIso);
    this.recordMessageSent();
  }

  // Pocket Money & Savings Management
  addPocketMoney(amount, reason = 'Diberi uang jajan oleh orang tua') {
    const parsed = Math.max(0, parseInt(amount, 10) || 0);
    this.state.finances.pocketMoneyBalance += parsed;
    this.state.finances.transactionHistory.unshift({
      id: `tx_${Date.now()}`,
      type: 'income',
      amount: parsed,
      target: 'pocketMoney',
      description: reason,
      timestamp: new Date().toISOString()
    });
    // Keep transaction history limited to 50 items
    if (this.state.finances.transactionHistory.length > 50) {
      this.state.finances.transactionHistory.pop();
    }
    this.saveState();
    return this.state.finances.pocketMoneyBalance;
  }

  transferToSavings(amount, reason = 'Menabung ke celengan') {
    const parsed = Math.max(0, parseInt(amount, 10) || 0);
    if (this.state.finances.pocketMoneyBalance < parsed) {
      return { success: false, message: 'Uang jajan di dompet tidak cukup untuk ditabung sejumlah itu.' };
    }
    this.state.finances.pocketMoneyBalance -= parsed;
    this.state.finances.savingsBalance += parsed;
    this.state.finances.transactionHistory.unshift({
      id: `tx_${Date.now()}`,
      type: 'savings_transfer',
      amount: parsed,
      target: 'savings',
      description: reason,
      timestamp: new Date().toISOString()
    });
    this.saveState();
    return {
      success: true,
      pocketMoneyBalance: this.state.finances.pocketMoneyBalance,
      savingsBalance: this.state.finances.savingsBalance,
      target: this.state.finances.savingsTarget
    };
  }

  spendPocketMoney(amount, reason = 'Beli jajan / barang virtual') {
    const parsed = Math.max(0, parseInt(amount, 10) || 0);
    if (this.state.finances.pocketMoneyBalance < parsed) {
      return { success: false, message: 'Uang jajan tidak cukup.' };
    }
    this.state.finances.pocketMoneyBalance -= parsed;
    this.state.finances.transactionHistory.unshift({
      id: `tx_${Date.now()}`,
      type: 'expense',
      amount: parsed,
      target: 'pocketMoney',
      description: reason,
      timestamp: new Date().toISOString()
    });
    this.saveState();
    return { success: true, balance: this.state.finances.pocketMoneyBalance };
  }

  canAskForMoney() {
    const lastAsked = this.state.finances.lastMoneyRequest;
    if (!lastAsked) return true;
    const lastDate = dayjs(lastAsked);
    const now = dayjs();
    // At least 3 days between requests
    return now.diff(lastDate, 'day') >= 3;
  }

  recordMoneyRequest() {
    this.state.finances.lastMoneyRequest = new Date().toISOString();
    this.saveState();
  }

  formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(amount || 0);
  }

  getDefaultState() {
    return {
      identity: {
        name: config.childName,
        age: 6,
        gender: 'perempuan',
        birthday: '2020-05-15',
        fatherName: config.fatherName,
        motherName: config.motherName
      },
      mood: {
        current: 'Ceria',
        emoji: '😊',
        intensity: 8,
        reason: 'Senang bersama keluarga',
        updatedAt: new Date().toISOString()
      },
      virtualLife: {
        school: {
          name: 'SD Pelangi',
          grade: 'Kelas 1B',
          teacher: 'Bu Rina',
          favoriteSubject: 'Menggambar dan Olahraga',
          subjects: ['Tematik', 'Matematika Dasar', 'Bahasa Indonesia', 'Seni Budaya', 'PJOK']
        },
        friends: [
          { name: 'Rafi', personality: 'Aktif, main bola', lastInteraction: 'Main oper bola', relationshipLevel: 'Sahabat dekat' },
          { name: 'Dika', personality: 'Suka game, jahil', lastInteraction: 'Pinjam pensil', relationshipLevel: 'Teman sekelas' },
          { name: 'Naya', personality: 'Suka gambar, ramah', lastInteraction: 'Gambar bareng', relationshipLevel: 'Teman sebangku' },
          { name: 'Sinta', personality: 'Suka baca buku', lastInteraction: 'Cerita dongeng', relationshipLevel: 'Teman dekat' }
        ],
        hobbies: ['menggambar', 'main lego', 'nonton kartun'],
        currentActivity: 'Santai di rumah',
        lastEvent: {
          title: 'Hari baru',
          description: 'Memulai hari dengan semangat',
          timestamp: new Date().toISOString()
        }
      },
      finances: {
        pocketMoneyBalance: 20000,
        savingsBalance: 75000,
        savingsTarget: 300000,
        targetItem: 'Set Krayon 48 Warna & Buku Sketsa Tebal',
        lastMoneyRequest: null,
        transactionHistory: []
      },
      telemetry: {
        lastActiveAt: null,
        lastMessageSentAt: null,
        lastSpontaneousMessageAt: null,
        totalMessagesSent: 0,
        totalInteractions: 0
      }
    };
  }
}
