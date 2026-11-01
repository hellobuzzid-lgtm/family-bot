import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

const tasksFilePath = path.join(config.dataDir, 'tasks.json');

export class TaskManager {
  constructor() {
    this.tasks = this.loadTasks();
  }

  loadTasks() {
    try {
      if (!fs.existsSync(tasksFilePath)) {
        return this.getDefaultTasks();
      }
      const raw = fs.readFileSync(tasksFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[TaskManager] Error reading tasks.json, using defaults:', err.message);
      return this.getDefaultTasks();
    }
  }

  saveTasks() {
    try {
      fs.writeFileSync(tasksFilePath, JSON.stringify(this.tasks, null, 2), 'utf-8');
    } catch (err) {
      console.error('[TaskManager] Error saving tasks.json:', err.message);
    }
  }

  addTask({
    title,
    priority = 'medium', // 'high' | 'medium' | 'low'
    category = 'business', // 'business' | 'personal' | 'relationship' | 'health'
    dueDate = '',
    notes = '',
    owner = 'owner'
  }) {
    if (!title) return null;

    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      title: title.trim(),
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      category: category || 'business',
      dueDate: dueDate || getNow().format('YYYY-MM-DD'),
      status: 'pending', // 'pending' | 'in_progress' | 'completed' | 'cancelled'
      notes: notes || '',
      owner: owner || 'owner',
      createdAt: getNow().format('YYYY-MM-DD HH:mm:ss'),
      completedAt: null
    };

    this.tasks.push(newTask);
    this.saveTasks();
    console.log(`[TaskManager] New task added: [${newTask.priority.toUpperCase()}] "${newTask.title}"`);
    return newTask;
  }

  completeTask(idOrTitle) {
    const task = this.findTask(idOrTitle);
    if (!task) return { success: false, message: 'Pekerjaan tidak ditemukan.' };

    task.status = 'completed';
    task.completedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
    this.saveTasks();
    console.log(`[TaskManager] Task completed: "${task.title}"`);
    return { success: true, task };
  }

  rescheduleTask(idOrTitle, newDueDate, reason = '') {
    const task = this.findTask(idOrTitle);
    if (!task) return { success: false, message: 'Pekerjaan tidak ditemukan.' };

    const oldDate = task.dueDate;
    task.dueDate = newDueDate;
    if (reason) {
      task.notes = (task.notes ? task.notes + ' | ' : '') + `Dijadwalkan ulang dari ${oldDate}: ${reason}`;
    }
    this.saveTasks();
    console.log(`[TaskManager] Task rescheduled: "${task.title}" -> ${newDueDate}`);
    return { success: true, task, oldDate };
  }

  deleteTask(idOrTitle) {
    const index = this.tasks.findIndex(t => t.id === idOrTitle || t.title.toLowerCase().includes(String(idOrTitle).toLowerCase()));
    if (index === -1) return { success: false, message: 'Pekerjaan tidak ditemukan.' };

    const deleted = this.tasks.splice(index, 1)[0];
    this.saveTasks();
    console.log(`[TaskManager] Task deleted: "${deleted.title}"`);
    return { success: true, task: deleted };
  }

  findTask(idOrTitle) {
    if (!idOrTitle) return null;
    const clean = String(idOrTitle).toLowerCase().trim();
    return this.tasks.find(t => t.id === idOrTitle || t.title.toLowerCase().includes(clean));
  }

  getPendingTasks(owner = 'owner') {
    return this.tasks.filter(t => t.status === 'pending' && (t.owner === owner || t.owner === 'shared'));
  }

  getTopPriorities(count = 3, owner = 'owner') {
    const pending = this.getPendingTasks(owner);
    const priorityWeight = { high: 3, medium: 2, low: 1 };
    
    return pending
      .sort((a, b) => {
        const weightDiff = (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
        if (weightDiff !== 0) return weightDiff;
        return a.dueDate.localeCompare(b.dueDate);
      })
      .slice(0, count);
  }

  getCompletedToday(owner = 'owner') {
    const today = getNow().format('YYYY-MM-DD');
    return this.tasks.filter(t => t.status === 'completed' && t.completedAt?.startsWith(today) && (t.owner === owner || t.owner === 'shared'));
  }

  getSummary(owner = 'owner') {
    const pending = this.getPendingTasks(owner);
    const top = this.getTopPriorities(3, owner);
    const completedToday = this.getCompletedToday(owner);

    if (pending.length === 0 && completedToday.length === 0) {
      return 'Belum ada daftar pekerjaan aktif. Semua tugas beres!';
    }

    let summary = `📌 *Daftar Pekerjaan & Prioritas:*\n`;
    if (top.length > 0) {
      summary += `*3 Pekerjaan Paling Penting Hari Ini:*\n` +
        top.map((t, i) => `  ${i + 1}. [${t.priority.toUpperCase()}] ${t.title} (Deadline: ${t.dueDate})`).join('\n') + '\n';
    }

    summary += `• Total pekerjaan tertunda: ${pending.length} tugas\n`;
    summary += `• Tugas diselesaikan hari ini: ${completedToday.length} tugas`;
    return summary;
  }

  getDefaultTasks() {
    const today = getNow().format('YYYY-MM-DD');
    return [
      {
        id: 'task_init_01',
        title: 'Review laporan penjualan & cashflow harian',
        priority: 'high',
        category: 'business',
        dueDate: today,
        status: 'pending',
        notes: 'Pengecekan transaksi dan margin keuntungan',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD HH:mm:ss'),
        completedAt: null
      },
      {
        id: 'task_init_02',
        title: 'Follow-up order & operasional KEYNEX',
        priority: 'high',
        category: 'business',
        dueDate: today,
        status: 'pending',
        notes: 'Pastikan seluruh pesanan dan pelanggan terlayani',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD HH:mm:ss'),
        completedAt: null
      },
      {
        id: 'task_init_03',
        title: 'Olahraga & latihan fisik sore (30-45 menit)',
        priority: 'medium',
        category: 'health',
        dueDate: today,
        status: 'pending',
        notes: 'Konsistensi menjaga kebugaran tubuh',
        owner: 'owner',
        createdAt: getNow().format('YYYY-MM-DD HH:mm:ss'),
        completedAt: null
      }
    ];
  }
}
