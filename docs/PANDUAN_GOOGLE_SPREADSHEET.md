# 📊 Panduan Menghubungkan Bot NEX ke Google Spreadsheet

Dengan integrasi ini, setiap kali Anda atau pasangan meminta **NEX** mencatat pengeluaran, pemasukan, atau rutinitas di WhatsApp, data akan **otomatis terupdate ke Google Spreadsheet secara real-time**!

---

## ⚡ Langkah Mudah Pemasangan (Hanya 1 Menit)

### 1. Buat Google Spreadsheet Baru
1. Buka browser dan kunjungi [sheets.new](https://sheets.new) (atau buat spreadsheet baru di Google Drive).
2. Beri nama file spreadsheet Anda, misalnya: **`Catatan Keuangan & Rutinitas NEX`**.

### 2. Buka Apps Script
1. Pada menu atas Google Sheets, klik **Ekstensi** (*Extensions*) > **Apps Script**.
2. Hapus seluruh isi kode bawaan yang ada di editor.

### 3. Salin & Tempel Kode Script
1. Salin seluruh kode yang ada di file [`docs/google-apps-script.js`](./google-apps-script.js) (atau dari chat ini).
2. Tempel (*paste*) ke dalam editor Apps Script.
3. Klik tombol **Simpan** (ikon disket / `Ctrl + S`).

### 4. Terapkan sebagai Aplikasi Web (Deploy as Web App)
1. Di pojok kanan atas, klik tombol biru **Terapkan** (*Deploy*) > **Penerapan baru** (*New deployment*).
2. Klik ikon gerigi di sebelah kiri (*Select type*), lalu pilih **Aplikasi web** (*Web app*).
3. Isi kolom pengaturan berikut:
   - **Deskripsi**: `NEX Bot Webhook`
   - **Jalankan sebagai** (*Execute as*): **Saya** (*Me / email Anda*)
   - **Siapa yang memiliki akses** (*Who has access*): **Siapa saja** (*Anyone*) ⚠️ *(Penting: pilih "Anyone" agar bot di Railway bisa mengirim data tanpa login akun Google)*.
4. Klik tombol **Terapkan** (*Deploy*).
5. Jika muncul jendela permintaan izin:
   - Klik **Tinjau Izin** (*Review permissions*).
   - Pilih akun Google Anda.
   - Klik **Lanjutan** (*Advanced*) > Klik **Buka (tidak aman)** (*Go to project*).
   - Klik **Izinkan** (*Allow*).
6. Salin **URL Aplikasi Web** yang muncul (URL berakhiran `/exec`).
   *Contoh format*: `https://script.google.com/macros/s/AKfycbx.../exec`

---

### 5. Masukkan ke Railway / File `.env`
Buka proyek Anda di **Railway** (atau file `.env` jika dijalankan di server lokal):
1. Masuk ke menu **Variables**.
2. Tambahkan variable:
   - **`GOOGLE_SHEET_WEBHOOK_URL`**: Tempelkan URL `/exec` yang tadi Anda salin.
   - **`GOOGLE_SHEET_URL`** *(opsional)*: Tempelkan link Google Spreadsheet Anda agar NEX bisa membagikan link saat ditanya.
3. Railway akan otomatis me-restart bot Anda dalam hitungan detik.

---

## 🎉 Hasil Otomatisasi di Google Spreadsheet

Google Spreadsheet Anda akan otomatis memiliki 3 lembar kerja rapi dengan warna elegan:
1. **Transaksi Keuangan** (Hijau):
   - Kolom: `Timestamp | Tanggal | Waktu | Jenis | Nominal (Rp) | Kategori | Keterangan | Akun (Pribadi/Bisnis) | Pencatat | ID Transaksi`
   - Nominal sudah otomatis terformat Rupiah (`Rp 50.000`).
   - Warna teks otomatis hijau untuk Pemasukan dan merah untuk Pengeluaran.
2. **Rutinitas & Kebiasaan** (Biru):
   - Kolom: `Timestamp | Tanggal | Waktu | Aktivitas / Habit | Nilai / Status | Catatan`
3. **Target & Evaluasi** (Oranye):
   - Kolom: `Timestamp | Kategori | Judul Target | Tolok Ukur | Target Tanggal | Pemilik`
