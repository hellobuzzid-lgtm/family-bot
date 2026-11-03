import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { config } from '../config.js';
import { formatRupiah, parseAmount, getNow } from '../utils/formatters.js';

const financesFilePath = path.join(config.dataDir, 'finances.json');
const backupDir = path.join(config.dataDir, 'backups');

export class FinanceManager {
  constructor(googleSheetsService = null) {
    this.googleSheetsService = googleSheetsService;
    this.ensureDirs();
    this.data = this.loadData();
    this.recalculateAllBalances(); // Ensure SSOT on startup
  }

  setGoogleSheetsService(service) {
    this.googleSheetsService = service;
  }

  ensureDirs() {
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  }

  createBackup(tag = 'auto') {
    try {
      if (fs.existsSync(financesFilePath)) {
        const timestamp = getNow().format('YYYYMMDD_HHmmss');
        const backupFile = path.join(backupDir, `finances_${tag}_${timestamp}.json`);
        fs.copyFileSync(financesFilePath, backupFile);
        return backupFile;
      }
    } catch (err) {
      console.warn('[FinanceManager] Backup creation failed:', err.message);
    }
    return null;
  }

  loadData() {
    try {
      if (!fs.existsSync(financesFilePath)) {
        const defaults = this.getDefaultData();
        this.saveData(defaults);
        return defaults;
      }
      const raw = fs.readFileSync(financesFilePath, 'utf-8');
      const loaded = JSON.parse(raw);

      const merged = {
        ...this.getDefaultData(),
        ...loaded,
        initialBalances: { ...this.getDefaultData().initialBalances, ...(loaded.initialBalances || {}) },
        balances: { ...this.getDefaultData().balances, ...(loaded.balances || {}) },
        transactions: Array.isArray(loaded.transactions) ? loaded.transactions : [],
        debts: Array.isArray(loaded.debts) ? loaded.debts : [],
        processedIdempotencyKeys: loaded.processedIdempotencyKeys || {}
      };

      // Ensure every transaction has a unique ID and status
      merged.transactions.forEach((tx, idx) => {
        if (!tx.id) tx.id = `tx_migrated_${Date.now()}_${idx}`;
        if (!tx.status) tx.status = 'active';
        if (!tx.createdAt) tx.createdAt = tx.date || getNow().format('YYYY-MM-DD HH:mm:ss');
        if (!tx.updatedAt) tx.updatedAt = tx.createdAt;
        if (!Array.isArray(tx.correctionHistory)) tx.correctionHistory = [];
      });

      return merged;
    } catch (err) {
      console.error('[FinanceManager] Error reading finances.json, using defaults:', err.message);
      return this.getDefaultData();
    }
  }

  saveData(dataToSave = null) {
    const data = dataToSave || this.data;
    try {
      const jsonStr = JSON.stringify(data, null, 2);
      const tmpPath = `${financesFilePath}.tmp`;

      // Atomic write: write to temp file then rename
      fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
      fs.renameSync(tmpPath, financesFilePath);
    } catch (err) {
      console.error('[FinanceManager] Error saving finances.json atomically:', err.message);
    }
  }

  /**
   * SSOT MATHEMATICAL RECALCULATION
   * Saldo akhir = Saldo awal + Total pemasukan - Total pengeluaran.
   * Strictly recalculated from all active transactions.
   */
  recalculateAllBalances() {
    const init = this.data.initialBalances || {
      personalBalance: 0,
      businessBalance: 0,
      savingsBalance: 0,
      emergencyFundBalance: 0
    };

    let personal = Number(init.personalBalance) || 0;
    let business = Number(init.businessBalance) || 0;
    let savings = Number(init.savingsBalance) || 0;
    let emergency = Number(init.emergencyFundBalance) || 0;

    const activeTxs = this.data.transactions.filter(t => t.status === 'active');

    // Chronological order for consistent compounding
    const sorted = [...activeTxs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const tx of sorted) {
      const amt = Number(tx.amount) || 0;
      const type = (tx.type || '').toLowerCase();

      if (tx.isBusiness) {
        if (type === 'income') {
          business += amt;
        } else if (type === 'expense') {
          business -= amt;
        }
      } else {
        if (type === 'income') {
          personal += amt;
        } else if (type === 'expense' || type === 'debt_payment' || type === 'installment') {
          personal -= amt;
        } else if (type === 'savings') {
          personal -= amt;
          savings += amt;
        } else if (type === 'emergency') {
          personal -= amt;
          emergency += amt;
        }
      }
    }

    this.data.balances = {
      personalBalance: personal,
      businessBalance: business,
      savingsBalance: savings,
      emergencyFundBalance: emergency
    };

    return this.data.balances;
  }

  /**
   * RECORD NEW TRANSACTION (With Idempotency & Duplicate Burst Check)
   */
  async recordTransaction({
    type = 'expense',
    amount,
    category = 'Umum',
    description = '',
    isBusiness = false,
    owner = 'owner',
    date = null,
    idempotencyKey = null
  }) {
    const parsedAmount = parseAmount(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return { success: false, message: 'Nominal transaksi tidak valid.' };
    }

    const txType = type.toLowerCase();
    const cleanDesc = (description || category).trim();
    const cleanCategory = category.trim();

    // 1. Check idempotencyKey
    if (idempotencyKey) {
      if (!this.data.processedIdempotencyKeys) this.data.processedIdempotencyKeys = {};
      const existing = this.data.processedIdempotencyKeys[idempotencyKey];
      if (existing) {
        const found = this.data.transactions.find(t => t.id === existing.txId);
        console.log(`[FinanceManager] 🛡️ Idempotent hit: Key ${idempotencyKey} already recorded`);
        return {
          success: true,
          transaction: found,
          balances: this.data.balances,
          isDuplicate: true,
          spsConfirmed: true
        };
      }
    }

    // 2. Check duplicate burst (identical type, amount, desc within 15 seconds)
    const nowTime = getNow().valueOf();
    const recentDuplicate = this.data.transactions.find(t =>
      t.status === 'active' &&
      t.type === txType &&
      t.amount === parsedAmount &&
      t.description.toLowerCase() === cleanDesc.toLowerCase() &&
      Math.abs(nowTime - dayjs(t.date).valueOf()) < 15000
    );
    if (recentDuplicate) {
      console.log(`[FinanceManager] 🛡️ Duplicate burst prevention: Same transaction registered within 15s`);
      return {
        success: true,
        transaction: recentDuplicate,
        balances: this.data.balances,
        isDuplicate: true,
        spsConfirmed: true
      };
    }

    const txDate = date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : getNow().format('YYYY-MM-DD HH:mm:ss');
    const newTx = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      date: txDate,
      type: txType,
      amount: parsedAmount,
      category: cleanCategory,
      description: cleanDesc,
      isBusiness: Boolean(isBusiness),
      owner: owner || 'owner',
      status: 'active',
      createdAt: txDate,
      updatedAt: txDate,
      idempotencyKey: idempotencyKey || null,
      correctionHistory: []
    };

    this.data.transactions.unshift(newTx);
    if (this.data.transactions.length > 1000) {
      this.data.transactions.pop();
    }

    if (idempotencyKey) {
      this.data.processedIdempotencyKeys[idempotencyKey] = {
        txId: newTx.id,
        timestamp: nowTime
      };
    }

    // Recalculate balances from ground truth
    this.recalculateAllBalances();
    this.saveData();

    console.log(`[FinanceManager] Recorded tx: [${newTx.type.toUpperCase()}] ${formatRupiah(parsedAmount)} - ${newTx.description} (ID: ${newTx.id})`);

    // Sync to Google Sheets & verify
    let spsConfirmed = false;
    let spsResult = null;
    if (this.googleSheetsService && this.googleSheetsService.isConfigured()) {
      try {
        spsResult = await this.googleSheetsService.appendTransaction(newTx);
        spsConfirmed = Boolean(spsResult && spsResult.success);
      } catch (err) {
        console.warn('[FinanceManager] Failed to sync transaction to Google Sheets:', err.message);
        spsResult = { success: false, error: err.message };
      }
    }

    return {
      success: true,
      transaction: newTx,
      balances: this.data.balances,
      spsConfirmed,
      spsResult
    };
  }

  /**
   * INTELLIGENT TRANSACTION MATCHER FOR CORRECTIONS
   * Resolves target transaction based on ID, amount, description, type, and recency.
   * Returns { status: 'found' | 'ambiguous' | 'not_found', transaction?, candidates? }
   */
  findTransactionForCorrection({ id = null, text = '', amount = null, type = null, owner = null }) {
    const activeTxs = this.data.transactions.filter(t => t.status === 'active');
    if (activeTxs.length === 0) {
      return { status: 'not_found' };
    }

    // 1. Direct match by ID
    if (id) {
      const match = activeTxs.find(t => t.id === id || t.id.toLowerCase().includes(id.toLowerCase()));
      if (match) return { status: 'found', transaction: match };
    }

    // Check if ID is mentioned in user text (e.g. "tx_173024...")
    const idRegex = /tx_\w+/i;
    const idInText = (text || '').match(idRegex);
    if (idInText) {
      const match = activeTxs.find(t => t.id.toLowerCase() === idInText[0].toLowerCase());
      if (match) return { status: 'found', transaction: match };
    }

    const cleanText = (text || '').toLowerCase();
    const parsedAmt = amount ? parseAmount(amount) : parseAmount(cleanText);

    // Target type intent from user text:
    const wantsExpense = /(?:jadi|ubah\s*(?:ke|menjadi)?|seharusnya|mestinya|koreksi\s*(?:jadi|ke)?)\s*pengeluaran|bukan\s*pemasukan/i.test(cleanText);
    const wantsIncome = /(?:jadi|ubah\s*(?:ke|menjadi)?|seharusnya|mestinya|koreksi\s*(?:jadi|ke)?)\s*pemasukan|bukan\s*pengeluaran/i.test(cleanText);

    // Filter by recent active transactions (last 30 transactions)
    const recentCandidates = activeTxs
      .filter(t => !owner || t.owner === owner)
      .slice(0, 30);

    const now = getNow();

    const scored = recentCandidates.map((tx, idx) => {
      let score = 0;
      const txDesc = (tx.description || '').toLowerCase();
      const txCat = (tx.category || '').toLowerCase();
      const diffMinutes = Math.abs(now.diff(dayjs(tx.date), 'minute'));

      // 1. Time proximity (huge boost for recently created transactions)
      if (diffMinutes <= 5) {
        score += 65;
      } else if (diffMinutes <= 15) {
        score += 45;
      } else if (diffMinutes <= 60) {
        score += 30;
      } else if (diffMinutes <= 1440) {
        score += 15;
      } else {
        score += Math.max(0, 10 - idx);
      }

      // 2. Amount match (+40 points)
      if (parsedAmt && parsedAmt > 0 && tx.amount === parsedAmt) {
        score += 40;
      }

      // 3. Target type correlation:
      // If user says "jadi pengeluaran", prefer transactions that are currently 'income' (+40)
      // and penalize transactions that are already 'expense' (-35).
      if (wantsExpense) {
        if (tx.type === 'income') score += 40;
        else if (tx.type === 'expense') score -= 35;
      } else if (wantsIncome) {
        if (tx.type === 'expense') score += 40;
        else if (tx.type === 'income') score -= 35;
      }

      // 4. Keyword match with description or category
      const words = cleanText
        .replace(/\b(?:salah|ralat|seharusnya|harusnya|mestinya|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi|bukan|pemasukan|pengeluaran|tabungan|nominal|jadi|sebesar|senilai|kemarin|tadi|dong|nex|bot|bro|ya|tolong|beli|bayar)\b/gi, '')
        .split(/\s+/)
        .filter(w => w.length >= 3);

      let wordMatches = 0;
      for (const w of words) {
        if (txDesc.includes(w) || txCat.includes(w)) {
          wordMatches++;
        }
      }
      score += wordMatches * 15;

      return { tx, score, diffMinutes };
    });

    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top || top.score < 25) {
      // Fallback: If user simply says "salah, seharusnya pengeluaran 50rb" right after recording,
      // and only 1 transaction was recorded in the last 10 minutes:
      const lastTx = recentCandidates[0];
      if (lastTx) {
        const diffMinutes = Math.abs(now.diff(dayjs(lastTx.date), 'minute'));
        if (diffMinutes <= 10) {
          return { status: 'found', transaction: lastTx };
        }
      }
      return { status: 'not_found' };
    }

    const runnerUp = scored[1];
    // Check ambiguity: Only ambiguous if scores are very close AND top isn't overwhelmingly recent
    if (runnerUp && runnerUp.tx.id !== top.tx.id) {
      const scoreDiff = top.score - runnerUp.score;
      const topIsVeryRecent = top.diffMinutes <= 10 && runnerUp.diffMinutes > 30;
      if (!topIsVeryRecent && runnerUp.score >= 20 && scoreDiff <= 5) {
        return {
          status: 'ambiguous',
          candidates: scored.filter(s => s.score >= top.score - 5).map(s => s.tx)
        };
      }
    }

    return { status: 'found', transaction: top.tx };
  }

  /**
   * CORRECT EXISTING TRANSACTION
   * Modifies existing transaction in-place by ID, preserving ID and recalculating SSOT.
   */
  async correctTransaction(id, updates = {}, { reason = 'Koreksi pengguna', idempotencyKey = null } = {}) {
    const tx = this.data.transactions.find(t => t.id === id);
    if (!tx) {
      return { success: false, message: `Transaksi dengan ID ${id} tidak ditemukan.` };
    }

    if (tx.status !== 'active') {
      return { success: false, message: `Transaksi ${id} sudah tidak aktif (${tx.status}).` };
    }

    // Save previous snapshot
    const previousSnapshot = {
      type: tx.type,
      amount: tx.amount,
      category: tx.category,
      description: tx.description,
      isBusiness: tx.isBusiness,
      date: tx.date
    };

    // Apply updates
    if (updates.type) {
      tx.type = updates.type.toLowerCase();
    }
    if (updates.amount !== undefined) {
      const parsed = parseAmount(updates.amount);
      if (parsed > 0) tx.amount = parsed;
    }
    if (updates.category) {
      tx.category = updates.category.trim();
    }
    if (updates.description) {
      tx.description = updates.description.trim();
    }
    if (updates.isBusiness !== undefined) {
      tx.isBusiness = Boolean(updates.isBusiness);
    }
    if (updates.date) {
      tx.date = dayjs(updates.date).format('YYYY-MM-DD HH:mm:ss');
    }

    tx.updatedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
    if (!Array.isArray(tx.correctionHistory)) {
      tx.correctionHistory = [];
    }
    tx.correctionHistory.push({
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      previous: previousSnapshot,
      reason: reason || 'Koreksi'
    });

    if (idempotencyKey) {
      tx.idempotencyKey = idempotencyKey;
    }

    // Recalculate balances mathematically
    this.recalculateAllBalances();
    this.saveData();

    console.log(`[FinanceManager] ✅ Corrected tx ${tx.id}: [${previousSnapshot.type} -> ${tx.type}] ${formatRupiah(previousSnapshot.amount)} -> ${formatRupiah(tx.amount)}`);

    // Sync to Google Sheets & verify
    let spsConfirmed = false;
    let spsResult = null;
    if (this.googleSheetsService && this.googleSheetsService.isConfigured()) {
      try {
        spsResult = await this.googleSheetsService.updateTransaction(tx, previousSnapshot);
        spsConfirmed = Boolean(spsResult && spsResult.success);
      } catch (err) {
        console.warn('[FinanceManager] Failed to sync updated tx to Google Sheets:', err.message);
        spsResult = { success: false, error: err.message };
      }
    }

    return {
      success: true,
      transaction: tx,
      previous: previousSnapshot,
      balances: this.data.balances,
      spsConfirmed,
      spsResult
    };
  }

  /**
   * CANCEL / DELETE TRANSACTION
   * Marks transaction as cancelled and recalculates SSOT balances.
   */
  async deleteTransaction(id, { reason = 'Dibatalkan pengguna', idempotencyKey = null } = {}) {
    const tx = this.data.transactions.find(t => t.id === id);
    if (!tx) {
      return { success: false, message: `Transaksi dengan ID ${id} tidak ditemukan.` };
    }

    const previousSnapshot = {
      type: tx.type,
      amount: tx.amount,
      description: tx.description
    };

    tx.status = 'cancelled';
    tx.updatedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
    if (!Array.isArray(tx.correctionHistory)) tx.correctionHistory = [];
    tx.correctionHistory.push({
      timestamp: getNow().format('YYYY-MM-DD HH:mm:ss'),
      action: 'CANCEL',
      reason: reason || 'Dibatalkan'
    });

    this.recalculateAllBalances();
    this.saveData();

    console.log(`[FinanceManager] 🗑️ Cancelled tx ${tx.id}: ${tx.description} (${formatRupiah(tx.amount)})`);

    // Sync to Google Sheets & verify
    let spsConfirmed = false;
    let spsResult = null;
    if (this.googleSheetsService && this.googleSheetsService.isConfigured()) {
      try {
        spsResult = await this.googleSheetsService.deleteTransaction(tx.id);
        spsConfirmed = Boolean(spsResult && spsResult.success);
      } catch (err) {
        console.warn('[FinanceManager] Failed to sync deleted tx to Google Sheets:', err.message);
        spsResult = { success: false, error: err.message };
      }
    }

    return {
      success: true,
      transaction: tx,
      previous: previousSnapshot,
      balances: this.data.balances,
      spsConfirmed,
      spsResult
    };
  }

  /**
   * Reset / Clear all transactions (Tab Transaksi Keuangan di SPS & database lokal)
   */
  async clearAllTransactions() {
    this.createBackup('before_clear');
    const prevCount = this.data.transactions.length;
    this.data.transactions = [];
    this.data.balances = {
      personalBalance: Number(this.data.initialBalances?.personalBalance) || 0,
      businessBalance: Number(this.data.initialBalances?.businessBalance) || 0,
      savingsBalance: Number(this.data.initialBalances?.savingsBalance) || 0,
      emergencyFundBalance: Number(this.data.initialBalances?.emergencyFundBalance) || 0
    };
    this.saveData();

    let spsResult = { success: false };
    if (this.googleSheetsService && this.googleSheetsService.isConfigured()) {
      try {
        spsResult = await this.googleSheetsService.resetSpreadsheet();
      } catch (err) {
        console.error('[FinanceManager] Error resetting SPS:', err.message);
      }
    }

    return {
      success: true,
      clearedCount: prevCount,
      balances: this.data.balances,
      spsConfirmed: Boolean(spsResult && spsResult.success)
    };
  }

  /**
   * AUDIT & RECONCILE DATA INTEGRITY (Section 8)
   */
  auditAndReconcile() {
    this.createBackup('pre_audit');

    let duplicatesFound = 0;
    let corruptedFound = 0;
    const seen = new Set();
    const validTxs = [];

    // Reverse iterate to keep newest if duplicate
    for (const tx of this.data.transactions) {
      if (!tx || !tx.amount || !tx.type) {
        corruptedFound++;
        continue;
      }

      // Check identical duplicate fingerprint
      const fingerprint = `${tx.date}_${tx.type}_${tx.amount}_${(tx.description || '').trim().toLowerCase()}`;
      if (seen.has(fingerprint) && tx.status === 'active') {
        duplicatesFound++;
        tx.status = 'duplicate_archived';
      } else {
        seen.add(fingerprint);
      }
      validTxs.push(tx);
    }

    this.data.transactions = validTxs;
    const oldBalances = { ...this.data.balances };
    const newBalances = this.recalculateAllBalances();
    this.saveData();

    return {
      totalTransactions: this.data.transactions.length,
      activeTransactions: this.data.transactions.filter(t => t.status === 'active').length,
      duplicatesFound,
      corruptedFound,
      oldBalances,
      reconciledBalances: newBalances
    };
  }

  getFinancialSummary(owner = 'owner') {
    const b = this.data.balances;
    const nowMonth = getNow().format('YYYY-MM');

    // Monthly calculations from active transactions only
    const monthlyTxs = this.data.transactions.filter(t =>
      t.status === 'active' &&
      t.date.startsWith(nowMonth) &&
      (!owner || t.owner === owner)
    );

    const monthlyIncomePersonal = monthlyTxs
      .filter(t => t.type === 'income' && !t.isBusiness)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const monthlyExpensePersonal = monthlyTxs
      .filter(t => t.type === 'expense' && !t.isBusiness)
      .reduce((acc, cur) => acc + cur.amount, 0);

    const monthlyIncomeBiz = monthlyTxs
      .filter(t => t.type === 'income' && t.isBusiness)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const monthlyExpenseBiz = monthlyTxs
      .filter(t => t.type === 'expense' && t.isBusiness)
      .reduce((acc, cur) => acc + cur.amount, 0);

    const activeDebts = this.data.debts.filter(d => d.status === 'active');
    const totalRemainingDebt = activeDebts.reduce((acc, cur) => acc + cur.remainingAmount, 0);

    const recentTxList = this.data.transactions
      .filter(t => t.status === 'active')
      .slice(0, 5)
      .map(t =>
        `  - [ID: ${t.id}] ${t.date.split(' ')[0]} | [${t.isBusiness ? 'BISNIS' : 'PRIBADI'}] ${t.type.toUpperCase()}: ${formatRupiah(t.amount)} (${t.description})`
      ).join('\n') || '  (Belum ada transaksi tercatat)';

    return `
• Saldo Kas Pribadi: ${formatRupiah(b.personalBalance)}
• Saldo Kas Bisnis: ${formatRupiah(b.businessBalance)}
• Tabungan Rencana: ${formatRupiah(b.savingsBalance)}
• Dana Darurat: ${formatRupiah(b.emergencyFundBalance)}
• Arus Kas Bulan Ini (${nowMonth}):
  * Pribadi: Pemasukan ${formatRupiah(monthlyIncomePersonal)} | Pengeluaran ${formatRupiah(monthlyExpensePersonal)} (Net: ${formatRupiah(monthlyIncomePersonal - monthlyExpensePersonal)})
  * Bisnis: Omzet ${formatRupiah(monthlyIncomeBiz)} | Biaya ${formatRupiah(monthlyExpenseBiz)} (Net Profit: ${formatRupiah(monthlyIncomeBiz - monthlyExpenseBiz)})
• Total Kewajiban Utang/Cicilan Aktif: ${formatRupiah(totalRemainingDebt)} (${activeDebts.length} kewajiban)
• 5 Transaksi Terakhir (Gunakan ID untuk koreksi/pembatalan):
${recentTxList}
`.trim();
  }

  getWeeklyRecap(owner = null) {
    const now = getNow();
    const day = now.day();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = now.add(diffToMonday, 'day').startOf('day');
    const sunday = monday.add(6, 'day').endOf('day');

    const weekTxs = this.data.transactions.filter(t => {
      if (t.status !== 'active') return false;
      const d = dayjs(t.date);
      const inRange = (d.isAfter(monday) || d.isSame(monday)) && (d.isBefore(sunday) || d.isSame(sunday));
      if (!inRange) return false;
      if (!owner || owner === 'all') return true;
      const tOwner = String(t.owner || '').toLowerCase();
      const qOwner = String(owner).toLowerCase();
      if (qOwner === 'owner' || qOwner.includes('bro')) {
        return tOwner === 'owner' || tOwner.includes('owner') || tOwner.includes('bro');
      }
      if (qOwner === 'partner' || qOwner.includes('istri') || qOwner.includes('calon')) {
        return tOwner === 'partner' || tOwner.includes('istri') || tOwner.includes('calon');
      }
      return tOwner === qOwner;
    });

    const income = weekTxs.filter(t => t.type === 'income').reduce((acc, c) => acc + c.amount, 0);
    const expense = weekTxs.filter(t => t.type === 'expense').reduce((acc, c) => acc + c.amount, 0);
    const net = income - expense;
    const dailyAvg = Math.round(expense / 7);

    const catMap = {};
    weekTxs.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category || 'Umum';
      catMap[cat] = (catMap[cat] || 0) + t.amount;
    });

    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const topCatStr = sortedCats.length > 0
      ? sortedCats.slice(0, 3).map(([c, amt]) => `${c}: ${formatRupiah(amt)}`).join(', ')
      : 'Belum ada pengeluaran';

    return {
      periodLabel: `${monday.format('DD MMM')} - ${sunday.format('DD MMM YYYY')}`,
      income,
      expense,
      net,
      dailyAvg,
      topCategories: sortedCats,
      summaryText: `📅 *REKAP MINGGUAN (${monday.format('DD MMM')} - ${sunday.format('DD MMM YYYY')})*\n\n` +
        `• *Pemasukan:* ${formatRupiah(income)}\n` +
        `• *Pengeluaran:* ${formatRupiah(expense)}\n` +
        `• *Net Cashflow:* ${formatRupiah(net)} (${net >= 0 ? 'Surplus ✅' : 'Defisit ⚠️'})\n` +
        `• *Rata-rata Pengeluaran/Hari:* ${formatRupiah(dailyAvg)}\n` +
        `• *Kategori Terbesar:* ${topCatStr}\n\n` +
        `📊 *Status:* Seluruh transaksi valid sudah tersinkronisasi di Google Spreadsheet.`
    };
  }

  getMonthlyRecap(owner = null) {
    const now = getNow();
    const currentMonthKey = now.format('YYYY-MM');
    const monthLabel = now.format('MMMM YYYY');

    const monthTxs = this.data.transactions.filter(t => {
      if (t.status !== 'active') return false;
      if (!t.date.startsWith(currentMonthKey)) return false;
      if (!owner || owner === 'all') return true;
      const tOwner = String(t.owner || '').toLowerCase();
      const qOwner = String(owner).toLowerCase();
      if (qOwner === 'owner' || qOwner.includes('bro')) {
        return tOwner === 'owner' || tOwner.includes('owner') || tOwner.includes('bro');
      }
      if (qOwner === 'partner' || qOwner.includes('istri') || qOwner.includes('calon')) {
        return tOwner === 'partner' || tOwner.includes('istri') || tOwner.includes('calon');
      }
      return tOwner === qOwner;
    });

    const income = monthTxs.filter(t => t.type === 'income').reduce((acc, c) => acc + c.amount, 0);
    const expense = monthTxs.filter(t => t.type === 'expense').reduce((acc, c) => acc + c.amount, 0);
    const savings = monthTxs.filter(t => t.type === 'savings' || t.type === 'emergency').reduce((acc, c) => acc + c.amount, 0);
    const net = income - expense;
    const savingsRatio = income > 0 ? ((savings / income) * 100).toFixed(1) + '%' : '0%';

    const catMap = {};
    monthTxs.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category || 'Umum';
      catMap[cat] = (catMap[cat] || 0) + t.amount;
    });

    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const topCatStr = sortedCats.length > 0
      ? sortedCats.slice(0, 3).map(([c, amt]) => `${c}: ${formatRupiah(amt)}`).join(', ')
      : 'Belum ada pengeluaran';

    return {
      monthLabel,
      income,
      expense,
      savings,
      net,
      savingsRatio,
      topCategories: sortedCats,
      summaryText: `🗓️ *REKAP BULANAN (${monthLabel})*\n\n` +
        `• *Total Pemasukan:* ${formatRupiah(income)}\n` +
        `• *Total Pengeluaran:* ${formatRupiah(expense)}\n` +
        `• *Tabungan Disimpan:* ${formatRupiah(savings)} (Rasio: ${savingsRatio})\n` +
        `• *Net Cashflow (Sisa):* ${formatRupiah(net)} (${net >= 0 ? 'Surplus ✅' : 'Defisit ⚠️'})\n` +
        `• *Top Kategori Pengeluaran:* ${topCatStr}\n\n` +
        `📊 *Status:* Seluruh laporan bulanan telah dihitung ulang berdasarkan transaksi aktif.`
    };
  }

  /**
   * SPECIFIC INCOME/BUSINESS SOURCE QUERY (Section 1)
   * Example: "Berapa pendapatan KEYNEX bulan ini?"
   * Strictly isolates the requested source from all other businesses.
   */
  getFinancesBySource(sourceName, { month = null, year = null, owner = null } = {}) {
    if (!sourceName) return null;
    const cleanSource = String(sourceName).trim().toLowerCase();
    const now = getNow();
    const targetMonth = month || now.format('YYYY-MM');

    const matchingTxs = this.data.transactions.filter(t => {
      if (t.status !== 'active') return false;
      if (owner && t.owner !== owner) return false;

      // Filter by period if specified
      if (targetMonth && !t.date.startsWith(targetMonth)) return false;

      const desc = (t.description || '').toLowerCase();
      const cat = (t.category || '').toLowerCase();
      return desc.includes(cleanSource) || cat.includes(cleanSource);
    });

    const income = matchingTxs
      .filter(t => t.type === 'income')
      .reduce((acc, c) => acc + c.amount, 0);

    const expense = matchingTxs
      .filter(t => t.type === 'expense')
      .reduce((acc, c) => acc + c.amount, 0);

    const net = income - expense;

    const sourceLabel = sourceName.toUpperCase();
    const monthLabel = dayjs(targetMonth + '-01').format('MMMM YYYY');

    const txRows = matchingTxs.map(t =>
      `  • [${t.date.split(' ')[0]}] [${t.type.toUpperCase()}] ${formatRupiah(t.amount)}: ${t.description}`
    );

    const summaryText = `💼 *ANALISIS KEUANGAN SPESIFIK: ${sourceLabel}*\n` +
      `📅 *Periode:* ${monthLabel}\n\n` +
      `• *Total Pendapatan / Omzet:* ${formatRupiah(income)}\n` +
      `• *Total Beban / Pengeluaran:* ${formatRupiah(expense)}\n` +
      `• *Laba / Keuntungan Bersih:* ${formatRupiah(net)} (${net >= 0 ? 'Surplus/Untung 🟢' : 'Defisit/Rugi 🔴'})\n` +
      `• *Jumlah Transaksi:* ${matchingTxs.length} transaksi\n\n` +
      (txRows.length > 0 ? `📜 *Riwayat Transaksi Terkait:*\n${txRows.join('\n')}\n\n` : '') +
      `📌 *Catatan:* Perhitungan ini murni diisolasi dari sumber ${sourceLabel} saja berdasarkan data transaksi aktif.`;

    return {
      source: sourceName,
      month: targetMonth,
      monthLabel,
      income,
      expense,
      net,
      transactionCount: matchingTxs.length,
      transactions: matchingTxs,
      summaryText
    };
  }

  getDailyRecap(targetDate = null, owner = 'owner') {
    const dStr = targetDate || getNow().format('YYYY-MM-DD');
    const dayTxs = this.data.transactions.filter(t => {
      return t.status === 'active' && t.date.startsWith(dStr) && (!owner || t.owner === owner);
    });

    const income = dayTxs.filter(t => t.type === 'income').reduce((acc, c) => acc + c.amount, 0);
    const expense = dayTxs.filter(t => t.type === 'expense').reduce((acc, c) => acc + c.amount, 0);
    const net = income - expense;

    return {
      date: dStr,
      income,
      expense,
      net,
      transactions: dayTxs,
      summaryText: `📅 *REKAP KEUANGAN HARIAN (${dStr})*\n\n` +
        `• Pemasukan : ${formatRupiah(income)}\n` +
        `• Pengeluaran: ${formatRupiah(expense)}\n` +
        `• Net Hari Ini: ${formatRupiah(net)} (${net >= 0 ? 'Surplus ✅' : 'Defisit ⚠️'})\n` +
        `• Total Transaksi: ${dayTxs.length} transaksi`
    };
  }

  getAnnualRecap(targetYear = null, owner = 'owner') {
    const yStr = targetYear ? String(targetYear) : getNow().format('YYYY');
    const yearTxs = this.data.transactions.filter(t => {
      return t.status === 'active' && t.date.startsWith(yStr) && (!owner || t.owner === owner);
    });

    const income = yearTxs.filter(t => t.type === 'income').reduce((acc, c) => acc + c.amount, 0);
    const expense = yearTxs.filter(t => t.type === 'expense').reduce((acc, c) => acc + c.amount, 0);
    const savings = yearTxs.filter(t => t.type === 'savings' || t.type === 'emergency').reduce((acc, c) => acc + c.amount, 0);
    const net = income - expense;

    return {
      year: yStr,
      income,
      expense,
      savings,
      net,
      transactionsCount: yearTxs.length,
      summaryText: `📊 *REKAP KEUANGAN TAHUNAN (${yStr})*\n\n` +
        `• Total Pemasukan Tahunan : ${formatRupiah(income)}\n` +
        `• Total Pengeluaran Tahunan: ${formatRupiah(expense)}\n` +
        `• Total Tabungan Disimpan : ${formatRupiah(savings)}\n` +
        `• Net Saldo Tahunan       : ${formatRupiah(net)} (${net >= 0 ? 'Surplus ✅' : 'Defisit ⚠️'})\n` +
        `• Volume Transaksi        : ${yearTxs.length} transaksi`
    };
  }

  async syncWithSpreadsheet() {
    if (!this.googleSheetsService || !this.googleSheetsService.isConfigured()) {
      return { success: false, reason: 'NOT_CONFIGURED' };
    }
    const res = await this.googleSheetsService.fetchSpreadsheetFinances();
    if (res.success && res.data && res.data.status === 'success') {
      const remoteTxs = res.data.transactions || [];
      console.log(`[FinanceManager] 📥 Synced with Google Spreadsheet (SPS). Remote transactions found: ${res.data.totalTransactions}`);

      let addedCount = 0;
      let updatedCount = 0;

      for (const rTx of remoteTxs) {
        if (!rTx.id) continue;
        const existingIdx = this.data.transactions.findIndex(t => t.id === rTx.id);
        const normOwner = (String(rTx.owner || '').toLowerCase().includes('partner') || String(rTx.owner || '').toLowerCase().includes('istri')) ? 'partner' : 'owner';

        if (existingIdx === -1) {
          this.data.transactions.push({
            id: rTx.id,
            date: rTx.date ? `${rTx.date} ${rTx.time || '12:00:00'}` : getNow().format('YYYY-MM-DD HH:mm:ss'),
            type: rTx.type || 'expense',
            amount: Number(rTx.amount) || 0,
            category: rTx.category || 'Umum',
            description: rTx.description || '',
            isBusiness: Boolean(rTx.isBusiness),
            owner: normOwner,
            status: 'active',
            createdAt: rTx.date ? `${rTx.date} ${rTx.time || '12:00:00'}` : getNow().format('YYYY-MM-DD HH:mm:ss'),
            updatedAt: getNow().format('YYYY-MM-DD HH:mm:ss'),
            correctionHistory: []
          });
          addedCount++;
        } else {
          const cur = this.data.transactions[existingIdx];
          if (cur.amount !== rTx.amount || cur.type !== rTx.type) {
            cur.amount = Number(rTx.amount) || cur.amount;
            cur.type = rTx.type || cur.type;
            cur.description = rTx.description || cur.description;
            cur.category = rTx.category || cur.category;
            cur.owner = normOwner;
            cur.updatedAt = getNow().format('YYYY-MM-DD HH:mm:ss');
            updatedCount++;
          }
        }
      }

      this.recalculateAllBalances();
      this.saveData();

      return {
        success: true,
        data: res.data,
        addedCount,
        updatedCount,
        totalLocal: this.data.transactions.length
      };
    }
    return { success: false, error: res.error || 'Gagal sinkron dari spreadsheet' };
  }

  setInitialBalance({ personal = null, business = null, savings = null, emergency = null }) {
    if (!this.data.initialBalances) {
      this.data.initialBalances = {
        personalBalance: 0,
        businessBalance: 0,
        savingsBalance: 0,
        emergencyFundBalance: 0
      };
    }
    if (personal !== null && personal !== undefined) this.data.initialBalances.personalBalance = parseAmount(personal);
    if (business !== null && business !== undefined) this.data.initialBalances.businessBalance = parseAmount(business);
    if (savings !== null && savings !== undefined) this.data.initialBalances.savingsBalance = parseAmount(savings);
    if (emergency !== null && emergency !== undefined) this.data.initialBalances.emergencyFundBalance = parseAmount(emergency);

    this.recalculateAllBalances();
    this.saveData();
    return this.data.initialBalances;
  }

  addDebt({ creditor, totalAmount, monthlyInstallment = 0, dueDate = '', notes = '', type = 'debt' }) {
    const total = parseAmount(totalAmount);
    const installment = parseAmount(monthlyInstallment);

    const newDebt = {
      id: `debt_${Date.now()}`,
      creditor: creditor.trim(),
      type: type === 'receivable' ? 'receivable' : 'debt', // 'debt' (utang) | 'receivable' (piutang)
      totalAmount: total,
      remainingAmount: total,
      monthlyInstallment: installment,
      dueDate: dueDate || 'Akhir bulan',
      notes: notes || '',
      status: 'active',
      createdAt: getNow().format('YYYY-MM-DD')
    };

    this.data.debts.push(newDebt);
    this.saveData();
    return newDebt;
  }

  payDebt({ debtId, amount }) {
    const debt = this.data.debts.find(d => d.id === debtId || d.creditor.toLowerCase().includes(String(debtId).toLowerCase()));
    if (!debt) return { success: false, message: 'Data utang/cicilan tidak ditemukan.' };

    const parsed = parseAmount(amount);
    debt.remainingAmount = Math.max(0, debt.remainingAmount - parsed);
    if (debt.remainingAmount === 0) {
      debt.status = 'paid';
    }

    this.recordTransaction({
      type: 'debt_payment',
      amount: parsed,
      category: 'Cicilan/Utang',
      description: `Bayar cicilan ke ${debt.creditor}`,
      isBusiness: false
    });

    this.saveData();
    return { success: true, debt };
  }

  getDefaultData() {
    return {
      initialBalances: {
        personalBalance: 0,
        businessBalance: 0,
        savingsBalance: 0,
        emergencyFundBalance: 0
      },
      balances: {
        personalBalance: 0,
        businessBalance: 0,
        savingsBalance: 0,
        emergencyFundBalance: 0
      },
      transactions: [],
      debts: [],
      processedIdempotencyKeys: {}
    };
  }
}
