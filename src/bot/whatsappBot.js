import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { config, normalizePhone } from '../config.js';

export class WhatsAppBot {
  constructor(geminiService) {
    this.geminiService = geminiService;
    this.sock = null;
    this.botJid = null;
    this.botLid = null;
    this.botPhone = config.botPhone || null;
    this.botSentMessageIds = new Set();
    this.targetGroupJid = config.targetGroupJid || null;
    this.chatHistories = new Map(); // Map of jid -> array of recent messages
  }

  trackSentMessageId(id) {
    if (!id) return;
    this.botSentMessageIds.add(id);
    if (this.botSentMessageIds.size > 100) {
      const first = this.botSentMessageIds.values().next().value;
      this.botSentMessageIds.delete(first);
    }
  }

  async start() {
    // If requested via env, reset auth directory cleanly
    if (process.env.RESET_AUTH === 'true') {
      console.log('[WhatsAppBot] RESET_AUTH=true detected. Clearing authDir before start...');
      try {
        if (fs.existsSync(config.authDir)) {
          fs.rmSync(config.authDir, { recursive: true, force: true });
          fs.mkdirSync(config.authDir, { recursive: true });
        }
      } catch (e) {
        console.error('[WhatsAppBot] Error clearing authDir on reset:', e.message);
      }
    }

    if (this.sock?.ev) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
      } catch (_) {}
    }

    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

    console.log(`[WhatsAppBot] Starting AI Life Partner WhatsApp Socket (Baileys v${version.join('.')})...`);

    const browser = config.usePairingCode
      ? ['Ubuntu', 'Chrome', '20.0.04']
      : ['AI Life Partner', 'Chrome', '2.0.0'];

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

    // Pairing Code Request for Headless / Railway environment
    if (config.usePairingCode && !this.sock.authState.creds.registered) {
      if (!config.botPhone) {
        console.warn('⚠️ [WhatsAppBot] BOT_PHONE belum diatur di .env / Variables!');
      } else {
        let attempts = 0;
        const requestPairing = async () => {
          if (this.sock?.authState?.creds?.registered) return;
          try {
            attempts++;
            console.log(`[WhatsAppBot] 📡 Meminta kode pairing WhatsApp untuk nomor ${config.botPhone} (Percobaan #${attempts})...`);
            const code = await this.sock.requestPairingCode(config.botPhone);
            console.log('\n======================================================');
            console.log(`🔑 KODE PAIRING WHATSAPP ANDA: 👉 ${code} 👈`);
            console.log('======================================================');
            console.log(`📱 Nomor Bot: ${config.botPhone}`);
            console.log('Langkah Menautkan di WhatsApp HP Bot:');
            console.log(`1. Buka aplikasi WhatsApp di HP nomor bot (${config.botPhone})`);
            console.log('2. Buka Setelan (titik tiga) > Perangkat Tertaut > Tautkan Perangkat');
            console.log('3. Klik tautan teks kecil di bagian bawah: "Tautkan dengan nomor telepon saja"');
            console.log(`4. Masukkan kode 8 karakter di atas: ${code}`);
            console.log('======================================================\n');
          } catch (err) {
            console.error(`❌ [WhatsAppBot] Gagal meminta kode pairing (Percobaan #${attempts}):`, err.message);
            if (attempts < 5 && !this.sock?.authState?.creds?.registered) {
              console.log('[WhatsAppBot] Mencoba meminta kode pairing kembali dalam 5 detik...');
              setTimeout(requestPairing, 5000);
            }
          }
        };

        setTimeout(requestPairing, 5000);
      }
    }

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !config.usePairingCode) {
        console.log('\n📱 SCAN QR CODE DENGAN WHATSAPP:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
        const errMsg = (lastDisconnect?.error?.message || '').toLowerCase();
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403 || errMsg.includes('connection failure') || errMsg.includes('logged out') || errMsg.includes('bad session');
        const shouldReconnect = !isLoggedOut;

        console.log(`[WhatsAppBot] Connection closed. Reason: ${lastDisconnect?.error?.message || statusCode}. StatusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (isLoggedOut) {
          console.log('⚠️ [WhatsAppBot] Sesi WhatsApp sebelumnya telah LOGGED OUT atau TIDAK VALID.');
          console.log('🔄 [WhatsAppBot] Membersihkan direktori auth_info_baileys secara otomatis agar bot meminta KODE PAIRING BARU...');
          try {
            if (fs.existsSync(config.authDir)) {
              fs.rmSync(config.authDir, { recursive: true, force: true });
              fs.mkdirSync(config.authDir, { recursive: true });
            }
          } catch (cleanErr) {
            console.error('[WhatsAppBot] Gagal mereset authDir:', cleanErr.message);
          }
          console.log('⏳ [WhatsAppBot] Memulai ulang socket dalam 3 detik untuk meminta kode pairing baru...');
          setTimeout(() => this.start(), 3000);
        } else {
          console.log('[WhatsAppBot] Menyambung kembali dalam 3 detik...');
          setTimeout(() => this.start(), 3000);
        }
      } else if (connection === 'open') {
        this.botJid = this.sock.user?.id ? this.sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
        this.botLid = this.sock.user?.lid ? this.sock.user.lid.split('@')[0] : null;
        this.botPhone = config.botPhone || (this.sock.user?.id ? this.sock.user.id.split(':')[0].replace(/\D/g, '') : null);

        console.log('======================================================');
        console.log('✅ [WhatsAppBot] AI LIFE PARTNER WHATSAPP CONNECTED!');
        console.log(`🤖 Bot JID: ${this.botJid} (LID: ${this.botLid || 'N/A'})`);
        console.log(`👤 Owner (${config.ownerName}): ${config.ownerPhone}`);
        console.log(`💍 Partner (${config.partnerName}): ${config.partnerPhone}`);
        if (this.targetGroupJid) {
          console.log(`👥 Target Group: ${this.targetGroupJid}`);
        }
        console.log('======================================================');
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
    if (msg.key.fromMe) return;

    const chatJid = msg.key.remoteJid;
    const isGroup = chatJid.endsWith('@g.us');
    const senderJid = isGroup ? (msg.key.participant || msg.key.remoteJid) : chatJid;
    const senderPhone = normalizePhone(senderJid);
    const participantPn = msg.key?.participantPn ? normalizePhone(msg.key.participantPn) : '';
    const pushName = msg.pushName || 'Teman';

    // Identify speaker
    const speakerInfo = this.identifySpeaker(senderPhone, pushName, senderJid, participantPn);

    // Extract text
    const text = this.extractMessageText(msg);
    if (!text && !msg.message?.imageMessage && !msg.message?.audioMessage) {
      return;
    }

    // Add to history
    this.recordChatHistory(chatJid, {
      senderJid,
      senderName: speakerInfo.name,
      role: speakerInfo.role,
      text: text || '[Media]'
    });

    // Determine if bot should respond
    const shouldRespond = this.checkShouldRespond(msg, text, isGroup, speakerInfo);
    if (!shouldRespond) {
      return;
    }

    console.log(`[WhatsAppBot] 💬 Processing message from ${speakerInfo.name} (${speakerInfo.role}) in ${isGroup ? 'Group' : 'Private'}: "${text || '[Media]'}"`);

    // Generate AI Response
    const history = this.getRecentChatHistory(chatJid, 10);
    const replyText = await this.geminiService.generateResponse({
      messageText: text,
      speakerInfo,
      chatHistory: history,
      isGroup,
      chatJid
    });

    if (replyText) {
      await this.sendMessageWithTyping(chatJid, replyText, msg);

      this.recordChatHistory(chatJid, {
        senderJid: 'bot',
        senderName: config.botName,
        role: 'assistant',
        text: replyText
      });
    }
  }

  identifySpeaker(senderPhone, pushName, senderJid, participantPn = '') {
    let resolvedPhone = senderPhone;
    if (participantPn) {
      resolvedPhone = normalizePhone(participantPn);
    }

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

    const normOwner = normalizePhone(config.ownerPhone);
    const normPartner = normalizePhone(config.partnerPhone);

    if (normOwner && resolvedPhone && (resolvedPhone === normOwner || resolvedPhone.endsWith(normOwner) || normOwner.endsWith(resolvedPhone))) {
      return { role: 'owner', name: config.ownerName, jid: senderJid, phone: resolvedPhone };
    }
    if (normPartner && resolvedPhone && (resolvedPhone === normPartner || resolvedPhone.endsWith(normPartner) || normPartner.endsWith(resolvedPhone))) {
      return { role: 'partner', name: config.partnerName, jid: senderJid, phone: resolvedPhone };
    }

    return { role: 'user', name: pushName || 'User', jid: senderJid, phone: resolvedPhone };
  }

  checkShouldRespond(msg, text, isGroup, speakerInfo) {
    // 1. In private chat (1-on-1): Always respond!
    if (!isGroup) return true;

    const cleanText = (text || '').trim();
    const lowerText = cleanText.toLowerCase();

    // 2. Check if quoted / replied to bot
    if (this.isMessageQuotingBot(msg)) {
      return true;
    }

    // 3. Check WhatsApp @mentions
    const contextInfo = this.extractContextInfo(msg);
    const mentionedJids = contextInfo?.mentionedJid || [];
    const botNum = config.botPhone || (this.botJid ? this.botJid.replace(/\D/g, '') : '');
    const isDirectlyMentioned = Boolean(
      (this.botJid && mentionedJids.some(jid => jid.includes(this.botJid.split('@')[0]))) ||
      (this.botLid && mentionedJids.some(jid => jid.includes(this.botLid))) ||
      (botNum && mentionedJids.some(jid => jid.includes(botNum)))
    );
    if (isDirectlyMentioned) return true;

    // 4. Check if called by name or bot keywords
    const callKeywords = /(^|\s|[^a-zA-Z0-9])(bot|partner|ai|partner ai|life partner|bro ai|asisten)($|\s|[^a-zA-Z0-9])/i;
    if (callKeywords.test(lowerText)) {
      return true;
    }

    // 5. Check if parent/owner asks for specific life partner utilities in group:
    // (e.g. tanya jadwal salat, minta evaluasi, tanya keuangan bersama, minta saran)
    const utilityKeywords = /(jadwal salat|waktu salat|evaluasi|catat|pengeluaran|pemasukan|keuangan|saran|pendapat kamu|menurut kamu|target kita)/i;
    if (utilityKeywords.test(lowerText)) {
      return true;
    }

    // In group, give space for private conversations between the couple
    return false;
  }

  isMessageQuotingBot(msg) {
    const contextInfo = this.extractContextInfo(msg);
    if (!contextInfo) return false;

    if (contextInfo.stanzaId && this.botSentMessageIds.has(contextInfo.stanzaId)) {
      return true;
    }

    const participant = (contextInfo.participant || '').toLowerCase();
    const botPhone = config.botPhone || (this.botJid ? this.botJid.replace(/\D/g, '') : '');
    if (participant) {
      if (botPhone && participant.includes(botPhone)) return true;
      if (this.botLid && participant.includes(this.botLid.toLowerCase())) return true;
      if (this.botJid && participant.includes(this.botJid.split('@')[0].toLowerCase())) return true;
    }

    return false;
  }

  extractContextInfo(msg) {
    const m = msg.message;
    if (!m) return null;
    return m.extendedTextMessage?.contextInfo ||
           m.imageMessage?.contextInfo ||
           m.videoMessage?.contextInfo ||
           m.audioMessage?.contextInfo ||
           m.documentMessage?.contextInfo;
  }

  extractMessageText(msg) {
    const m = msg.message;
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    return '';
  }

  recordChatHistory(chatJid, entry) {
    if (!this.chatHistories.has(chatJid)) {
      this.chatHistories.set(chatJid, []);
    }
    const list = this.chatHistories.get(chatJid);
    list.push(entry);
    if (list.length > 50) {
      list.shift();
    }
  }

  getRecentChatHistory(chatJid, limit = 10) {
    const list = this.chatHistories.get(chatJid) || [];
    return list.slice(-limit);
  }

  async sendMessageWithTyping(chatJid, text, quotedMessage = null) {
    try {
      await this.sock.presenceSubscribe(chatJid);
      await this.sock.sendPresenceUpdate('composing', chatJid);

      const delay = Math.min(3500, Math.max(1200, text.length * 20));
      await new Promise(resolve => setTimeout(resolve, delay));

      await this.sock.sendPresenceUpdate('paused', chatJid);

      const sent = await this.sock.sendMessage(chatJid, { text }, { quoted: quotedMessage });
      if (sent?.key?.id) {
        this.trackSentMessageId(sent.key.id);
      }
      return sent;
    } catch (err) {
      console.error('[WhatsAppBot] Error sending message with typing:', err.message);
    }
  }
}
