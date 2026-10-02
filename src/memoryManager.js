import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const memoriesFilePath = path.join(config.dataDir, 'memories.json');

export class MemoryManager {
  constructor() {
    this.memories = this.loadMemories();
  }

  loadMemories() {
    try {
      if (!fs.existsSync(memoriesFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(memoriesFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[MemoryManager] Error reading memories.json:', err.message);
      return [];
    }
  }

  saveMemories() {
    try {
      fs.writeFileSync(memoriesFilePath, JSON.stringify(this.memories, null, 2), 'utf-8');
    } catch (err) {
      console.error('[MemoryManager] Failed to save memories.json:', err.message);
    }
  }

  getAll() {
    return this.memories;
  }

  addMemory(fact, category = 'family', importance = 5) {
    if (!fact || typeof fact !== 'string') return null;
    const cleanFact = fact.trim();
    if (cleanFact.length < 5) return null;

    // Check for exact duplicates or near duplicates
    const exists = this.memories.some(m => m.fact.toLowerCase() === cleanFact.toLowerCase());
    if (exists) return null;

    const newMem = {
      id: `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      category,
      fact: cleanFact,
      importance,
      createdAt: new Date().toISOString()
    };

    this.memories.push(newMem);
    // Sort memories by importance descending
    this.memories.sort((a, b) => (b.importance || 5) - (a.importance || 5));

    // Limit to 100 top memories to avoid prompt explosion
    if (this.memories.length > 100) {
      this.memories = this.memories.slice(0, 100);
    }

    this.saveMemories();
    console.log(`[MemoryManager] Saved new memory [${category}]: ${cleanFact}`);
    return newMem;
  }

  deleteMemory(id) {
    const beforeCount = this.memories.length;
    this.memories = this.memories.filter(m => m.id !== id);
    if (this.memories.length !== beforeCount) {
      this.saveMemories();
      return true;
    }
    return false;
  }

  getFormattedMemoriesForPrompt() {
    if (!this.memories || this.memories.length === 0) {
      return 'Belum ada catatan memori khusus.';
    }

    // Group memories by category
    const categoryLabels = {
      family: 'Keluarga & Hubungan LDR',
      father: 'Tentang Ayah',
      mother: 'Tentang Ibu',
      child: 'Tentang Kebiasaan & Hal Favorit Anak',
      school: 'Tentang Sekolah',
      friend: 'Tentang Teman-Teman'
    };

    const grouped = {};
    for (const mem of this.memories) {
      const cat = mem.category || 'family';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(mem.fact);
    }

    const lines = [];
    for (const [cat, items] of Object.entries(grouped)) {
      const title = categoryLabels[cat] || `Kategori ${cat}`;
      lines.push(`• ${title}:`);
      items.slice(0, 6).forEach(fact => {
        lines.push(`  - ${fact}`);
      });
    }

    return lines.join('\n');
  }
}
