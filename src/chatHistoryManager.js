import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const historyFilePath = path.join(config.dataDir, 'chat_history.json');

export class ChatHistoryManager {
  constructor() {
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      if (!fs.existsSync(historyFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(historyFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[ChatHistoryManager] Error reading chat_history.json:', err.message);
      return [];
    }
  }

  saveHistory() {
    try {
      fs.writeFileSync(historyFilePath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ChatHistoryManager] Failed to save chat_history.json:', err.message);
    }
  }

  addMessage({ senderJid, senderName, role, text, timestamp = null }) {
    if (!text || typeof text !== 'string') return;
    const cleanText = text.trim();
    if (!cleanText) return;

    const entry = {
      id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      senderJid: senderJid || 'unknown',
      senderName: senderName || 'Orang Tua',
      role: role || 'family_member',
      text: cleanText,
      timestamp: timestamp || new Date().toISOString()
    };

    this.history.push(entry);

    // Keep max 50 messages
    if (this.history.length > 50) {
      this.history = this.history.slice(-50);
    }

    this.saveHistory();
  }

  getRecent(limit = 15) {
    return this.history.slice(-limit);
  }

  getLastMessage() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }
}
