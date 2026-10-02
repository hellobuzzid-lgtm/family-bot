import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to normalize phone number to WhatsApp JID format (e.g. 62812345678@s.whatsapp.net)
export function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }
  return cleaned;
}

export function toJid(phone) {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  return norm.includes('@') ? norm : `${norm}@s.whatsapp.net`;
}

import fs from 'fs';

const storageDir = process.env.STORAGE_DIR || rootDir;
const dataDir = process.env.DATA_DIR || path.join(storageDir, 'data');
const authDir = process.env.AUTH_DIR || path.join(storageDir, 'auth_info_baileys');

// Ensure directories exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

export const config = {
  rootDir,
  dataDir,
  authDir,

  // Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',

  // Family Identity
  childName: process.env.CHILD_NAME || 'Cia',
  fatherName: process.env.FATHER_NAME || 'Ayah',
  motherName: process.env.MOTHER_NAME || 'Ibu',

  // Phone numbers
  fatherPhone: normalizePhone(process.env.FATHER_PHONE),
  motherPhone: normalizePhone(process.env.MOTHER_PHONE),
  fatherJid: toJid(process.env.FATHER_PHONE),
  motherJid: toJid(process.env.MOTHER_PHONE),

  // Bot Pairing Phone (untuk login kode pairing tanpa scan QR)
  botPhone: normalizePhone(process.env.BOT_PHONE || process.env.PAIRING_NUMBER),
  usePairingCode: process.env.USE_PAIRING_CODE === 'true' || !!(process.env.BOT_PHONE || process.env.PAIRING_NUMBER),

  // WhatsApp Group Target
  targetGroupName: process.env.TARGET_GROUP_NAME || '',
  targetGroupJid: process.env.TARGET_GROUP_JID || '',

  // Spontaneous message behavior
  autonomousEnabled: process.env.AUTONOMOUS_ENABLED !== 'false',
  autonomousCheckIntervalMinutes: parseInt(process.env.AUTONOMOUS_CHECK_INTERVAL_MINUTES || '20', 10),
  minHoursBetweenSpontaneous: parseFloat(process.env.MIN_HOURS_BETWEEN_SPONTANEOUS || '3'),

  // Timezone
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
};
