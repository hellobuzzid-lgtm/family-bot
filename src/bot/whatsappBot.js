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
import { formatRupiah } from '../utils/formatters.js';

export class WhatsAppBot {
  constructor(geminiService, googleSheetsService = null) {
    this.geminiService = geminiService;
    this.googleSheetsService = googleSheetsService;
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

    const cleanLower = (text || '').toLowerCase().trim();
    const isSpreadsheetTest = /(cek|tes|test|status)\s*(spreadsheet|spreedsheet|sheet|gss)/i.test(cleanLower) ||
                             /(spreadsheet|spreedsheet)\s*(cek|tes|test|status|error|kenapa)/i.test(cleanLower);

    if (isSpreadsheetTest && this.googleSheetsService) {
      console.log('[WhatsAppBot] 📊 Diagnostic command triggered: Cek Spreadsheet');
      const testResult = await this.googleSheetsService.testConnection();
      await this.sendMessageWithTyping(chatJid, testResult, msg);
      return;
    }

    const isRefreshRecap = /(perbarui|update|refresh|sinkron|sync)\s*(rekap|dashboard|sps|spreadsheet)/i.test(cleanLower);
    if (isRefreshRecap && this.googleSheetsService) {
      console.log('[WhatsAppBot] 📊 Diagnostic command triggered: Perbarui Rekap Spreadsheet');
      await this.sendMessageWithTyping(chatJid, '⏳ *Sedang memperbarui Rekap Mingguan & Bulanan di Google Spreadsheet...*', msg);
      const refreshResult = await this.googleSheetsService.refreshRecap();
      if (refreshResult.success) {
        await this.sendMessageWithTyping(chatJid, '✅ *Tab "Rekap Bulanan" dan "Rekap Mingguan" di Google Spreadsheet BERHASIL Diperbarui!*\n\nSilakan buka spreadsheet Anda untuk melihat ringkasan keuangan terbaru.', msg);
      } else {
        await this.sendMessageWithTyping(chatJid, `⚠️ *Gagal memperbarui rekap:* ${refreshResult.error || refreshResult.reason}\n\nPastikan kode Apps Script terbaru sudah dipasang di spreadsheet Anda.`, msg);
      }
      return;
    }

    // Audit & Rekonsiliasi Database Keuangan
    const isAuditCommand = /(audit|rekonsiliasi|sinkron ulang)\s*(keuangan|transaksi|saldo|database)/i.test(cleanLower);
    if (isAuditCommand && this.geminiService?.financeManager) {
      console.log('[WhatsAppBot] 🛡️ Audit & Rekonsiliasi Command Triggered');
      await this.sendMessageWithTyping(chatJid, '⏳ *Sedang melakukan audit dan rekonsiliasi data transaksi...*', msg);
      const auditResult = this.geminiService.financeManager.auditAndReconcile();

      if (this.googleSheetsService) {
        const activeTxs = this.geminiService.financeManager.data.transactions.filter(t => t.status === 'active');
        await this.googleSheetsService.reconcileAllTransactions(activeTxs);
      }

      const reportMsg = `🛡️ *LAPORAN AUDIT & REKONSILIASI KEUANGAN*\n\n` +
        `• Total Transaksi: *${auditResult.totalTransactions}*\n` +
        `• Transaksi Aktif Valid: *${auditResult.activeTransactions}*\n` +
        `• Duplikat Diarsipkan: *${auditResult.duplicatesFound}*\n` +
        `• Data Corrupt/Invalid: *${auditResult.corruptedFound}*\n\n` +
        `💰 *Rekonsiliasi Saldo Akhir (SSOT):*\n` +
        `• Saldo Pribadi: *${formatRupiah(auditResult.reconciledBalances.personalBalance)}*\n` +
        `• Saldo Bisnis: *${formatRupiah(auditResult.reconciledBalances.businessBalance)}*\n` +
        `• Tabungan Rencana: *${formatRupiah(auditResult.reconciledBalances.savingsBalance)}*\n\n` +
        `✅ *Seluruh laporan mingguan, bulanan, dan Google Spreadsheet telah diselaraskan secara konsisten.*`;

      await this.sendMessageWithTyping(chatJid, reportMsg, msg);
      return;
    }

    // Jadwal Salat Query
    const isPrayerScheduleQuery = /(jadwal|waktu|jam berapa)\s*(salat|sholat|solat)/i.test(cleanLower);
    if (isPrayerScheduleQuery && this.geminiService?.routineManager) {
      const pt = this.geminiService.routineManager.getPrayerTimesToday();
      const prayerMsg = `🕌 *JADWAL SALAT HARI INI - ${pt.city.toUpperCase()}*\n\n` +
        `• Subuh   : *${pt.subuh} WIB*\n` +
        `• Terbit  : *${pt.terbit} WIB*\n` +
        `• Dzuhur  : *${pt.dzuhur} WIB*\n` +
        `• Ashar   : *${pt.ashar} WIB*\n` +
        `• Maghrib : *${pt.maghrib} WIB*\n` +
        `• Isya    : *${pt.isya} WIB*\n\n` +
        `_Waktu dihitung presisi standar Kemenag RI wilayah ${pt.city}._`;
      await this.sendMessageWithTyping(chatJid, prayerMsg, msg);
      return;
    }

    // Auto-detect prayer completion (Salat)
    const prayerMatch = cleanLower.match(/(?:(?:udah|sudah|selesai|beres)\s*(?:sholat|salat|solat)\s*(subuh|dzuhur|zuhur|ashar|asar|maghrib|isya)|(?:sholat|salat|solat)\s*(subuh|dzuhur|zuhur|ashar|asar|maghrib|isya)\s*(?:udah|sudah|selesai|beres))/i);
    if (prayerMatch && this.geminiService?.routineManager) {
      const pName = (prayerMatch[1] || prayerMatch[2] || '').toLowerCase();
      const stdName = pName.includes('subuh') ? 'Subuh'
        : (pName.includes('dzuhur') || pName.includes('zuhur')) ? 'Dzuhur'
        : (pName.includes('ashar') || pName.includes('asar')) ? 'Ashar'
        : pName.includes('maghrib') ? 'Maghrib' : 'Isya';
      
      this.geminiService.routineManager.logHabit({
        habit: 'prayer',
        value: stdName,
        notes: `Telah ditunaikan (${speakerInfo.name})`
      });
      console.log(`[WhatsAppBot] 🕌 Salat ${stdName} ditunaikan oleh ${speakerInfo.name}, tercatat ke Rutinitas & SPS.`);
    }

    // Safety check: Ambiguity handling for corrections (Kasus F)
    const isCorrectionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:salah|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi|seharusnya|harusnya|mestinya|bukan\s*(?:pemasukan|pengeluaran|tabungan|utang)|(?:jadi|menjadi)\s*(?:pengeluaran|pemasukan))(?:$|\s|[^a-zA-Z0-9])/i.test(cleanLower);
    if (isCorrectionIntent && this.geminiService?.financeManager) {
      const match = this.geminiService.financeManager.findTransactionForCorrection({
        text,
        owner: speakerInfo.role === 'partner' ? 'partner' : 'owner'
      });

      if (match.status === 'ambiguous') {
        console.log('[WhatsAppBot] ⚠️ Ambiguous correction detected, prompting user for choice');
        const candidateList = match.candidates.slice(0, 4).map((c, idx) =>
          `${idx + 1}. [ID: ${c.id}] ${c.date.split(' ')[0]} | ${c.type.toUpperCase()}: ${formatRupiah(c.amount)} ("${c.description}")`
        ).join('\n');

        const ambiguousMsg = `⚠️ *Konfirmasi Koreksi Transaksi*\n\n` +
          `NEX menemukan beberapa transaksi yang serupa dengan yang ingin Anda koreksi:\n\n${candidateList}\n\n` +
          `📌 *Silakan sebutkan nomor urut atau ID transaksinya* (contoh: *"Koreksi nomor 1 jadi pengeluaran"*) agar data Anda diperbarui secara tepat dan akurat.`;

        await this.sendMessageWithTyping(chatJid, ambiguousMsg, msg);
        return;
      }
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
      console.log('[WhatsAppBot] 🎯 Triggered by QUOTE / REPLY to bot');
      return true;
    }

    // 3. Check WhatsApp @mentions
    const contextInfo = this.extractContextInfo(msg);
    const mentionedJids = contextInfo?.mentionedJid || [];
    const botNum = normalizePhone(config.botPhone) || (this.botJid ? normalizePhone(this.botJid) : '');
    const botCleanJid = this.botJid ? this.botJid.split(':')[0].split('@')[0] : '';
    const botCleanLid = this.botLid ? this.botLid.split(':')[0].split('@')[0] : '';

    const isDirectlyMentioned = Boolean(
      (botCleanJid && mentionedJids.some(jid => jid.split(':')[0].split('@')[0] === botCleanJid)) ||
      (botCleanLid && mentionedJids.some(jid => jid.split(':')[0].split('@')[0] === botCleanLid)) ||
      (botNum && mentionedJids.some(jid => normalizePhone(jid).includes(botNum) || botNum.includes(normalizePhone(jid)))) ||
      (botNum && (lowerText.includes(`@${botNum}`) || lowerText.includes(`@${botNum.replace(/^62/, '0')}`)))
    );
    if (isDirectlyMentioned) {
      console.log('[WhatsAppBot] 🎯 Triggered by @TAG / MENTION to bot');
      return true;
    }

    // 4. Check if called by name or bot keywords (NEX)
    const customBotName = (config.botName || 'nex').trim().toLowerCase();
    const callKeywords = /(^|\s|[^a-zA-Z0-9])(nex|bot|partner|ai|partner ai|life partner|bro ai|asisten)($|\s|[^a-zA-Z0-9])/i;
    if (callKeywords.test(lowerText) || (customBotName && lowerText.includes(customBotName))) {
      console.log(`[WhatsAppBot] 🎯 Triggered by NAME / KEYWORD in message: "${cleanText}"`);
      return true;
    }

    // 5. Check if parent/owner asks for specific life partner utilities in group:
    // (e.g. tanya jadwal salat, minta evaluasi, tanya keuangan bersama, minta saran, rekap, koreksi, audit, briefing, tugas)
    const utilityKeywords = /(jadwal salat|waktu salat|evaluasi|rekap|ringkasan|catat|koreksi|ralat|audit|rekonsiliasi|pengeluaran|pemasukan|keuangan|saran|pendapat kamu|menurut kamu|target kita|briefing|daily briefing|pekerjaan|tugas|harus saya lakukan|ngapain|keynex)/i;
    if (utilityKeywords.test(lowerText)) {
      console.log(`[WhatsAppBot] 🎯 Triggered by UTILITY KEYWORD: "${cleanText}"`);
      return true;
    }

    // In group, give space for private conversations between the couple
    return false;
  }

  isMessageQuotingBot(msg) {
    const contextInfo = this.extractContextInfo(msg);
    if (!contextInfo) return false;

    // A. Quoting a message sent by the bot in current session
    if (contextInfo.stanzaId && this.botSentMessageIds.has(contextInfo.stanzaId)) {
      return true;
    }

    // B. Quoting bot's participant JID, LID, or Phone number
    const participant = (contextInfo.participant || '').toLowerCase().trim();
    if (!participant) return false;

    const botNum = normalizePhone(config.botPhone) || (this.botJid ? normalizePhone(this.botJid) : '');
    const botCleanJid = this.botJid ? this.botJid.split(':')[0].split('@')[0] : '';
    const botCleanLid = this.botLid ? this.botLid.split(':')[0].split('@')[0] : '';

    const participantClean = participant.split(':')[0].split('@')[0];
    const participantPhone = normalizePhone(participant);

    if (botCleanJid && (participantClean === botCleanJid || participant.includes(botCleanJid))) return true;
    if (botCleanLid && (participantClean === botCleanLid || participant.includes(botCleanLid))) return true;
    if (botNum && participantPhone && (participantPhone === botNum || participantPhone.includes(botNum) || botNum.includes(participantPhone))) return true;

    return false;
  }

  getInnerMessage(msg) {
    let m = msg?.message;
    if (!m) return null;
    while (
      m.ephemeralMessage ||
      m.viewOnceMessage ||
      m.viewOnceMessageV2 ||
      m.viewOnceMessageV2Extension ||
      m.documentWithCaptionMessage
    ) {
      m = (
        m.ephemeralMessage ||
        m.viewOnceMessage ||
        m.viewOnceMessageV2 ||
        m.viewOnceMessageV2Extension ||
        m.documentWithCaptionMessage
      ).message;
    }
    return m;
  }

  extractContextInfo(msg) {
    const m = this.getInnerMessage(msg);
    if (!m) return null;
    return m.extendedTextMessage?.contextInfo ||
           m.imageMessage?.contextInfo ||
           m.videoMessage?.contextInfo ||
           m.audioMessage?.contextInfo ||
           m.documentMessage?.contextInfo;
  }

  extractMessageText(msg) {
    const m = this.getInnerMessage(msg);
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.documentMessage?.caption) return m.documentMessage.caption;
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
