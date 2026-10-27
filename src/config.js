import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

// Storage resolution: Prefer persistent volume /app/storage if mounted on Railway
const defaultStorage = fs.existsSync('/app/storage') ? '/app/storage' : rootDir;
const storageDir = process.env.STORAGE_DIR || defaultStorage;
const dataDir = process.env.DATA_DIR || path.join(storageDir, 'data');
const authDir = process.env.AUTH_DIR || path.join(storageDir, 'auth_info_baileys');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

const ownerPhoneRaw = process.env.OWNER_PHONE || process.env.FATHER_PHONE || '62895360317212';
const partnerPhoneRaw = process.env.PARTNER_PHONE || process.env.MOTHER_PHONE || '628975889967';

export const config = {
  rootDir,
  storageDir,
  dataDir,
  authDir,

  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',

  // Bot Profile
  botName: process.env.BOT_NAME || 'Life Partner',
  botPhone: normalizePhone(process.env.BOT_PHONE || process.env.PAIRING_NUMBER || '6285183541035'),
  usePairingCode: process.env.USE_PAIRING_CODE === 'true' || !!(process.env.BOT_PHONE || process.env.PAIRING_NUMBER),

  // Owner (Primary User)
  ownerName: process.env.OWNER_NAME || 'Bro',
  ownerPhone: normalizePhone(ownerPhoneRaw),
  ownerJid: toJid(ownerPhoneRaw),

  // Partner (Calon Istri)
  partnerName: process.env.PARTNER_NAME || 'Calon Istri',
  partnerPhone: normalizePhone(partnerPhoneRaw),
  partnerJid: toJid(partnerPhoneRaw),

  // Group Settings
  targetGroupJid: process.env.TARGET_GROUP_JID || '120363429574214127@g.us',
  targetGroupName: process.env.TARGET_GROUP_NAME || 'NEX FAMILY',

  // Schedule & Location
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  cityName: process.env.CITY_NAME || 'Jakarta',
  autonomousReminders: process.env.AUTONOMOUS_REMINDERS !== 'false',
};
