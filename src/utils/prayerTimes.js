import dayjs from 'dayjs';
import { getNow } from './formatters.js';
import { config } from '../config.js';

// Predefined coordinates for Indonesian major cities (Kemenag reference)
export const CITY_COORDINATES = {
  jambi: {
    name: 'Kota Jambi',
    latitude: -1.6101,
    longitude: 103.6131,
    timezoneOffset: 7 // WIB
  },
  jakarta: {
    name: 'DKI Jakarta',
    latitude: -6.2088,
    longitude: 106.8456,
    timezoneOffset: 7 // WIB
  },
  bandung: {
    name: 'Bandung',
    latitude: -6.9175,
    longitude: 107.6191,
    timezoneOffset: 7 // WIB
  },
  surabaya: {
    name: 'Surabaya',
    latitude: -7.2575,
    longitude: 112.7521,
    timezoneOffset: 7 // WIB
  },
  medan: {
    name: 'Medan',
    latitude: 3.5952,
    longitude: 98.6722,
    timezoneOffset: 7 // WIB
  },
  palembang: {
    name: 'Palembang',
    latitude: -2.9761,
    longitude: 104.7754,
    timezoneOffset: 7 // WIB
  },
  makassar: {
    name: 'Makassar',
    latitude: -5.1477,
    longitude: 119.4327,
    timezoneOffset: 8 // WITA
  }
};

export function getLocationConfig() {
  const cityKey = (config?.cityName || 'jambi').toLowerCase().trim();
  if (CITY_COORDINATES[cityKey]) {
    return CITY_COORDINATES[cityKey];
  }
  if (cityKey.includes('jambi')) {
    return CITY_COORDINATES.jambi;
  }
  const customLat = parseFloat(process.env.LATITUDE);
  const customLon = parseFloat(process.env.LONGITUDE);
  if (!isNaN(customLat) && !isNaN(customLon)) {
    return {
      name: config?.cityName || 'Custom',
      latitude: customLat,
      longitude: customLon,
      timezoneOffset: 7
    };
  }
  return CITY_COORDINATES.jambi;
}

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
  const loc = getLocationConfig();
  const LATITUDE = loc.latitude;
  const LONGITUDE = loc.longitude;
  const TIMEZONE_OFFSET = loc.timezoneOffset;
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
    city: loc.name,
    subuh: formatTime(noon - haFajr),
    terbit: formatTime(noon - haSunrise, 0),
    dzuhur: formatTime(noon),
    ashar: formatTime(noon + haAsr),
    maghrib: formatTime(noon + haMaghrib),
    isya: formatTime(noon + haIsha)
  };
}
