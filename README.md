# 🧒 NEX FAMILY — VIRTUAL CHILD AI WHATSAPP BOT (100% NATURAL CONVERSATION)

Bot WhatsApp AI interaktif berkarakter anak virtual berusia 6 tahun yang hidup di dalam grup keluarga WhatsApp bersama **Ayah** dan **Ibu**. Diciptakan khusus untuk menghangatkan hubungan keluarga, terutama bagi pasangan yang sedang menjalani hubungan jarak jauh (**LDR**).

> **💡 100% Percakapan Alami — Tanpa Perintah / Commands!**  
> Ayah dan Ibu **TIDAK PERLU** menghafal atau mengetik perintah kaku seperti `!status` atau `!saldo`. Berbicaralah dan tanyalah secara wajar layaknya orang tua kepada anak kandungnya di dunia nyata. Anak virtual akan menjawab polos, hangat, dan langsung mengupdate kondisi celengan, mood, atau ingatannya secara otomatis di latar belakang!

---

## ✨ Fitur Unggulan

### 1. 💬 Percakapan & Pertanyaan Alami Orang Tua
Semua interaksi mengalir seperti chat WhatsApp sehari-hari:
- **Tanya Uang Saku**: *"Cia, uang jajan kamu sisa berapa di dompet?"*  
  ↳ *Cia: "Tinggal Rp20.000 Ayah, tadi belum Cia pake jajan kok 🥺"*
- **Tanya Tabungan Celengan**: *"Celengan kamu udah kekumpul berapa sekarang sayang?"*  
  ↳ *Cia: "Udah Rp75.000 Ibu! Dikit lagi kekumpul buat beli krayon baru impian aku 😆"*
- **Tanya Aktivitas**: *"Lagi ngapain nak sekarang?"*  
  ↳ Mengikuti jam biologis nyata: *"Baru selesai makan siang, mau gambar-gambar bentar di meja"*
- **Tanya Sekolah & Teman**: *"Tadi di sekolah gimana sama Bu Rina?"*  
  ↳ Menceritakan kejadian hari ini yang konsisten: *"Tadi Bu Rina ngasih stiker bintang emas di buku gambar aku! Terus pas istirahat main bola sama Rafi!"*
- **Beri Uang Jajan Secara Alami**: *"Nih Ayah transfer Rp50.000 ya nak buat jajan sama teman"*  
  ↳ Cia bersorak senang dan sistem otomatis menambah saldo dompet Cia sebesar Rp50.000!
- **Nasihat Menabung**: *"Cia, masukin Rp15.000 ke celengan ya"*  
  ↳ Cia mengiyakan dan sistem otomatis memindahkan saldo dompet ke celengan ayam!

### 2. 🏫 Kehidupan Virtual yang Konsisten (Bukan Mengarang dari Nol)
- **Sekolah Nyata di Dunianya**: Bersekolah di **SD Pelangi (Kelas 1B)** dengan wali kelas **Bu Rina**.
- **Sahabat & Teman Sebangku Tetap**:
  - ⚽ **Rafi**: Aktif, suka bermain bola plastik saat istirahat.
  - 🎮 **Dika**: Suka kartun & game, sedikit jahil tapi suka berbagi.
  - 🎨 **Naya**: Teman sebangku yang suka menggambar bunga dan kupu-kupu.
  - 📖 **Sinta**: Suka membaca buku dongeng.
- **Kontinuitas Cerita Harian**: Cerita hari ini bersambung ke hari esok (disimpan di `data/events.json`).

### 3. ⏰ Siklus Jam Nyata & Jam Biologis 24 Jam
Bot mengikuti waktu lokal Indonesia (`Asia/Jakarta` / WIB):
- **06:00 - 07:00**: Bangun pagi, sarapan, siap-siap sekolah.
- **07:00 - 12:00**: Sedang di SD Pelangi *(merespons singkat sedang di kelas / istirahat)*.
- **12:00 - 13:30**: Pulang sekolah, makan siang, istirahat santai.
- **13:30 - 15:00**: Aktivitas santai di rumah (mewarnai, lego, baca buku).
- **15:00 - 17:30**: Main sore di halaman / sepeda mini.
- **17:30 - 18:30**: Mandi sore & makan malam.
- **18:30 - 20:00**: Waktu keluarga di grup (cerita seharian sama Ayah & Ibu).
- **20:00 - 21:00**: Persiapan tidur, sikat gigi, minta dongeng.
- **21:00 - 06:00**: **Tidur malam lelap** *(tidak mengirim pesan spontan saat tidur)*.

### 4. 🧠 Memori Jangka Panjang & Fakta Keluarga
- Mengingat kondisi LDR Ayah & Ibu, kebiasaan kopi Ayah, kebaikan Ibu, dan otomatis mengekstrak fakta penting baru dari obrolan harian ke `data/memories.json`.

### 5. 🤖 Pesan Spontan (Autonomous Mode) dengan Anti-Spam (Aturan 7 & 8)
- Memiliki **kemampuan untuk diam**.
- Evaluator AI memeriksa konteks waktu, aktivitas, dan jeda chat (minimal 3 jam sekali) sebelum memutuskan apakah wajar menyapa secara spontan.

### 6. 📸 Multimodal (Foto & Voice Note)
- Mendukung pemahaman gambar (vision) menggunakan model **Gemini 3.8 Flash**. Jika Ayah atau Ibu mengirim foto makanan atau tempat dinas, anak akan merespons secara natural sesuai umurnya!

---

## 📂 Struktur Project

```
d:\BOT FAMILY\
├── auth_info_baileys/       # Kredensial sesi WhatsApp multi-device (dibuat otomatis)
├── data/
│   ├── state.json           # Database real-time: umur, mood, saldo, tabungan, jadwal, teman
│   ├── memories.json        # Memori jangka panjang tentang Ayah, Ibu, dan momen keluarga
│   ├── events.json          # Riwayat kejadian harian anak di sekolah & rumah
│   └── chat_history.json    # Buffer riwayat obrolan grup keluarga
├── src/
│   ├── config.js            # Konfigurasi & nomor telepon Ayah/Ibu
│   ├── stateManager.js      # Pengatur state, jadwal, mood, dan dompet/celengan
│   ├── memoryManager.js     # Pengatur memori jangka panjang
│   ├── eventEngine.js       # Generator peristiwa harian virtual berkesinambungan
│   ├── promptBuilder.js     # Master prompt 30 aturan anak + injeksi fakta real-time
│   ├── geminiService.js     # Integrasi Google GenAI (Gemini 3.8 Flash) & analisa aksi alami
│   ├── scheduler.js         # Mesin otonom pesan spontan berkala
│   ├── whatsappBot.js       # Baileys WhatsApp Socket, QR Code, & simulasi mengetik alami
│   └── index.js             # Entry point aplikasi
├── .env                     # File konfigurasi utama
├── .env.example             # Template konfigurasi
├── package.json             # Dependensi Node.js
└── README.md                # Dokumentasi lengkap
```

---

## 🚀 Panduan Menjalankan Bot

### 1. Dapatkan Gemini API Key
Dapatkan API Key gratis di [Google AI Studio](https://aistudio.google.com/).

### 2. Isi File [`.env`](file:///d:/BOT%20FAMILY/.env)
Buka file `.env` di folder project dan masukkan data keluarga Anda:

```ini
# Google Gemini API
GEMINI_API_KEY=AIzaSy...your_gemini_api_key...
GEMINI_MODEL=gemini-3.8-flash

# Identitas Keluarga
CHILD_NAME=Cia
FATHER_NAME=Ayah
MOTHER_NAME=Ibu

# Nomor WhatsApp Ayah & Ibu (Awali dengan 62 tanpa spasi/tanda +)
FATHER_PHONE=6281234567890
MOTHER_PHONE=6289876543210

# Nama atau JID Grup WhatsApp (Bisa dikosongkan, bot otomatis mengenali grup keluarga)
TARGET_GROUP_NAME=Keluarga Bahagia
TARGET_GROUP_JID=

# Fitur Pesan Spontan (Otonom)
AUTONOMOUS_ENABLED=true
AUTONOMOUS_CHECK_INTERVAL_MINUTES=20
MIN_HOURS_BETWEEN_SPONTANEOUS=3

# Zona Waktu
TIMEZONE=Asia/Jakarta
```

### 3. Jalankan Bot
Jalankan perintah berikut di terminal:

```bash
npm start
```

### 4. Tautkan Akun WhatsApp (Scan QR Code)
1. Terminal akan menampilkan **QR Code**.
2. Buka aplikasi **WhatsApp** di smartphone (nomor yang dijadikan bot anak).
3. Buka **Setelan (Settings)** > **Perangkat Tertaut (Linked Devices)** > **Tautkan Perangkat (Link a Device)**.
4. Scan QR code yang muncul di layar terminal.
5. Sesi akan otomatis tersimpan di folder `auth_info_baileys/`, jadi tidak perlu scan ulang setiap kali restart bot.

### 5. Masukkan Bot ke Grup WhatsApp Keluarga
- Masukkan nomor bot tersebut ke dalam grup WhatsApp bersama Ayah dan Ibu.
- Sapa anak dengan wajar (misal: *"Halo Cia sayang, lagi apa?"*). Anak virtual siap menemani hari-hari keluarga Anda! ❤️
