import dayjs from 'dayjs';
import { getNow } from './formatters.js';

// Coordinates for Jakarta (default)
const LATITUDE = -6.2088;
const LONGITUDE = 106.8456;
const TIMEZONE_OFFSET = 7; // WIB

function toRadians(deg) { return (deg * Math.PI) / 180; }
function toDegrees(rad) { return (rad * 180) / Math.PI; }
function fixAngle(a) { return (a % 360 + 360) % 360; }
function fixHour(h) { return (h % 24 + 24) % 24; }

function calculateJulianDate(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

export function getPrayerTimes(date = null) {
  const d = date ? dayjs(date) : getNow();
  const year = d.year();
  const month = d.month() + 1;
  const day = d.date();

  const jd = calculateJulianDate(year, month, day);
  const D = jd - 2451545.0;

  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * Math.sin(toRadians(g)) + 0.02 * Math.sin(toRadians(2 * g)));
  const e = 23.439 - 0.00000036 * D;
  const dec = toDegrees(Math.asin(Math.sin(toRadians(e)) * Math.sin(toRadians(L))));
  let RA = toDegrees(Math.atan2(Math.cos(toRadians(e)) * Math.sin(toRadians(L)), Math.cos(toRadians(L)))) / 15;
  RA = fixHour(RA);
  const EqT = q / 15 - RA;
  const noon = fixHour(12 + TIMEZONE_OFFSET - (LONGITUDE / 15) - EqT);

  function hourAngle(altitude) {
    const latRad = toRadians(LATITUDE);
    const decRad = toRadians(dec);
    const altRad = toRadians(altitude);
    const cosHA = (Math.sin(altRad) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));
    if (cosHA > 1 || cosHA < -1) return 0;
    return toDegrees(Math.acos(cosHA)) / 15;
  }

  // Indonesian Standard (Kemenag): Fajr -20°, Isha -18°, Asr Shafi'i shadow factor = 1
  const asrAlt = toDegrees(Math.atan(1 / (1 + Math.tan(toRadians(Math.abs(LATITUDE - dec))))));
  const haFajr = hourAngle(-20);
  const haSunrise = hourAngle(-0.833);
  const haAsr = hourAngle(asrAlt);
  const haMaghrib = hourAngle(-0.833);
  const haIsha = hourAngle(-18);

  function formatTime(h, addIhtiyat = 2) {
    h = fixHour(h);
    let totalMinutes = Math.round(h * 60) + addIhtiyat;
    const hr = Math.floor(totalMinutes / 60) % 24;
    const mn = totalMinutes % 60;
    return `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  }

  return {
    subuh: formatTime(noon - haFajr),
    terbit: formatTime(noon - haSunrise, 0),
    dzuhur: formatTime(noon),
    ashar: formatTime(noon + haAsr),
    maghrib: formatTime(noon + haMaghrib),
    isya: formatTime(noon + haIsha)
  };
}
