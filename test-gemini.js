import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

console.log('Testing with API key:', process.env.GEMINI_API_KEY?.slice(0, 10) + '...');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  console.log('Calling interactions.create...');
  const start = Date.now();
  try {
    const res = await Promise.race([
      ai.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'halo'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_20S')), 20000))
    ]);
    console.log(`Success in ${Date.now() - start}ms:`, res.output_text);
  } catch (err) {
    console.log(`Error in ${Date.now() - start}ms:`, err);
  }
}

run();
