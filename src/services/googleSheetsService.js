import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

export class GoogleSheetsService {
  constructor() {
    this.webhookUrl = config.googleSheetWebhookUrl || '';
    this.sheetUrl = config.googleSheetUrl || '';
    this.pendingQueue = [];
    this.isProcessing = false;

    if (this.isConfigured()) {
      console.log('📊 [GoogleSheetsService] Google Spreadsheet Webhook connected:', this.webhookUrl.slice(0, 35) + '...');
    } else {
      console.log('ℹ️ [GoogleSheetsService] GOOGLE_SHEET_WEBHOOK_URL belum diset di .env / Variables. Sinkronisasi Google Sheets nonaktif.');
    }
  }

  isConfigured() {
    return Boolean(this.webhookUrl && this.webhookUrl.startsWith('http'));
  }

  getSpreadsheetUrl() {
    return this.sheetUrl || '';
  }

  /**
   * Append new financial transaction to Google Sheets
   */
  async appendTransaction(transaction) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'TRANSACTION',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      transaction: {
        id: transaction.id,
        date: transaction.date || getNow().format('YYYY-MM-DD HH:mm:ss'),
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category || 'Umum',
        description: transaction.description || '',
        isBusiness: Boolean(transaction.isBusiness),
        owner: transaction.owner || 'owner'
      }
    };

    return this.sendPayload(payload);
  }

  /**
   * Append routine / habit log to Google Sheets
   */
  async appendHabit(habitData) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'HABIT',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      habit: {
        time: getNow().format('HH:mm'),
        habit: habitData.habit,
        value: habitData.value,
        notes: habitData.notes || ''
      }
    };

    return this.sendPayload(payload);
  }

  /**
   * Append goal to Google Sheets
   */
  async appendGoal(goalData) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'GOAL',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      goal: {
        id: goalData.id,
        category: goalData.category,
        title: goalData.title,
        metrics: goalData.metrics,
        targetDate: goalData.targetDate,
        owner: goalData.owner || 'owner'
      }
    };

    return this.sendPayload(payload);
  }

  /**
   * Send HTTP POST to Google Apps Script Webhook with timeout and error protection
   */
  async sendPayload(payload) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const resText = await response.text();
      let resJson;
      try {
        resJson = JSON.parse(resText);
      } catch (_) {
        resJson = { status: 'success', raw: resText };
      }

      console.log(`✅ [GoogleSheetsService] Data [${payload.action}] berhasil disinkronkan ke Google Spreadsheet.`);
      return { success: true, result: resJson };
    } catch (err) {
      console.warn(`⚠️ [GoogleSheetsService] Gagal kirim ke Google Sheets (${payload.action}): ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
