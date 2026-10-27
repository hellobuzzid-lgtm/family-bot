# AI Personal Life Partner (WhatsApp Bot)

> **Personal Assistant, Financial Advisor, Life Coach, Business Consultant, Relationship Mediator, Long-Term Memory & Continuous Learning AI.**

Bot WhatsApp asisten pribadi cerdas yang bertindak sebagai teman diskusi, penasihat keuangan, analis kehidupan, pengingat rutinitas ibadah & kesehatan, konsultan bisnis, serta mediator hubungan yang objektif dan adil.

---

## 🌟 Fitur Utama (Sesuai 32 Bagian Master Prompt)

1. **Karakter Cerdas, Logis & Jujur (Bukan Yes-Man)**:
   - Berbicara menggunakan bahasa Indonesia yang natural, santai, dan cerdas (*"Bro, menurut gue..."*).
   - Jujur mengoreksi kesalahan tanpa merendahkan, objektif, dan berorientasi pada hasil nyata.
2. **Manajemen Keuangan Pribadi & Bisnis**:
   - Pencatatan transaksi real-time: Pemasukan, Pengeluaran, Utang/Cicilan, Tabungan, Dana Darurat.
   - Perhitungan matematis akurat langsung dari database terstruktur (anti-halusinasi angka).
   - Laporan arus kas harian, mingguan, dan bulanan.
3. **Target & Akuntabilitas (Goal Tracker)**:
   - Siklus evaluasi: Rencana → Tindakan → Hasil → Evaluasi → Pelajaran → Perbaikan.
   - Tracking target finansial, bisnis, kesehatan, dan pengembangan diri.
4. **Rutinitas Ibadah & Gaya Hidup Sehat**:
   - Pengingat salat 5 waktu otomatis dengan kalkulasi astronomis akurat wilayah Indonesia (WIB/Kemenag RI).
   - Pengingat minum air, makan bergizi, pola tidur teratur (7–9 jam), dan olahraga konsisten.
   - Tracker pengurangan rokok bertahap.
   - Skincare rutin (pagi: sunscreen, malam: pembersih & pelembap).
   - Sesi belajar & peningkatan skill 20–30 menit sehari.
5. **Mediator Hubungan yang Adil (Dukungan Calon Istri)**:
   - Berinteraksi di grup bersama pemilik dan calon istrinya.
   - Bersikap objektif, membantu menjembatani komunikasi, dan mendiskusikan visi rumah tangga.
   - Pemisahan privasi ketat: catatan keuangan dan rahasia pribadi tidak pernah dibocorkan ke grup tanpa izin.
6. **Memori Jangka Panjang & Pembelajaran Berkelanjutan**:
   - Menyimpan konteks, kebiasaan, preferensi, dan peristiwa penting secara persisten.

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Kebutuhan Sistem
- **Node.js** v18+ atau v20+
- **Google Gemini API Key** (Dapatkan di [Google AI Studio](https://aistudio.google.com/))
- Akun WhatsApp untuk nomor bot

### 2. Konfigurasi `.env`
Salin template konfigurasi:
```bash
cp .env.example .env
```
Isi variabel berikut:
```env
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-3.5-flash

OWNER_NAME=Bro
OWNER_PHONE=62895360317212

PARTNER_NAME=Calon Istri
PARTNER_PHONE=628975889967

BOT_PHONE=6285183541035
USE_PAIRING_CODE=true
TARGET_GROUP_JID=120363429574214127@g.us
TIMEZONE=Asia/Jakarta
STORAGE_DIR=/app/storage
```

### 3. Menjalankan Bot
```bash
npm install
npm start
```

### 4. Tautkan WhatsApp (Pairing Code)
Saat bot pertama kali menyala, kode pairing 8 karakter akan muncul di terminal:
```text
======================================================
🔑 KODE PAIRING WHATSAPP ANDA: 👉 ABC1-XYZ2 👈
======================================================
```
1. Buka WhatsApp di HP nomor bot.
2. Buka **Setelan > Perangkat Tertaut > Tautkan Perangkat**.
3. Pilih **"Tautkan dengan nomor telepon saja"**.
4. Masukkan kode 8 karakter tersebut.

---

## ☁️ Deployment di Railway (24 Jam Online)

1. Hubungkan repository GitHub ke project Railway.
2. Pasang **Volume Permanen**:
   - Klik `+ Create` > `Volume`.
   - Mount Path: `/app/storage`.
   *(Sesi WhatsApp dan database tidak akan pernah hilang saat redeploy)*.
3. Tambahkan Environment Variables dari file `.env`.
4. Deploy! Bot akan aktif 24 jam tanpa henti.
