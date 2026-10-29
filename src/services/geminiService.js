import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { parseAmount, formatRupiah } from '../utils/formatters.js';

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
          const { cleanText, actionsExecuted } = this.processEmbeddedActions(rawText, speakerInfo);

          // If Gemini didn't output action_json, check fallback deterministic parser!
          if (actionsExecuted === 0) {
            this.checkAndFallbackParseTransaction(messageText, speakerInfo);
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

  processEmbeddedActions(text, speakerInfo) {
    let cleanText = text;
    let actionsExecuted = 0;
    const actionRegex = /```action_json\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const jsonStr = match[1];
      try {
        const actionObj = JSON.parse(jsonStr);
        this.executeAction(actionObj, speakerInfo);
        actionsExecuted++;
      } catch (err) {
        console.warn('[GeminiService] Failed to parse action_json:', err.message);
      }
    }

    cleanText = cleanText.replace(/```action_json[\s\S]*?```/g, '').trim();
    return { cleanText, actionsExecuted };
  }

  /**
   * DETERMINISTIC PARSER & CORRECTION FALLBACK
   * Strictly distinguishes between NEW transactions, CORRECTIONS, and DELETIONS.
   */
  checkAndFallbackParseTransaction(text, speakerInfo) {
    if (!text) return;
    const clean = text.toLowerCase().trim();

    // 1. Check if user is asking to CORRECT a previous transaction
    const isCorrectionIntent = /(^|\s|[^a-zA-Z0-9])(salah|ralat|seharusnya|koreksi|ubah|ganti|bukan\s*(pemasukan|pengeluaran|tabungan|utang)|salah\s*(catat|ketik|masuk)|revisi)($|\s|[^a-zA-Z0-9])/i.test(clean);
    
    // 2. Check if user is asking to CANCEL/DELETE a transaction
    const isDeletionIntent = /(^|\s|[^a-zA-Z0-9])(hapus|batal|batalkan|delete|cancel|buang)\s*(transaksi|pencatatan|pengeluaran|pemasukan|tadi|kemarin)?/i.test(clean);

    if (isCorrectionIntent) {
      console.log(`[GeminiService] 🔍 Detected CORRECTION intent: "${text}"`);

      // Determine target updates
      const isExpense = /(pengeluaran|beli|bayar|keluar|belanja|biaya)/i.test(clean);
      const isIncome = /(pemasukan|masuk|gaji|terima|dapat|omzet|cair)/i.test(clean);
      const amountMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:jt|juta|rb|ribu|k)?|\d{4,})/i);
      const parsedAmount = amountMatch ? parseAmount(amountMatch[0]) : null;

      const updates = {};
      if (isExpense && !clean.includes('bukan pengeluaran')) updates.type = 'expense';
      if (isIncome && !clean.includes('bukan pemasukan')) updates.type = 'income';
      if (parsedAmount && parsedAmount > 0) updates.amount = parsedAmount;

      const owner = speakerInfo.role === 'partner' ? 'partner' : 'owner';
      const matchResult = this.financeManager.findTransactionForCorrection({
        text,
        amount: parsedAmount,
        owner
      });

      if (matchResult.status === 'found') {
        const targetTx = matchResult.transaction;
        console.log(`[GeminiService] 💡 Deterministic correction executing on ID: ${targetTx.id}`);
        this.financeManager.correctTransaction(targetTx.id, updates, {
          reason: `Koreksi deterministik: ${text}`
        });
      } else if (matchResult.status === 'ambiguous') {
        console.log(`[GeminiService] ⚠️ Ambiguous transaction match for correction: ${matchResult.candidates?.length} candidates found.`);
      }
      return; // NEVER fall through to record a new transaction!
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
      }
      return; // NEVER fall through to record a new transaction!
    }

    // 3. New Transaction Recording Intent
    const isRecordIntent = /(catat|rekam|tulis|masukkan|tambah)/i.test(clean);
    const isExpense = /(pengeluaran|beli|bayar|keluar|belanja|biaya)/i.test(clean);
    const isIncome = /(pemasukan|masuk|gaji|terima|dapat|omzet|cair)/i.test(clean);

    if (isRecordIntent && (isExpense || isIncome)) {
      const amountMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:jt|juta|rb|ribu|k)?|\d{4,})/i);
      if (amountMatch) {
        const rawAmount = amountMatch[0];
        const parsed = parseAmount(rawAmount);
        if (parsed && parsed > 0) {
          const type = isIncome ? 'income' : 'expense';

          let desc = text
            .replace(/(nex|bot|partner|tolong|bantu|coba|dong|ya|please)/gi, '')
            .replace(/(catat|rekam|tulis|masukkan|tambah)/gi, '')
            .replace(/(pengeluaran|pemasukan|sebesar|senilai)/gi, '')
            .replace(rawAmount, '')
            .trim();

          if (!desc) desc = type === 'income' ? 'Pemasukan' : 'Pengeluaran';

          console.log(`[GeminiService] 💡 Deterministic fallback triggered: [${type.toUpperCase()}] ${parsed} - ${desc}`);
          this.financeManager.recordTransaction({
            type,
            amount: parsed,
            category: type === 'income' ? 'Pemasukan' : 'Operasional / Umum',
            description: desc,
            isBusiness: /(bisnis|usaha|toko|proyek|klien)/i.test(clean),
            owner: speakerInfo.role === 'partner' ? 'partner' : 'owner'
          });
        }
      }
    }
  }

  executeAction(actionObj, speakerInfo) {
    if (!actionObj || !actionObj.action) return;
    const { action, data } = actionObj;
    console.log(`[GeminiService] Executing auto action: ${action}`, data);

    try {
      const owner = data?.owner || (speakerInfo.role === 'partner' ? 'partner' : 'owner');

      switch (action) {
        case 'RECORD_TRANSACTION':
          this.financeManager.recordTransaction({
            type: data.type || 'expense',
            amount: data.amount,
            category: data.category || 'Umum',
            description: data.description || '',
            isBusiness: Boolean(data.isBusiness),
            owner,
            idempotencyKey: data.idempotencyKey
          });
          break;

        case 'CORRECT_TRANSACTION':
          {
            let targetId = data.targetId;
            if (!targetId || targetId === 'tx_xxxx') {
              const matchResult = this.financeManager.findTransactionForCorrection({
                text: `${data.description || ''} ${data.amount || ''}`,
                amount: data.amount,
                type: data.type,
                owner
              });
              if (matchResult.status === 'found') {
                targetId = matchResult.transaction.id;
              }
            }
            if (targetId && targetId !== 'tx_xxxx') {
              this.financeManager.correctTransaction(targetId, {
                type: data.type,
                amount: data.amount,
                category: data.category,
                description: data.description,
                isBusiness: data.isBusiness
              }, { reason: data.reason || 'Koreksi via AI' });
            } else {
              console.warn(`[GeminiService] CORRECT_TRANSACTION targetId not resolved`);
            }
          }
          break;

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
            }
          }
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
