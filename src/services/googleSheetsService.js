import { config } from '../config.js';
import { getNow } from '../utils/formatters.js';

export class GoogleSheetsService {
  constructor() {
    this.webhookUrl = this.cleanWebhookUrl(config.googleSheetWebhookUrl || '');
    this.sheetUrl = (config.googleSheetUrl || '').trim();

    if (this.isConfigured()) {
      if (!this.webhookUrl.includes('/exec')) {
        console.warn('⚠️ [GoogleSheetsService] PERINGATAN: GOOGLE_SHEET_WEBHOOK_URL tampaknya bukan URL Web App (/exec)! Pastikan menggunakan URL berakhiran /exec.');
      } else {
        console.log('📊 [GoogleSheetsService] Google Spreadsheet Webhook connected:', this.webhookUrl.slice(0, 40) + '...');
      }
    } else {
      console.log('ℹ️ [GoogleSheetsService] GOOGLE_SHEET_WEBHOOK_URL belum diset di .env / Variables. Sinkronisasi Google Sheets nonaktif.');
    }
  }

  cleanWebhookUrl(url) {
    if (!url) return '';
    let cleaned = String(url).trim();
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
    cleaned = cleaned.replace(/\/macros\/u\/\d+\/s\//i, '/macros/s/');
    return cleaned;
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
   * Update existing transaction in Google Sheets by ID
   */
  async updateTransaction(transaction, previous = null) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'UPDATE_TRANSACTION',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      transaction: {
        id: transaction.id,
        date: transaction.date || getNow().format('YYYY-MM-DD HH:mm:ss'),
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category || 'Umum',
        description: transaction.description || '',
        isBusiness: Boolean(transaction.isBusiness),
        owner: transaction.owner || 'owner',
        previous: previous || null
      }
    };

    return this.sendPayload(payload);
  }

  /**
   * Delete / Cancel transaction in Google Sheets by ID
   */
  async deleteTransaction(transactionId) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'DELETE_TRANSACTION',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      transaction: {
        id: transactionId
      }
    };

    return this.sendPayload(payload);
  }

  /**
   * Reconcile all transactions in Google Sheets
   */
  async reconcileAllTransactions(transactions) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'RECONCILE_ALL',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      transactions: transactions.map(t => ({
        id: t.id,
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
        isBusiness: Boolean(t.isBusiness),
        owner: t.owner || 'owner'
      }))
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
   * Read financial data directly from Google Spreadsheet (Single Source of Truth)
   */
  async fetchSpreadsheetFinances(source = null, month = null) {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    let url = this.cleanWebhookUrl(this.webhookUrl);
    url += (url.includes('?') ? '&' : '?') + 'action=get_finances';
    if (source) {
      url += '&source=' + encodeURIComponent(source);
    }
    if (month) {
      url += '&month=' + encodeURIComponent(month);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const resText = await response.text();

      try {
        const json = JSON.parse(resText);
        return { success: true, data: json };
      } catch (_) {
        return { success: false, raw: resText, error: 'Gagal parse JSON dari Google Sheets' };
      }
    } catch (err) {
      console.warn(`[GoogleSheetsService] Error reading from spreadsheet: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Trigger manual refresh of weekly & monthly recap sheets in Google Spreadsheet
   */
  async refreshRecap() {
    if (!this.isConfigured()) return { success: false, reason: 'NOT_CONFIGURED' };

    const payload = {
      action: 'REFRESH_RECAP',
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss')
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

    const cleanUrl = this.cleanWebhookUrl(this.webhookUrl);
    if (!cleanUrl.includes('/exec')) {
      return `⚠️ *URL Webhook Tidak Sesuai!*\n\nURL yang terpasang saat ini:\n\`${cleanUrl}\`\n\n📌 *Penyebab:* URL tersebut bukan URL Web App.\nURL Webhook Google Apps Script yang benar WAJIB berformat:\n\`https://script.google.com/macros/s/.../exec\`\n\n(Bukan link spreadsheet dan bukan link editor /edit). Silakan periksa kembali langkah deployment di Apps Script.`;
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
        const errMsg = String(pingResult.error || pingResult.reason || '');
        if (errMsg.includes('403')) {
          return `❌ *Akses Ditolak Google (HTTP 403 Forbidden)*\n\nGoogle memblokir koneksi bot. Ini biasanya terjadi karena salah satu dari 3 hal berikut:\n\n1. **Wajib Buat "Penerapan Baru" (New Deployment):**\n   Jika Anda baru saja mengubah izin ke "Siapa saja", Google *tidak otomatis memperbarui link lama*. Anda harus klik:\n   👉 **Terapkan (Deploy)** > **Penerapan baru (New deployment)** > pilih **Aplikasi web** > klik **Terapkan**.\n   Lalu salin URL \`/exec\` yang baru dan masukkan ke Railway.\n\n2. **"Jalankan Sebagai" (Execute as):**\n   Pastikan dipilih **Saya (Me / email Anda)**, *BUKAN* 'Pengguna yang mengakses aplikasi web'.\n\n3. **Bukan Akun Kantor/Kampus:**\n   Pastikan membuat spreadsheet menggunakan akun Gmail pribadi (@gmail.com), karena akun Workspace kantor sering mengunci akses eksternal.`;
        }

        return `❌ *Gagal Mengirim ke Spreadsheet!*\n\n*Pesan Error:* ${errMsg}\n\n📌 *Solusi Paling Sering:*\nPastikan saat Deploy Apps Script, opsi *Who has access (Siapa yang memiliki akses)* dipilih **Anyone (Siapa saja)**, bukan 'Only myself'.`;
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

    const url = this.cleanWebhookUrl(this.webhookUrl);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

        if (resJson && resJson.status === 'ignored') {
          console.warn(`⚠️ [GoogleSheetsService] Webhook Google Apps Script mengabaikan aksi [${payload.action}]. Hal ini terjadi jika deployment web app di Google Apps Script belum diperbarui ke versi baru.`);
          return {
            success: false,
            reason: 'WEBHOOK_IGNORED',
            error: 'Google Apps Script belum diperbarui (action ignored). Pastikan kode Apps Script terbaru sudah di-Deploy sebagai "Versi baru".'
          };
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
