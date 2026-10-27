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

export function parseAmount(str) {
  if (!str) return 0;
  if (typeof str === 'number') return Math.abs(str);
  
  let s = String(str).toLowerCase().trim();
  // Strip "rp", "idr", commas, dots
  s = s.replace(/^(rp\.?|idr)\s*/i, '');

  let multiplier = 1;
  if (/(\d+([.,]\d+)?)\s*(jt|juta|million|m)\b/i.test(s)) {
    const match = s.match(/(\d+([.,]\d+)?)\s*(jt|juta|million|m)/i);
    const val = parseFloat(match[1].replace(',', '.'));
    return Math.round(val * 1000000);
  }
  if (/(\d+([.,]\d+)?)\s*(k|rb|ribu|thousand)\b/i.test(s)) {
    const match = s.match(/(\d+([.,]\d+)?)\s*(k|rb|ribu|thousand)/i);
    const val = parseFloat(match[1].replace(',', '.'));
    return Math.round(val * 1000);
  }

  // Handle regular numbers with dot as thousand separator: 50.000 -> 50000
  const cleanDigits = s.replace(/[^0-9]/g, '');
  return parseInt(cleanDigits, 10) || 0;
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
