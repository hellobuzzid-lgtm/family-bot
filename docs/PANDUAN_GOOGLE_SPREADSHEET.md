# 📊 Panduan Integrasi Google Spreadsheet Bot NEX (Termasuk Rekap Mingguan & Bulanan)

Dengan integrasi ini, setiap kali Anda atau pasangan meminta **NEX** mencatat pengeluaran, pemasukan, atau rutinitas di WhatsApp, data akan **otomatis terupdate ke Google Spreadsheet secara real-time** lengkap dengan **Rekap Mingguan** dan **Rekap Bulanan**!

---

## 📑 Struktur Lembar Kerja (Tabs) yang Dihasilkan Otomatis

Google Spreadsheet Anda akan otomatis memiliki 5 lembar kerja profesional:

1. 🟢 **`Transaksi Keuangan`** (Buku Kas Mentah):
   - Kolom: `Timestamp | Tanggal | Waktu | Jenis | Nominal (Rp) | Kategori | Keterangan | Akun (Pribadi/Bisnis) | Pencatat | ID Transaksi`
   - Nominal otomatis diformat Rupiah (`Rp 50.000`).
   - Warna teks hijau untuk Pemasukan dan merah untuk Pengeluaran.

2. 📅 **`Rekap Bulanan`** (Dashboard Keuangan Bulanan):
   - **Kartu Ringkasan (KPI Cards)**: Total Pemasukan, Total Pengeluaran, Total Tabungan, dan Net Cashflow (Surplus/Defisit).
   - **Tabel Kinerja Bulanan**:
     - `Bulan | Pemasukan (Rp) | Pengeluaran (Rp) | Net Cashflow (Rp) | Tabungan (Rp) | Rasio Tabungan (%) | Status Arus Kas`
     - Evaluasi otomatis status cashflow (`SURPLUS ✅`, `DEFISIT ⚠️`, `SEIMBANG ⚖️`).
     - Baris Total Keseluruhan di bagian bawah.

3. 📆 **`Rekap Mingguan`** (Evaluasi Ritme Mingguan):
   - **Kartu Ringkasan Minggu Berjalan**: Pemasukan minggu ini, pengeluaran minggu ini, sisa saldo mingguan, dan rata-rata pengeluaran/hari.
   - **Tabel Kinerja Mingguan (Senin s/d Minggu)**:
     - `Periode Minggu | Pemasukan (Rp) | Pengeluaran (Rp) | Net Mingguan (Rp) | Rata-rata / Hari | Status Evaluasi | Top Kategori Pengeluaran`
     - Evaluasi disiplin anggaran (`HEMAT 🟢`, `TERKENDALI 🟡`, `WASPADA 🔴`).
     - Deteksi otomatis kategori pengeluaran terbesar per minggu.

4. 🔵 **`Rutinitas & Kebiasaan`**:
   - Kolom: `Timestamp | Tanggal | Waktu | Aktivitas / Habit | Nilai / Status | Catatan`

5. 🟠 **`Target & Evaluasi`**:
   - Kolom: `Timestamp | Kategori | Judul Target | Tolok Ukur | Target Tanggal | Pemilik`

---

## ⚡ Cara Memperbarui Kode di Apps Script (Hanya 1 Menit)

Jika Anda sudah pernah memasang skrip sebelumnya, lakukan langkah mudah ini untuk mengaktifkan tab **Rekap Bulanan & Mingguan**:

1. Buka spreadsheet Anda di Google Drive.
2. Klik menu: **Ekstensi** (*Extensions*) > **Apps Script**.
3. Hapus seluruh kode yang ada di editor, lalu **Paste seluruh kode dari file [`docs/google-apps-script.js`](./google-apps-script.js)**.
4. Klik icon **Simpan** (ikon disket / `Ctrl + S`).
5. Perbarui Penerapan (*Deploy*):
   - Klik tombol biru di kanan atas: **Terapkan** (*Deploy*) > **Kelola penerapan** (*Manage deployments*).
   - Klik ikon **Pensil** (Edit) di samping nama deployment Anda.
   - Pada dropdown **Versi** (*Version*), pilih **Versi baru** (*New version*).
   - Klik tombol **Terapkan** (*Deploy*).
6. Selesai! URL webhook Anda tetap sama, tidak perlu mengubah apa pun di Railway.

---

## 🖱️ Menu Praktis Langsung di Spreadsheet Anda

Setelah memasang kode terbaru, ketika Anda membuka Google Spreadsheet di browser komputer, akan muncul menu baru di bilah menu atas:
👉 **`🤖 NEX Bot`**
- **`🔄 Perbarui Rekap Mingguan & Bulanan`**: Klik ini kapan saja untuk menyegarkan rekap instan.
- **`📅 Buka Tab Rekap Bulanan`**: Langsung melompat ke dashboard bulanan.
- **`📆 Buka Tab Rekap Mingguan`**: Langsung melompat ke dashboard mingguan.

---

## 💬 Cara Meminta Rekap dari WhatsApp

Anda juga bisa meminta rekap langsung ke bot NEX di WhatsApp:
- `nex rekap mingguan`
- `nex rekap bulanan`
- `nex evaluasi keuangan bulan ini`
- `nex sync rekap` (untuk memicu update paksa ke spreadsheet)
