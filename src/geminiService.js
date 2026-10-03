import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

export class GeminiService {
  constructor(stateManager, memoryManager, eventEngine, promptBuilder) {
    this.stateManager = stateManager;
    this.memoryManager = memoryManager;
    this.eventEngine = eventEngine;
    this.promptBuilder = promptBuilder;

    if (!config.geminiApiKey) {
      console.warn('⚠️ [GeminiService] GEMINI_API_KEY is not set in .env! AI features will require API key.');
      this.ai = null;
    } else {
      if (!config.geminiApiKey.startsWith('AIzaSy')) {
        console.warn('⚠️ [GeminiService] PERINGATAN: GEMINI_API_KEY di file .env tidak diawali dengan "AIzaSy". API Key Google AI Studio selalu diawali dengan "AIzaSy...".');
      }
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
  }

  isAvailable() {
    return !!this.ai;
  }

  /**
   * Generates a conversational response in character
   */
  async generateResponse({ messageText, speakerInfo, chatHistory = [], media = null }) {
    if (!this.ai) {
      return '*(Virtual Child AI: GEMINI_API_KEY belum diisi di file .env. Mohon isi API Key terlebih dahulu di .env)*';
    }

    const systemPrompt = this.promptBuilder.buildSystemPrompt(speakerInfo);
    const model = config.geminiModel || 'gemini-3.8-flash';

    // Format chat history context
    let historyContext = '';
    if (chatHistory && chatHistory.length > 0) {
      historyContext = '\n\n=== RIWAYAT CHAT TERAKHIR DI GRUP KELUARGA ===\n' +
        chatHistory.slice(-10).map(msg => `[${msg.senderName} (${msg.role})]: ${msg.text}`).join('\n') +
        '\n============================================\n';
    }

    const currentMsgText = `Pesan baru dari ${speakerInfo.name || speakerInfo.role}: "${messageText || ''}"`;
    const fullPrompt = `${historyContext}\n${currentMsgText}\n\nJawablah sebagai ${config.childName} (anak umur 6 tahun) yang tinggal di grup WhatsApp ini. Jaga respon tetap pendek, polos, dan hangat:`;

    try {
      // Multimodal input construction
      const inputParts = [];
      inputParts.push({ type: 'text', text: fullPrompt });

      if (media && media.buffer && media.mimeType) {
        const base64Data = media.buffer.toString('base64');
        if (media.type === 'image') {
          inputParts.push({
            type: 'image',
            data: base64Data,
            mime_type: media.mimeType
          });
        } else if (media.type === 'audio') {
          inputParts.push({
            type: 'audio',
            data: base64Data,
            mime_type: media.mimeType
          });
        }
      }

      // Wrap call with strict timeout so bot never hangs
      const timeoutMs = 25000;
      const callWithTimeout = (promise) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_25S')), timeoutMs))
      ]);

      const candidateModels = [...new Set([
        config.geminiModel,
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-flash-lite-latest'
      ].filter(Boolean))];

      for (const candidate of candidateModels) {
        try {
          const contents = [];
          if (media && media.buffer && media.mimeType) {
            contents.push({
              role: 'user',
              parts: [
                { text: fullPrompt },
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
              parts: [{ text: fullPrompt }]
            });
          }

          const response = await callWithTimeout(
            this.ai.models.generateContent({
              model: candidate,
              contents,
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.9,
                maxOutputTokens: 100
              }
            })
          );

          const reply = response.text?.trim();
          if (reply) {
            this.analyzeMessageAftermath(messageText, reply, speakerInfo).catch(err => {
              console.error('[GeminiService] Error in aftermath analysis:', err.message);
            });
            return reply;
          }
        } catch (candidateErr) {
          console.warn(`[GeminiService] Model ${candidate} error: ${candidateErr.message}`);
        }
      }

      return 'Ehehe... tadi Cia lagi bengong bentar, ada apa Ayah/Bunda? 😆';
    } catch (err) {
      console.error('❌ [GeminiService] Error calling Gemini API:', err.message);
      if (!config.geminiApiKey?.startsWith('AIzaSy')) {
        console.error('⚠️ [GeminiService] CATATAN: GEMINI_API_KEY saat ini bukan API Key Google AI Studio yang valid (harus diawali "AIzaSy...").');
      }
      return 'Ehehe Cia tadi ketiduran bentar... 🥺 Cia di sini kok Ayah dan Bunda!';
    }
  }

  /**
   * Evaluates spontaneous messaging decision (Autonomous mode)
   */
  async evaluateSpontaneous({ chatHistory = [] }) {
    if (!this.ai) return { shouldSend: false, reason: 'AI client not ready' };

    const state = this.stateManager.getState();
    const currentActivity = this.stateManager.getCurrentActivity();

    // Strict rule: Never speak if sleeping
    if (currentActivity.isSleeping) {
      return { shouldSend: false, reason: 'Child is currently sleeping (21:00 - 06:00)' };
    }

    const systemPrompt = `
Kamu adalah evaluator virtual child AI (${config.childName}, 6 tahun).
Tugasmu adalah menentukan apakah anak kecil ini memiliki alasan yang BENAR-BENAR ALAMI untuk mengirim 1 pesan spontan pendek di grup keluarga WhatsApp Ayah dan Bunda sekarang.

Prinsip Aturan 7 & 8:
- JANGAN TERLALU AKTIF: Anak tidak harus selalu berbicara tanpa henti. Memiliki kemampuan untuk diam adalah keharusan.
- Jangan mengirim pesan jika obrolan Ayah dan Bunda sedang sangat serius atau tidak ada konteks.
- ALASAN TERBAIK & UTAMA: RASA KANGEN PADA AYAH & BUNDA (KARENA LDR). Jika grup sudah hening beberapa jam, anak manja berusia 6 tahun ini sering tiba-tiba rindu dan ingin tahu kabar orang tuanya:
  * Menanyakan lagi ngapain: "Ayahhh sama Bundaaa lagi ngapain sekarang? Cia kangeeenn 🥺"
  * Perhatian manis: "Ayah lagi sibuk kerja ya? Jangan lupa makan siang ya Ayah ❤️" atau "Bundaaa jangan capek-capek yaa ❤️"
  * Cari teman ngobrol: "Bundaaa... Cia lagi sendirian nih, Bunda lagi apa? 🥺👉👈"
  * Spontan cerita sehabis santai sore atau kegiatan hari ini.

Jawablah HANYA dalam format JSON valid tanpa markdown wrapper:
{
  "shouldSend": true atau false,
  "reason": "alasan singkat kenapa bicara / kenapa diam",
  "message": "isi chat anak jika shouldSend true (harus singkat, manja, manis, alami, gaya anak 6 thn)"
}
`;

    const recentHistoryText = chatHistory.slice(-8).map(m => `[${m.senderName}]: ${m.text}`).join('\n') || 'Belum ada pesan baru.';
    const inputPrompt = `
Kondisi saat ini:
- Waktu: ${this.stateManager.getCurrentTimeString()}
- Fase: ${currentActivity.name} (${currentActivity.description})
- Mood anak: ${state.mood.current} ${state.mood.emoji}
- Kejadian hari ini: ${this.eventEngine.getTodayEvent()?.story || 'Santai'}
- Riwayat chat grup terakhir:
${recentHistoryText}

Tentukan apakah anak harus mengirim pesan spontan sekarang?
`;

    const candidateModels = [...new Set([
      config.geminiModel,
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
    ].filter(Boolean))];

    for (const candidate of candidateModels) {
      try {
        const response = await this.ai.models.generateContent({
          model: candidate,
          contents: inputPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json'
          }
        });

        const parsed = JSON.parse(response.text.trim());
        return parsed;
      } catch (err) {
        // Continue to next candidate
      }
    }

    return { shouldSend: false, reason: 'Evaluation unavailable across candidate models' };
  }

  /**
   * Background task: Analyze message to discover new memories, mood shifts, pocket money or savings updates
   */
  async analyzeMessageAftermath(userText, childReply, speakerInfo) {
    if (!this.ai || !userText) return;

    try {
      const prompt = `
Analisis percakapan santai berikut antara orang tua (${speakerInfo.role}: "${userText}") dan anak virtual 6 tahun (${childReply}).

Tentukan apakah ada:
1. Fakta penting baru tentang keluarga / Ayah / Ibu (misal: Ayah sedang dinas, Ibu sedang sakit, janji jalan-jalan, makanan favorit baru).
2. Mood baru untuk anak (apakah anak jadi sangat senang, sedih ringan, manja, bangga, ngantuk, dsb).
3. Transaksi uang jajan nyata / konfirmasi transfer (misal: "nih uang 20 ribu", "sudah ayah transfer 50.000", "buat jajan es krim 10rb").
4. Permintaan atau tindakan menabung ke celengan (misal: "tabung ya 10 ribu ke celengan", "masukin 15rb ke celengan ayam").
5. Pengeluaran jajan (misal anak bilang beli es krim 5.000).

Jawab HANYA dalam JSON valid:
{
  "newMemory": "ringkasan fakta penting baru jika ada, atau null",
  "memoryCategory": "family" | "father" | "mother" | "child" | null,
  "updatedMood": "Ceria" | "Manja" | "Bangga" | "Sedih Ringan" | "Ngantuk" | "Penasaran" | null,
  "moodEmoji": "😊" | "🥺" | "😴" | "😆" | "😤" | null,
  "moodReason": "alasan mood jika berubah",
  "transferredAmount": angka nominal jika orang tua memberi/mentransfer uang (cth: 20000), atau 0,
  "savingsDepositAmount": angka nominal jika orang tua meminta menabung uang saku ke celengan (cth: 10000), atau 0,
  "spendAmount": angka nominal jika anak jajan sesuatu, atau 0
}
`;

      const res = await this.ai.models.generateContent({
        model: config.geminiModel || 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const analysis = JSON.parse(res.text.trim());

      // 1. Update memory if detected
      if (analysis.newMemory && analysis.memoryCategory) {
        this.memoryManager.addMemory(analysis.newMemory, analysis.memoryCategory, 7);
      }

      // 2. Update mood if detected
      if (analysis.updatedMood) {
        this.stateManager.updateMood(
          analysis.updatedMood,
          analysis.moodEmoji || '😊',
          8,
          analysis.moodReason || 'Terpengaruh percakapan terakhir'
        );
      }

      // 3. Update pocket money if transferred
      if (analysis.transferredAmount && analysis.transferredAmount > 0) {
        this.stateManager.addPocketMoney(
          analysis.transferredAmount,
          `Diberikan oleh ${speakerInfo.name || speakerInfo.role} lewat percakapan alami`
        );
        console.log(`[GeminiService] Natural pocket money detected: +Rp${analysis.transferredAmount}`);
      }

      // 4. Update savings transfer if advised by parent
      if (analysis.savingsDepositAmount && analysis.savingsDepositAmount > 0) {
        const transferRes = this.stateManager.transferToSavings(
          analysis.savingsDepositAmount,
          `Menabung ke celengan atas saran ${speakerInfo.name || speakerInfo.role}`
        );
        if (transferRes.success) {
          console.log(`[GeminiService] Natural piggy bank savings transfer: Rp${analysis.savingsDepositAmount} to celengan`);
        }
      }

      // 5. Update spending if child bought something
      if (analysis.spendAmount && analysis.spendAmount > 0) {
        this.stateManager.spendPocketMoney(
          analysis.spendAmount,
          'Jajan/beli sesuatu dari uang saku'
        );
      }
    } catch (e) {
      // Non-critical background task
    }
  }
}

