import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow, parseAmount } from '../utils/formatters.js';

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
      const loaded = JSON.parse(raw);
      return Array.isArray(loaded) ? loaded : this.getDefaultGoals();
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
    type = 'weekly', // 'daily' | 'weekly' | 'monthly' | 'long_term'
    category = 'business', // 'finance' | 'business' | 'health' | 'learning' | 'relationship'
    targetValue = 1,
    currentValue = 0,
    unit = 'kali', // 'kali' | 'rupiah' | 'jam' | 'buku' | 'halaman'
    targetDate = '',
    strategy = '',
    owner = 'owner'
  }) {
    if (!title) return null;

    const parsedTarget = typeof targetValue === 'string' ? parseAmount(targetValue) || 1 : Number(targetValue) || 1;
    const parsedCurrent = typeof currentValue === 'string' ? parseAmount(currentValue) || 0 : Number(currentValue) || 0;

    const newGoal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      title: title.trim(),
      type: ['daily', 'weekly', 'monthly', 'long_term'].includes(type) ? type : 'weekly',
      category: category || 'business',
      targetValue: parsedTarget,
      currentValue: parsedCurrent,
      unit: unit || 'kali',
      targetDate: targetDate || getNow().add(type === 'weekly' ? 7 : 30, 'day').format('YYYY-MM-DD'),
      strategy: strategy || 'Eksekusi harian konsisten',
      status: 'active', // 'active' | 'completed' | 'paused'
      owner: owner || 'owner',
      createdAt: getNow().format('YYYY-MM-DD'),
      progressNotes: [],
      evaluation: null
    };

    this.goals.push(newGoal);
    this.saveGoals();
    console.log(`[GoalTracker] New target added: [${newGoal.type.toUpperCase()}] "${newGoal.title}" (${newGoal.targetValue} ${newGoal.unit})`);

    if (this.googleSheetsService) {
      this.googleSheetsService.appendGoal({
        ...newGoal,
        metrics: `${newGoal.targetValue} ${newGoal.unit} (Strategi: ${newGoal.strategy})`
      }).catch(err => {
        console.warn('[GoalTracker] Failed to sync goal to Google Sheets:', err.message);
      });
    }

    return newGoal;
  }

  findGoal(idOrTitle) {
    if (!idOrTitle) return null;
    const clean = String(idOrTitle).toLowerCase().trim();
    return this.goals.find(g => g.id === idOrTitle || g.title.toLowerCase().includes(clean));
  }

  updateGoalProgress(idOrTitle, incrementOrValue, note = '', isAbsolute = false) {
    const goal = this.findGoal(idOrTitle);
    if (!goal) return { success: false, message: 'Target tidak ditemukan.' };

    const parsedVal = typeof incrementOrValue === 'string' ? parseAmount(incrementOrValue) || 1 : Number(incrementOrValue) || 1;
    const prevVal = goal.currentValue;

    if (isAbsolute) {
      goal.currentValue = parsedVal;
    } else {
      goal.currentValue += parsedVal;
    }

    const progressPct = Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100));

    goal.progressNotes.push({
      date: getNow().format('YYYY-MM-DD HH:mm'),
      note: note || `Update progres dari ${prevVal} menjadi ${goal.currentValue} ${goal.unit}`,
      addedValue: isAbsolute ? goal.currentValue - prevVal : parsedVal
    });

    if (goal.currentValue >= goal.targetValue && goal.status === 'active') {
      goal.status = 'completed';
      goal.evaluation = {
        completedAt: getNow().format('YYYY-MM-DD HH:mm'),
        results: `Target ${goal.title} tercapai (${goal.currentValue}/${goal.targetValue} ${goal.unit})!`,
        lessonsLearned: 'Disiplin dan konsistensi membuahkan hasil.'
      };
      console.log(`🎉 [GoalTracker] Goal COMPLETED: "${goal.title}"`);
    }

    this.saveGoals();
    return { success: true, goal, progressPct };
  }

  completeGoal(idOrTitle, results = '', lessons = '') {
    const goal = this.findGoal(idOrTitle);
    if (!goal) return { success: false, message: 'Target tidak ditemukan.' };

    goal.status = 'completed';
    goal.currentValue = goal.targetValue;
    goal.evaluation = {
      completedAt: getNow().format('YYYY-MM-DD HH:mm'),
      results: results || `Target tercapai penuh (${goal.targetValue} ${goal.unit}).`,
      lessonsLearned: lessons || 'Konsistensi dan eksekusi membawa hasil nyata.'
    };
    this.saveGoals();
    return { success: true, goal };
  }

  /**
   * Identifies lagging goals that need immediate action and returns concrete recommendations
   */
  getLaggingGoals(owner = 'owner') {
    const active = this.goals.filter(g => g.status === 'active' && (g.owner === owner || g.owner === 'shared'));
    const now = getNow();
    const lagging = [];

    for (const g of active) {
      const remainingValue = Math.max(0, g.targetValue - g.currentValue);
      if (remainingValue <= 0) continue;

      const targetDayjs = getNow().isSame(g.targetDate, 'day') ? now : getNow();
      // Calculate remaining days
      const daysLeft = Math.max(1, Math.ceil(now.diff(g.targetDate, 'day') * -1));
      const progressPct = Math.round((g.currentValue / g.targetValue) * 100);

      if (progressPct < 75 && daysLeft <= 4) {
        lagging.push({
          goal: g,
          remainingValue,
          daysLeft,
          progressPct,
          recommendation: `Target ${g.title} (${g.currentValue}/${g.targetValue} ${g.unit}) sisa ${remainingValue} ${g.unit} dalam ${daysLeft} hari. Disarankan jadwalkan ${Math.ceil(remainingValue / daysLeft)} ${g.unit}/hari mulai hari ini.`
        });
      }
    }

    return lagging;
  }

  getActiveGoalsSummary(owner = 'owner') {
    const active = this.goals.filter(g => g.status === 'active' && (g.owner === owner || g.owner === 'shared'));
    if (active.length === 0) {
      return 'Belum ada target aktif yang terdaftar.';
    }

    const typeOrder = ['daily', 'weekly', 'monthly', 'long_term'];
    const typeLabel = {
      daily: 'Target Harian',
      weekly: 'Target Mingguan',
      monthly: 'Target Bulanan',
      long_term: 'Target Jangka Panjang'
    };

    let result = '';
    for (const t of typeOrder) {
      const matching = active.filter(g => g.type === t);
      if (matching.length > 0) {
        result += `*${typeLabel[t]}:*\n`;
        result += matching.map(g => {
          const pct = Math.round((g.currentValue / g.targetValue) * 100);
          return `  • [${g.category.toUpperCase()}] ${g.title}: ${g.currentValue}/${g.targetValue} ${g.unit} (${pct}%) — Deadline: ${g.targetDate}`;
        }).join('\n') + '\n';
      }
    }

    return result.trim();
  }

  getDefaultGoals() {
    return [
      {
        id: 'goal_init_workout',
        title: 'Olahraga & latihan fisik mingguan',
        type: 'weekly',
        category: 'health',
        targetValue: 4,
        currentValue: 0,
        unit: 'kali seminggu',
        targetDate: getNow().endOf('week').format('YYYY-MM-DD'),
        strategy: 'Jadwalkan setiap sore 17:00 (Senin, Rabu, Jumat, Minggu)',
        status: 'active',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD'),
        progressNotes: [],
        evaluation: null
      },
      {
        id: 'goal_init_keynex',
        title: 'Omzet & ekspansi bisnis KEYNEX',
        type: 'monthly',
        category: 'business',
        targetValue: 30000000,
        currentValue: 0,
        unit: 'rupiah',
        targetDate: getNow().endOf('month').format('YYYY-MM-DD'),
        strategy: 'Meningkatkan promosi, pelayanan pesanan, dan pencatatan kas rapi',
        status: 'active',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD'),
        progressNotes: [],
        evaluation: null
      },
      {
        id: 'goal_init_savings',
        title: 'Tabungan persiapan pernikahan mandiri',
        type: 'long_term',
        category: 'relationship',
        targetValue: 50000000,
        currentValue: 5000000,
        unit: 'rupiah',
        targetDate: getNow().add(6, 'month').format('YYYY-MM-DD'),
        strategy: 'Alokasi minimal 20-30% keuntungan bisnis dan pendapatan ke tabungan rencana',
        status: 'active',
        owner: 'shared',
        createdAt: getNow().format('YYYY-MM-DD'),
        progressNotes: [],
        evaluation: null
      }
    ];
  }
}
