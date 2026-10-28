import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

const goalsFilePath = path.join(config.dataDir, 'goals.json');

export class GoalTracker {
  constructor(googleSheetsService = null) {
    this.googleSheetsService = googleSheetsService;
    this.goals = this.loadGoals();
  }

  setGoogleSheetsService(service) {
    this.googleSheetsService = service;
  }

  loadGoals() {
    try {
      if (!fs.existsSync(goalsFilePath)) {
        return this.getDefaultGoals();
      }
      const raw = fs.readFileSync(goalsFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[GoalTracker] Error reading goals.json, using defaults:', err.message);
      return this.getDefaultGoals();
    }
  }

  saveGoals() {
    try {
      fs.writeFileSync(goalsFilePath, JSON.stringify(this.goals, null, 2), 'utf-8');
    } catch (err) {
      console.error('[GoalTracker] Error saving goals.json:', err.message);
    }
  }

  addGoal({
    title,
    category = 'business', // 'finance' | 'business' | 'health' | 'learning' | 'relationship'
    targetDate = '',
    metrics = '',
    strategy = '',
    owner = 'owner'
  }) {
    if (!title) return null;

    const newGoal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      title: title.trim(),
      category: category || 'business',
      targetDate: targetDate || getNow().add(1, 'month').format('YYYY-MM-DD'),
      metrics: metrics || 'Selesai tepat waktu',
      strategy: strategy || 'Eksekusi harian konsisten',
      status: 'active', // 'active' | 'completed' | 'paused'
      owner: owner || 'owner',
      createdAt: getNow().format('YYYY-MM-DD'),
      progressNotes: [],
      evaluation: null
    };

    this.goals.push(newGoal);
    this.saveGoals();
    console.log(`[GoalTracker] New target added: "${newGoal.title}" (${newGoal.category})`);

    if (this.googleSheetsService) {
      this.googleSheetsService.appendGoal(newGoal).catch(err => {
        console.warn('[GoalTracker] Failed to sync goal to Google Sheets:', err.message);
      });
    }

    return newGoal;
  }

  updateGoalProgress(id, note) {
    const goal = this.goals.find(g => g.id === id || g.title.toLowerCase().includes(String(id).toLowerCase()));
    if (!goal) return { success: false, message: 'Target tidak ditemukan.' };

    goal.progressNotes.push({
      date: getNow().format('YYYY-MM-DD HH:mm'),
      note
    });
    this.saveGoals();
    return { success: true, goal };
  }

  completeGoal(id, results = '', lessons = '') {
    const goal = this.goals.find(g => g.id === id || g.title.toLowerCase().includes(String(id).toLowerCase()));
    if (!goal) return { success: false, message: 'Target tidak ditemukan.' };

    goal.status = 'completed';
    goal.evaluation = {
      completedAt: getNow().format('YYYY-MM-DD HH:mm'),
      results: results || 'Target tercapai.',
      lessonsLearned: lessons || 'Konsistensi membawa hasil.'
    };
    this.saveGoals();
    return { success: true, goal };
  }

  getActiveGoalsSummary(owner = 'owner') {
    const active = this.goals.filter(g => g.status === 'active' && (g.owner === owner || g.owner === 'shared'));
    if (active.length === 0) {
      return 'Belum ada target aktif yang terdaftar.';
    }

    return active.map(g =>
      `• [${g.category.toUpperCase()}] ${g.title} (Target: ${g.targetDate} | Tolok Ukur: ${g.metrics})`
    ).join('\n');
  }

  getDefaultGoals() {
    return [
      {
        id: 'goal_init_01',
        title: 'Membangun Bisnis & Disiplin Finansial',
        category: 'business',
        targetDate: getNow().add(3, 'month').format('YYYY-MM-DD'),
        metrics: 'Omzet bertumbuh dan cashflow positif setiap bulan',
        strategy: 'Fokus penjualan dan pencatatan kas harian',
        status: 'active',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD'),
        progressNotes: [],
        evaluation: null
      },
      {
        id: 'goal_init_02',
        title: 'Persiapan Membangun Rumah Tangga Mandiri',
        category: 'relationship',
        targetDate: getNow().add(6, 'month').format('YYYY-MM-DD'),
        metrics: 'Kesiapan mental, kesepakatan nilai bersama, dan tabungan pernikahan',
        strategy: 'Komunikasi terbuka dan menabung rutin',
        status: 'active',
        owner: 'shared',
        createdAt: getNow().format('YYYY-MM-DD'),
        progressNotes: [],
        evaluation: null
      }
    ];
  }
}
