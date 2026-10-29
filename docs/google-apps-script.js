/**
 * =========================================================================
 * GOOGLE APPS SCRIPT UNTUK BOT NEX (AI PERSONAL LIFE PARTNER)
 * =========================================================================
 * Fitur Utama:
 * 1. Otomatis mencatat setiap transaksi keuangan ke tab "Transaksi Keuangan".
 * 2. Otomatis menghasilkan & memperbarui tab "Rekap Bulanan" (Arus Kas, Tabungan, Status).
 * 3. Otomatis menghasilkan & memperbarui tab "Rekap Mingguan" (Ritme Pengeluaran, Rata-rata Harian).
 * 4. Otomatis mencatat log rutinitas & habit ke tab "Rutinitas & Kebiasaan".
 * 5. Otomatis mencatat target/goals ke tab "Target & Evaluasi".
 * 6. Menyediakan menu interaktif di Spreadsheet: "🤖 NEX Bot" > "Perbarui Rekap".
 * 
 * PANDUAN PEMBARUAN KODE:
 * 1. Buka spreadsheet Anda di Google Drive.
 * 2. Klik menu: Ekstensi (Extensions) > Apps Script.
 * 3. Hapus seluruh isi editor lama, lalu PASTE SELURUH KODE DI FILE INI.
 * 4. Klik icon Save (Disket / Ctrl+S).
 * 5. Klik "Terapkan" (Deploy) > "Kelola penerapan" (Manage deployments) > klik icon Pensil (Edit) > ubah Versi ke "Versi baru" (New version) > klik "Terapkan" (Deploy).
 *    (Atau klik "Penerapan baru" / New deployment > Aplikasi web > Siapa saja / Anyone).
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
      try {
        data = JSON.parse(raw);
      } catch (pErr) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'No active spreadsheet. Pastikan Apps Script dibuat melalui menu Ekstensi > Apps Script di dalam file Google Spreadsheet Anda.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. SINKRONISASI TRANSAKSI KEUANGAN
    if (data.action === 'TRANSACTION') {
      var sheet = getOrCreateSheet(ss, 'Transaksi Keuangan', [
        'Timestamp',
        'Tanggal',
        'Waktu',
        'Jenis',
        'Nominal (Rp)',
        'Kategori',
        'Keterangan',
        'Akun',
        'Pencatat',
        'ID Transaksi'
      ], '#1B5E20'); // Hijau Tua Elegan

      var tx = data.transaction || {};
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

      sheet.appendRow(row);
      var lastRow = sheet.getLastRow();
      
      // Format kolom Nominal (Kolom 5) sebagai Rupiah
      sheet.getRange(lastRow, 5).setNumberFormat('"Rp"#,##0');
      
      // Pewarnaan teks status
      var jenisCell = sheet.getRange(lastRow, 4);
      if (tx.type === 'income') {
        jenisCell.setFontColor('#2E7D32').setFontWeight('bold');
      } else if (tx.type === 'expense') {
        jenisCell.setFontColor('#C62828').setFontWeight('bold');
      }

      // OTOMATIS PERBARUI TAB REKAP BULANAN & MINGGUAN
      try {
        updateRecapSheets(ss);
      } catch (recapErr) {
        console.warn('Gagal memperbarui rekap:', recapErr.message);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Transaction recorded and recaps updated',
        id: tx.id
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. TRIGGER REKAP MANUAL DARI BOT / WEBHOOK
    if (data.action === 'REFRESH_RECAP' || data.action === 'RECAP') {
      updateRecapSheets(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Rekap Mingguan & Bulanan berhasil diperbarui.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. SINKRONISASI RUTINITAS & KEBIASAAN
    if (data.action === 'HABIT') {
      var sheetHabit = getOrCreateSheet(ss, 'Rutinitas & Kebiasaan', [
        'Timestamp',
        'Tanggal',
        'Waktu',
        'Aktivitas / Habit',
        'Nilai / Status',
        'Catatan'
      ], '#0D47A1'); // Biru Tua Elegan

      var habit = data.habit || {};
      var tglNow = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
      var wktNow = habit.time || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm');

      sheetHabit.appendRow([
        new Date(),
        tglNow,
        wktNow,
        (habit.habit || '').toUpperCase(),
        habit.value || '',
        habit.notes || ''
      ]);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Habit recorded' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 4. SINKRONISASI TARGET & GOALS
    if (data.action === 'GOAL') {
      var sheetGoal = getOrCreateSheet(ss, 'Target & Evaluasi', [
        'Timestamp',
        'Kategori',
        'Judul Target',
        'Tolok Ukur',
        'Target Tanggal',
        'Pemilik'
      ], '#E65100'); // Oranye Tua Elegan

      var goal = data.goal || {};
      sheetGoal.appendRow([
        new Date(),
        (goal.category || '').toUpperCase(),
        goal.title || '',
        goal.metrics || '',
        goal.targetDate || '',
        goal.owner === 'partner' ? 'Calon Istri' : 'Owner (Bro)'
      ]);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Goal recorded' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ignored', message: 'Action not handled' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (e && e.parameter && e.parameter.action === 'refresh') {
    if (ss) {
      updateRecapSheets(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Rekap Mingguan & Bulanan berhasil diperbarui.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'online',
    message: 'NEX Google Sheets Webhook is ready to receive data!',
    spreadsheetName: ss ? ss.getName() : 'Unknown'
  })).setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// MENU INTERAKTIF SPREADSHEET (MUNCUL DI MENU ATAS SPREADSHEET)
// =========================================================================
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('🤖 NEX Bot')
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
  SpreadsheetApp.getUi().alert('✅ Berhasil!\n\nTab "Rekap Bulanan" dan "Rekap Mingguan" telah diperbarui dengan data transaksi terbaru.');
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
// LOGIKA AGREGASI REKAP BULANAN & MINGGUAN
// =========================================================================
var monthNamesIndo = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var monthShortIndo = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

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
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function getWeekRange(dateObj) {
  var d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  var day = d.getDay(); // 0: Minggu, 1: Senin, ..., 6: Sabtu
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
      var rawDate = row[1];
      if (!rawDate) rawDate = row[0];
      var d = parseRowDate(rawDate);

      var jenisStr = String(row[3] || '').toLowerCase().trim();
      var isIncome = jenisStr.includes('pemasukan') || jenisStr === 'income';
      var isExpense = jenisStr.includes('pengeluaran') || jenisStr === 'expense';
      var isSavings = jenisStr.includes('tabungan') || jenisStr.includes('darurat') || jenisStr === 'savings' || jenisStr === 'emergency';
      var isDebt = jenisStr.includes('utang') || jenisStr.includes('cicilan') || jenisStr === 'debt_payment';

      var rawAmt = row[4];
      var amt = 0;
      if (typeof rawAmt === 'number') {
        amt = rawAmt;
      } else if (rawAmt) {
        var cleanAmt = String(rawAmt).replace(/[^0-9.-]+/g, '');
        amt = parseFloat(cleanAmt) || 0;
      }

      var category = String(row[5] || 'Umum').trim();
      var description = String(row[6] || '').trim();
      var account = String(row[7] || 'PRIBADI').trim();
      var owner = String(row[8] || 'Owner (Bro)').trim();

      transactions.push({
        date: d,
        amount: amt,
        type: jenisStr,
        isIncome: isIncome,
        isExpense: isExpense,
        isSavings: isSavings,
        isDebt: isDebt,
        category: category,
        description: description,
        account: account,
        owner: owner
      });
    }
  }

  buildMonthlyRecapSheet(ss, transactions);
  buildWeeklyRecapSheet(ss, transactions);
}

// -------------------------------------------------------------------------
// TAB 1: REKAP BULANAN
// -------------------------------------------------------------------------
function buildMonthlyRecapSheet(ss, rawTransactions) {
  var sheetName = 'Rekap Bulanan';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();

  var monthlyMap = {};
  var totalIncome = 0;
  var totalExpense = 0;
  var totalSavings = 0;

  for (var i = 0; i < rawTransactions.length; i++) {
    var t = rawTransactions[i];
    var mKey = t.date.getFullYear() + '-' + pad2(t.date.getMonth() + 1);
    var mLabel = monthNamesIndo[t.date.getMonth()] + ' ' + t.date.getFullYear();

    if (!monthlyMap[mKey]) {
      monthlyMap[mKey] = {
        key: mKey,
        label: mLabel,
        income: 0,
        expense: 0,
        savings: 0,
        categories: {}
      };
    }

    if (t.isIncome) {
      monthlyMap[mKey].income += t.amount;
      totalIncome += t.amount;
    } else if (t.isExpense) {
      monthlyMap[mKey].expense += t.amount;
      totalExpense += t.amount;
      var cat = t.category || 'Umum';
      monthlyMap[mKey].categories[cat] = (monthlyMap[mKey].categories[cat] || 0) + t.amount;
    } else if (t.isSavings) {
      monthlyMap[mKey].savings += t.amount;
      totalSavings += t.amount;
    }
  }

  var sortedKeys = Object.keys(monthlyMap).sort();
  var netTotal = totalIncome - totalExpense;

  // Banner
  sheet.getRange('A1:G1').merge()
    .setValue('📅 REKAPITULASI KEUANGAN BULANAN - NEX')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground('#004D40')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 35);

  sheet.getRange('A2:G2').merge()
    .setValue('Otomatis diperbarui secara real-time | Terakhir: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm:ss') + ' WIB')
    .setFontStyle('italic')
    .setFontSize(9)
    .setFontColor('#546E7A')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 20);

  // KPI Cards
  sheet.getRange('A4:B4').merge().setValue('TOTAL PEMASUKAN').setFontWeight('bold').setFontSize(9).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');
  sheet.getRange('A5:B5').merge().setValue(totalIncome).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');

  sheet.getRange('C4:D4').merge().setValue('TOTAL PENGELUARAN').setFontWeight('bold').setFontSize(9).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');
  sheet.getRange('C5:D5').merge().setValue(totalExpense).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');

  sheet.getRange('E4:E4').setValue('TABUNGAN').setFontWeight('bold').setFontSize(9).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');
  sheet.getRange('E5:E5').setValue(totalSavings).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');

  sheet.getRange('F4:G4').merge().setValue('NET CASHFLOW (SURPLUS)').setFontWeight('bold').setFontSize(9).setFontColor(netTotal >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');
  sheet.getRange('F5:G5').merge().setValue(netTotal).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor(netTotal >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 28);

  // Section Title
  sheet.getRange('A7:G7').merge()
    .setValue('📊 RINCIAN ARUS KAS PER BULAN')
    .setFontWeight('bold')
    .setFontSize(11)
    .setFontColor('#004D40');

  // Table Headers
  var headers = ['Bulan', 'Pemasukan (Rp)', 'Pengeluaran (Rp)', 'Net Cashflow (Rp)', 'Tabungan (Rp)', 'Rasio Tabungan', 'Status Arus Kas'];
  sheet.getRange(8, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#004D40')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(8, 28);

  // Table Rows
  if (sortedKeys.length === 0) {
    sheet.getRange('A9:G9').merge()
      .setValue('Belum ada data transaksi yang tercatat.')
      .setFontStyle('italic')
      .setFontColor('#78909C')
      .setHorizontalAlignment('center');
  } else {
    var tableRows = [];
    for (var k = 0; k < sortedKeys.length; k++) {
      var item = monthlyMap[sortedKeys[k]];
      var net = item.income - item.expense;
      var savRatio = item.income > 0 ? (item.savings / item.income) : 0;
      var status = net > 0 ? 'SURPLUS ✅' : (net < 0 ? 'DEFISIT ⚠️' : 'SEIMBANG ⚖️');

      tableRows.push([
        item.label,
        item.income,
        item.expense,
        net,
        item.savings,
        savRatio,
        status
      ]);
    }

    var startRow = 9;
    sheet.getRange(startRow, 1, tableRows.length, headers.length).setValues(tableRows);

    sheet.getRange(startRow, 2, tableRows.length, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(startRow, 6, tableRows.length, 1).setNumberFormat('0.0%');

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
      sheet.getRange(currRow, 6).setHorizontalAlignment('center');
      sheet.setRowHeight(currRow, 24);
    }

    var totalRowNum = startRow + tableRows.length;
    var overallStatus = netTotal > 0 ? 'SURPLUS TOTAL ✅' : (netTotal < 0 ? 'DEFISIT TOTAL ⚠️' : 'SEIMBANG ⚖️');
    var overallRatio = totalIncome > 0 ? (totalSavings / totalIncome) : 0;

    sheet.getRange(totalRowNum, 1, 1, headers.length).setValues([[
      'TOTAL KESELURUHAN',
      totalIncome,
      totalExpense,
      netTotal,
      totalSavings,
      overallRatio,
      overallStatus
    ]]);

    var totalRange = sheet.getRange(totalRowNum, 1, 1, headers.length);
    totalRange.setFontWeight('bold').setBackground('#ECEFF1');
    sheet.getRange(totalRowNum, 2, 1, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(totalRowNum, 6, 1, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sheet.getRange(totalRowNum, 7, 1, 1).setHorizontalAlignment('center');
    sheet.setRowHeight(totalRowNum, 26);

    sheet.getRange(8, 1, tableRows.length + 2, headers.length).setBorder(true, true, true, true, true, true, '#CFD8DC', SpreadsheetApp.BorderStyle.SOLID);
  }

  sheet.setFrozenRows(8);

  for (var c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
}

// -------------------------------------------------------------------------
// TAB 2: REKAP MINGGUAN
// -------------------------------------------------------------------------
function buildWeeklyRecapSheet(ss, rawTransactions) {
  var sheetName = 'Rekap Mingguan';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();

  var weeklyMap = {};
  var totalIncome = 0;
  var totalExpense = 0;

  var todayRange = getWeekRange(new Date());
  var thisWeekKey = todayRange.monday.getFullYear() + '-' + pad2(todayRange.monday.getMonth() + 1) + '-' + pad2(todayRange.monday.getDate());

  for (var i = 0; i < rawTransactions.length; i++) {
    var t = rawTransactions[i];
    var range = getWeekRange(t.date);
    var wKey = range.monday.getFullYear() + '-' + pad2(range.monday.getMonth() + 1) + '-' + pad2(range.monday.getDate());
    var wLabel = pad2(range.monday.getDate()) + ' ' + monthShortIndo[range.monday.getMonth()] + ' - ' + pad2(range.sunday.getDate()) + ' ' + monthShortIndo[range.sunday.getMonth()] + ' ' + range.sunday.getFullYear();

    if (!weeklyMap[wKey]) {
      weeklyMap[wKey] = {
        key: wKey,
        label: wLabel,
        income: 0,
        expense: 0,
        categories: {}
      };
    }

    if (t.isIncome) {
      weeklyMap[wKey].income += t.amount;
      totalIncome += t.amount;
    } else if (t.isExpense) {
      weeklyMap[wKey].expense += t.amount;
      totalExpense += t.amount;
      var cat = t.category || 'Umum';
      weeklyMap[wKey].categories[cat] = (weeklyMap[wKey].categories[cat] || 0) + t.amount;
    }
  }

  var sortedKeys = Object.keys(weeklyMap).sort();
  var thisWeekData = weeklyMap[thisWeekKey] || { income: 0, expense: 0 };
  var thisWeekNet = thisWeekData.income - thisWeekData.expense;
  var thisWeekDailyAvg = Math.round(thisWeekData.expense / 7);

  // Banner
  sheet.getRange('A1:G1').merge()
    .setValue('📆 REKAPITULASI KEUANGAN MINGGUAN - NEX')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground('#1A237E')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 35);

  sheet.getRange('A2:G2').merge()
    .setValue('Evaluasi ritme pengeluaran mingguan & rata-rata harian | Terakhir: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy HH:mm:ss') + ' WIB')
    .setFontStyle('italic')
    .setFontSize(9)
    .setFontColor('#546E7A')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 20);

  // KPI Cards (Minggu Ini)
  sheet.getRange('A4:B4').merge().setValue('PEMASUKAN MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');
  sheet.getRange('A5:B5').merge().setValue(thisWeekData.income).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#1B5E20').setBackground('#E8F5E9').setHorizontalAlignment('center');

  sheet.getRange('C4:D4').merge().setValue('PENGELUARAN MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');
  sheet.getRange('C5:D5').merge().setValue(thisWeekData.expense).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#B71C1C').setBackground('#FFEBEE').setHorizontalAlignment('center');

  sheet.getRange('E4:F4').merge().setValue('NET CASHFLOW MINGGU INI').setFontWeight('bold').setFontSize(9).setFontColor(thisWeekNet >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');
  sheet.getRange('E5:F5').merge().setValue(thisWeekNet).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor(thisWeekNet >= 0 ? '#1B5E20' : '#B71C1C').setBackground('#ECEFF1').setHorizontalAlignment('center');

  sheet.getRange('G4:G4').setValue('RATA-RATA / HARI').setFontWeight('bold').setFontSize(9).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');
  sheet.getRange('G5:G5').setValue(thisWeekDailyAvg).setNumberFormat('"Rp"#,##0').setFontWeight('bold').setFontSize(12).setFontColor('#0D47A1').setBackground('#E3F2FD').setHorizontalAlignment('center');

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 28);

  // Section Title
  sheet.getRange('A7:G7').merge()
    .setValue('📊 RINCIAN KINERJA KEUANGAN PER MINGGU')
    .setFontWeight('bold')
    .setFontSize(11)
    .setFontColor('#1A237E');

  // Table Headers
  var headers = ['Periode Minggu', 'Pemasukan (Rp)', 'Pengeluaran (Rp)', 'Net Mingguan (Rp)', 'Rata-rata / Hari', 'Status Evaluasi', 'Top Kategori Pengeluaran'];
  sheet.getRange(8, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1A237E')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(8, 28);

  // Table Rows
  if (sortedKeys.length === 0) {
    sheet.getRange('A9:G9').merge()
      .setValue('Belum ada data transaksi yang tercatat.')
      .setFontStyle('italic')
      .setFontColor('#78909C')
      .setHorizontalAlignment('center');
  } else {
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

      tableRows.push([
        item.label,
        item.income,
        item.expense,
        net,
        dailyAvg,
        status,
        topCatStr
      ]);
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

    sheet.getRange(totalRowNum, 1, 1, headers.length).setValues([[
      'TOTAL KESELURUHAN',
      totalIncome,
      totalExpense,
      totalNet,
      avgDailyTotal,
      overallStatus,
      '-'
    ]]);

    var totalRange = sheet.getRange(totalRowNum, 1, 1, headers.length);
    totalRange.setFontWeight('bold').setBackground('#ECEFF1');
    sheet.getRange(totalRowNum, 2, 1, 4).setNumberFormat('"Rp"#,##0');
    sheet.getRange(totalRowNum, 6, 1, 1).setHorizontalAlignment('center');
    sheet.setRowHeight(totalRowNum, 26);

    sheet.getRange(8, 1, tableRows.length + 2, headers.length).setBorder(true, true, true, true, true, true, '#CFD8DC', SpreadsheetApp.BorderStyle.SOLID);
  }

  sheet.setFrozenRows(8);

  for (var c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
}

// -------------------------------------------------------------------------
// HELPER: BUAT ATAU DAPATKAN SHEET
// -------------------------------------------------------------------------
function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground(headerColor || '#37474F');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    for (var i = 1; i <= headers.length; i++) {
      sheet.autoResizeColumn(i);
    }
  }
  return sheet;
}
