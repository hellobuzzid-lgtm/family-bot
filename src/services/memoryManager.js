import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const memoriesFilePath = path.join(config.dataDir, 'memories.json');

/**
 * 6 Memory Types as strictly mandated by Master Prompt Section 5:
 * 1. Fakta yang sudah diketahui (facts)
 * 2. Keputusan yang sudah disepakati (decisions)
 * 3. Ide yang masih dipertimbangkan (ideas)
 * 4. Rencana yang belum dilaksanakan (plans)
 * 5. Tugas yang sedang berjalan (tasks)
 * 6. Informasi yang masih perlu dikonfirmasi (pending_confirmations)
 */
export const MEMORY_TYPES = {
  FACT: 'facts',
  DECISION: 'decisions',
  IDEA: 'ideas',
  PLAN: 'plans',
  TASK: 'tasks',
  PENDING_CONFIRMATION: 'pending_confirmations'
};

export class MemoryManager {
  constructor() {
    this.memories = this.loadMemories();
  }

  loadMemories() {
    try {
      if (!fs.existsSync(memoriesFilePath)) {
        return this.getDefaultMemories();
      }
      const raw = fs.readFileSync(memoriesFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : this.getDefaultMemories();
    } catch (err) {
      console.error('[MemoryManager] Error reading memories.json, using defaults:', err.message);
      return this.getDefaultMemories();
    }
  }

  saveMemories() {
    try {
      fs.writeFileSync(memoriesFilePath, JSON.stringify(this.memories, null, 2), 'utf-8');
    } catch (err) {
      console.error('[MemoryManager] Error saving memories.json:', err.message);
    }
  }

  addMemory({ content, category = 'personal', scope = 'owner', type = 'facts', relevance = 8 }) {
    if (!content) return null;

    // Normalize type
    let validTypes = Object.values(MEMORY_TYPES);
    let resolvedType = validTypes.includes(type) ? type : MEMORY_TYPES.FACT;

    // Auto-detect type if not explicitly set
    const clean = content.toLowerCase();
    if (clean.includes('sepakat') || clean.includes('memutuskan') || clean.includes('keputusan')) {
      resolvedType = MEMORY_TYPES.DECISION;
    } else if (clean.includes('ide ') || clean.includes('bagaimana jika') || clean.includes('peluang')) {
      resolvedType = MEMORY_TYPES.IDEA;
    } else if (clean.includes('rencana') || clean.includes('akan ') || clean.includes('besok akan')) {
      resolvedType = MEMORY_TYPES.PLAN;
    } else if (clean.includes('konfirmasi') || clean.includes('belum yakin') || clean.includes('tanya')) {
      resolvedType = MEMORY_TYPES.PENDING_CONFIRMATION;
    }

    const newMem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      scope: scope || 'owner', // 'owner' | 'partner' | 'shared'
      category: category || 'personal', // 'personal' | 'business' | 'finance' | 'relationship' | 'health'
      type: resolvedType, // facts | decisions | ideas | plans | tasks | pending_confirmations
      content: content.trim(),
      relevance: Math.min(10, Math.max(1, relevance || 8)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.memories.push(newMem);
    if (this.memories.length > 500) {
      this.memories = this.memories.slice(-500);
    }

    this.saveMemories();
    console.log(`[MemoryManager] New memory saved [${newMem.scope} / ${newMem.type} / ${newMem.category}]: "${newMem.content}"`);
    return newMem;
  }

  /**
   * Retrieves structured memories categorized into the 6 sections defined in Master Prompt Section 5
   */
  getStructuredMemories(scope = 'owner') {
    const relevant = this.memories.filter(m => m.scope === scope || m.scope === 'shared');

    const grouped = {
      facts: [],
      decisions: [],
      ideas: [],
      plans: [],
      tasks: [],
      pending_confirmations: []
    };

    for (const mem of relevant) {
      const t = mem.type || 'facts';
      if (grouped[t]) {
        grouped[t].push(mem);
      } else {
        grouped.facts.push(mem);
      }
    }

    let result = '';

    if (grouped.facts.length > 0) {
      result += `📌 *Fakta Diketahui:*\n` + grouped.facts.slice(-6).map(m => `  • ${m.content}`).join('\n') + '\n\n';
    }
    if (grouped.decisions.length > 0) {
      result += `🤝 *Keputusan Disepakati:*\n` + grouped.decisions.slice(-6).map(m => `  • ${m.content}`).join('\n') + '\n\n';
    }
    if (grouped.ideas.length > 0) {
      result += `💡 *Ide Dipertimbangkan:*\n` + grouped.ideas.slice(-5).map(m => `  • ${m.content}`).join('\n') + '\n\n';
    }
    if (grouped.plans.length > 0) {
      result += `🗓️ *Rencana Belum Dilaksanakan:*\n` + grouped.plans.slice(-5).map(m => `  • ${m.content}`).join('\n') + '\n\n';
    }
    if (grouped.pending_confirmations.length > 0) {
      result += `❓ *Perlu Dikonfirmasi:*\n` + grouped.pending_confirmations.slice(-4).map(m => `  • ${m.content}`).join('\n') + '\n\n';
    }

    return result.trim() || 'Belum ada ingatan terstruktur khusus.';
  }

  getUserMemoriesSummary(scope = 'owner', limit = 15) {
    return this.getStructuredMemories(scope);
  }

  getSharedMemoriesSummary(limit = 10) {
    return this.getStructuredMemories('shared');
  }

  getDefaultMemories() {
    return [
      {
        id: 'mem_init_01',
        scope: 'shared',
        category: 'relationship',
        type: MEMORY_TYPES.FACT,
        content: `Pengguna (${config.ownerName}) dan calon istri (${config.partnerName}) sedang mempersiapkan masa depan bersama dan pernikahan.`,
        relevance: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'mem_init_02',
        scope: 'owner',
        category: 'business',
        type: MEMORY_TYPES.FACT,
        content: `Pengguna menjalankan bisnis teknologi/digital KEYNEX dan usaha peternakan kambing di wilayah Jambi.`,
        relevance: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'mem_init_03',
        scope: 'owner',
        category: 'personal',
        type: MEMORY_TYPES.DECISION,
        content: `Komitmen prioritas: Menjaga cashflow positif, tertib salat 5 waktu Jambi, olahraga rutin, dan target omzet bulanan.`,
        relevance: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }
}
