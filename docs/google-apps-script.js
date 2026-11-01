/**
 * =========================================================================
 * GOOGLE APPS SCRIPT UNTUK BOT NEX (AI PERSONAL LIFE PARTNER) v2.5
 * =========================================================================
 * Fitur Utama:
 * 1. Otomatis catat transaksi baru ke tab "Transaksi Keuangan".
 * 2. Mendukung KOREKSI transaksi lama (Update in-place via ID Transaksi).
 * 3. Mendukung PEMBATALAN / PENGHAPUSAN transaksi via ID Transaksi.
 * 4. Otomatis rekap real-time ke tab "Rekap Bulanan" (SSOT dari transaksi aktif).
 * 5. Otomatis rekap real-time ke tab "Rekap Mingguan" (SSOT dari transaksi aktif).
 * 6. Otomatis catat log rutinitas & habit ke tab "Rutinitas & Kebiasaan".
 * 7. Otomatis catat target/goals ke tab "Target & Evaluasi".
 * 8. Menyediakan menu interaktif di Spreadsheet: "🤖 NEX Bot" > "Perbarui Rekap".
 * =========================================================================
 */

function doPost(e) {
  try {
    var raw = '';
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
    } else if (e && e.parameter && e.parameter.data) {
      raw = e.parameter.data;
    }

    var data = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch (pErr) { data = e.parameter || {}; }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'No active spreadsheet.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var txHeaders = [
      'Timestamp', 'Tanggal', 'Waktu', 'Jenis', 'Nominal (Rp)', 'Kategori', 'Keterangan', 'Akun', 'Pencatat', 'ID Transaksi'
    ];

    // 1. SINKRONISASI TRANSAKSI BARU ATAU KOREKSI TRANSAKSI
    if (data.action === 'TRANSACTION' || data.action === 'UPDATE_TRANSACTION' || data.action === 'CORRECT_TRANSACTION') {
      var sheet = getOrCreateSheet(ss, 'Transaksi Keuangan', txHeaders, '#1B5E20');
      var tx = data.transaction || {};
      var isUpdateAction = (data.action === 'UPDATE_TRANSACTION' || data.action === 'CORRECT_TRANSACTION');

      updateOrAppendTxRow(sheet, tx, isUpdateAction);

      try { updateRecapSheets(ss); } catch (recapErr) { console.warn('Gagal update rekap:', recapErr.message); }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: data.action === 'TRANSACTION' ? 'Transaction recorded' : 'Transaction updated',
        id: tx.id
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. PEMBATALAN / PENGHAPUSAN TRANSAKSI
    if (data.action === 'DELETE_TRANSACTION') {
      var sheetDel = getOrCreateSheet(ss, 'Transaksi Keuangan', txHeaders, '#1B5E20');
      var txDel = data.transaction || {};
      var deleted = deleteTxRow(sheetDel, txDel.id);

      try { updateRecapSheets(ss); } catch (recapErr) { console.warn('Gagal update rekap:', recapErr.message); }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: deleted ? 'Transaction deleted' : 'Transaction not found',
        id: txDel.id
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. REKONSILIASI TOTAL DARI BOT (OVERWRITE & REFRESH)
    if (data.action === 'RECONCILE_ALL') {
      var sheetRec = getOrCreateSheet(ss, 'Transaksi Keuangan', txHeaders, '#1B5E20');
      var txs = data.transactions || [];

      // Clear existing rows (keep header)
      var curLast = sheetRec.getLastRow();
      if (curLast > 1) {
        sheetRec.deleteRows(2, curLast - 1);
      }

      for (var t = 0; t < txs.length; t++) {
        updateOrAppendTxRow(sheetRec, txs[t]);
      }

      try { updateRecapSheets(ss); } catch (recapErr) { console.warn(recapErr.message); }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Reconciliation complete',
        count: txs.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. TRIGGER REKAP MANUAL DARI BOT
    if (data.action === 'REFRESH_RECAP' || data.action === 'RECAP') {
      updateRecapSheets(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Rekap Mingguan & Bulanan berhasil diperbarui.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. RUTINITAS & HABIT
    if (data.action === 'HABIT') {
      var sheetHabit = getOrCreateSheet(ss, 'Rutinitas & Kebiasaan', [
        'Timestamp', 'Tanggal', 'Waktu', 'Aktivitas / Habit', 'Nilai / Status', 'Catatan'
      ], '#0D47A1');
      var habit = data.habit || {};
      sheetHabit.appendRow([
        new Date(),
        Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'),
        habit.time || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm'),
        (habit.habit || '').toUpperCase(),
        habit.value || '',
        habit.notes || ''
      ]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Habit recorded' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 6. TARGET & GOALS
    if (data.action === 'GOAL') {
      var sheetGoal = getOrCreateSheet(ss, 'Target & Evaluasi', [
        'Timestamp', 'Kategori', 'Judul Target', 'Tolok Ukur', 'Target Tanggal', 'Pemilik'
      ], '#E65100');
      var goal = data.goal || {};
      sheetGoal.appendRow([
        new Date(), (goal.category || '').toUpperCase(), goal.title || '', goal.metrics || '', goal.targetDate || '', goal.owner === 'partner' ? 'Calon Istri' : 'Owner (Bro)'
      ]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Goal recorded' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No active spreadsheet.' })).setMimeType(ContentService.MimeType.JSON);
  }

  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action.toLowerCase() : '';

  // 1. Refresh Rekap
  if (action === 'refresh') {
    updateRecapSheets(ss);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Recap updated' })).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. READ FINANCES (SPS AS SINGLE SOURCE OF TRUTH)
  if (action === 'get_finances' || action === 'read' || action === 'get_transactions') {
    var sheet = ss.getSheetByName('Transaksi Keuangan');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        transactions: [],
        balances: { personal: 0, business: 0, total: 0 },
        message: 'Sheet Transaksi Keuangan belum memiliki data.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        transactions: [],
        balances: { personal: 0, business: 0, total: 0 }
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    var filterSource = (e.parameter.source || '').trim().toLowerCase();
    var filterMonth = (e.parameter.month || '').trim(); // e.g. "2026-11"

    var txList = [];
    var totalIncome = 0;
    var totalExpense = 0;
    var personalBal = 0;
    var businessBal = 0;

    var sourceIncome = 0;
    var sourceExpense = 0;
    var sourceTxCount = 0;
    var sourceTxs = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var rawAmt = row[4];
      var amt = 0;
      if (typeof rawAmt === 'number') {
        amt = rawAmt;
      } else {
        amt = parseFloat(String(rawAmt || '').replace(/[^0-9.-]+/g, '')) || 0;
      }

      var jenisStr = String(row[3] || '').toLowerCase().trim();
      var isIncome = jenisStr.includes('pemasukan') || jenisStr === 'income';
      var isExpense = jenisStr.includes('pengeluaran') || jenisStr === 'expense';
      var akunStr = String(row[7] || '').toLowerCase().trim();
      var isBiz = akunStr.includes('bisnis') || akunStr.includes('business');

      var dateStr = String(row[1] || '').trim();
      var descStr = String(row[6] || '').trim();
      var catStr = String(row[5] || '').trim();
      var txId = String(row[9] || '').trim();

      var txObj = {
        id: txId,
        timestamp: row[0],
        date: dateStr,
        time: String(row[2] || ''),
        type: isIncome ? 'income' : 'expense',
        amount: amt,
        category: catStr,
        description: descStr,
        isBusiness: isBiz,
        owner: String(row[8] || 'owner')
      };

      txList.push(txObj);

      if (isIncome) {
        totalIncome += amt;
        if (isBiz) businessBal += amt; else personalBal += amt;
      } else if (isExpense) {
        totalExpense += amt;
        if (isBiz) businessBal -= amt; else personalBal -= amt;
      }

      // Check specific source filter (e.g. KEYNEX)
      if (filterSource) {
        var matchSource = descStr.toLowerCase().includes(filterSource) || catStr.toLowerCase().includes(filterSource);
        var matchMonth = !filterMonth || dateStr.startsWith(filterMonth);
        if (matchSource && matchMonth) {
          sourceTxCount++;
          if (isIncome) sourceIncome += amt;
          if (isExpense) sourceExpense += amt;
          sourceTxs.push(txObj);
        }
      }
    }

    var resultPayload = {
      status: 'success',
      spreadsheetName: ss.getName(),
      totalTransactions: txList.length,
      balances: {
        personal: personalBal,
        business: businessBal,
        total: personalBal + businessBal
      },
      summary: {
        totalIncome: totalIncome,
        totalExpense: totalExpense,
        netCashflow: totalIncome - totalExpense
      },
      transactions: txList.slice(-50).reverse() // recent 50
    };

    if (filterSource) {
      resultPayload.sourceFilter = filterSource;
      resultPayload.sourceSummary = {
        source: filterSource,
        month: filterMonth || 'Semua Periode',
        income: sourceIncome,
        expense: sourceExpense,
        netProfit: sourceIncome - sourceExpense,
        transactionCount: sourceTxCount,
        transactions: sourceTxs
      };
    }

    return ContentService.createTextOutput(JSON.stringify(resultPayload)).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'online',
    message: 'NEX Google Sheets Webhook is ready!',
    spreadsheetName: ss ? ss.getName() : 'Unknown'
  })).setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// HELPER TRANSAKSI: UPDATE IN-PLACE ATAU APPEND
// =========================================================================
function updateOrAppendTxRow(sheet, tx, isExplicitUpdate) {
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  // 1. Cari berdasarkan ID Transaksi di Kolom 10
  if (lastRow > 1 && tx.id) {
    var ids = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (ids[i][0] === tx.id) {
        foundRow = i + 2;
        break;
      }
    }
  }

  // 2. Fallback untuk data lama (jika kolom 10 belum ada ID dan ini adalah aksi koreksi)
  if (foundRow === -1 && lastRow > 1 && isExplicitUpdate) {
    var searchLimit = Math.min(lastRow - 1, 30);
    var startRow = lastRow - searchLimit + 1;
    var rows = sheet.getRange(startRow, 1, searchLimit, 10).getValues();

    for (var r = rows.length - 1; r >= 0; r--) {
      var row = rows[r];
      var rJenis = String(row[3] || '').toLowerCase();
      var rAmt = (typeof row[4] === 'number') ? row[4] : (parseFloat(String(row[4] || '').replace(/[^0-9.-]+/g, '')) || 0);
      var rId = String(row[9] || '').trim();

      if (tx.previous) {
        var prevType = (tx.previous.type === 'income' ? 'pemasukan' : 'pengeluaran');
        var prevAmt = Number(tx.previous.amount) || 0;
        if (rJenis.includes(prevType) && Math.abs(rAmt - prevAmt) < 1) {
          foundRow = startRow + r;
          break;
        }
      } else if (!rId) {
        var targetAmt = Number(tx.amount) || 0;
        if (Math.abs(rAmt - targetAmt) < 1) {
          foundRow = startRow + r;
          break;
        }
      }
    }
  }

  var dateParts = (tx.date || '').split(' ');
  var tgl = dateParts[0] || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  var wkt = dateParts[1] || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm:ss');

  var tipeMap = {
    'income': 'Pemasukan',
    'expense': 'Pengeluaran',
    'savings': 'Tabungan',
    'emergency': 'Dana Darurat',
    'debt_payment': 'Bayar Utang'
  };
  var jenisLabel = tipeMap[tx.type] || (tx.type ? tx.type.toUpperCase() : 'PENGELUARAN');

  var row = [
    new Date(),
    tgl,
    wkt,
    jenisLabel,
    tx.amount || 0,
    tx.category || 'Umum',
    tx.description || '',
    tx.isBusiness ? 'BISNIS' : 'PRIBADI',
    tx.owner === 'partner' ? 'Calon Istri' : 'Owner (Bro)',
    tx.id || ''
  ];

  var targetRow;
  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, row.length).setValues([row]);
    targetRow = foundRow;
  } else {
    sheet.appendRow(row);
    targetRow = sheet.getLastRow();
  }

  sheet.getRange(targetRow, 5).setNumberFormat('"Rp"#,##0');
  var jenisCell = sheet.getRange(targetRow, 4);
  if (tx.type === 'income') {
    jenisCell.setFontColor('#2E7D32').setFontWeight('bold');
  } else if (tx.type === 'expense') {
    jenisCell.setFontColor('#C62828').setFontWeight('bold');
  }
}

function deleteTxRow(sheet, txId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1 || !txId) return false;
  var ids = sheet.getRange(2, 10, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === txId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

// =========================================================================
// MENU SPREADSHEET (MUNCUL DI MENU ATAS GOOGLE SHEETS)
// =========================================================================
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('🤖 NEX Bot')
      .addItem('🔄 Perbarui Rekap Mingguan & Bulanan', 'manualRefreshRecap')
      .addSeparator()
      .addItem('📅 Buka Tab Rekap Bulanan', 'openMonthlyTab')
      .addItem('📆 Buka Tab Rekap Mingguan', 'openWeeklyTab')
      .addToUi();
  } catch (_) {}
}

function manualRefreshRecap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  updateRecapSheets(ss);
  SpreadsheetApp.getUi().alert('✅ Berhasil!\n\nTab "Rekap Bulanan" dan "Rekap Mingguan" telah diperbarui.');
}

function openMonthlyTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Rekap Bulanan');
  if (sheet) ss.setActiveSheet(sheet);
}

function openWeeklyTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Rekap Mingguan');
  if (sheet) ss.setActiveSheet(sheet);
}

// =========================================================================
// AGREGASI REKAPITULASI BULANAN & MINGGUAN (SSOT)
// =========================================================================
var monthNamesIndo = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var monthShortIndo = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatRibuan(num) {
  if (!num) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseRowDate(rawDate) {
  if (!rawDate) return new Date();
  if (rawDate instanceof Date) return rawDate;
  var str = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    var parts = str.split(' ')[0].split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  var parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getWeekRange(dateObj) {
  var d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  var day = d.getDay();
  var diffToMonday = (day === 0 ? -6 : 1) - day;
  var monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: monday, sunday: sunday };
}

function updateRecapSheets(ss) {
  var txSheet = ss.getSheetByName('Transaksi Keuangan');
  if (!txSheet) return;

  var lastRow = txSheet.getLastRow();
  var transactions = [];

  if (lastRow > 1) {
    var data = txSheet.getRange(2, 1, lastRow - 1, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var jenisStr = String(row[3] || '').toLowerCase().trim();
      if (jenisStr.includes('batal') || jenisStr.includes('cancel')) {
        continue; // Skip cancelled transactions
      }

      var d = parseRowDate(row[1] || row[0]);
      var isIncome = jenisStr.includes('pemasukan') || jenisStr === 'income';
      var isExpense = jenisStr.includes('pengeluaran') || jenisStr === 'expense';
      var isSavings = jenisStr.includes('tabungan') || jenisStr.includes('darurat') || jenisStr === 'savings' || jenisStr === 'emergency';

      var rawAmt = row[4];
      var amt = (typeof rawAmt === 'number') ? rawAmt : (parseFloat(String(rawAmt || '').replace(/[^0-9.-]+/g, '')) || 0);

      transactions.push({
        date: d,
        amount: amt,
        isIncome: isIncome,
        isExpense: isExpense,
        isSavings: isSavings,
        category: String(row[5] || 'Umum').trim()
      });
    }
  }

  buildMonthlyRecapSheet(ss, transactions);
  buildWeeklyRecapSheet(ss, transactions);
}

function buildMonthlyRecapSheet(ss, rawTransactions) {
  var sheet = ss.getSheetByName('Rekap Bulanan') || ss.insertSheet('Rekap Bulanan');
  sheet.clear();

  var monthlyMap = {};
  var totalIncome = 0, totalExpense = 0, totalSavings = 0;

  for (var i = 0; i < rawTransactions.length; i++) {
    var t = rawTransactions[i];
    var mKey = t.date.getFullYear() + '-' + pad2(t.date.getMonth() + 1);
    var mLabel = monthNamesIndo[t.date.getMonth()] + ' ' + t.date.getFullYear();

    if (!monthlyMap[mKey]) monthlyMap[mKey] = { label: mLabel, income: 0, expense: 0, savings: 0 };
    if (t.isIncome) { monthlyMap[mKey].income += t.amount; totalIncome += t.amount; }
    else if (t.isExpense) { monthlyMap[mKey].expense += t.amount; totalExpense += t.amount; }
    else if (t.isSavings) { monthlyMap[mKey].savings += t.amount; totalSavings += t.amount; }
  }

  var sortedKeys = Object.keys(monthlyMap).sort();
  var netTotal = totalIncome - totalExpense;

  sheet.getRange('A1:G1').merge().setValue('📅 REKAPITULASI KEUANGAN BULANAN - NEX').setFontWeight('bold').setFontSize(13).setBackground('#004D40').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 35);
  sheet.getRange('A2:G2').merge().setValue('Otomatis diperbarui real-time | Terakhir: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm:ss') + ' WIB').setFontStyle('italic').setFontSize(9).setFontColor('#546E7A').setHorizontalAlignment('center');
  sheet.setRowHeight(2, 20);

  sheet.getRange('A4:B4').merge().setValue('TOTAL PEMASUKAN').setFontWeight('bold').setFontSize(9).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');
  sheet.getRange('A5:B5').merge().setValue(totalIncome).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');

  sheet.getRange('C4:D4').merge().setValue('TOTAL PENGELUARAN').setFontWeight('bold').setFontSize(9).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');
  sheet.getRange('C5:D5').merge().setValue(totalExpense).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');

  sheet.getRange('E4:E4').setValue('TABUNGAN').setFontWeight('bold').setFontSize(9).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');
  sheet.getRange('E5:E5').setValue(totalSavings).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');

  sheet.getRange('F4:G4').merge().setValue('NET CASHFLOW (SURPLUS)').setFontWeight('bold').setFontSize(9).setFontColor(netTotal >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');
  sheet.getRange('F5:G5').merge().setValue(netTotal).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor(netTotal >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');

  sheet.setRowHeight(4, 22); sheet.setRowHeight(5, 28);
  sheet.getRange('A7:G7').merge().setValue('📊 RINCIAN ARUS KAS PER BULAN').setFontWeight('bold').setFontSize(11).setFontColor('#004D40');

  var headers = ['Bulan', 'Pemasukan (Rp)', 'Pengeluaran (Rp)', 'Net Cashflow (Rp)', 'Tabungan (Rp)', 'Rasio Tabungan', 'Status Arus Kas'];
  sheet.getRange(8, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#004D40').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(8, 28);

  if (sortedKeys.length > 0) {
    var tableRows = [];
    for (var k = 0; k < sortedKeys.length; k++) {
      var item = monthlyMap[sortedKeys[k]];
      var net = item.income - item.expense;
      var savRatio = item.income > 0 ? (item.savings / item.income) : 0;
      var status = net > 0 ? 'SURPLUS ✅' : (net < 0 ? 'DEFISIT ⚠️' : 'SEIMBANG ⚖️');
      tableRows.push([item.label, item.income, item.expense, net, item.savings, savRatio, status]);
    }

    var startRow = 9;
    sheet.getRange(startRow, 1, tableRows.length, headers.length).setValues(tableRows);
    sheet.getRange(startRow, 2, tableRows.length, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(startRow, 6, tableRows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');

    for (var r = 0; r < tableRows.length; r++) {
      var currRow = startRow + r;
      var netVal = tableRows[r][3];
      var netCell = sheet.getRange(currRow, 4);
      netCell.setFontWeight('bold');
      if (netVal > 0) netCell.setFontColor('#2E7D32');
      else if (netVal < 0) netCell.setFontColor('#C62828');

      var statusCell = sheet.getRange(currRow, 7);
      statusCell.setHorizontalAlignment('center').setFontWeight('bold');
      if (netVal > 0) statusCell.setFontColor('#2E7D32');
      else if (netVal < 0) statusCell.setFontColor('#C62828');

      sheet.getRange(currRow, 1).setFontWeight('bold');
      sheet.setRowHeight(currRow, 24);
    }

    var totalRowNum = startRow + tableRows.length;
    var overallStatus = netTotal > 0 ? 'SURPLUS TOTAL ✅' : (netTotal < 0 ? 'DEFISIT TOTAL ⚠️' : 'SEIMBANG ⚖️');
    var overallRatio = totalIncome > 0 ? (totalSavings / totalIncome) : 0;

    sheet.getRange(totalRowNum, 1, 1, headers.length).setValues([['TOTAL KESELURUHAN', totalIncome, totalExpense, netTotal, totalSavings, overallRatio, overallStatus]]);
    sheet.getRange(totalRowNum, 1, 1, headers.length).setFontWeight('bold').setBackground('#ECEFF1');
    sheet.getRange(totalRowNum, 2, 1, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(totalRowNum, 6, 1, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sheet.getRange(totalRowNum, 7, 1, 1).setHorizontalAlignment('center');
    sheet.setRowHeight(totalRowNum, 26);
    sheet.getRange(8, 1, tableRows.length + 2, headers.length).setBorder(true, true, true, true, true, true, '#CFD8DC', SpreadsheetApp.BorderStyle.SOLID);
  }

  sheet.setFrozenRows(8);
  for (var c = 1; c <= headers.length; c++) { sheet.autoResizeColumn(c); }
}

function buildWeeklyRecapSheet(ss, rawTransactions) {
  var sheet = ss.getSheetByName('Rekap Mingguan') || ss.insertSheet('Rekap Mingguan');
  sheet.clear();

  var weeklyMap = {};
  var totalIncome = 0, totalExpense = 0;
  var todayRange = getWeekRange(new Date());
  var thisWeekKey = todayRange.monday.getFullYear() + '-' + pad2(todayRange.monday.getMonth() + 1) + '-' + pad2(todayRange.monday.getDate());

  for (var i = 0; i < rawTransactions.length; i++) {
    var t = rawTransactions[i];
    var range = getWeekRange(t.date);
    var wKey = range.monday.getFullYear() + '-' + pad2(range.monday.getMonth() + 1) + '-' + pad2(range.monday.getDate());
    var wLabel = pad2(range.monday.getDate()) + ' ' + monthShortIndo[range.monday.getMonth()] + ' - ' + pad2(range.sunday.getDate()) + ' ' + monthShortIndo[range.sunday.getMonth()] + ' ' + range.sunday.getFullYear();

    if (!weeklyMap[wKey]) weeklyMap[wKey] = { label: wLabel, income: 0, expense: 0, categories: {} };
    if (t.isIncome) { weeklyMap[wKey].income += t.amount; totalIncome += t.amount; }
    else if (t.isExpense) {
      weeklyMap[wKey].expense += t.amount; totalExpense += t.amount;
      var cat = t.category || 'Umum';
      weeklyMap[wKey].categories[cat] = (weeklyMap[wKey].categories[cat] || 0) + t.amount;
    }
  }

  var sortedKeys = Object.keys(weeklyMap).sort();
  var thisWeekData = weeklyMap[thisWeekKey] || { income: 0, expense: 0 };
  var thisWeekNet = thisWeekData.income - thisWeekData.expense;
  var thisWeekDailyAvg = Math.round(thisWeekData.expense / 7);

  sheet.getRange('A1:G1').merge().setValue('📆 REKAPITULASI KEUANGAN MINGGUAN - NEX').setFontWeight('bold').setFontSize(13).setBackground('#1A237E').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 35);
  sheet.getRange('A2:G2').merge().setValue('Evaluasi ritme pengeluaran mingguan & rata-rata harian | Terakhir: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm:ss') + ' WIB').setFontStyle('italic').setFontSize(9).setFontColor('#546E7A').setHorizontalAlignment('center');
  sheet.setRowHeight(2, 20);

  sheet.getRange('A4:B4').merge().setValue('PEMASUKAN MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');
  sheet.getRange('A5:B5').merge().setValue(thisWeekData.income).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');

  sheet.getRange('C4:D4').merge().setValue('PENGELUARAN MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');
  sheet.getRange('C5:D5').merge().setValue(thisWeekData.expense).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');

  sheet.getRange('E4:F4').merge().setValue('NET CASHFLOW MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor(thisWeekNet >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');
  sheet.getRange('E5:F5').merge().setValue(thisWeekNet).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor(thisWeekNet >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');

  sheet.getRange('G4:G4').setValue('RATA-RATA / HARI').setFontWeight('bold').setFontSize(9).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');
  sheet.getRange('G5:G5').setValue(thisWeekDailyAvg).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');

  sheet.setRowHeight(4, 22); sheet.setRowHeight(5, 28);
  sheet.getRange('A7:G7').merge().setValue('📊 RINCIAN KINERJA KEUANGAN PER MINGGU').setFontWeight('bold').setFontSize(11).setFontColor('#1A237E');

  var headers = ['Periode Minggu', 'Pemasukan (Rp)', 'Pengeluaran (Rp)', 'Net Mingguan (Rp)', 'Rata-rata / Hari', 'Status Evaluasi', 'Top Kategori Pengeluaran'];
  sheet.getRange(8, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1A237E').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(8, 28);

  if (sortedKeys.length > 0) {
    var tableRows = [];
    for (var k = 0; k < sortedKeys.length; k++) {
      var item = weeklyMap[sortedKeys[k]];
      var net = item.income - item.expense;
      var dailyAvg = Math.round(item.expense / 7);

      var topCatStr = '-';
      var maxCat = 0;
      var catKeys = Object.keys(item.categories);
      for (var c = 0; c < catKeys.length; c++) {
        if (item.categories[catKeys[c]] > maxCat) {
          maxCat = item.categories[catKeys[c]];
          topCatStr = catKeys[c] + ' (Rp ' + formatRibuan(maxCat) + ')';
        }
      }

      var status = 'HEMAT 🟢';
      if (item.expense === 0) status = 'AMAN ⚪';
      else if (item.income > 0 && item.expense > item.income) status = 'WASPADA 🔴';
      else if (item.income > 0 && item.expense > item.income * 0.7) status = 'TERKENDALI 🟡';
      else if (item.income === 0 && item.expense > 0) status = 'PENGELUARAN 🟡';

      tableRows.push([item.label, item.income, item.expense, net, dailyAvg, status, topCatStr]);
    }

    var startRow = 9;
    sheet.getRange(startRow, 1, tableRows.length, headers.length).setValues(tableRows);
    sheet.getRange(startRow, 2, tableRows.length, 4).setNumberFormat('"Rp"#,##0');

    for (var r = 0; r < tableRows.length; r++) {
      var currRow = startRow + r;
      var netVal = tableRows[r][3];
      var netCell = sheet.getRange(currRow, 4);
      netCell.setFontWeight('bold');
      if (netVal > 0) netCell.setFontColor('#2E7D32');
      else if (netVal < 0) netCell.setFontColor('#C62828');

      var statusCell = sheet.getRange(currRow, 6);
      statusCell.setHorizontalAlignment('center').setFontWeight('bold');
      sheet.getRange(currRow, 1).setFontWeight('bold');
      sheet.setRowHeight(currRow, 24);
    }

    var totalRowNum = startRow + tableRows.length;
    var totalNet = totalIncome - totalExpense;
    var avgDailyTotal = Math.round(totalExpense / (tableRows.length * 7 || 1));
    var overallStatus = totalNet >= 0 ? 'SURPLUS TOTAL ✅' : 'DEFISIT TOTAL ⚠️';

    sheet.getRange(totalRowNum, 1, 1, headers.length).setValues([['TOTAL KESELURUHAN', totalIncome, totalExpense, totalNet, avgDailyTotal, overallStatus, '-']]);
    sheet.getRange(totalRowNum, 1, 1, headers.length).setFontWeight('bold').setBackground('#ECEFF1');
    sheet.getRange(totalRowNum, 2, 1, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(totalRowNum, 6, 1, 1).setHorizontalAlignment('center');
    sheet.setRowHeight(totalRowNum, 26);
    sheet.getRange(8, 1, tableRows.length + 2, headers.length).setBorder(true, true, true, true, true, true, '#CFD8DC', SpreadsheetApp.BorderStyle.SOLID);
  }

  sheet.setFrozenRows(8);
  for (var c = 1; c <= headers.length; c++) { sheet.autoResizeColumn(c); }
}

function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold').setBackground(headerColor || '#37474F').setFontColor('#FFFFFF').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    for (var i = 1; i <= headers.length; i++) { sheet.autoResizeColumn(i); }
  }
  return sheet;
}
