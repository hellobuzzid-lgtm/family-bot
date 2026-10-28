import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { config } from '../config.js';
import { formatRupiah, parseAmount, getNow } from '../utils/formatters.js';

const financesFilePath = path.join(config.dataDir, 'finances.json');

export class FinanceManager {
  constructor(googleSheetsService = null) {
    this.googleSheetsService = googleSheetsService;
    this.data = this.loadData();
  }

  setGoogleSheetsService(service) {
    this.googleSheetsService = service;
  }

  loadData() {
    try {
      if (!fs.existsSync(financesFilePath)) {
        return this.getDefaultData();
      }
      const raw = fs.readFileSync(financesFilePath, 'utf-8');
      const loaded = JSON.parse(raw);
      return {
        ...this.getDefaultData(),
        ...loaded,
        balances: { ...this.getDefaultData().balances, ...(loaded.balances || {}) }
      };
    } catch (err) {
      console.error('[FinanceManager] Error reading finances.json, using defaults:', err.message);
      return this.getDefaultData();
    }
  }

  saveData() {
    try {
      fs.writeFileSync(financesFilePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[FinanceManager] Error saving finances.json:', err.message);
    }
  }

  recordTransaction({
    type = 'expense', // 'income' | 'expense' | 'savings' | 'debt_payment' | 'installment'
    amount,
    category = 'Umum',
    description = '',
    isBusiness = false,
    owner = 'owner'
  }) {
    const parsedAmount = parseAmount(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return { success: false, message: 'Nominal transaksi tidak valid.' };
    }

    const txType = type.toLowerCase();
    const newTx = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      date: getNow().format('YYYY-MM-DD HH:mm:ss'),
      type: txType,
      amount: parsedAmount,
      category: category.trim(),
      description: (description || category).trim(),
      isBusiness: Boolean(isBusiness),
      owner: owner || 'owner'
    };

    // Update internal balances accurately
    if (newTx.isBusiness) {
      if (txType === 'income') {
        this.data.balances.businessBalance += parsedAmount;
      } else if (txType === 'expense') {
        this.data.balances.businessBalance -= parsedAmount;
      }
    } else {
      if (txType === 'income') {
        this.data.balances.personalBalance += parsedAmount;
      } else if (txType === 'expense') {
        this.data.balances.personalBalance -= parsedAmount;
      } else if (txType === 'savings') {
        this.data.balances.personalBalance -= parsedAmount;
        this.data.balances.savingsBalance += parsedAmount;
      } else if (txType === 'emergency') {
        this.data.balances.personalBalance -= parsedAmount;
        this.data.balances.emergencyFundBalance += parsedAmount;
      }
    }

    this.data.transactions.unshift(newTx);
    if (this.data.transactions.length > 500) {
      this.data.transactions.pop();
    }

    this.saveData();
    console.log(`[FinanceManager] Recorded tx: [${newTx.type.toUpperCase()}] ${formatRupiah(parsedAmount)} - ${newTx.description}`);

    if (this.googleSheetsService) {
      this.googleSheetsService.appendTransaction(newTx).catch(err => {
        console.warn('[FinanceManager] Failed to sync transaction to Google Sheets:', err.message);
      });
    }

    return {
      success: true,
      transaction: newTx,
      balances: this.data.balances
    };
  }

  addDebt({ creditor, totalAmount, monthlyInstallment = 0, dueDate = '', notes = '' }) {
    const total = parseAmount(totalAmount);
    const installment = parseAmount(monthlyInstallment);

    const newDebt = {
      id: `debt_${Date.now()}`,
      creditor: creditor.trim(),
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

  getFinancialSummary(owner = 'owner') {
    const b = this.data.balances;
    const nowMonth = getNow().format('YYYY-MM');

    // Monthly calculations
    const monthlyTxs = this.data.transactions.filter(t => t.date.startsWith(nowMonth) && t.owner === owner);
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

    const recentTxList = this.data.transactions.slice(0, 5).map(t =>
      `  - ${t.date.split(' ')[0]} | [${t.isBusiness ? 'BISNIS' : 'PRIBADI'}] ${t.type.toUpperCase()}: ${formatRupiah(t.amount)} (${t.description})`
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
• 5 Transaksi Terakhir:
${recentTxList}
`.trim();
  }

  getDefaultData() {
    return {
      balances: {
        personalBalance: 0,
        businessBalance: 0,
        savingsBalance: 0,
        emergencyFundBalance: 0
      },
      transactions: [],
      debts: []
    };
  }
}
