import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { config, normalizePhone } from './config.js';

export class WhatsAppBot {
  constructor(stateManager, memoryManager, eventEngine, geminiService, chatHistoryManager, commandHandler) {
    this.stateManager = stateManager;
    this.memoryManager = memoryManager;
    this.eventEngine = eventEngine;
    this.geminiService = geminiService;
    this.chatHistoryManager = chatHistoryManager;
    this.commandHandler = commandHandler;

    this.sock = null;
    this.botJid = null;
    this.targetGroupJid = config.targetGroupJid || this.stateManager.getState().telemetry?.targetGroupId || null;
  }

  getTargetGroupJid() {
    return this.targetGroupJid;
  }

  async start() {
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

    console.log(`[WhatsAppBot] Initializing WhatsApp Socket (Baileys v${version.join('.')}, isLatest: ${isLatest})...`);

    const browser = config.usePairingCode
      ? ['Ubuntu', 'Chrome', '20.0.04']
      : ['NEX Family Virtual Child', 'Chrome', '1.0.0'];

    this.sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: !config.usePairingCode,
      auth: state,
      browser,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    this.sock.ev.on('creds.update', saveCreds);

    // Pairing Code Handler
    if (config.usePairingCode && !this.sock.authState.creds.registered) {
      if (!config.botPhone) {
        console.warn('⚠️ [WhatsAppBot] USE_PAIRING_CODE aktif tetapi nomor BOT_PHONE belum diisi di .env / Variables!');
      } else {
        setTimeout(async () => {
          try {
            console.log(`[WhatsAppBot] Menghubungi WhatsApp untuk meminta kode pairing ke: ${config.botPhone}...`);
            const code = await this.sock.requestPairingCode(config.botPhone);
            console.log('\n======================================================');
            console.log(`🔑 KODE PAIRING WHATSAPP ANDA: 👉 ${code} 👈`);
            console.log('======================================================');
            console.log('Langkah Menautkan di HP:');
            console.log('1. Buka aplikasi WhatsApp di HP Anda');
            console.log('2. Buka Setelan > Perangkat Tertaut > Tautkan Perangkat');
            console.log('3. Klik opsi di bawah: "Tautkan dengan nomor telepon saja"');
            console.log(`4. Masukkan 8 karakter kode pairing: ${code}`);
            console.log('======================================================\n');
          } catch (err) {
            console.error('❌ [WhatsAppBot] Gagal meminta kode pairing:', err.message);
          }
        }, 4000);
      }
    }

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !config.usePairingCode) {
        console.log('\n======================================================');
        console.log('📱 SCAN QR CODE BERIKUT DENGAN WHATSAPP:');
        console.log('1. Buka WhatsApp di HP Anda');
        console.log('2. Buka Menu / Setelan > Perangkat Tertaut > Tautkan Perangkat');
        console.log('3. Arahkan kamera HP ke QR Code di bawah ini:');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\n======================================================\n');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsAppBot] Connection closed. Reason: ${lastDisconnect?.error?.message || statusCode}. Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        } else {
          console.log('[WhatsAppBot] Device logged out. Please restart bot to scan a new QR code.');
        }
      } else if (connection === 'open') {
        this.botJid = this.sock.user?.id ? this.sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        console.log('✅ [WhatsAppBot] WhatsApp connection successfully OPENED!');
        console.log(`🤖 Bot Number: ${this.botJid}`);
        console.log(`👨 Configured Father: ${config.fatherName} (${config.fatherPhone || 'Not set'})`);
        console.log(`👩 Configured Mother: ${config.motherName} (${config.motherPhone || 'Not set'})`);
        if (this.targetGroupJid) {
          console.log(`👥 Target Group: ${this.targetGroupJid}`);
        } else {
          console.log('👥 Target Group: (Akan otomatis dideteksi saat ada pesan di grup keluarga)');
        }
      }
    });

    this.sock.ev.on('messages.upsert', async (upsert) => {
      try {
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
          await this.handleIncomingMessage(msg);
        }
      } catch (err) {
        console.error('[WhatsAppBot] Error in messages.upsert handler:', err);
      }
    });
  }

  async handleIncomingMessage(msg) {
    if (!msg.message) return;
    if (msg.key.fromMe) return; // Ignore messages from the bot itself

    const chatJid = msg.key.remoteJid;
    const isGroup = chatJid.endsWith('@g.us');
    const senderJid = isGroup ? (msg.key.participant || msg.key.remoteJid) : chatJid;
    const senderPhone = normalizePhone(senderJid);
    const participantPn = msg.key?.participantPn ? normalizePhone(msg.key.participantPn) : '';
    const pushName = msg.pushName || 'Keluarga';

    // Identify speaker
    const speakerInfo = this.identifySpeaker(senderPhone, pushName, senderJid, participantPn);

    // Extract text content and media from message
    const { text, mediaType, mediaMessage } = this.extractMessageContent(msg);

    // If this is a group message, check or set target group
    if (isGroup) {
      if (!this.targetGroupJid || this.targetGroupJid === chatJid) {
        // If this group includes Father or Mother, lock this group
        if (speakerInfo.role === 'father' || speakerInfo.role === 'mother') {
          if (this.targetGroupJid !== chatJid) {
            this.targetGroupJid = chatJid;
            this.stateManager.updateTelemetry('targetGroupId', chatJid);
            console.log(`[WhatsAppBot] Set target family group to: ${chatJid}`);
          }
        }
      }

      // Record to chat history
      if (text) {
        this.chatHistoryManager.addMessage({
          senderJid,
          senderName: speakerInfo.name,
          role: speakerInfo.role,
          text
        });
      }
    }

    const cleanText = (text || '').trim();
    const lowerText = cleanText.toLowerCase();

    // 1. Wakeup detection
    const wakeupRegex = /(^|\s)(bangun|pagi|subuh|sahur|udah pagi|bangun yuk|bangun nak|bangun sayang|bangun bangun)(\s|[!?.,]|$)/i;
    const childName = (config.childName || 'cia').toLowerCase();
    const nameRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])(${childName}+|anakku|si kecil|dedek|adek|dek|nak|sayang|sayangku|neng|cantik)($|\\s|[^a-zA-Z0-9])`, 'i');
    const isNameCalled = nameRegex.test(lowerText);

    if (wakeupRegex.test(lowerText) && (this.stateManager.isSleeping() || isNameCalled || lowerText.includes('pagi'))) {
      if (this.stateManager.isSleeping()) {
        console.log('[WhatsAppBot] 🌅 Deteksi ucapan membangunkan Cia, membangunkan Cia dari mode tidur!');
        this.stateManager.wakeUp();
      }
    }

    // 2. Privacy mode restore detection (orang tua memanggil Cia kembali)
    const privacyEndRegex = /(^|\s)(cia sini|sini cia|cia udah|mana cia|keluar kamar|boleh keluar|selesai ngobrol|cia gabung|panggil cia)(\s|[!?.,]|$)/i;
    if (privacyEndRegex.test(lowerText) && this.stateManager.isPrivacyModeActive()) {
      console.log('[WhatsAppBot] 🚪 Orang tua memanggil Cia kembali, menonaktifkan privacy mode!');
      this.stateManager.deactivatePrivacyMode();
    }

    // Determine if bot should respond:
    const shouldRespond = this.checkShouldRespond(msg, text, isGroup, speakerInfo);
    if (!shouldRespond) {
      return;
    }

    // Detect bedtime or privacy request for state transition AFTER sending reply
    const bedtimeRegex = /(tidur ya|bobo ya|tidur yuk|bobo yuk|tidur gih|bobo gih|tidur sana|bobo sana|tidur dulu|bobo dulu|selamat tidur|selamat bobo|selamat malam|good night|met bobo|met tidur|mimpi indah|tidur nyenyak|udah malam.*tidur|udah malem.*tidur|cia tidur|cia bobo)/i;
    const privacyRegex = /(ngobrol berdua|bicara berdua|ngomong berdua|chat berdua|berdua dulu|berdua aja|mau berdua|ke kamar dulu|main di kamar dulu|jangan ganggu dulu|ayah.*bunda.*mau (ngobrol|bicara|ngomong)|mau (ngobrol|bicara|ngomong) sama (bunda|ayah))/i;
    const isBedtimeRequest = bedtimeRegex.test(lowerText);
    const isPrivacyRequest = privacyRegex.test(lowerText);

    console.log(`[WhatsAppBot] Responding to ${speakerInfo.name} (${speakerInfo.role}) in ${isGroup ? 'Group' : 'Private'}: "${text || '[Media]'}"`);

    // Download media if photo or audio
    let mediaData = null;
    if (mediaType && mediaMessage) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: this.sock.updateMediaMessage
          }
        );

        if (mediaType === 'image') {
          mediaData = {
            type: 'image',
            mimeType: mediaMessage.mimetype || 'image/jpeg',
            buffer
          };
        } else if (mediaType === 'audio') {
          mediaData = {
            type: 'audio',
            mimeType: mediaMessage.mimetype || 'audio/ogg; codecs=opus',
            buffer
          };
        }
      } catch (mediaErr) {
        console.warn('[WhatsAppBot] Could not download media message:', mediaErr.message);
      }
    }

    // Generate AI response
    const history = isGroup ? this.chatHistoryManager.getRecent(12) : [];
    const replyText = await this.geminiService.generateResponse({
      messageText: text,
      speakerInfo,
      chatHistory: history,
      media: mediaData
    });

    if (replyText) {
      await this.sendMessageWithTyping(chatJid, replyText, msg);
      this.stateManager.recordMessageSent();

      // If this was a bedtime request, activate sleepLock now so bot goes completely quiet
      if (isBedtimeRequest) {
        console.log('[WhatsAppBot] 😴 Cia sudah pamitan tidur, mengaktifkan sleepLock...');
        this.stateManager.setSleepLock(true);
      }

      // If this was a privacy request, activate privacyMode so parents can talk privately
      if (isPrivacyRequest) {
        console.log('[WhatsAppBot] 🤫 Ayah/Bunda ingin ngobrol berdua, mengaktifkan privacyMode (120 menit)...');
        this.stateManager.activatePrivacyMode(120, 'Orang tua ingin ngobrol berdua');
      }

      // Also record bot's reply into history
      this.chatHistoryManager.addMessage({
        senderJid: 'bot',
        senderName: config.childName,
        role: 'child',
        text: replyText
      });
    }
  }

  identifySpeaker(senderPhone, pushName, senderJid, participantPn = '') {
    let resolvedPhone = senderPhone;

    // 1. If participantPn is available directly from Baileys
    if (participantPn) {
      resolvedPhone = normalizePhone(participantPn);
    }

    // 2. If sender is a WhatsApp LID (e.g. 46944277819513@lid), check Baileys reverse LID mapping
    if (senderJid && senderJid.endsWith('@lid')) {
      const lidDigits = senderJid.replace(/\D/g, '');
      const reverseFile = path.join(config.authDir, `lid-mapping-${lidDigits}_reverse.json`);
      if (fs.existsSync(reverseFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(reverseFile, 'utf-8'));
          if (raw) resolvedPhone = normalizePhone(raw);
        } catch (_) {}
      }
    }

    // Match phone number with Father or Mother
    if (config.fatherPhone && resolvedPhone && resolvedPhone.includes(config.fatherPhone)) {
      return { role: 'father', name: config.fatherName, jid: senderJid, phone: resolvedPhone };
    }
    if (config.motherPhone && resolvedPhone && resolvedPhone.includes(config.motherPhone)) {
      return { role: 'mother', name: config.motherName, jid: senderJid, phone: resolvedPhone };
    }

    // Secondary fallback matching on pushName if configured phone is missing
    const nameLower = (pushName || '').toLowerCase();
    if (nameLower.includes(config.fatherName.toLowerCase())) {
      return { role: 'father', name: config.fatherName, jid: senderJid, phone: resolvedPhone };
    }
    if (nameLower.includes(config.motherName.toLowerCase())) {
      return { role: 'mother', name: config.motherName, jid: senderJid, phone: resolvedPhone };
    }

    // Specific known family mapping for Ayah's LID
    if (senderJid && senderJid.includes('46944277819513')) {
      return { role: 'father', name: config.fatherName, jid: senderJid, phone: config.fatherPhone };
    }

    return { role: 'family_member', name: pushName || 'Keluarga', jid: senderJid, phone: resolvedPhone };
  }

  extractMessageContent(msg) {
    const m = msg.message;
    let text = '';
    let mediaType = null;
    let mediaMessage = null;

    if (m.conversation) {
      text = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      text = m.extendedTextMessage.text;
    } else if (m.imageMessage) {
      text = m.imageMessage.caption || '';
      mediaType = 'image';
      mediaMessage = m.imageMessage;
    } else if (m.audioMessage) {
      text = '';
      mediaType = 'audio';
      mediaMessage = m.audioMessage;
    } else if (m.videoMessage) {
      text = m.videoMessage.caption || '';
    }

    return { text, mediaType, mediaMessage };
  }

  checkShouldRespond(msg, text, isGroup, speakerInfo) {
    const cleanText = (text || '').trim();
    const lowerText = cleanText.toLowerCase();
    const childName = (config.childName || 'cia').toLowerCase();

    // Check context mentions / reply to bot
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid || [];
    const isDirectlyMentioned = Boolean(
      this.botJid && (
        mentionedJids.some(jid => jid.includes(this.botJid.split('@')[0])) ||
        (contextInfo?.participant && contextInfo.participant.includes(this.botJid.split('@')[0]))
      )
    );

    // Check if child's name or pet names are mentioned
    const nameRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])(${childName}+|anakku|si kecil|dedek|adek|dek|nak|sayang|sayangku|neng|cantik)($|\\s|[^a-zA-Z0-9])`, 'i');
    const isNameCalled = nameRegex.test(lowerText);

    // Wakeup call check
    const wakeupRegex = /(^|\s)(bangun|pagi|subuh|sahur|udah pagi|bangun yuk|bangun nak|bangun sayang|bangun bangun)(\s|[!?.,]|$)/i;
    const isWakeup = wakeupRegex.test(lowerText);

    // 1. ATURAN TIDUR: Jika Cia sedang tidur (21:00 - 06:00 atau sleepLock aktif)
    // Permintaan user: "botnya harus bisa mengerti saat dia bilang tidur seharusnya dia tidak membalas"
    if (this.stateManager.isSleeping()) {
      // Cia HANYA bangun dan membalas jika secara spesifik dibangunkan oleh orang tua
      if (isWakeup && (isNameCalled || isDirectlyMentioned || !isGroup || lowerText.includes('pagi'))) {
        return true;
      }
      // Selama tidur, Cia 100% diam dan TIDAK MEMBALAS pesan obrolan apapun!
      return false;
    }

    // 2. ATURAN PRIVASI: Jika Orang Tua sedang mode ngobrol berdua (privacyMode aktif)
    // Permintaan user: "apabila saya mengatakan ingin ngobrol berdua dengan bunda seharusnya bot memberi ruang tidak selalu membalas setiap saat ada obrolan di grup"
    if (this.stateManager.isPrivacyModeActive()) {
      const privacyEndRegex = /(^|\s)(cia sini|sini cia|cia udah|mana cia|keluar kamar|boleh keluar|selesai ngobrol|cia gabung|panggil cia)(\s|[!?.,]|$)/i;
      if (privacyEndRegex.test(lowerText) || isDirectlyMentioned) {
        return true;
      }
      // Selama orang tua ngobrol berdua, Cia diam memberi ruang
      return false;
    }

    // 3. Private 1-on-1 Chat: Selalu respon
    if (!isGroup) return true;

    // 4. Tag / mention langsung WhatsApp (@bot) atau reply pesan bot: Selalu respon
    if (isDirectlyMentioned) return true;

    // 5. Nama Cia atau panggilan sayang anak disebut: Selalu respon
    if (isNameCalled) return true;

    // 6. Media foto atau pesan suara dikirim di grup: Respon antusias
    if (msg.message?.imageMessage || msg.message?.audioMessage) {
      return true;
    }

    // 7. Ping check ("p", "ppp", "P"): Respon
    if (/^p+$/i.test(lowerText)) {
      return true;
    }

    // 8. Permintaan pamitan tidur atau permintaan ngobrol berdua: Respon 1 kali pamitan manis
    const bedtimeRegex = /(tidur ya|bobo ya|tidur yuk|bobo yuk|tidur gih|bobo gih|tidur sana|bobo sana|tidur dulu|bobo dulu|selamat tidur|selamat bobo|selamat malam|good night|met bobo|met tidur|mimpi indah|tidur nyenyak|udah malam.*tidur|udah malem.*tidur|cia tidur|cia bobo)/i;
    const privacyRegex = /(ngobrol berdua|bicara berdua|ngomong berdua|chat berdua|berdua dulu|berdua aja|mau berdua|ke kamar dulu|main di kamar dulu|jangan ganggu dulu|ayah.*bunda.*mau (ngobrol|bicara|ngomong)|mau (ngobrol|bicara|ngomong) sama (bunda|ayah))/i;
    if (bedtimeRegex.test(lowerText) || privacyRegex.test(lowerText)) {
      return true;
    }

    // 9. Pesan yang jelas ditujukan secara spesifik untuk pasangan (Ayah <-> Bunda)
    // Contoh: "Bunda hari ini masak apa?", "Bun besok ada acara?", "Ayah mau makan apa?", "Yah pulang jam berapa?"
    // Cia TIDAK BOLEH MENYELA obrolan pasangan!
    const spouseAddressRegex = /^(bunda|bun|ayah|yah|istriku|suamiku|sayang)([,.!?\s]|$)/i;
    if (spouseAddressRegex.test(cleanText) && !isNameCalled) {
      return false;
    }

    // 10. Pertanyaan atau sapaan umum keluarga di grup (Cia boleh nimbrung ramah):
    // Contoh: "halo semua", "assalamualaikum", "udah pada makan?", "lagi pada ngapain?", "siapa yang mau"
    const generalFamilyRegex = /(assalamu|halo semua|halo guys|lagi pada ngapain|pada lagi apa|udah pada makan|pada dimana|kangen|kabar|hari ini gimana|siapa yang mau)/i;
    if (generalFamilyRegex.test(lowerText)) {
      return true;
    }

    // 11. Selain di atas (misal dialog antar Ayah & Bunda di grup yang tidak menyapa Cia):
    // Cia memberi ruang dan TIDAK selalu membalas setiap pesan di grup!
    return false;
  }

  async sendMessageWithTyping(chatJid, text, quotedMessage = null) {
    try {
      // Simulate typing indicator
      await this.sock.presenceSubscribe(chatJid);
      await this.sock.sendPresenceUpdate('composing', chatJid);

      // Natural typing delay: 1.5 to 3.5 seconds
      const delay = Math.min(4000, Math.max(1500, text.length * 35));
      await new Promise(resolve => setTimeout(resolve, delay));

      await this.sock.sendPresenceUpdate('paused', chatJid);

      // Send message (quoted if available)
      await this.sock.sendMessage(chatJid, { text }, { quoted: quotedMessage });
    } catch (err) {
      console.error('[WhatsAppBot] Error sending message with typing:', err.message);
    }
  }

  async sendMessageToGroup(groupJid, text) {
    try {
      await this.sock.presenceSubscribe(groupJid);
      await this.sock.sendPresenceUpdate('composing', groupJid);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.sock.sendPresenceUpdate('paused', groupJid);

      await this.sock.sendMessage(groupJid, { text });
    } catch (err) {
      console.error('[WhatsAppBot] Error sending spontaneous group message:', err.message);
    }
  }
}
