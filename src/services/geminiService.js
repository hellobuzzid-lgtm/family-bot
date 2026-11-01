import { GoogleGenAI } from '@google/genai';
import dayjs from 'dayjs';
import { config } from '../config.js';
import { parseAmount, extractAmount, formatRupiah, isConfirmationText, getNow, formatIndoDate } from '../utils/formatters.js';

export class GeminiService {
  constructor(promptBuilder, memoryManager, financeManager, goalTracker, routineManager, taskManager = null) {
    this.promptBuilder = promptBuilder;
    this.memoryManager = memoryManager;
    this.financeManager = financeManager;
    this.goalTracker = goalTracker;
    this.routineManager = routineManager;
    this.taskManager = taskManager;

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

    // 1. SAFETY: Check Confirmation Words ("Ya", "Benar", "Setuju", "Oke", "Sip")
    // Never re-process amounts or trigger new transactions on pure confirmation!
    if (isConfirmationText(clean)) {
      console.log(`[GeminiService] 🛡️ Recognized pure confirmation: "${clean}"`);
      return 'Sip, Bro! Dicatat dan dipahami. Kita lanjutkan eksekusi rencana sesuai target.';
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
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite'
    ];

    if (config.geminiModel && !candidateModels.includes(config.geminiModel)) {
      candidateModels.unshift(config.geminiModel);
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

    // 1. Check if user is asking to CORRECT a previous transaction
    const isCorrectionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:salah|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi|seharusnya|harusnya|mestinya|bukan\s*(?:pemasukan|pengeluaran|tabungan|utang)|(?:jadi|menjadi)\s*(?:pengeluaran|pemasukan))(?:$|\s|[^a-zA-Z0-9])/i.test(clean);
    
    // 2. Check if user is asking to CANCEL/DELETE a transaction
    const isDeletionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:hapus|batal|batalkan|delete|cancel|buang)\s*(?:transaksi|pencatatan|pengeluaran|pemasukan|tadi|kemarin)?(?:$|\s|[^a-zA-Z0-9])/i.test(clean);

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
      const matchResult = this.financeManager.findTransactionForCorrection({ text, owner });
      if (matchResult.status === 'found') {
        console.log(`[GeminiService] 💡 Deterministic deletion executing on ID: ${matchResult.transaction.id}`);
        const delRes = await this.financeManager.deleteTransaction(matchResult.transaction.id, {
          reason: `Pembatalan deterministik: ${text}`
        });
        return { recorded: true, transaction: matchResult.transaction, isDeletion: true, spsConfirmed: delRes.spsConfirmed };
      }
      return null;
    }

    // 3. New Transaction Recording Intent
    const extracted = extractAmount(clean);
    const isIncome = /(?:pemasukan|masuk|jual|penjualan|gaji|gajian|terima|menerima|dapat|pendapatan|omzet|omset|cair|closing|untung|profit|bonus|thr|komisi|tf\s*masuk|transfer\s*masuk)/i.test(clean);
    const isExpense = /(?:pengeluaran|keluar|beli|pembelian|bayar|pembayaran|biaya|ongkir|makan|minum|jajan|kopi|pulsa|listrik|bensin|sewa|tf\s*keluar|transfer\s*keluar|transfer\s*ke)/i.test(clean);
    const isSavings = /(?:tabung|tabungan|nabung|simpan|darurat)/i.test(clean);
    const isDebt = /(?:utang|hutang|pinjam|pinjaman|kasbon|bon|piutang|cicilan|angsuran)/i.test(clean);
    const isExplicitRecord = /(?:catat|rekam|tulis|masukkan|tambah|input)/i.test(clean);

    if (extracted && extracted.value > 0 && (isExplicitRecord || isIncome || isExpense || isSavings || isDebt)) {
      let type = 'expense';
      if (isSavings) type = 'savings';
      else if (isDebt) type = 'debt_payment';
      else if (isIncome && !clean.includes('bukan pemasukan')) type = 'income';
      else if (isExpense) type = 'expense';

      // Clean description
      let desc = text
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

      const isBusiness = /(?:bisnis|usaha|toko|proyek|klien|kambing|ternak|dagang|omzet|omset|jual|keynex)/i.test(clean);
      let category = 'Umum';
      if (isBusiness) category = clean.includes('keynex') ? 'KEYNEX' : 'Bisnis';
      else if (/makan|minum|kopi|resto|nasi|mie|sarapan|lunch|dinner|jajan|snack|bakso|ayam/i.test(clean)) category = 'Makanan';
      else if (/bensin|parkir|tol|gojek|grab|ojek|transport/i.test(clean)) category = 'Transportasi';
      else if (/listrik|air|wifi|pulsa|paket\s*data|iuran/i.test(clean)) category = 'Tagihan & Utilitas';
      else if (/belanja|baju|sepatu|tas|shopee|tokopedia/i.test(clean)) category = 'Belanja';

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
          const userExtracted = extractAmount(userMessageText);
          if (userExtracted && userExtracted.value > 0) {
            if (userExtracted.value >= 10000 && (finalAmount <= 2000 || finalAmount !== userExtracted.value)) {
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
          const userExtracted = extractAmount(userMessageText);
          if (userExtracted && userExtracted.value > 0) {
            if (userExtracted.value >= 10000 && (!finalAmount || finalAmount <= 2000 || finalAmount !== userExtracted.value)) {
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

  buildWeeklyEvaluation(speakerInfo) {
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
    const weeklyRecap = this.financeManager.getWeeklyRecap(owner);
    const goalsSummary = this.goalTracker.getActiveGoalsSummary(owner);
    const pendingTasks = this.taskManager ? this.taskManager.getPendingTasks(owner) : [];
    const compliance = this.routineManager.getRoutineComplianceReport();

    return `📊 *EVALUASI MINGGUAN KELUARGA & BISNIS (${weeklyRecap.periodLabel})*\n\n` +
      `1. *Konsistensi Rutinitas & Kepatuhan:* ${compliance.complianceRate} (${compliance.totalCompleted} aktivitas berhasil diselesaikan)\n` +
      `2. *Perkembangan Target:*\n${goalsSummary}\n\n` +
      `3. *Produktivitas Pekerjaan:*\n` +
      `   • Total pekerjaan masih tertunda: ${pendingTasks.length} tugas\n\n` +
      `4. *Kondisi Keuangan Aktual (SPS):*\n` +
      `   • Total Pemasukan Mingguan : ${formatRupiah(weeklyRecap.income)}\n` +
      `   • Total Pengeluaran       : ${formatRupiah(weeklyRecap.expense)}\n` +
      `   • Net Cashflow Mingguan   : ${formatRupiah(weeklyRecap.net)} (${weeklyRecap.net >= 0 ? 'Surplus 🟢' : 'Defisit 🔴'})\n` +
      `   • Rata-rata Beban/Hari    : ${formatRupiah(weeklyRecap.dailyAvg)}\n\n` +
      `5. *Rekomendasi Perbaikan:* Pertahankan surplus kas, lunasi tugas yang paling lama tertunda, dan jaga komitmen olahraga 4x seminggu.`;
  }

  buildMonthlyEvaluation(speakerInfo) {
    const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
    const monthlyRecap = this.financeManager.getMonthlyRecap(owner);
    const goalsSummary = this.goalTracker.getActiveGoalsSummary(owner);

    return `🗓️ *EVALUASI BULANAN (${monthlyRecap.monthLabel})*\n\n` +
      `1. *Kondisi Keuangan Berdasarkan SPS (SSOT):*\n` +
      `   • Total Pendapatan / Inflow : ${formatRupiah(monthlyRecap.income)}\n` +
      `   • Total Pengeluaran         : ${formatRupiah(monthlyRecap.expense)}\n` +
      `   • Tabungan Disimpan         : ${formatRupiah(monthlyRecap.savings)} (Rasio: ${monthlyRecap.savingsRatio})\n` +
      `   • Net Cashflow              : ${formatRupiah(monthlyRecap.net)} (${monthlyRecap.net >= 0 ? 'Surplus 🟢' : 'Defisit 🔴'})\n\n` +
      `2. *Pencapaian Target Bulanan:*\n${goalsSummary}\n\n` +
      `3. *Rencana Periode Bulan Depan:* Alokasikan minimal 20-30% keuntungan bisnis ke tabungan rencana, tingkatkan margin penjualan, dan pertahankan disiplin kesehatan.`;
  }
}
