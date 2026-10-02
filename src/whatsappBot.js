import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
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

    this.sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['NEX Family Virtual Child', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
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
    const pushName = msg.pushName || 'Keluarga';

    // Identify speaker
    const speakerInfo = this.identifySpeaker(senderPhone, pushName, senderJid);

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

  identifySpeaker(senderPhone, pushName, senderJid) {
    if (config.fatherPhone && senderPhone.includes(config.fatherPhone)) {
      return { role: 'father', name: config.fatherName, jid: senderJid };
    }
    if (config.motherPhone && senderPhone.includes(config.motherPhone)) {
      return { role: 'mother', name: config.motherName, jid: senderJid };
    }

    // Secondary fallback matching on pushName if configured phone is missing
    const nameLower = (pushName || '').toLowerCase();
    if (nameLower.includes(config.fatherName.toLowerCase())) {
      return { role: 'father', name: config.fatherName, jid: senderJid };
    }
    if (nameLower.includes(config.motherName.toLowerCase())) {
      return { role: 'mother', name: config.motherName, jid: senderJid };
    }

    return { role: 'family_member', name: pushName || 'Keluarga', jid: senderJid };
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
    // In private 1-on-1 chat with Ayah or Ibu: always respond
    if (!isGroup) return true;

    // In group:
    const childName = (config.childName || 'cia').toLowerCase();
    const cleanText = (text || '').toLowerCase();

    // 1. Check if bot is mentioned via WhatsApp mentions (@number)
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid || [];
    if (this.botJid && mentionedJids.some(jid => jid.includes(this.botJid.split('@')[0]))) {
      return true;
    }

    // 2. Check if replying/quoting the bot's message
    if (contextInfo?.participant && this.botJid && contextInfo.participant.includes(this.botJid.split('@')[0])) {
      return true;
    }

    // 3. Check if child's name or pet names are mentioned in text (Cia, nak, adek, si kecil, dll)
    const nameRegex = new RegExp(`\\b(${childName}|anakku|si kecil|dedek|adek|dek|nak)\\b`, 'i');
    if (nameRegex.test(cleanText)) {
      return true;
    }

    // 4. Natural questions or topics directed to child from Ayah or Ibu:
    if (speakerInfo.role === 'father' || speakerInfo.role === 'mother') {
      const childKeywords = [
        'uang jajan', 'uang saku', 'celengan', 'tabungan', 'uangmu', 'sisa uang',
        'sekolah', 'bu rina', 'pr ', 'tugas', 'gambar', 'krayon',
        'lagi apa', 'sedang apa', 'udah makan', 'sudah makan', 'sudah mandi',
        'udah tidur', 'selamat tidur', 'mimpi indah', 'bobok', 'bobo',
        'kangen', 'hari ini gimana', 'gimana harimu', 'cerita dong',
        'jajan apa', 'buat jajan', 'transfer', 'uangnya'
      ];

      if (childKeywords.some(kw => cleanText.includes(kw))) {
        return true;
      }

      // If Ayah or Ibu sends a photo or audio, child is curious and responds naturally!
      if (msg.message?.imageMessage || msg.message?.audioMessage) {
        return true;
      }
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
