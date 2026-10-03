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

    // Natural flow: All messages, questions, and interactions are handled by natural conversation!

    // Determine if bot should respond:
    const shouldRespond = this.checkShouldRespond(msg, text, isGroup, speakerInfo);
    if (!shouldRespond) {
      return;
    }

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
    // 1. In private 1-on-1 chat: always respond
    if (!isGroup) return true;

    // 2. In dedicated Family Group: ALWAYS RESPOND!
    // (User requirement: Cia membalas tidak hanya ketika namanya dipanggil saja)
    const chatJid = msg.key.remoteJid;
    if (this.targetGroupJid && chatJid === this.targetGroupJid) {
      return true;
    }

    // 3. If message is from Father or Mother: always respond!
    if (speakerInfo.role === 'father' || speakerInfo.role === 'mother') {
      return true;
    }

    // 4. In any other group: respond if mentioned, quoted, or called
    const childName = (config.childName || 'cia').toLowerCase();
    const cleanText = (text || '').toLowerCase().trim();

    // Check if bot is mentioned via WhatsApp mentions (@number)
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid || [];
    if (this.botJid && mentionedJids.some(jid => jid.includes(this.botJid.split('@')[0]))) {
      return true;
    }

    // Check if replying/quoting the bot's message
    if (contextInfo?.participant && this.botJid && contextInfo.participant.includes(this.botJid.split('@')[0])) {
      return true;
    }

    // Ping check: if someone pings "p", "ppp", "P"
    if (/^p+$/i.test(cleanText)) {
      return true;
    }

    // Check if child's name or pet names are mentioned in text
    const nameRegex = new RegExp(`(^|\\s|[^a-zA-Z0-9])(${childName}+|anakku|si kecil|dedek|adek|dek|nak|sayang|sayangku|neng|cantik)($|\\s|[^a-zA-Z0-9])`, 'i');
    if (nameRegex.test(cleanText)) {
      return true;
    }

    // If sends photo or audio
    if (msg.message?.imageMessage || msg.message?.audioMessage) {
      return true;
    }

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
