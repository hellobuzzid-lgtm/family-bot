import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export function formatRupiah(amount) {
  const num = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(num);
}

export function isConfirmationText(text) {
  if (!text) return false;
  const clean = String(text).toLowerCase().replace(/[!.,?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:ya|iya|benar|bener|betul|setuju|oke|ok|sip|siap|yup|yes|agree|baik|deal|mantap|lanjutkan|okey|okay)(?:\s+(?:bro|nih|dong|deh|lah|ya|bang|min|mas|bener|benar|gan|kuy|setuju|betul|oke))?$/i.test(clean);
}

/**
 * Robust extraction of Indonesian currency expressions from text
 * Handles: 2 juta, 2jt, 1,5 juta, 500 ribu, 500rb, 500k, 2.000.000, 50.000, 1 miliar, etc.
 */
export function extractAmount(text) {
  if (text === null || text === undefined) return null;
  const str = String(text).trim();
  if (!str) return null;

  if (isConfirmationText(str)) return null;

  if (typeof text === 'number') {
    return { raw: String(text), value: Math.abs(text), index: 0 };
  }

  const clean = str.toLowerCase();

  // 1. Phrasal amounts: 'setengah juta', 'seperempat juta'
  const halfMatch = clean.match(/\bsetengah\s+(?:jt|juta)\b/i);
  if (halfMatch) return { raw: halfMatch[0], value: 500000, index: halfMatch.index };

  const quarterMatch = clean.match(/\bseperempat\s+(?:jt|juta)\b/i);
  if (quarterMatch) return { raw: quarterMatch[0], value: 250000, index: quarterMatch.index };

  // 2. Compound Million amounts: 1jt 200, 1jt 50 rb, 1jt 50rb, 1 juta 50 ribu, 2jt 500, 2jt 5, 1jt200
  const compoundJtMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:jt|juta)\s*(\d+(?:[.,]\d+)?)\s*(rb|ribu|k)?\b/i);
  if (compoundJtMatch) {
    const mainJt = parseFloat(compoundJtMatch[1].replace(',', '.'));
    const subNum = parseFloat(compoundJtMatch[2].replace(',', '.'));
    const subUnit = compoundJtMatch[3];
    let subVal = 0;
    if (subUnit) {
      subVal = Math.round(subNum * 1000);
    } else {
      if (subNum < 10) subVal = Math.round(subNum * 100000);
      else if (subNum < 1000) subVal = Math.round(subNum * 1000);
      else subVal = Math.round(subNum);
    }
    return {
      raw: compoundJtMatch[0],
      value: Math.round(mainJt * 1000000) + subVal,
      index: compoundJtMatch.index
    };
  }

  // 3. Compound Thousands amounts: 50rb 500, 50 ribu 500, 100k 250
  const compoundRbMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\s+(\d{1,3})\b/i);
  if (compoundRbMatch) {
    const mainRb = parseFloat(compoundRbMatch[1].replace(',', '.'));
    const subVal = parseInt(compoundRbMatch[2], 10) || 0;
    return {
      raw: compoundRbMatch[0],
      value: Math.round(mainRb * 1000) + subVal,
      index: compoundRbMatch.index
    };
  }

  // 4. Amounts with suffix: 2jt, 2 juta, 1,5 juta, 500rb, 500 ribu, 500k, 1 miliar, etc.
  const suffixMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(miliar|milyar|jt|juta|million|rb|ribu|k|thousand)\b/i);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1].replace(',', '.'));
    const unit = suffixMatch[2].toLowerCase();
    let mult = 1000;
    if (unit.startsWith('m')) {
      if (unit.includes('miliar') || unit.includes('milyar')) mult = 1000000000;
      else mult = 1000000;
    } else if (unit.startsWith('j')) {
      mult = 1000000;
    } else if (unit.startsWith('r') || unit === 'k' || unit === 'thousand') {
      mult = 1000;
    }
    return { raw: suffixMatch[0], value: Math.round(num * mult), index: suffixMatch.index };
  }

  // 3. Multi-dot/comma thousand separator numbers: 2.000.000 or 50.000 or 2,000,000
  const multiDotMatch = clean.match(/(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+)\b/i);
  if (multiDotMatch) {
    const digits = multiDotMatch[1].replace(/[^0-9]/g, '');
    return { raw: multiDotMatch[0], value: parseInt(digits, 10) || 0, index: multiDotMatch.index };
  }

  // 4. Standalone numbers with Rp prefix: Rp 50000, Rp2000000
  const rpMatch = clean.match(/rp\.?\s*(\d+)\b/i);
  if (rpMatch) {
    return { raw: rpMatch[0], value: parseInt(rpMatch[1], 10) || 0, index: rpMatch.index };
  }

  // 5. Standalone digits (at least 4 digits, e.g. 5000, 50000, 2000000)
  const rawNumMatch = clean.match(/\b(\d{4,})\b/);
  if (rawNumMatch) {
    return { raw: rawNumMatch[0], value: parseInt(rawNumMatch[1], 10) || 0, index: rawNumMatch.index };
  }

  // 6. Direct numeric string fallback: only if the string is essentially just a number (e.g. '2000', '500', '50000')
  if (/^\s*(?:rp\.?\s*)?\d+\s*$/i.test(clean)) {
    const parsed = parseInt(clean.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return { raw: str, value: parsed, index: 0 };
    }
  }

  return null;
}

export function parseAmount(str) {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return Math.abs(str);

  const extracted = extractAmount(str);
  return extracted ? extracted.value : 0;
}

export function getNow() {
  return dayjs().tz(config.timezone);
}

export function formatIndoDate(dateObj = null) {
  const d = dateObj ? dayjs(dateObj).tz(config.timezone) : getNow();
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const dayName = days[d.day()];
  const date = d.date();
  const monthName = months[d.month()];
  const year = d.year();
  const time = d.format('HH:mm');

  return `${dayName}, ${date} ${monthName} ${year} - Pukul ${time} WIB`;
}
