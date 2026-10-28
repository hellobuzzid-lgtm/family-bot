/**
 * =========================================================================
 * GOOGLE APPS SCRIPT UNTUK BOT NEX (AI PERSONAL LIFE PARTNER)
 * =========================================================================
 * Script ini menerima data transaksi, rutinitas, dan target dari bot WhatsApp
 * dan otomatis mencatatnya secara rapi di Google Spreadsheet Anda.
 * 
 * CARA PEMASANGAN (HANYA 1 MENIT):
 * 1. Buat Spreadsheet baru di Google Drive (https://sheets.new)
 * 2. Beri nama file, misalnya: "Catatan Keuangan & Rutinitas NEX"
 * 3. Klik menu: Ekstensi (Extensions) > Apps Script
 * 4. Hapus semua kode default di editor, lalu PASTE SELURUH KODE DI BAWAH INI
 * 5. Klik icon Save (Disket / Ctrl+S)
 * 6. Klik tombol biru di kanan atas: "Terapkan" (Deploy) > "Penerapan baru" (New deployment)
 * 7. Pada roda gigi (Select type), pilih: "Aplikasi web" (Web app)
 * 8. Konfigurasi:
 *    - Deskripsi: Bot NEX
 *    - Jalankan sebagai (Execute as): Saya (email Anda)
 *    - Siapa yang memiliki akses (Who has access): Siapa saja (Anyone) -> WAJIB agar bot bisa kirim data!
 * 9. Klik "Terapkan" (Deploy) -> jika diminta izin akun Google, klik Lanjutkan/Authorize > Izinkan.
 * 10. SALIN "URL Aplikasi Web" (URL berakhiran /exec).
 * 11. Masukkan URL tersebut ke file .env atau Environment Variables di Railway:
 *     GOOGLE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/xxxx/exec
 *     GOOGLE_SHEET_URL=https://docs.google.com/spreadsheets/d/xxxx/edit
 * =========================================================================
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No payload' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

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

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Transaction recorded', id: tx.id }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. SINKRONISASI RUTINITAS & KEBIASAAN
    if (data.action === 'HABIT') {
      var sheet = getOrCreateSheet(ss, 'Rutinitas & Kebiasaan', [
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

      sheet.appendRow([
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

    // 3. SINKRONISASI TARGET & GOALS
    if (data.action === 'GOAL') {
      var sheet = getOrCreateSheet(ss, 'Target & Evaluasi', [
        'Timestamp',
        'Kategori',
        'Judul Target',
        'Tolok Ukur',
        'Target Tanggal',
        'Pemilik'
      ], '#E65100'); // Oranye Tua Elegan

      var goal = data.goal || {};
      sheet.appendRow([
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
  return ContentService.createTextOutput(JSON.stringify({
    status: 'online',
    message: 'NEX Google Sheets Webhook is ready to receive data!'
  })).setMimeType(ContentService.MimeType.JSON);
}

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
