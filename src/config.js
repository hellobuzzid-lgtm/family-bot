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

// Filter out dummy/sample phone numbers from legacy templates
const DUMMY_PHONES = [
  '6281234567890',
  '6289876543210',
  '1234567890',
  '081234567890',
  '089876543210'
];

function sanitizePhone(phone, defaultVal) {
  const norm = normalizePhone(phone);
  if (!norm || DUMMY_PHONES.includes(norm)) {
    return defaultVal;
  }
  return norm;
}

const ownerPhoneRaw = sanitizePhone(process.env.OWNER_PHONE || process.env.FATHER_PHONE, '62895360317212');
const partnerPhoneRaw = sanitizePhone(process.env.PARTNER_PHONE || process.env.MOTHER_PHONE, '628975889967');
const botPhoneRaw = sanitizePhone(process.env.BOT_PHONE || process.env.PAIRING_NUMBER, '6285183541035');

// Resolve City Name (Default: Kota Jambi)
const rawCity = (process.env.CITY_NAME || '').trim();
const resolvedCityName = (!rawCity || rawCity.toLowerCase() === 'jakarta') ? 'Jambi' : rawCity;

export const config = {
  rootDir,
  storageDir,
  dataDir,
  authDir,

  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',

  // Bot Profile
  botName: process.env.BOT_NAME || 'NEX',
  botPhone: botPhoneRaw,
  usePairingCode: process.env.USE_PAIRING_CODE !== 'false',

  // Owner (Primary User)
  ownerName: process.env.OWNER_NAME || 'Bro',
  ownerPhone: ownerPhoneRaw,
  ownerJid: toJid(ownerPhoneRaw),

  // Partner (Calon Istri)
  partnerName: process.env.PARTNER_NAME || 'Calon Istri',
  partnerPhone: partnerPhoneRaw,
  partnerJid: toJid(partnerPhoneRaw),

  // Group Settings
  targetGroupJid: process.env.TARGET_GROUP_JID || '120363429574214127@g.us',
  targetGroupName: process.env.TARGET_GROUP_NAME || 'NEX FAMILY',

  // Schedule & Location
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  cityName: resolvedCityName,
  autonomousReminders: process.env.AUTONOMOUS_REMINDERS !== 'false',

  // Google Spreadsheet Integration
  googleSheetWebhookUrl: process.env.GOOGLE_SHEET_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzt8mAlEaHSjpnvLtuci49gATqXB-KMoLNCGY8Ttz_ltc79jzg3xaGEnd5vXbLCEseJ/exec',
  googleSheetUrl: process.env.GOOGLE_SHEET_URL || '',
};
