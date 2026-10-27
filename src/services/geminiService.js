import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

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
    const fullUserPrompt = `${historyContext}\n${currentMsgPrompt}\n\nJawablah sebagai AI Personal Life Partner. Bersikaplah dewasa, logis, jujur, santai, dan bersahabat:`;

    const candidateModels = [...new Set([
      config.geminiModel,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite',
      'gemini-1.5-flash',
      'gemini-3.5-flash'
    ].filter(Boolean))];

    const timeoutMs = 28000;
    const callWithTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_28S')), timeoutMs))
    ]);

    for (const model of candidateModels) {
      try {
        const contents = [];
        if (media && media.buffer && media.mimeType) {
          contents.push({
            role: 'user',
            parts: [
              { text: fullUserPrompt },
              {
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.buffer.toString('base64')
                }
              }
            ]
          });
        } else {
          contents.push({
            role: 'user',
            parts: [{ text: fullUserPrompt }]
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
          const cleanedText = this.processEmbeddedActions(rawText, speakerInfo);
          return cleanedText;
        }
      } catch (err) {
        console.warn(`[GeminiService] Model ${model} failed: ${err.message}`);
      }
    }

    return 'Bro, koneksi analitik gue lagi agak terhambat barusan. Coba kirim ulang pesan lo ya.';
  }

  processEmbeddedActions(text, speakerInfo) {
    let cleanText = text;
    const actionRegex = /```action_json\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const jsonStr = match[1];
      try {
        const actionObj = JSON.parse(jsonStr);
        this.executeAction(actionObj, speakerInfo);
      } catch (err) {
        console.warn('[GeminiService] Failed to parse action_json:', err.message);
      }
    }

    // Strip out the action_json block so user doesn't see the raw json in WhatsApp
    cleanText = cleanText.replace(/```action_json[\s\S]*?```/g, '').trim();
    return cleanText;
  }

  executeAction(actionObj, speakerInfo) {
    if (!actionObj || !actionObj.action) return;
    const { action, data } = actionObj;
    console.log(`[GeminiService] Executing auto action: ${action}`, data);

    try {
      switch (action) {
        case 'RECORD_TRANSACTION':
          this.financeManager.recordTransaction({
            type: data.type || 'expense',
            amount: data.amount,
            category: data.category || 'Umum',
            description: data.description || '',
            isBusiness: Boolean(data.isBusiness),
            owner: data.owner || (speakerInfo.role === 'partner' ? 'partner' : 'owner')
          });
          break;

        case 'SET_GOAL':
          this.goalTracker.addGoal({
            title: data.title,
            category: data.category,
            targetDate: data.targetDate,
            metrics: data.metrics,
            strategy: data.strategy,
            owner: data.owner || (speakerInfo.role === 'partner' ? 'partner' : 'owner')
          });
          break;

        case 'ADD_MEMORY':
          this.memoryManager.addMemory({
            content: data.content,
            category: data.category || 'personal',
            scope: data.scope || (speakerInfo.role === 'partner' ? 'partner' : 'owner')
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
