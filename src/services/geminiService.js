import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { parseAmount, extractAmount, formatRupiah } from '../utils/formatters.js';

export class GeminiService {
  constructor(promptBuilder, memoryManager, financeManager, goalTracker, routineManager) {
    this.promptBuilder = promptBuilder;
    this.memoryManager = memoryManager;
    this.financeManager = financeManager;
    this.goalTracker = goalTracker;
    this.routineManager = routineManager;

    if (!config.geminiApiKey) {
      console.warn('⚠️ [GeminiService] GEMINI_API_KEY is not set in .env!');
      this.ai = null;
    } else {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
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

    // Fast and unmetered candidate models
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
              maxOutputTokens: 650
            }
          })
        );

        const rawText = response.text?.trim();
        if (rawText) {
          // Process and execute any action_json embedded in the response
          let { cleanText, actionsExecuted, executedTx } = this.processEmbeddedActions(rawText, speakerInfo, messageText);

          // If Gemini didn't output action_json, check fallback deterministic parser!
          if (actionsExecuted === 0) {
            const fallbackResult = this.checkAndFallbackParseTransaction(messageText, speakerInfo);
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

  processEmbeddedActions(text, speakerInfo, userMessageText = '') {
    let cleanText = text;
    let actionsExecuted = 0;
    let executedTx = null;
    const actionRegex = /```action_json\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const jsonStr = match[1];
      try {
        const actionObj = JSON.parse(jsonStr);
        const actionRes = this.executeAction(actionObj, speakerInfo, userMessageText);
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
  checkAndFallbackParseTransaction(text, speakerInfo) {
    if (!text) return null;
    const clean = text.toLowerCase().trim();

    // 1. Check if user is asking to CORRECT a previous transaction
    const isCorrectionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:salah|(?:di|meng)?koreksi|(?:di|me)?ralat|(?:di|meng)?ubah|(?:di|meng)?ganti|(?:di)?revisi|seharusnya|harusnya|mestinya|bukan\s*(?:pemasukan|pengeluaran|tabungan|utang)|(?:jadi|menjadi)\s*(?:pengeluaran|pemasukan))(?:$|\s|[^a-zA-Z0-9])/i.test(clean);
    
    // 2. Check if user is asking to CANCEL/DELETE a transaction
    const isDeletionIntent = /(?:^|\s|[^a-zA-Z0-9])(?:hapus|batal|batalkan|delete|cancel|buang)\s*(?:transaksi|pencatatan|pengeluaran|pemasukan|tadi|kemarin)?(?:$|\s|[^a-zA-Z0-9])/i.test(clean);

    if (isCorrectionIntent) {
      console.log(`[GeminiService] 🔍 Detected CORRECTION intent: "${text}"`);

      // Determine target updates
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
        const corRes = this.financeManager.correctTransaction(targetTx.id, updates, {
          reason: `Koreksi deterministik: ${text}`
        });
        return { recorded: true, transaction: corRes.transaction, isCorrection: true };
      } else if (matchResult.status === 'ambiguous') {
        console.log(`[GeminiService] ⚠️ Ambiguous transaction match for correction: ${matchResult.candidates?.length} candidates found.`);
      }
      return null; // NEVER fall through to record a new transaction!
    }

    if (isDeletionIntent) {
      console.log(`[GeminiService] 🔍 Detected DELETION intent: "${text}"`);
      const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
      const matchResult = this.financeManager.findTransactionForCorrection({ text, owner });
      if (matchResult.status === 'found') {
        console.log(`[GeminiService] 💡 Deterministic deletion executing on ID: ${matchResult.transaction.id}`);
        this.financeManager.deleteTransaction(matchResult.transaction.id, {
          reason: `Pembatalan deterministik: ${text}`
        });
        return { recorded: true, transaction: matchResult.transaction, isDeletion: true };
      }
      return null; // NEVER fall through to record a new transaction!
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

      const isBusiness = /(?:bisnis|usaha|toko|proyek|klien|kambing|ternak|dagang|omzet|omset|jual)/i.test(clean);
      let category = 'Umum';
      if (isBusiness) category = 'Bisnis';
      else if (/makan|minum|kopi|resto|nasi|mie|sarapan|lunch|dinner|jajan|snack|bakso|ayam/i.test(clean)) category = 'Makanan';
      else if (/bensin|parkir|tol|gojek|grab|ojek|transport/i.test(clean)) category = 'Transportasi';
      else if (/listrik|air|wifi|pulsa|paket\s*data|iuran/i.test(clean)) category = 'Tagihan & Utilitas';
      else if (/belanja|baju|sepatu|tas|shopee|tokopedia/i.test(clean)) category = 'Belanja';

      console.log(`[GeminiService] 💡 Deterministic parser triggered: [${type.toUpperCase()}] ${extracted.value} - ${desc} (${category}, isBusiness: ${isBusiness})`);
      const recordRes = this.financeManager.recordTransaction({
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
        transaction: recordRes.transaction
      };
    }
    return null;
  }

  executeAction(actionObj, speakerInfo, userMessageText = '') {
    if (!actionObj || !actionObj.action) return null;
    const { action, data } = actionObj;
    console.log(`[GeminiService] Executing auto action: ${action}`, data);

    try {
      const owner = data?.owner || (speakerInfo.role === 'partner' ? 'partner' : 'owner');

      switch (action) {
        case 'RECORD_TRANSACTION': {
          let finalAmount = parseAmount(data.amount);
          // Safety guard against LLM amount hallucination (e.g. user said 2jt, LLM put 2000 or 2)
          const userExtracted = extractAmount(userMessageText);
          if (userExtracted && userExtracted.value > 0) {
            if (userExtracted.value >= 10000 && (finalAmount <= 2000 || finalAmount !== userExtracted.value)) {
              console.log(`[GeminiService] 🛡️ Correcting Gemini amount hallucination: ${finalAmount} -> ${userExtracted.value}`);
              finalAmount = userExtracted.value;
            }
          }

          const recRes = this.financeManager.recordTransaction({
            type: data.type || 'expense',
            amount: finalAmount,
            category: data.category || 'Umum',
            description: data.description || '',
            isBusiness: Boolean(data.isBusiness),
            owner,
            idempotencyKey: data.idempotencyKey
          });
          return { success: true, transaction: recRes.transaction };
        }

        case 'CORRECT_TRANSACTION':
          {
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
              const corRes = this.financeManager.correctTransaction(targetId, {
                type: data.type,
                amount: finalAmount,
                category: data.category,
                description: data.description,
                isBusiness: data.isBusiness
              }, { reason: data.reason || 'Koreksi via AI' });
              return { success: true, transaction: corRes.transaction };
            } else {
              console.warn(`[GeminiService] CORRECT_TRANSACTION targetId not resolved`);
              return null;
            }
          }

        case 'DELETE_TRANSACTION':
          {
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
              this.financeManager.deleteTransaction(targetId, { reason: data.reason || 'Dibatalkan via AI' });
              return { success: true };
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

        case 'SET_GOAL':
          this.goalTracker.addGoal({
            title: data.title,
            category: data.category,
            targetDate: data.targetDate,
            metrics: data.metrics,
            strategy: data.strategy,
            owner
          });
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
}
