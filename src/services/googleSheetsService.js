import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

export class GoogleSheetsService {
  constructor() {
    this.webhookUrl = (config.googleSheetWebhookUrl || '').trim();
    this.sheetUrl = (config.googleSheetUrl || '').trim();

    if (this.isConfigured()) {
      if (!this.webhookUrl.includes('/exec')) {
        console.warn('⚠️ [GoogleSheetsService] PERINGATAN: GOOGLE_SHEET_WEBHOOK_URL tampaknya bukan URL Web App (/exec)! Pastikan menggunakan URL berakhiran /exec.');
      } else {
        console.log('📊 [GoogleSheetsService] Google Spreadsheet Webhook connected:', this.webhookUrl.slice(0, 35) + '...');
      }
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
   * Live test connection for WhatsApp diagnostic
   */
  async testConnection() {
    if (!this.webhookUrl) {
      return `❌ *Google Spreadsheet Belum Terhubung!*\n\nVariabel *GOOGLE_SHEET_WEBHOOK_URL* belum diisi di Railway (Variables).\n\n📌 *Langkah Perbaikan:*\n1. Buka Railway > Project Anda > Service Bot > tab *Variables*.\n2. Tambahkan variabel:\n   *GOOGLE_SHEET_WEBHOOK_URL* = (URL Apps Script berakhiran /exec)\n3. Setelah disimpan, bot akan merestart otomatis dalam beberapa detik.`;
    }

    const trimmed = this.webhookUrl.trim();
    if (!trimmed.includes('/exec')) {
      return `⚠️ *URL Webhook Tidak Sesuai!*\n\nURL yang terpasang saat ini:\n\`${trimmed}\`\n\n📌 *Penyebab:* URL tersebut bukan URL Web App.\nURL Webhook Google Apps Script yang benar WAJIB berformat:\n\`https://script.google.com/macros/s/.../exec\`\n\n(Bukan link spreadsheet dan bukan link editor /edit). Silakan periksa kembali langkah deployment di Apps Script.`;
    }

    try {
      console.log('[GoogleSheetsService] Mengirim data uji coba ke spreadsheet...');
      const pingResult = await this.appendTransaction({
        id: `test_${Date.now()}`,
        date: getNow().format('YYYY-MM-DD HH:mm:ss'),
        type: 'income',
        amount: 10000,
        category: 'Uji Coba Sistem',
        description: 'Tes Koneksi Bot NEX ke Google Spreadsheet',
        isBusiness: false,
        owner: 'owner'
      });

      if (pingResult.success) {
        return `✅ *Google Spreadsheet BERHASIL Terhubung!*\n\nNEX baru saja mengirimkan 1 baris transaksi uji coba (Pemasukan Rp 10.000) ke spreadsheet Anda.\n\n📊 *Silakan cek spreadsheet Anda sekarang:* baris tersebut sudah otomatis muncul di tab *Transaksi Keuangan*.`;
      } else {
        return `❌ *Gagal Mengirim ke Spreadsheet!*\n\n*Pesan Error:* ${pingResult.error || pingResult.reason || 'Unknown'}\n\n📌 *Solusi Paling Sering:*\nPastikan saat Deploy Apps Script, opsi *Who has access (Siapa yang memiliki akses)* dipilih **Anyone (Siapa saja)**, bukan 'Only myself'.`;
      }
    } catch (err) {
      return `❌ *Gagal Tes Koneksi:* ${err.message}`;
    }
  }

  /**
   * Send HTTP POST to Google Apps Script Webhook with timeout and redirect resilience
   */
  async sendPayload(payload) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const url = this.webhookUrl.trim();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Using text/plain prevents CORS preflight and body drops on Google Apps Script proxy
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const resText = await response.text();
      console.log(`[GoogleSheetsService] Webhook response (${response.status}):`, resText.slice(0, 150));

      if (response.ok || response.status === 302 || response.status === 200) {
        let resJson;
        try {
          resJson = JSON.parse(resText);
        } catch (_) {
          resJson = { status: 'success', raw: resText };
        }
        console.log(`✅ [GoogleSheetsService] Data [${payload.action}] berhasil disinkronkan ke Google Spreadsheet.`);
        return { success: true, result: resJson };
      }

      throw new Error(`HTTP ${response.status}: ${resText.slice(0, 120)}`);
    } catch (err) {
      console.warn(`⚠️ [GoogleSheetsService] Gagal kirim ke Google Sheets (${payload.action}): ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
