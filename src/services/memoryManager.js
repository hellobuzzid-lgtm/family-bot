import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const memoriesFilePath = path.join(config.dataDir, 'memories.json');

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
      return JSON.parse(raw);
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

  addMemory({ content, category = 'personal', scope = 'owner', relevance = 8 }) {
    if (!content) return null;

    const newMem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      scope: scope || 'owner', // 'owner' | 'partner' | 'shared'
      category: category || 'personal', // 'personal' | 'financial' | 'habit' | 'relationship' | 'business'
      content: content.trim(),
      relevance: Math.min(10, Math.max(1, relevance || 8)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.memories.push(newMem);
    // Limit to 500 memory entries
    if (this.memories.length > 500) {
      this.memories = this.memories.slice(-500);
    }

    this.saveMemories();
    console.log(`[MemoryManager] New memory saved [${newMem.scope} / ${newMem.category}]: "${newMem.content}"`);
    return newMem;
  }

  getUserMemoriesSummary(scope = 'owner', limit = 15) {
    const list = this.memories.filter(m => m.scope === scope || m.scope === 'shared');
    if (list.length === 0) {
      return `Belum ada catatan memori khusus untuk ${scope}.`;
    }
    return list
      .slice(-limit)
      .reverse()
      .map(m => `• [${m.category.toUpperCase()}] ${m.content}`)
      .join('\n');
  }

  getSharedMemoriesSummary(limit = 10) {
    const list = this.memories.filter(m => m.scope === 'shared');
    if (list.length === 0) {
      return 'Belum ada memori bersama keluarga/pasangan yang tercatat.';
    }
    return list
      .slice(-limit)
      .reverse()
      .map(m => `• [BERSAMA / ${m.category.toUpperCase()}] ${m.content}`)
      .join('\n');
  }

  getDefaultMemories() {
    return [
      {
        id: 'mem_init_01',
        scope: 'shared',
        category: 'relationship',
        content: `Pengguna (${config.ownerName}) dan calon istri (${config.partnerName}) sedang mempersiapkan masa depan bersama dan pernikahan.`,
        relevance: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'mem_init_02',
        scope: 'owner',
        category: 'personal',
        content: `Target utama Bro: mengembangkan bisnis, menjaga cashflow positif, menjaga salat 5 waktu, dan meningkatkan kedisiplinan hidup.`,
        relevance: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }
}
