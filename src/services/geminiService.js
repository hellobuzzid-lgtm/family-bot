import { GoogleGenAI } from '@google/genai';
import dayjs from 'dayjs';
import { config } from '../config.js';
import { parseAmount, extractAmount, formatRupiah, isConfirmationText, getNow, formatIndoDate } from '../utils/formatters.js';

export class GeminiService {
  constructor(promptBuilder, memoryManager, financeManager, goalTracker, routineManager, taskManager = null, reminderManager = null, googleSheetsService = null) {
    this.promptBuilder = promptBuilder;
    this.memoryManager = memoryManager;
    this.financeManager = financeManager;
    this.goalTracker = goalTracker;
    this.routineManager = routineManager;
    this.taskManager = taskManager;
    this.reminderManager = reminderManager;
    this.googleSheetsService = googleSheetsService;

    if (!config.geminiApiKey) {
      console.warn('⚠️ [GeminiService] GEMINI_API_KEY is not set in .env!');
      this.ai = null;
    } else {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
  }

  setTaskManager(taskManager) {
    this.taskManager = taskManager;
    if (this.promptBuilder) {
      this.promptBuilder.setTaskManager(taskManager);
    }
  }

  setReminderManager(reminderManager) {
    this.reminderManager = reminderManager;
    if (this.promptBuilder) {
      this.promptBuilder.setReminderManager(reminderManager);
    }
  }

  setGoogleSheetsService(googleSheetsService) {
    this.googleSheetsService = googleSheetsService;
  }

  isAvailable() {
    return !!this.ai;
  }

  async generateResponse({
    messageText,
    speakerInfo,
    chatHistory = [],
    isGroup = false,
    chatJid = null,
    media = null
  }) {
    if (!messageText && !media) return '';

    const clean = (messageText || '').toLowerCase().trim();

    // 0. ACTIVITY CONFIRMATION RESPONSE (Section 3: "Sudah", "Belum", "Lewati", "Jadwalkan ulang")
    if (this.reminderManager) {
      const confRes = this.reminderManager.handleConfirmationResponse(clean, speakerInfo.role);
      if (confRes && confRes.handled) {
        console.log(`[GeminiService] 🔔 Activity confirmation handled: ${confRes.status}`);
        return confRes.message;
      }

      // Check if user is replying to a pending time clarification
      if (this.reminderManager.pendingClarifications.has(speakerInfo.role)) {
        const pending = this.reminderManager.pendingClarifications.get(speakerInfo.role);
        const resolved = this.reminderManager.parseNaturalReminder(messageText);
        if (resolved && !resolved.requiresClarification) {
          this.reminderManager.pendingClarifications.delete(speakerInfo.role);
          const rem = this.reminderManager.createReminder({
            activity: pending.activity,
            dueDate: resolved.dueDate,
            dueTime: resolved.dueTime,
            repeat: pending.repeat,
            owner: speakerInfo.role
          });
          return `Baik, sudah saya masukkan ke jadwal.\n\nAktivitas: *${rem.activity}*\nWaktu: *${rem.dueDate === getNow().format('YYYY-MM-DD') ? 'Hari ini' : rem.dueDate} pukul ${rem.dueTime} WIB*.\n\nSaya akan mengingatkan kamu pada waktu tersebut. ⏰`;
        }
      }
    }

    // 1. SAFETY: Check Confirmation Words ("Ya", "Benar", "Setuju", "Oke", "Sip")
    // Never re-process amounts or trigger new transactions on pure confirmation!
    if (isConfirmationText(clean)) {
      console.log(`[GeminiService] 🛡️ Recognized pure confirmation: "${clean}"`);
      return 'Sip, Bro! Dicatat dan dipahami. Kita lanjutkan eksekusi rencana sesuai target.';
    }

    // 2. DETERMINISTIC FINANCIAL ACTIONS (Transactions, Corrections, Deletions)
    // 100% Guaranteed recording to Local DB & SPS without depending on AI latency/failure!
    const directFinResult = await this.checkAndFallbackParseTransaction(messageText, speakerInfo);
    if (directFinResult && directFinResult.recorded) {
      if (directFinResult.isMulti && Array.isArray(directFinResult.transactions)) {
        const listStr = directFinResult.transactions.map((tx, idx) => {
          const typeLabel = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
          return `${idx + 1}. *${typeLabel}:* ${tx.description} sebesar *${formatRupiah(tx.amount)}* (ID: \`${tx.id}\`)`;
        }).join('\n');
        return `Sip, Bro! ${directFinResult.transactions.length} transaksi berhasil dicatat dan disinkronkan ke Google Spreadsheet (SPS):\n\n${listStr}\n\n✅ *Status SPS:* Tersimpan dan terverifikasi sebagai Single Source of Truth.`;
      } else if (directFinResult.isCorrection) {
        const tx = directFinResult.transaction;
        const typeLabel = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
        return `✅ Transaksi berhasil dikoreksi in-place!\n\nID: \`${tx.id}\`\nJenis: *${typeLabel}*\nNominal: *${formatRupiah(tx.amount)}*\nKeterangan: *${tx.description}*\n\nData telah diselaraskan ke Google Spreadsheet (SPS).`;
      } else if (directFinResult.isResetSPS) {
        return `🗑️ *SELURUH DATA SPS & DATABASE BERHASIL DIRESET!*\n\n` +
          `• Seluruh data transaksi di database bot telah dikosongkan.\n` +
          `• Tab *'Transaksi Keuangan'* di Google Spreadsheet telah dibersihkan.\n` +
          `• Tab *'Rekap Bulanan'* dan *'Rekap Mingguan'* otomatis diset ulang ke Rp0.\n` +
          `• Saldo aktif kini kembali ke kondisi awal (Rp0).\n\n` +
          `✅ Sistem siap mencatat transaksi baru dari nol.`;
      } else if (directFinResult.isDeletion) {
        const tx = directFinResult.transaction;
        const typeLabel = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
        return `🗑️ *TRANSAKSI BERHASIL DIHAPUS / DIBATALKAN!*\n\n` +
          `• ID: \`${tx.id}\`\n` +
          `• Jenis: *${typeLabel}*\n` +
          `• Nominal: *${formatRupiah(tx.amount)}*\n` +
          `• Keterangan: *${tx.description}*\n\n` +
          `✅ Data telah dihapus dari database bot dan Google Spreadsheet (SPS).\n` +
          `📊 Tab 'Rekap Mingguan' dan 'Rekap Bulanan' di SPS otomatis diperbarui.`;
      } else {
        const tx = directFinResult.transaction;
        const typeLabel = tx.type === 'income'
          ? (tx.isBusiness ? 'pemasukan bisnis' : 'pemasukan pribadi')
          : (tx.isBusiness ? 'pengeluaran bisnis' : 'pengeluaran pribadi');
        return `Sip, Bro! Udah dicatat ${typeLabel}: *${tx.description}* sebesar *${formatRupiah(tx.amount)}* (ID: \`${tx.id}\`).\n\nData transaksi telah tersimpan di database dan disinkronkan ke Google Spreadsheet (SPS). ✅`;
      }
    }

    // 3. SPS AS GROUND TRUTH FOR FINANCIAL QUESTIONS (Section 1 & 11)
    const isFinancialQuery = /(?:saldo|keuangan|uang|kas|pengeluaran|pemasukan|rekap|pendapatan|omzet|omset|laba|rugi|sps|spreadsheet)/i.test(clean);
    if (isFinancialQuery && this.financeManager) {
      if (this.financeManager.googleSheetsService?.isConfigured()) {
        await this.financeManager.syncWithSpreadsheet().catch(err => {
          console.warn('[GeminiService] Error syncing SPS on financial query:', err.message);
        });
      }

      // Check specific source (e.g. "pendapatan keynex")
      const isSourceQuery = /(?:pendapatan|omzet|omset|pemasukan|keuntungan|laba|rugi|transaksi)\s*(?:dari|bisnis)?\s*(keynex|kambing|ternak|freelance|gaji)/i.exec(clean) ||
                            /(keynex|kambing|ternak|freelance)\s*(?:dapat|omzet|omset|pendapatan|pemasukan|keuntungan|laba)/i.exec(clean);
      if (isSourceQuery) {
        const sourceName = (isSourceQuery[1] || isSourceQuery[2]).toUpperCase();
        console.log(`[GeminiService] 💼 Specific income source query from SPS: ${sourceName}`);
        const sourceFin = this.financeManager.getFinancesBySource(sourceName, {
          owner: speakerInfo.role === 'partner' ? 'partner' : 'owner'
        });
        if (sourceFin) return sourceFin.summaryText;
      }

      // Check weekly recap query
      if (/(?:rekap|ringkasan|laporan)\s*minggu(?:an|\s*ini)/i.test(clean)) {
        return this.financeManager.getWeeklyRecap().summaryText;
      }

      // Check monthly recap query
      if (/(?:rekap|ringkasan|laporan)\s*bulan(?:an|\s*ini)/i.test(clean)) {
        return this.financeManager.getMonthlyRecap().summaryText;
      }

      // Check balance query ("berapa saldo saya", "cek saldo", "sisa uang")
      if (/(?:berapa\s*)?saldo(?:\s*saya|\s*kita|\s*saat\s*ini)?|cek\s*saldo|sisa\s*uang/i.test(clean)) {
        return `💰 *KONDISI SALDO REAL-TIME (SPS SSOT)*\n\n` +
          `${this.financeManager.getFinancialSummary(null)}\n\n` +
          `📊 *Status:* Data langsung tersinkronisasi dari Google Spreadsheet (SPS).`;
      }
    }

    // 2. SMART REMINDER CREATION VIA NATURAL LANGUAGE (Section 2)
    const isReminderCreation = /(?:^|\s)(?:ingatkan|ingetin|remind|jadwalkan|masukkan\s*ke\s*jadwal|bikin\s*pengingat)(?:\s*saya|\s*aku|\s*gw)?/i.test(clean);
    if (isReminderCreation && this.reminderManager) {
      const parsed = this.reminderManager.parseNaturalReminder(messageText);
      if (parsed) {
        if (parsed.requiresClarification) {
          this.reminderManager.pendingClarifications.set(speakerInfo.role, parsed);
          return parsed.clarificationQuestion;
        } else {
          const rem = this.reminderManager.createReminder({
            activity: parsed.activity,
            dueDate: parsed.dueDate,
            dueTime: parsed.dueTime,
            repeat: parsed.repeat,
            repeatDay: parsed.repeatDay,
            owner: speakerInfo.role
          });
          return `Baik, sudah saya masukkan ke jadwal.\n\nAktivitas: *${rem.activity}*\nWaktu: *${rem.dueDate === getNow().format('YYYY-MM-DD') ? 'Hari ini' : rem.dueDate} pukul ${rem.dueTime} WIB*${rem.repeat !== 'none' ? ` (${rem.repeat})` : ''}.\n\nSaya akan mengingatkan kamu pada waktu tersebut. ⏰`;
        }
      }
    }

    // 3. SMART REMINDER MODIFICATION / RESCHEDULING (Section 2)
    const isReminderModify = /(?:ubah|ganti|tunda|majukan|batalkan|hapus|ingatkan\s*lagi)\s*(?:jadwal|pengingat|tadi|kegiatan|aktivitas|jadi\s*jam|ke\s*jam|\d+\s*jam|\d+\s*menit|besok)?/i.test(clean);
    if (isReminderModify && this.reminderManager) {
      if (/batal|hapus/i.test(clean)) {
        const cancelTarget = clean.replace(/batal(?:kan)?|hapus|pengingat|jadwal|tadi/gi, '').trim();
        const cancelResult = this.reminderManager.cancelReminder(cancelTarget || null);
        if (cancelResult.success) {
          return `Pengingat untuk *${cancelResult.reminder.activity}* berhasil dibatalkan. ✅`;
        }
      } else {
        const resResult = this.reminderManager.rescheduleReminder(null, clean);
        if (resResult.success) {
          return `Pengingat *${resResult.reminder.activity}* berhasil diperbarui ke pukul *${resResult.reminder.dueTime} WIB* (${resResult.reminder.dueDate}). 🔄`;
        }
      }
    }

    // 4. SCHEDULE & UNFINISHED TASKS QUERIES (Section 6)
    const isScheduleQuery = /(?:apa\s*(?:saja\s*)?)?jadwal\s*(?:saya|hari\s*ini)|jadwal\s*kegiatan/i.test(clean);
    if (isScheduleQuery) {
      return this.buildTodaySchedule(speakerInfo);
    }

    const isUnfinishedQuery = /(?:apa\s*(?:saja\s*)?)?(?:yang\s*)?belum\s*(?:saya|gw|aku|kita)?\s*(?:selesaikan|beres|selesai|kerjakan)|tugas\s*tertunda|pekerjaan\s*pending/i.test(clean);
    if (isUnfinishedQuery) {
      return this.buildUnfinishedItems(speakerInfo);
    }

    // 2. SPECIFIC BUSINESS / INCOME SOURCE QUERY (e.g. "pendapatan keynex bulan ini")
    const isSourceQuery = /(?:pendapatan|omzet|omset|pemasukan|keuntungan|laba|rugi|transaksi)\s*(?:dari|bisnis)?\s*(keynex|kambing|ternak|freelance|gaji)/i.exec(clean) ||
                          /(keynex|kambing|ternak|freelance)\s*(?:dapat|omzet|omset|pendapatan|pemasukan|keuntungan|laba)/i.exec(clean);
    if (isSourceQuery) {
      const sourceName = (isSourceQuery[1] || isSourceQuery[2]).toUpperCase();
      console.log(`[GeminiService] 💼 Specific income source query: ${sourceName}`);
      const sourceFin = this.financeManager.getFinancesBySource(sourceName, {
        owner: speakerInfo.role === 'partner' ? 'partner' : 'owner'
      });
      if (sourceFin) {
        return sourceFin.summaryText;
      }
    }

    // 3. PROACTIVE GUIDANCE: "Apa yang harus saya lakukan sekarang?"
    const isWhatShouldIDoNow = /(?:apa\s*(?:yang\s*)?(?:harus|sebaiknya|mesti)\s*(?:saya|gw|aku|kita)\s*(?:lakukan|kerjakan|buat)|sekarang\s*(?:harus|enaknya|mau)?\s*(?:ngapain|buat apa|kerja apa)|next\s*step(?:\s*apa)?)/i.test(clean);
    if (isWhatShouldIDoNow) {
      console.log('[GeminiService] 🧭 Proactive guidance triggered: What should I do now?');
      return this.buildWhatShouldIDoNow(speakerInfo);
    }

    // 4. DAILY BRIEFING ON DEMAND
    const isBriefingReq = /(daily briefing|briefing pagi|rencana hari ini|jadwal hari ini|agenda hari ini)/i.test(clean);
    if (isBriefingReq) {
      console.log('[GeminiService] ☀️ Daily Briefing triggered');
      return this.buildDailyBriefing(speakerInfo);
    }

    // 5. DAILY EVALUATION ON DEMAND
    const isEvalReq = /(daily evaluation|evaluasi harian|evaluasi malam|evaluasi hari ini)/i.test(clean);
    if (isEvalReq) {
      console.log('[GeminiService] 🌙 Daily Evaluation triggered');
      return this.buildDailyEvaluation(speakerInfo);
    }

    // 6. WEEKLY EVALUATION ON DEMAND
    const isWeeklyEvalReq = /(evaluasi mingguan|rekap mingguan lengkap|evaluasi minggu ini)/i.test(clean);
    if (isWeeklyEvalReq) {
      console.log('[GeminiService] 📊 Weekly Evaluation triggered');
      return this.buildWeeklyEvaluation(speakerInfo);
    }

    // 7. MONTHLY EVALUATION ON DEMAND
    const isMonthlyEvalReq = /(evaluasi bulanan|rekap bulanan lengkap|evaluasi bulan ini)/i.test(clean);
    if (isMonthlyEvalReq) {
      console.log('[GeminiService] 🗓️ Monthly Evaluation triggered');
      return this.buildMonthlyEvaluation(speakerInfo);
    }

    if (!this.ai) {
      return '*(AI Life Partner: GEMINI_API_KEY belum diisi di file .env / Variables Railway. Mohon isi API Key terlebih dahulu)*';
    }

    const systemPrompt = this.promptBuilder.buildSystemPrompt({
      speakerInfo,
      isGroup,
      chatJid
    });

    let historyContext = '';
    if (chatHistory && chatHistory.length > 0) {
      historyContext = '\n\n=== RIWAYAT CHAT TERAKHIR ===\n' +
        chatHistory.slice(-10).map(m => `[${m.senderName} (${m.role})]: ${m.text}`).join('\n') +
        '\n============================\n';
    }

    const currentMsgPrompt = `Pesan baru dari ${speakerInfo.name} (${speakerInfo.role}): "${messageText || ''}"`;
    const promptCombined = systemPrompt + historyContext + '\n\n' + currentMsgPrompt;

    const candidateModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash'
    ];

    if (config.geminiModel && !candidateModels.includes(config.geminiModel)) {
      if (!config.geminiModel.includes('2.5') && !config.geminiModel.includes('3.1')) {
        candidateModels.unshift(config.geminiModel);
      }
    }

    let lastError = null;

    const callWithTimeout = (promise, ms = 15000) => {
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('AI Request Timeout (15s)')), ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
    };

    for (const model of candidateModels) {
      try {
        console.log(`[GeminiService] Calling Gemini API (Model: ${model})...`);

        const contents = [];
        if (media && media.buffer && media.mimetype) {
          contents.push({
            parts: [
              {
                inlineData: {
                  data: Buffer.from(media.buffer).toString('base64'),
                  mimeType: media.mimetype
                }
              },
              { text: promptCombined }
            ]
          });
        } else {
          contents.push({
            parts: [{ text: promptCombined }]
          });
        }

        const response = await callWithTimeout(
          this.ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.8,
              maxOutputTokens: 750
            }
          })
        );

        const rawText = response.text?.trim();
        if (rawText) {
          // Process and execute any action_json embedded in the response
          let { cleanText, actionsExecuted, executedTx } = await this.processEmbeddedActions(rawText, speakerInfo, messageText);

          // If Gemini didn't output action_json, check fallback deterministic parser!
          if (actionsExecuted === 0) {
            const fallbackResult = await this.checkAndFallbackParseTransaction(messageText, speakerInfo);
            if (fallbackResult && fallbackResult.recorded) {
              actionsExecuted++;
              if (fallbackResult.isMulti && Array.isArray(fallbackResult.transactions)) {
                executedTx = fallbackResult.transactions[0];
                const listStr = fallbackResult.transactions.map((tx, idx) => {
                  const typeLabel = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
                  return `${idx + 1}. *${typeLabel}:* ${tx.description} sebesar *${formatRupiah(tx.amount)}* (ID: \`${tx.id}\`)`;
                }).join('\n');
                cleanText = `Sip, Bro! ${fallbackResult.transactions.length} transaksi berhasil dicatat dan disinkronkan ke Google Spreadsheet (SPS):\n\n${listStr}\n\nData transaksi telah tersimpan di database dan status SPS terkonfirmasi. ✅`;
              } else {
                executedTx = fallbackResult.transaction;
                const typeLabel = executedTx.type === 'income'
                  ? (executedTx.isBusiness ? 'pemasukan bisnis' : 'pemasukan pribadi')
                  : (executedTx.isBusiness ? 'pengeluaran bisnis' : 'pengeluaran pribadi');

                // If cleanText from Gemini contained wrong amount (e.g. Rp 2.000 or Rp 2), replace it with the real amount
                if (/(?:rp\.?\s*)?(?:2\.?000|2)\b/i.test(cleanText) && executedTx.amount >= 10000) {
                  cleanText = cleanText
                    .replace(/rp\.?\s*2\.?000\b/gi, formatRupiah(executedTx.amount))
                    .replace(/rp\.?\s*2\b/gi, formatRupiah(executedTx.amount));
                } else if (!cleanText.includes(formatRupiah(executedTx.amount))) {
                  cleanText = `Sip, Bro! Udah dicatat ${typeLabel}: *${executedTx.description}* sebesar *${formatRupiah(executedTx.amount)}*.\n\nData transaksi telah tersimpan di database dan disinkronkan ke Google Spreadsheet. ✅`;
                }
              }
            }
          } else if (executedTx && executedTx.amount >= 10000) {
            // If Gemini produced action_json but hallucinated "Rp 2.000" or "Rp 2" in text
            if (/(?:rp\.?\s*)?(?:2\.?000|2)\b/i.test(cleanText)) {
              cleanText = cleanText
                .replace(/rp\.?\s*2\.?000\b/gi, formatRupiah(executedTx.amount))
                .replace(/rp\.?\s*2\b/gi, formatRupiah(executedTx.amount));
            }
          }

          return cleanText;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[GeminiService] Model ${model} failed: ${err.message}`);
      }
    }

    console.error('[GeminiService] All candidate models failed! Last error:', lastError?.message);
    return 'Bro, koneksi analitik NEX lagi agak terhambat barusan. Coba kirim ulang pesan lo ya.';
  }

  async processEmbeddedActions(text, speakerInfo, userMessageText = '') {
    let cleanText = text;
    let actionsExecuted = 0;
    let executedTx = null;
    const actionRegex = /```action_json\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const jsonStr = match[1];
      try {
        const actionObj = JSON.parse(jsonStr);
        const actionRes = await this.executeAction(actionObj, speakerInfo, userMessageText);
        actionsExecuted++;
        if (actionRes?.transaction) {
          executedTx = actionRes.transaction;
        }
      } catch (err) {
        console.warn('[GeminiService] Failed to parse action_json:', err.message);
      }
    }

    cleanText = cleanText.replace(/```action_json[\s\S]*?```/g, '').trim();
    return { cleanText, actionsExecuted, executedTx };
  }

  /**
   * DETERMINISTIC PARSER & CORRECTION FALLBACK
   * Strictly distinguishes between NEW transactions, CORRECTIONS, and DELETIONS.
   */
  async checkAndFallbackParseTransaction(text, speakerInfo) {
    if (!text) return null;
    const clean = text.toLowerCase().trim();

    // 0. Safety: ignore confirmation words
    if (isConfirmationText(clean)) {
      return null;
    }

    // 1. Check if user is asking to RESET / CLEAR SPS
    const isResetSPSIntent = /(?:^|\s|[^a-zA-Z0-9])(?:hapus|reset|kosongkan|bersihkan|clear)\s*(?:semua\s*)?(?:data\s*)?(?:sps|spreadsheet|transaksi\s*keuangan|riwayat\s*transaksi)(?:$|\s|[^a-zA-Z0-9])/i.test(clean);
    if (isResetSPSIntent) {
      console.log(`[GeminiService] 🚨 Detected RESET / CLEAR SPS intent: "${text}"`);
      const clearRes = await this.financeManager.clearAllTransactions();
      return {
        recorded: true,
        isResetSPS: true,
        spsConfirmed: clearRes.spsConfirmed
      };
    }

    // 2. Check if user is asking to CORRECT a previous transaction
    const isCorrectionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:salah|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi|seharusnya|harusnya|mestinya|bukan\s*(?:pemasukan|pengeluaran|tabungan|utang)|(?:jadi|menjadi)\s*(?:pengeluaran|pemasukan))(?:$|\s|[^a-zA-Z0-9])/i.test(clean);
    
    // 3. Check if user is asking to CANCEL/DELETE a transaction
    const isDeletionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:hapus|batal|batalkan|delete|cancel|buang)\s*(?:transaksi|pencatatan|pengeluaran|pemasukan|tadi|terakhir|kemarin|barusan)?(?:$|\s|[^a-zA-Z0-9])/i.test(clean);

    if (isCorrectionIntent) {
      console.log(`[GeminiService] 🔍 Detected CORRECTION intent: "${text}"`);

      const wantsExpense = /(?:jadi|ubah\s*(?:ke|menjadi)?|seharusnya|mestinya|koreksi\s*(?:jadi|ke)?)\s*pengeluaran|bukan\s*pemasukan/i.test(clean);
      const wantsIncome = /(?:jadi|ubah\s*(?:ke|menjadi)?|seharusnya|mestinya|koreksi\s*(?:jadi|ke)?)\s*pemasukan|bukan\s*pengeluaran/i.test(clean);
      const isExpense = /(pengeluaran|beli|bayar|keluar|belanja|biaya)/i.test(clean);
      const isIncome = /(pemasukan|masuk|gaji|terima|dapat|omzet|cair|jual)/i.test(clean);
      const extractedAmt = extractAmount(clean);
      const parsedAmount = extractedAmt ? extractedAmt.value : null;

      const updates = {};
      if (wantsExpense) {
        updates.type = 'expense';
      } else if (wantsIncome) {
        updates.type = 'income';
      } else if (isExpense && !clean.includes('bukan pengeluaran')) {
        updates.type = 'expense';
      } else if (isIncome && !clean.includes('bukan pemasukan')) {
        updates.type = 'income';
      }

      if (parsedAmount && parsedAmount > 0) updates.amount = parsedAmount;

      // Extract new description if provided
      let cleanDesc = text
        .replace(/\b(?:nex|bot|partner|tolong|bantu|coba|dong|ya|please)\b/gi, '')
        .replace(/\b(?:salah|ralat|seharusnya|harusnya|mestinya|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi)\b/gi, '')
        .replace(/\bbukan\s*(?:pemasukan|pengeluaran|tabungan|utang)\b/gi, '')
        .replace(/\b(?:jadi|menjadi)\s*(?:pengeluaran|pemasukan)\b/gi, '')
        .replace(/\b(?:pemasukan|pengeluaran|sebesar|senilai)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (extractedAmt) {
        cleanDesc = cleanDesc.replace(new RegExp(extractedAmt.raw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'), '').trim();
      }

      if (cleanDesc && cleanDesc.length >= 2) {
        updates.description = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);
        const lowerDesc = cleanDesc.toLowerCase();
        if (/ayam|makan|minum|kopi|resto|nasi|mie|sarapan|lunch|dinner|jajan|snack|bakso/i.test(lowerDesc)) {
          updates.category = 'Makanan';
        } else if (/bensin|parkir|tol|gojek|grab|ojek|transport/i.test(lowerDesc)) {
          updates.category = 'Transportasi';
        } else if (/listrik|air|wifi|pulsa|paket\s*data|iuran/i.test(lowerDesc)) {
          updates.category = 'Tagihan & Utilitas';
        } else if (/belanja|baju|sepatu|tas|shopee|tokopedia/i.test(lowerDesc)) {
          updates.category = 'Belanja';
        }
      }

      const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
      const matchResult = this.financeManager.findTransactionForCorrection({
        text,
        amount: parsedAmount,
        owner
      });

      if (matchResult.status === 'found') {
        const targetTx = matchResult.transaction;
        console.log(`[GeminiService] 💡 Deterministic correction executing on ID: ${targetTx.id}`);
        const corRes = await this.financeManager.correctTransaction(targetTx.id, updates, {
          reason: `Koreksi deterministik: ${text}`
        });
        return { recorded: true, transaction: corRes.transaction, isCorrection: true, spsConfirmed: corRes.spsConfirmed };
      } else if (matchResult.status === 'ambiguous') {
        console.log(`[GeminiService] ⚠️ Ambiguous transaction match for correction: ${matchResult.candidates?.length} candidates found.`);
      }
      return null;
    }

    if (isDeletionIntent) {
      console.log(`[GeminiService] 🔍 Detected DELETION intent: "${text}"`);
      const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';

      // Check if user specifically asks to delete the last / latest transaction
      const isLastTxIntent = /(?:tadi|terakhir|barusan|kemarin|terbaru)/i.test(clean);
      let matchResult = this.financeManager.findTransactionForCorrection({ text, owner });

      if (matchResult.status !== 'found' && (isLastTxIntent || clean.includes('hapus') || clean.includes('batal'))) {
        const activeTxs = this.financeManager.data.transactions.filter(t => t.status === 'active');
        if (activeTxs.length > 0) {
          const lastTx = activeTxs[activeTxs.length - 1];
          matchResult = { status: 'found', transaction: lastTx };
        }
      }

      if (matchResult.status === 'found') {
        console.log(`[GeminiService] 💡 Deterministic deletion executing on ID: ${matchResult.transaction.id}`);
        const delRes = await this.financeManager.deleteTransaction(matchResult.transaction.id, {
          reason: `Pembatalan deterministik: ${text}`
        });
        return { recorded: true, transaction: matchResult.transaction, isDeletion: true, spsConfirmed: delRes.spsConfirmed };
      }
      return null;
    }

    // 3. New Transaction Recording Intent (Supports Single or Multi-Transaction sentences)
    const splitRegex = /(?:\r?\n|[,;]|\s+(?:dan|serta|sama)\s+)\s*(?=(?:pemasukan|pengeluaran|masuk|keluar|beli|jual|bayar|tabungan|nabung)\b)/i;
    const rawClauses = text.split(splitRegex).map(c => c.trim()).filter(Boolean);

    const parseSingleClause = async (clauseText) => {
      const cClean = clauseText.toLowerCase().trim();
      const extracted = extractAmount(cClean);
      const isIncome = /(?:pemasukan|masuk|jual|penjualan|gaji|gajian|terima|menerima|dapat|pendapatan|omzet|omset|cair|closing|untung|profit|bonus|thr|komisi|tf\s*masuk|transfer\s*masuk)/i.test(cClean);
      const isExpense = /(?:pengeluaran|keluar|beli|pembelian|bayar|pembayaran|biaya|ongkir|makan|minum|jajan|kopi|pulsa|listrik|bensin|sewa|tf\s*keluar|transfer\s*keluar|transfer\s*ke)/i.test(cClean);
      const isSavings = /(?:tabung|tabungan|nabung|simpan|darurat)/i.test(cClean);
      const isDebt = /(?:utang|hutang|pinjam|pinjaman|kasbon|bon|piutang|cicilan|angsuran)/i.test(cClean);
      const isExplicitRecord = /(?:catat|rekam|tulis|masukkan|tambah|input)/i.test(cClean);

      if (extracted && extracted.value > 0 && (isExplicitRecord || isIncome || isExpense || isSavings || isDebt)) {
        let type = 'expense';
        if (isSavings) type = 'savings';
        else if (isDebt) type = 'debt_payment';
        else if (isIncome && !cClean.includes('bukan pemasukan')) type = 'income';
        else if (isExpense) type = 'expense';

        // Clean description
        let desc = clauseText
          .replace(/\b(?:nex|bot|partner|tolong|bantu|coba|dong|ya|please|bro)\b/gi, '')
          .replace(/\b(?:catat|rekam|tulis|masukkan|tambah|input)\b/gi, '')
          .replace(/\b(?:pengeluaran|pemasukan|tabungan|sebesar|senilai|rp|idr)\b/gi, '')
          .replace(new RegExp(extracted.raw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'), '')
          .replace(/\s+/g, ' ')
          .trim();

        if (!desc || desc.length < 2) {
          if (type === 'income') desc = 'Pemasukan';
          else if (type === 'expense') desc = 'Pengeluaran';
          else if (type === 'savings') desc = 'Tabungan';
          else desc = 'Transaksi Keuangan';
        } else {
          desc = desc.charAt(0).toUpperCase() + desc.slice(1);
        }

        const isBusiness = /(?:bisnis|usaha|toko|proyek|klien|kambing|ternak|dagang|omzet|omset|jual|keynex)/i.test(cClean);
        let category = 'Umum';
        if (isBusiness) category = cClean.includes('keynex') ? 'KEYNEX' : 'Bisnis';
        else if (/makan|minum|kopi|resto|nasi|mie|sarapan|lunch|dinner|jajan|snack|bakso|ayam/i.test(cClean)) category = 'Makanan';
        else if (/bensin|parkir|tol|gojek|grab|ojek|transport/i.test(cClean)) category = 'Transportasi';
        else if (/listrik|air|wifi|pulsa|paket\s*data|iuran/i.test(cClean)) category = 'Tagihan & Utilitas';
        else if (/belanja|baju|sepatu|tas|shopee|tokopedia/i.test(cClean)) category = 'Belanja';

        console.log(`[GeminiService] 💡 Deterministic parser triggered: [${type.toUpperCase()}] ${extracted.value} - ${desc} (${category}, isBusiness: ${isBusiness})`);
        const recordRes = await this.financeManager.recordTransaction({
          type,
          amount: extracted.value,
          category,
          description: desc,
          isBusiness,
          owner: speakerInfo.role === 'partner' ? 'partner' : 'owner'
        });

        return {
          recorded: true,
          type,
          amount: extracted.value,
          description: desc,
          category,
          isBusiness,
          transaction: recordRes.transaction,
          spsConfirmed: recordRes.spsConfirmed
        };
      }
      return null;
    };

    if (rawClauses.length > 1) {
      const multiResults = [];
      for (const clause of rawClauses) {
        const res = await parseSingleClause(clause);
        if (res && res.recorded) {
          multiResults.push(res.transaction);
        }
      }
      if (multiResults.length > 0) {
        return {
          recorded: true,
          isMulti: true,
          transactions: multiResults,
          transaction: multiResults[0]
        };
      }
    } else {
      return parseSingleClause(text);
    }

    return null;
  }

  async executeAction(actionObj, speakerInfo, userMessageText = '') {
    if (!actionObj || !actionObj.action) return null;
    const { action, data } = actionObj;
    console.log(`[GeminiService] Executing auto action: ${action}`, data);

    try {
      const owner = data?.owner || (speakerInfo.role === 'partner' ? 'partner' : 'owner');

      switch (action) {
        case 'RECORD_TRANSACTION': {
          let finalAmount = parseAmount(data.amount);
          // Only correct if amount is suspiciously small (<= 2000) or missing, and user text has a real amount
          if (!finalAmount || finalAmount <= 2000) {
            const contextText = `${data.description || ''} ${data.type || ''} ${userMessageText}`;
            const userExtracted = extractAmount(contextText);
            if (userExtracted && userExtracted.value >= 10000) {
              console.log(`[GeminiService] 🛡️ Correcting Gemini amount hallucination: ${finalAmount} -> ${userExtracted.value}`);
              finalAmount = userExtracted.value;
            }
          }

          const recRes = await this.financeManager.recordTransaction({
            type: data.type || 'expense',
            amount: finalAmount,
            category: data.category || 'Umum',
            description: data.description || '',
            isBusiness: Boolean(data.isBusiness),
            owner,
            idempotencyKey: data.idempotencyKey
          });
          return { success: true, transaction: recRes.transaction, spsConfirmed: recRes.spsConfirmed };
        }

        case 'CORRECT_TRANSACTION': {
          let targetId = data.targetId;
          let finalAmount = data.amount ? parseAmount(data.amount) : null;
          if (!finalAmount || finalAmount <= 2000) {
            const contextText = `${data.description || ''} ${data.type || ''} ${userMessageText}`;
            const userExtracted = extractAmount(contextText);
            if (userExtracted && userExtracted.value >= 10000) {
              finalAmount = userExtracted.value;
            }
          }

          if (!targetId || targetId === 'tx_xxxx') {
            const matchResult = this.financeManager.findTransactionForCorrection({
              text: `${data.description || ''} ${finalAmount || ''}`,
              amount: finalAmount,
              type: data.type,
              owner
            });
            if (matchResult.status === 'found') {
              targetId = matchResult.transaction.id;
            }
          }
          if (targetId && targetId !== 'tx_xxxx') {
            const corRes = await this.financeManager.correctTransaction(targetId, {
              type: data.type,
              amount: finalAmount,
              category: data.category,
              description: data.description,
              isBusiness: data.isBusiness
            }, { reason: data.reason || 'Koreksi via AI' });
            return { success: true, transaction: corRes.transaction, spsConfirmed: corRes.spsConfirmed };
          } else {
            console.warn(`[GeminiService] CORRECT_TRANSACTION targetId not resolved`);
            return null;
          }
        }

        case 'DELETE_TRANSACTION': {
          let targetId = data.targetId;
          if (!targetId || targetId === 'tx_xxxx') {
            const matchResult = this.financeManager.findTransactionForCorrection({
              text: data.description || '',
              owner
            });
            if (matchResult.status === 'found') {
              targetId = matchResult.transaction.id;
            }
          }
          if (targetId && targetId !== 'tx_xxxx') {
            const delRes = await this.financeManager.deleteTransaction(targetId, { reason: data.reason || 'Dibatalkan via AI' });
            return { success: true, spsConfirmed: delRes.spsConfirmed };
          }
          return null;
        }

        case 'SET_INITIAL_BALANCE':
          this.financeManager.setInitialBalance({
            personal: data.personal,
            business: data.business,
            savings: data.savings,
            emergency: data.emergency
          });
          break;

        case 'ADD_DEBT':
          this.financeManager.addDebt({
            creditor: data.creditor || data.name || 'Pihak Ketiga',
            totalAmount: data.totalAmount || data.amount,
            monthlyInstallment: data.monthlyInstallment || data.installment || 0,
            dueDate: data.dueDate,
            notes: data.notes,
            type: data.type || 'debt'
          });
          break;

        case 'PAY_DEBT':
          this.financeManager.payDebt({
            debtId: data.debtId || data.creditor,
            amount: data.amount
          });
          break;

        case 'ADD_TASK':
          if (this.taskManager) {
            this.taskManager.addTask({
              title: data.title,
              priority: data.priority || 'medium',
              category: data.category || 'business',
              dueDate: data.dueDate,
              notes: data.notes,
              owner
            });
          }
          break;

        case 'COMPLETE_TASK':
          if (this.taskManager) {
            this.taskManager.completeTask(data.titleOrId || data.id || data.title);
          }
          break;

        case 'RESCHEDULE_TASK':
          if (this.taskManager) {
            this.taskManager.rescheduleTask(data.titleOrId || data.id, data.newDueDate || data.dueDate, data.reason);
          }
          break;

        case 'UPDATE_ROUTINE':
          this.routineManager.updateActivityStatus(data.nameOrId || data.name, data.status || 'completed', data.notes);
          break;

        case 'RESCHEDULE_ROUTINE':
          this.routineManager.rescheduleActivity(data.nameOrId || data.name, data.newTime || data.time, data.reason);
          break;

        case 'SET_GOAL':
          this.goalTracker.addGoal({
            title: data.title,
            type: data.type || 'weekly',
            category: data.category,
            targetValue: data.targetValue || 1,
            unit: data.unit || 'kali',
            targetDate: data.targetDate,
            strategy: data.strategy,
            owner
          });
          break;

        case 'UPDATE_GOAL':
          this.goalTracker.updateGoalProgress(data.titleOrId || data.id, data.progress || 1, data.note || '');
          break;

        case 'ADD_MEMORY':
          this.memoryManager.addMemory({
            content: data.content,
            category: data.category || 'personal',
            scope: data.scope || owner
          });
          break;

        case 'LOG_HABIT':
          this.routineManager.logHabit({
            habit: data.habit,
            value: data.value,
            notes: data.notes
          });
          break;

        case 'CREATE_REMINDER':
          if (this.reminderManager) {
            this.reminderManager.createReminder({
              activity: data.activity,
              dueDate: data.dueDate,
              dueTime: data.dueTime,
              repeat: data.repeat,
              repeatDay: data.repeatDay,
              priority: data.priority,
              owner
            });
          }
          break;

        case 'MODIFY_REMINDER':
        case 'RESCHEDULE_REMINDER':
          if (this.reminderManager) {
            this.reminderManager.modifyReminder(data.idOrActivity || data.activity, {
              newTime: data.newTime,
              newDate: data.newDate
            });
          }
          break;

        case 'CANCEL_REMINDER':
          if (this.reminderManager) {
            this.reminderManager.cancelReminder(data.idOrActivity || data.activity);
          }
          break;

        default:
          console.warn(`[GeminiService] Unknown action: ${action}`);
      }
    } catch (err) {
      console.error(`[GeminiService] Error executing action ${action}:`, err.message);
    }
  }

  // --- PROACTIVE BUILDERS (SECTIONS 1, 3, 7, 8, 9) ---

  buildWhatShouldIDoNow(speakerInfo) {
    const now = getNow();
    const timeStr = now.format('HH:mm');
    const pt = this.routineManager.getPrayerTimesToday();
    const nextAct = this.routineManager.getNextScheduledActivity(timeStr);
    const topTasks = this.taskManager ? this.taskManager.getTopPriorities(2, speakerInfo.role === 'partner' ? 'partner' : 'owner') : [];
    const lagging = this.goalTracker ? this.goalTracker.getLaggingGoals(speakerInfo.role === 'partner' ? 'partner' : 'owner') : [];

    let text = `🧭 *PANDUAN ARAHAN SEKARANG (Pukul ${timeStr} WIB)*\n\n`;
    text += `Bro, berdasarkan waktu aktual dan prioritas hidup lo saat ini, berikut langkah taktis yang harus lo lakukan:\n\n`;

    // 1. Sholat check
    const prayers = [
      { name: 'Subuh', time: pt.subuh, done: this.routineManager.data.todayRoutines.prayers.subuh },
      { name: 'Dzuhur', time: pt.dzuhur, done: this.routineManager.data.todayRoutines.prayers.dzuhur },
      { name: 'Ashar', time: pt.ashar, done: this.routineManager.data.todayRoutines.prayers.ashar },
      { name: 'Maghrib', time: pt.maghrib, done: this.routineManager.data.todayRoutines.prayers.maghrib },
      { name: 'Isya', time: pt.isya, done: this.routineManager.data.todayRoutines.prayers.isya }
    ];
    const passedNotDone = prayers.filter(p => timeStr >= p.time && !p.done);
    if (passedNotDone.length > 0) {
      const p = passedNotDone[passedNotDone.length - 1];
      text += `1. 🕌 *Kewajiban Ibadah:* Waktu ${p.name} (${p.time} WIB) sudah masuk dan belum tercatat. *Tunaikan sholat ${p.name} sekarang sebelum memulai hal lain!*\n\n`;
    }

    // 2. Scheduled routine
    if (nextAct) {
      text += `2. 📅 *Rutinitas Terjadwal:* *${nextAct.name}* (Pukul ${nextAct.time} WIB, durasi ${nextAct.duration} menit). Fokus tuntaskan ini.\n\n`;
    }

    // 3. Top priority task
    if (topTasks.length > 0) {
      text += `3. ⚡ *Pekerjaan Prioritas Utama:* Tuntaskan *${topTasks[0].title}* (Kategori: ${topTasks[0].category.toUpperCase()}).\n\n`;
    }

    // 4. Target reminder
    if (lagging.length > 0) {
      text += `4. 🎯 *Pengingat Target:* ${lagging[0].recommendation}\n\n`;
    }

    text += `💡 *Instruksi Eksekusi:* Ambil tindakan langsung untuk poin nomor 1 atau 2 dalam 30 menit ke depan, jangan menunda!`;
    return text;
  }

  buildDailyBriefing(speakerInfo) {
    const dateFormatted = formatIndoDate();
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';

    const balances = this.financeManager.data.balances;
    const monthly = this.financeManager.getMonthlyRecap(owner);

    const schedule = this.routineManager.getScheduleToday();
    const scheduleRows = schedule.map(s => `  • [${s.time}] ${s.name}`).join('\n');

    const topTasks = this.taskManager ? this.taskManager.getTopPriorities(3, owner) : [];
    const taskRows = topTasks.map((t, i) => `  ${i + 1}. [${t.priority.toUpperCase()}] ${t.title} (${t.category})`).join('\n') || '  (Belum ada pekerjaan prioritas)';

    const activeGoals = this.goalTracker ? this.goalTracker.getActiveGoalsSummary(owner) : '-';
    const topTaskTitle = topTasks[0]?.title || 'Eksekusi operasional dan pencatatan kas rapi';
    const pt = this.routineManager.getPrayerTimesToday();

    return `☀️ *DAILY BRIEFING — ${dateFormatted}*\n\n` +
      `💰 *1. Ringkasan Keuangan (SPS SSOT):*\n` +
      `• Saldo Aktif: Pribadi ${formatRupiah(balances.personalBalance)} | Bisnis ${formatRupiah(balances.businessBalance)}\n` +
      `• Arus Kas Bulan Ini (${monthly.monthLabel}): In ${formatRupiah(monthly.income)} | Out ${formatRupiah(monthly.expense)} | Net ${formatRupiah(monthly.net)}\n\n` +
      `📅 *2. Jadwal Rutinitas Hari Ini:*\n${scheduleRows}\n\n` +
      `🎯 *3. Tiga Pekerjaan Paling Penting (Top Priorities):*\n${taskRows}\n\n` +
      `🎯 *4. Target yang Harus Dicapai:*\n${activeGoals}\n\n` +
      `⚡ *5. Aktivitas yang Harus Diprioritaskan:* Fokus utama hari ini adalah menuntaskan *${topTaskTitle}*.\n\n` +
      `🔔 *6. Pengingat Khusus:*\n` +
      `• Jadwal Sholat Kota Jambi: Subuh ${pt.subuh}, Dzuhur ${pt.dzuhur}, Ashar ${pt.ashar}, Maghrib ${pt.maghrib}, Isya ${pt.isya} WIB.\n` +
      `• Jaga asupan air putih minimal 8 gelas (2 liter) dan gunakan sunscreen pagi lo.`;
  }

  buildDailyEvaluation(speakerInfo) {
    const now = getNow();
    const dateFormatted = formatIndoDate();
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';

    const compliance = this.routineManager.getRoutineComplianceReport();
    const topTasks = this.taskManager ? this.taskManager.getTopPriorities(3, owner) : [];
    const completedTasks = this.taskManager ? this.taskManager.getCompletedToday(owner) : [];
    const pendingTasks = this.taskManager ? this.taskManager.getPendingTasks(owner) : [];
    const dailyRecap = this.financeManager.getDailyRecap(now.format('YYYY-MM-DD'), owner);
    const r = this.routineManager.data.todayRoutines;

    const uncompletedRows = compliance.uncompletedItems.map(a => `  • ${a.name} (${a.time} WIB)`).join('\n') || '  Semua rutinitas terlaksana!';
    const completedTaskRows = completedTasks.map(t => `  • ${t.title}`).join('\n') || '  (Belum ada pekerjaan tercatat selesai)';
    const pendingTaskRows = pendingTasks.slice(0, 3).map(t => `  • ${t.title}`).join('\n') || '  (Tidak ada pekerjaan tertunda)';

    return `🌙 *DAILY EVALUATION — ${dateFormatted}*\n\n` +
      `1. *Jumlah Rutinitas Dijadwalkan:* ${compliance.totalScheduled} aktivitas\n` +
      `2. *Jumlah Rutinitas Berhasil Dilakukan:* ${compliance.totalCompleted} aktivitas (${compliance.complianceRate})\n` +
      `3. *Aktivitas yang Belum Dilakukan:*\n${uncompletedRows}\n` +
      `4. *Target yang Tercapai:* Evaluasi progres target aktif tercatat di sistem\n` +
      `5. *Target yang Masih Berjalan:* Menjaga ritme dan konsistensi harian\n` +
      `6. *Pekerjaan yang Sudah Diselesaikan:*\n${completedTaskRows}\n` +
      `7. *Pekerjaan yang Masih Tertunda:*\n${pendingTaskRows}\n` +
      `8. *Arus Kas Hari Ini (SPS):* Pemasukan ${formatRupiah(dailyRecap.income)} | Pengeluaran ${formatRupiah(dailyRecap.expense)} | Net ${formatRupiah(dailyRecap.net)}\n` +
      `9. *Perkembangan Kebiasaan:*\n` +
      `   • Salat 5 Waktu Jambi: ${Object.values(r.prayers).filter(Boolean).length}/5 selesai\n` +
      `   • Air Minum: ${r.waterGlasses} gelas\n` +
      `   • Konsumsi Rokok: ${r.smoking.count} batang\n` +
      `   • Skincare: Pagi [${r.skincare.morning ? '✅' : '⏳'}] | Malam [${r.skincare.night ? '✅' : '⏳'}]\n` +
      `   • Olahraga: [${r.workout.completed ? '✅ ' + r.workout.type : '⏳ Belum'}]\n` +
      `10. *Rekomendasi Perbaikan:* Evaluasi jujur: jika ada pekerjaan prioritas yang tertunda, jadwalkan di slot jam 08:00 besok pagi sebelum membuka distraksi lain.\n` +
      `11. *Prioritas untuk Besok:*\n` +
      (topTasks.length > 0 ? topTasks.map((t, i) => `   ${i + 1}. ${t.title}`).join('\n') : '   1. Memulai hari tepat waktu & Sholat Subuh\n   2. Eksekusi operasional utama\n   3. Olahraga sore');
  }

  buildTodaySchedule(speakerInfo) {
    const todayStr = formatIndoDate();
    const todaySchedule = this.routineManager ? this.routineManager.getScheduleToday() : [];
    const remindersText = this.reminderManager ? this.reminderManager.getTodayRemindersSummary() : 'Tidak ada pengingat khusus.';

    const scheduleList = todaySchedule.map(s => {
      let icon = '📅';
      if (s.status === 'completed') icon = '✅';
      else if (s.status === 'rescheduled') icon = '⏳';
      return `  • [${s.time} WIB] ${s.name} (${icon} ${s.status.toUpperCase()})`;
    }).join('\n');

    return `📅 *JADWAL AKTIVITAS HARI INI — ${todayStr}*\n\n` +
      `🕒 *Rutinitas Terjadwal:*\n${scheduleList}\n\n` +
      `🔔 *Pengingat Khusus (Smart Reminders):*\n${remindersText}\n\n` +
      `_Ketik *"Apa yang harus saya lakukan sekarang?"* untuk mendapatkan arahan taktis berdasarkan waktu saat ini._`;
  }

  buildUnfinishedItems(speakerInfo) {
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
    const pendingTasks = this.taskManager ? this.taskManager.getPendingTasks(owner) : [];
    const compliance = this.routineManager ? this.routineManager.getRoutineComplianceReport() : { uncompletedItems: [] };

    const taskRows = pendingTasks.map((t, idx) =>
      `  ${idx + 1}. [${t.priority.toUpperCase()}] *${t.title}* (Kategori: ${t.category}${t.dueDate ? `, Tenggat: ${t.dueDate}` : ''})`
    ).join('\n') || '  (Semua pekerjaan utama sudah tuntas! ✅)';

    const uncompletedRoutines = compliance.uncompletedItems.map(a =>
      `  • [${a.time} WIB] ${a.name}`
    ).join('\n') || '  (Semua rutinitas hari ini telah diselesaikan! ✅)';

    return `📌 *DAFTAR TUGAS & AKTIVITAS YANG BELUM SELESAI*\n\n` +
      `💼 *Pekerjaan / Tasks yang Masih Tertunda (${pendingTasks.length} tugas):*\n${taskRows}\n\n` +
      `⏰ *Rutinitas Hari Ini yang Belum Dikonfirmasi:*\n${uncompletedRoutines}\n\n` +
      `💡 *Saran NEX:* Tuntaskan pekerjaan berlabel *[HIGH]* terlebih dahulu sebelum menangani hal-hal kecil.`;
  }

  buildWeeklyEvaluation(speakerInfo) {
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
    const weeklyRecap = this.financeManager.getWeeklyRecap(owner);
    const goalsSummary = this.goalTracker.getActiveGoalsSummary(owner);
    const pendingTasks = this.taskManager ? this.taskManager.getPendingTasks(owner) : [];
    const completedTasks = this.taskManager ? this.taskManager.getCompletedToday(owner) : [];
    const compliance = this.routineManager.getRoutineComplianceReport();
    const reminderStats = this.reminderManager ? this.reminderManager.getEvaluationStats() : { complianceRate: '100%', completed: 0, total: 0 };

    const reportText =
      `📊 *WEEKLY PERFORMANCE REPORT (${weeklyRecap.periodLabel})*\n` +
      `============================================\n\n` +
      `### A. PENCAPAIAN\n` +
      `• Menyelesaikan ${compliance.totalCompleted} aktivitas rutinitas harian (Kepatuhan: ${compliance.complianceRate}).\n` +
      `• Pengingat aktivitas terselesaikan: ${reminderStats.completed} pengingat (Kepatuhan pengingat: ${reminderStats.complianceRate}).\n` +
      `• Pekerjaan bisnis & pribadi tuntas minggu ini tercatat di database.\n\n` +
      `### B. TARGET DAN REALISASI\n` +
      `${goalsSummary}\n\n` +
      `### C. PRODUKTIVITAS & MANAJEMEN WAKTU\n` +
      `• Kepatuhan Rutinitas Harian: *${compliance.complianceRate}* (${compliance.totalCompleted} dari ${compliance.totalScheduled} aktivitas terlaksana).\n` +
      `• Pekerjaan Pending: ${pendingTasks.length} tugas masih dalam antrean kerja.\n\n` +
      `### D. KEUANGAN (SPS SINGLE SOURCE OF TRUTH)\n` +
      `• Total Pemasukan Mingguan : *${formatRupiah(weeklyRecap.income)}*\n` +
      `• Total Pengeluaran       : *${formatRupiah(weeklyRecap.expense)}*\n` +
      `• Net Cashflow Mingguan   : *${formatRupiah(weeklyRecap.net)}* (${weeklyRecap.net >= 0 ? 'Surplus 🟢' : 'Defisit 🔴'})\n` +
      `• Rata-rata Beban Harian  : *${formatRupiah(weeklyRecap.dailyAvg)}*\n\n` +
      `### E. HAL YANG PERLU DIPERBAIKI\n` +
      `• Hindari menunda-nunda tugas berprioritas tinggi hingga larut malam.\n` +
      `• Disiplin mencatat setiap pengeluaran kecil agar tidak ada celah cashflow yang bocor.\n\n` +
      `### F. HAL YANG PERLU DITINGKATKAN\n` +
      `• Pertahankan konsistensi olahraga minimal 4x seminggu untuk menjaga stamina dan kejernihan pikiran.\n` +
      `• Tingkatkan follow-up calon klien KEYNEX di awal pekan (Senin-Selasa).\n\n` +
      `### G. PRIORITAS MINGGU BERIKUTNYA\n` +
      `1. Eksekusi follow-up dan order klien KEYNEX.\n` +
      `2. Alokasikan tabungan rencana dari surplus kas minggu ini.\n` +
      `3. Jaga ketertiban salat 5 waktu berjamaah dan asupan fisik optimal.`;

    // Asynchronously save performance report to Google Spreadsheet
    if (this.googleSheetsService) {
      this.googleSheetsService.appendPerformanceReport({
        periodType: 'weekly',
        periodKey: weeklyRecap.periodLabel,
        achievements: `${compliance.totalCompleted} rutinitas selesai (${compliance.complianceRate})`,
        targetsReconciliation: goalsSummary.slice(0, 200),
        productivity: `Kepatuhan: ${compliance.complianceRate}, Pending tasks: ${pendingTasks.length}`,
        finances: `In: ${formatRupiah(weeklyRecap.income)} | Out: ${formatRupiah(weeklyRecap.expense)} | Net: ${formatRupiah(weeklyRecap.net)}`,
        improvements: 'Disiplin eksekusi prioritas & pencatatan keuangan',
        nextPriorities: 'Follow-up order KEYNEX, tabungan rencana, olahraga',
        rawReport: reportText
      }).catch(err => console.warn('[GeminiService] Failed to sync weekly report to SPS:', err.message));
    }

    return reportText;
  }

  buildMonthlyEvaluation(speakerInfo) {
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
    const monthlyRecap = this.financeManager.getMonthlyRecap(owner);
    const goalsSummary = this.goalTracker.getActiveGoalsSummary(owner);
    const pendingTasks = this.taskManager ? this.taskManager.getPendingTasks(owner) : [];
    const compliance = this.routineManager.getRoutineComplianceReport();

    const reportText =
      `🗓️ *MONTHLY PERFORMANCE REPORT (${monthlyRecap.monthLabel})*\n` +
      `============================================\n\n` +
      `1. *Pencapaian Target Bulanan:*\n${goalsSummary}\n\n` +
      `2. *Produktivitas & Konsistensi Rutinitas:*\n` +
      `   • Rata-rata Kepatuhan Harian: *${compliance.complianceRate}*\n` +
      `   • Total Tugas Masih Tertunda: *${pendingTasks.length} tugas*\n\n` +
      `3. *Kondisi Keuangan Berdasarkan SPS (SSOT):*\n` +
      `   • Total Pendapatan Inflow : *${formatRupiah(monthlyRecap.income)}*\n` +
      `   • Total Pengeluaran       : *${formatRupiah(monthlyRecap.expense)}*\n` +
      `   • Tabungan Disimpan       : *${formatRupiah(monthlyRecap.savings)}* (Rasio Tabungan: *${monthlyRecap.savingsRatio}*)\n` +
      `   • Net Cashflow Bulanan    : *${formatRupiah(monthlyRecap.net)}* (${monthlyRecap.net >= 0 ? 'Surplus 🟢' : 'Defisit 🔴'})\n\n` +
      `4. *Perkembangan Bisnis & Usaha (KEYNEX & Ternak):*\n` +
      `   • Pertahankan perputaran modal bisnis terpisah dari pengeluaran rumah tangga.\n` +
      `   • Salurkan laba bersih ke reinvestasi atau tabungan rencana masa depan.\n\n` +
      `5. *Kendala Utama & Hal yang Perlu Ditingkatkan:*\n` +
      `   • Perketat batas pengeluaran konsumtif di akhir pekan.\n` +
      `   • Tingkatkan konsistensi rutinitas olahraga sore dan istirahat malam teratur.\n\n` +
      `6. *Rencana & Sasaran Bulan Berikutnya:*\n` +
      `   • Naikkan target omzet bisnis KEYNEX minimal 15-20%.\n` +
      `   • Target rasio tabungan stabil di atas 25% dari total arus kas masuk.`;

    if (this.googleSheetsService) {
      this.googleSheetsService.appendPerformanceReport({
        periodType: 'monthly',
        periodKey: monthlyRecap.monthLabel,
        achievements: `Omzet Inflow: ${formatRupiah(monthlyRecap.income)}, Tabungan: ${formatRupiah(monthlyRecap.savings)}`,
        targetsReconciliation: goalsSummary.slice(0, 200),
        productivity: `Kepatuhan Rutinitas: ${compliance.complianceRate}`,
        finances: `In: ${formatRupiah(monthlyRecap.income)} | Out: ${formatRupiah(monthlyRecap.expense)} | Net: ${formatRupiah(monthlyRecap.net)}`,
        improvements: 'Kendala biaya konsumtif & ritme istirahat',
        nextPriorities: 'Target omzet +20%, rasio tabungan > 25%',
        rawReport: reportText
      }).catch(err => console.warn('[GeminiService] Failed to sync monthly report to SPS:', err.message));
    }

    return reportText;
  }
}
