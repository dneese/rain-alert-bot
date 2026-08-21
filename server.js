import { createServer } from 'http';
import { createRequire } from 'module';
import { initDB, getUser, saveUser, getAllUsers, getUserApiKey, getAllUserApiKeys, saveUserApiKey, deleteUserApiKey } from './lib/db.js';
import { t, getLangName, getLangFlag, languagePages } from './lib/i18n.js';

const require = createRequire(import.meta.url);
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const OWM_KEY = process.env.OWM_KEY;
const RAINBOW_KEY = process.env.RAINBOW_KEY;

// === Telegram API ===
async function tgApi(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function tgSendMessage(chatId, text, options = {}) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
}

async function tgEditMessage(chatId, messageId, text, options = {}) {
  return tgApi('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...options });
}

async function tgAnswerCallback(callbackQueryId, text = '') {
  return tgApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
}

async function tgSetWebhook(url) {
  return tgApi('setWebhook', { url, allowed_updates: ['message', 'callback_query'] });
}

// === Keyboards ===
function mainMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'btn_location'), callback_data: 'cb_location' },
        { text: t(lang, 'btn_check'), callback_data: 'cb_check' },
      ],
      [
        { text: t(lang, 'btn_settings'), callback_data: 'cb_settings' },
      ],
    ],
  };
}

function settingsKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'api_keys_label'), callback_data: 'cb_api_keys' },
        { text: t(lang, 'language_label'), callback_data: 'cb_lang' },
      ],
      [
        { text: t(lang, 'btn_back'), callback_data: 'cb_back_main' },
      ],
    ],
  };
}

function apiKeysKeyboard(lang, activeKeys) {
  const providers = [
    { key: 'weatherapi', label: 'WeatherAPI.com' },
    { key: 'owm', label: 'OpenWeatherMap' },
    { key: 'rainbow', label: 'Rainbow Weather' },
  ];
  const rows = providers.map(p => {
    const isActive = activeKeys.includes(p.key);
    return [
      { text: `${p.label} ${isActive ? '✅' : '❌'}`, callback_data: `cb_toggle_key_${p.key}` },
    ];
  });
  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_settings' }]);
  return { inline_keyboard: rows };
}

function languageKeyboard(page = 0) {
  const perPage = 9;
  const start = page * perPage;
  const pageLangs = languagePages.slice(start, start + perPage);
  const totalPages = Math.ceil(languagePages.length / perPage);

  const rows = [];
  for (let i = 0; i < pageLangs.length; i += 3) {
    const row = pageLangs.slice(i, i + 3).map(code => ({
      text: `${getLangFlag(code)} ${getLangName(code)}`,
      callback_data: `cb_lang_${code}`,
    }));
    rows.push(row);
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: '◀', callback_data: `cb_lang_page_${page - 1}` });
  navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
  if (page < totalPages - 1) navRow.push({ text: '▶', callback_data: `cb_lang_page_${page + 1}` });
  rows.push(navRow);

  rows.push([{ text: '◀ Back', callback_data: 'cb_settings' }]);
  return { inline_keyboard: rows };
}

function confirmKeyKeyboard(lang, provider) {
  return {
    inline_keyboard: [
      [{ text: t(lang, 'btn_cancel'), callback_data: 'cb_api_keys' }],
    ],
  };
}

// === Weather APIs ===

// WMO Weather interpretation codes
const WMO_CODES = {
  0: { desc: 'Clear', icon: '☀️', rain: false },
  1: { desc: 'Mainly clear', icon: '🌤', rain: false },
  2: { desc: 'Partly cloudy', icon: '⛅', rain: false },
  3: { desc: 'Overcast', icon: '☁️', rain: false },
  45: { desc: 'Fog', icon: '🌫', rain: false },
  48: { desc: 'Rime fog', icon: '🌫', rain: false },
  51: { desc: 'Light drizzle', icon: '🌦', rain: true },
  53: { desc: 'Moderate drizzle', icon: '🌦', rain: true },
  55: { desc: 'Dense drizzle', icon: '🌧', rain: true },
  56: { desc: 'Freezing drizzle', icon: '🌧', rain: true },
  57: { desc: 'Heavy freezing drizzle', icon: '🌧', rain: true },
  61: { desc: 'Slight rain', icon: '🌦', rain: true },
  63: { desc: 'Moderate rain', icon: '🌧', rain: true },
  65: { desc: 'Heavy rain', icon: '🌧', rain: true },
  66: { desc: 'Freezing rain', icon: '🌧', rain: true },
  67: { desc: 'Heavy freezing rain', icon: '🌧', rain: true },
  71: { desc: 'Slight snow', icon: '❄️', rain: true },
  73: { desc: 'Moderate snow', icon: '❄️', rain: true },
  75: { desc: 'Heavy snow', icon: '❄️', rain: true },
  77: { desc: 'Snow grains', icon: '❄️', rain: true },
  80: { desc: 'Slight showers', icon: '🌦', rain: true },
  81: { desc: 'Moderate showers', icon: '🌧', rain: true },
  82: { desc: 'Violent showers', icon: '🌧', rain: true },
  85: { desc: 'Slight snow showers', icon: '🌨', rain: true },
  86: { desc: 'Heavy snow showers', icon: '🌨', rain: true },
  95: { desc: 'Thunderstorm', icon: '⛈', rain: true },
  96: { desc: 'Thunderstorm with hail', icon: '⛈', rain: true },
  99: { desc: 'Thunderstorm with heavy hail', icon: '⛈', rain: true },
};

// Open-Meteo: current + minutely_15 + hourly in ONE call
async function fetchOpenMeteoFull(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&minutely_15=precipitation,precipitation_probability&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
  const data = await res.json();
  const tzOffsetSec = data.utc_offset_seconds || 0;

  // Convert API time string (in local tz) to real UTC epoch
  function apiTimeToMs(timeStr) {
    if (!timeStr) return 0;
    const d = new Date(timeStr + 'Z');
    return d.getTime() - tzOffsetSec * 1000;
  }

  // "Now" in real UTC
  const nowLocalMs = Date.now();

  const current = {
    temp_c: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    precipitation_mm: data.current.precipitation,
    rain_mm: data.current.rain,
    weather_code: data.current.weather_code,
    wind_speed: data.current.wind_speed_10m,
    time: data.current.time,
    is_raining: WMO_CODES[data.current.weather_code]?.rain || data.current.precipitation > 0,
    weather_icon: WMO_CODES[data.current.weather_code]?.icon || '🌤',
    weather_desc: WMO_CODES[data.current.weather_code]?.desc || 'Unknown',
  };

  const minutely = (data.minutely_15?.time || [])
    .map((t, i) => ({
      timeStr: t,
      ms: apiTimeToMs(t),
      precip_mm: data.minutely_15.precipitation[i],
      probability: data.minutely_15.precipitation_probability[i],
    }))
    .filter(h => h.ms >= nowLocalMs - 15 * 60 * 1000);

  const hourly = (data.hourly?.time || [])
    .map((t, i) => ({
      timeStr: t,
      ms: apiTimeToMs(t),
      probability: data.hourly.precipitation_probability[i],
      precip_mm: data.hourly.precipitation[i],
      temp_c: data.hourly.temperature_2m[i],
      wind_speed: data.hourly.wind_speed_10m[i],
    }))
    .filter(h => h.ms >= nowLocalMs);

  return { current, minutely, hourly, timezone: data.timezone, tzOffsetMs: tzOffsetSec * 1000, nowLocalMs };
}

// RainViewer: real-time radar precipitation
async function fetchRainViewer(lat, lon) {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error(`RainViewer: ${res.status}`);
  const data = await res.json();
  const pastFrames = data.radar?.past || [];
  if (pastFrames.length === 0) return { is_raining: false, intensity: 0 };

  const lastFrame = pastFrames[pastFrames.length - 1];
  const frameTime = lastFrame.time * 1000;
  const ageMinutes = (Date.now() - frameTime) / (1000 * 60);

  if (ageMinutes > 30) return { is_raining: false, intensity: 0, stale: true };

  const zoom = 6;
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  const tileUrl = `https://tilecache.rainviewer.com${lastFrame.path}/${zoom}/${x}/${y}/6/1_1.png`;
  const tileRes = await fetch(tileUrl);
  if (!tileRes.ok) return { is_raining: false, intensity: 0 };

  const buf = Buffer.from(await tileRes.arrayBuffer());
  const intensity = parseRadarTile(buf);
  return { is_raining: intensity > 0, intensity, ageMinutes: Math.round(ageMinutes) };
}

function parseRadarTile(pngBuf) {
  try {
    const w = pngBuf.readUInt32BE(16);
    const h = pngBuf.readUInt32BE(20);

    let pos = 8;
    let palette = null;
    let idatData = Buffer.alloc(0);
    while (pos < pngBuf.length) {
      const len = pngBuf.readUInt32BE(pos);
      const type = pngBuf.slice(pos + 4, pos + 8).toString('ascii');
      if (type === 'PLTE') {
        palette = [];
        const plteData = pngBuf.slice(pos + 8, pos + 8 + len);
        for (let i = 0; i < plteData.length; i += 3) {
          palette.push({ r: plteData[i], g: plteData[i + 1], b: plteData[i + 2], a: 255 });
        }
      }
      if (type === 'tRNS') {
        const trnsData = pngBuf.slice(pos + 8, pos + 8 + len);
        if (palette) {
          for (let i = 0; i < trnsData.length && i < palette.length; i++) {
            palette[i].a = trnsData[i];
          }
        }
      }
      if (type === 'IDAT') {
        idatData = Buffer.concat([idatData, pngBuf.slice(pos + 8, pos + 8 + len)]);
      }
      if (type === 'IEND') break;
      pos += 12 + len;
    }

    if (!palette || idatData.length === 0) return 0;

    const raw = zlib.inflateSync(idatData);
    const rowBytes = 1 + w;
    let rainPixels = 0;
    let totalPixels = 0;
    let maxIntensity = 0;

    for (let py = 0; py < h; py++) {
      const rowStart = py * rowBytes + 1;
      for (let px = 0; px < w; px++) {
        const idx = raw[rowStart + px];
        const color = palette[idx];
        if (color && color.a > 10) {
          rainPixels++;
          const brightness = (color.r + color.g + color.b) / 3;
          if (brightness < 50) maxIntensity = Math.max(maxIntensity, 5);
          else if (brightness < 100) maxIntensity = Math.max(maxIntensity, 4);
          else if (brightness < 150) maxIntensity = Math.max(maxIntensity, 3);
          else if (brightness < 200) maxIntensity = Math.max(maxIntensity, 2);
          else maxIntensity = Math.max(maxIntensity, 1);
        }
        totalPixels++;
      }
    }

    const coverage = rainPixels / totalPixels;
    if (coverage < 0.01) return 0;
    if (coverage < 0.05) return 1;
    if (coverage < 0.15) return 2;
    if (coverage < 0.30) return 3;
    if (coverage < 0.50) return 4;
    return 5;
  } catch (e) {
    console.warn('Radar parse error:', e.message);
    return 0;
  }
}

async function fetchWeatherAPI(lat, lon, apiKey) {
  const key = apiKey || WEATHERAPI_KEY;
  if (!key) return null;
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${lat},${lon}&days=2&alerts=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WeatherAPI: ${res.status}`);
  const data = await res.json();
  const hours = data.forecast.forecastday.flatMap(d => d.hour);
  const now = new Date();
  return hours
    .filter(h => new Date(h.time) >= now)
    .map(h => ({
      time: h.time,
      probability: h.chance_of_rain,
      precip_mm: h.precip_mm,
      temp_c: h.temp_c,
    }));
}

async function getRainForecast(lat, lon, chatId) {
  let result = {
    current: null,
    minutely: [],
    forecast: [],
    radar: { is_raining: false, intensity: 0 },
    source: 'none',
    isRaining: false,
  };

  // 1. Open-Meteo: current + minutely_15 + hourly (PRIMARY - free, reliable)
  try {
    const om = await fetchOpenMeteoFull(lat, lon);
    result.current = om.current;
    result.minutely = om.minutely;
    result.forecast = om.hourly;
    result.source = 'Open-Meteo';
    result.isRaining = om.current.is_raining;
    result.nowLocalMs = om.nowLocalMs;
    result.tzOffsetMs = om.tzOffsetMs;
  } catch (e) {
    console.warn('Open-Meteo failed:', e.message);
  }

  // 2. RainViewer: real-time radar (FREE, no key)
  try {
    result.radar = await fetchRainViewer(lat, lon);
    if (result.radar.is_raining) result.isRaining = true;
    if (result.radar.stale) console.warn('RainViewer radar data is stale');
  } catch (e) {
    console.warn('RainViewer failed:', e.message);
  }

  // 3. Check minutely_15 for recent/upcoming rain even if current is dry
  const next30minMs = result.nowLocalMs + 30 * 60 * 1000;
  const recentRain = result.minutely.some(m => {
    return m.ms >= result.nowLocalMs && m.ms <= next30minMs && m.precip_mm > 0.1;
  });
  if (recentRain) result.isRaining = true;

  // 4. WeatherAPI/OWM/Rainbow: supplementary (only if user has keys)
  if (chatId && !result.isRaining) {
    const providers = ['weatherapi', 'owm', 'rainbow'];
    for (const p of providers) {
      try {
        const key = await getUserApiKey(chatId, p);
        if (!key) continue;
        if (p === 'weatherapi') {
          const wa = await fetchWeatherAPI(lat, lon, key);
          if (wa) {
            const hasRain = wa.some(f => {
              const fUtcMs = new Date(f.time + 'Z').getTime() - 10800000;
              const diff = (fUtcMs - result.nowLocalMs) / (1000 * 60);
              return diff <= 60 && diff >= -30 && f.precip_mm > 0.2;
            });
            if (hasRain) {
              result.forecast = wa;
              result.source = 'WeatherAPI';
              result.isRaining = true;
              break;
            }
          }
        }
      } catch (e) {
        console.warn(`${p} failed:`, e.message);
      }
    }
  }

  return result;
}

// === Weather Display ===
function getWeatherEmoji(probability, precipMm) {
  if (precipMm > 2) return '🌧';
  if (precipMm > 0.5) return '🌧';
  if (precipMm > 0.1) return '🌦';
  if (probability > 60) return '🌧';
  if (probability > 30) return '⛅';
  return '☀️';
}

function makeRainBar(probability) {
  const filled = Math.round(probability / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function makePrecipBar(precipMm) {
  if (precipMm <= 0) return '░░░░░░░░░░';
  if (precipMm < 0.5) return '█░░░░░░░░░';
  if (precipMm < 1) return '██░░░░░░░░';
  if (precipMm < 2) return '████░░░░░░';
  if (precipMm < 5) return '██████░░░░';
  return '████████░░';
}

function formatTime(timeStr) {
  if (!timeStr) return '??:??';
  const parts = timeStr.split('T');
  if (parts.length === 2) return parts[1];
  return '??:??';
}

function formatDate(timeStr, lang, tzOffsetMs) {
  if (!timeStr) return '';
  const datePart = timeStr.split('T')[0];
  const nowLocal = new Date(Date.now() + (tzOffsetMs || 0));
  const todayStr = nowLocal.toISOString().split('T')[0];
  const tomorrowStr = new Date(nowLocal.getTime() + 86400000).toISOString().split('T')[0];

  if (datePart === todayStr) return t(lang, 'date_today');
  if (datePart === tomorrowStr) return t(lang, 'date_tomorrow');
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

function formatWeatherMessage(weatherData, lang) {
  const { current, minutely, forecast, radar, source, isRaining, nowLocalMs, tzOffsetMs } = weatherData;

  if (!current && (!forecast || forecast.length === 0)) {
    return `<b>${t(lang, 'error_no_forecast')}</b>`;
  }

  // Get current time string in local timezone for display
  const nowLocalDate = new Date(Date.now() + (tzOffsetMs || 0));
  const nowTimeStr = `${nowLocalDate.getUTCHours().toString().padStart(2, '0')}:${nowLocalDate.getUTCMinutes().toString().padStart(2, '0')}`;

  let msg = '';

  // === HEADER ===
  if (isRaining || radar.is_raining) {
    const rainMm = current?.precipitation_mm || radar.intensity * 0.5 || 0;
    const intensity = rainMm > 3 ? '⚠️ СИЛЬНИЙ ДОЩ' : rainMm > 1 ? '🌧 ДОЩ' : '🌦 НЕВЕЛИКИЙ ДОЩ';
    msg += `<b>${intensity}</b>\n\n`;
  } else {
    const nextRain = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    if (nextRain) {
      const minsAway = Math.round((nextRain.ms - nowLocalMs) / 60000);
      msg += `<b>🌧 ДОЩ ЧЕРЕЗ ${minsAway} ХВ</b>\n\n`;
    } else {
      const rainInForecast = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
      if (rainInForecast) {
        const hoursAway = Math.round((rainInForecast.ms - nowLocalMs) / (1000 * 60 * 60));
        msg += `<b>🌧 ДОЩ ЧЕРЕЗ ${hoursAway}год</b>\n\n`;
      } else {
        msg += `<b>☀️ Без опадів</b>\n\n`;
      }
    }
  }

  // === CURRENT CONDITIONS ===
  if (current) {
    const rainIcon = current.is_raining ? '🌧' : current.weather_icon;
    msg += `<b>Зараз:</b> ${rainIcon} ${Math.round(current.temp_c)}°C\n`;
    msg += `💧 ${Math.round(current.humidity)}%  💨 ${Math.round(current.wind_speed)}км/год\n`;
    if (current.precipitation_mm > 0) {
      msg += `🌧 Опади: ${current.precipitation_mm}мм\n`;
    }
    if (radar?.is_raining) {
      const radarDesc = ['', 'Слабкий', 'Помірний', 'Середній', 'Сильний', 'Дуже сильний'];
      msg += `📡 Радар: ${radarDesc[radar.intensity] || 'Так'} (${radar.ageMinutes || '?'}хв тому)\n`;
    }
    msg += '\n';
  }

  // === MINUTELY (next 2 hours, most accurate) ===
  if (minutely && minutely.length > 0) {
    msg += `<b>Наступні 2 години (15хв):</b>\n`;
    const displayMinutely = minutely.slice(0, 8);
    for (const m of displayMinutely) {
      const time = m.timeStr.split('T')[1];
      const emoji = m.precip_mm > 2 ? '🌧' : m.precip_mm > 0.1 ? '🌦' : '☀️';
      const bar = makePrecipBar(m.precip_mm);
      const precip = m.precip_mm > 0 ? ` ${m.precip_mm.toFixed(1)}мм` : '';
      msg += `<code>${time} ${emoji} ${bar}${precip}</code>\n`;
    }
    msg += '\n';
  }

  // === HOURLY FORECAST ===
  if (forecast && forecast.length > 0) {
    msg += `<b>Прогноз:</b>\n`;
    const displayHours = forecast.slice(0, 8);
    let lastDate = '';
    for (const h of displayHours) {
      const dateStr = formatDate(h.timeStr, lang, tzOffsetMs);
      if (dateStr !== lastDate) {
        msg += `<i>${dateStr}</i>\n`;
        lastDate = dateStr;
      }
      const time = h.timeStr.split('T')[1];
      const emoji = getWeatherEmoji(h.probability, h.precip_mm);
      const temp = h.temp_c !== null ? `${Math.round(h.temp_c)}°` : '--';
      const precip = h.precip_mm > 0 ? ` ${h.precip_mm.toFixed(1)}мм` : '';
      msg += `<code>${time} ${emoji} ${h.probability}% ${temp}${precip}</code>\n`;
    }
    msg += '\n';
  }

  // === RECOMMENDATION ===
  if (isRaining || radar?.is_raining) {
    msg += `⚠️ <b>Йде дощ! Не забудь парасольку!</b>\n`;
  } else {
    const nextRainMinutely = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    const nextRainHourly = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
    if (nextRainMinutely || nextRainHourly) {
      msg += `⚠️ <b>Дощ очікується! Візьми парасольку!</b>\n`;
    } else {
      msg += `✅ <b>Можна виходити без парасольки.</b>\n`;
    }
  }

  msg += `\n🕐 ${t(lang, 'updated_at', { time: nowTimeStr })}`;
  if (source) msg += ` | ${source}`;
  if (radar?.is_raining) msg += ` | 📡 Radar`;

  return msg;
}

// === Callback Handler ===
const pendingCallbacks = {};

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;

  if (!chatId || !data) return;

  const user = await getUser(chatId);
  const lang = user?.language || 'uk';

  await tgAnswerCallback(callbackQuery.id);

  if (data === 'cb_location') {
    await tgSendMessage(chatId, t(lang, 'send_location_prompt'), {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  if (data === 'cb_check') {
    const u = await getUser(chatId);
    if (!u || !u.latitude) {
      await tgSendMessage(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(u.latitude, u.longitude, chatId);
    const msg = formatWeatherMessage(weatherData, lang);
    const result = await tgSendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(lang) });
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (data === 'cb_settings') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const keys = await getAllUserApiKeys(chatId);
    const activeCount = keys.length;
    const msg = `<b>${t(uLang, 'settings_title')}</b>\n\n${t(uLang, 'language_label')}: ${getLangFlag(uLang)} ${getLangName(uLang)}\n${t(uLang, 'api_keys_label')}: ${t(uLang, 'api_keys_count', { active: activeCount })}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsKeyboard(uLang) });
    return;
  }

  if (data === 'cb_api_keys') {
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    const msg = `<b>${t(lang, 'api_keys_title')}</b>\n\n${t(lang, 'api_keys_desc')}\n\n${t(lang, 'api_register_hint')}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    return;
  }

  if (data.startsWith('cb_toggle_key_')) {
    const provider = data.replace('cb_toggle_key_', '');
    const providerNames = { weatherapi: 'WeatherAPI.com', owm: 'OpenWeatherMap', rainbow: 'Rainbow Weather' };
    const providerName = providerNames[provider] || provider;

    const existingKey = await getUserApiKey(chatId, provider);
    if (existingKey) {
      await deleteUserApiKey(chatId, provider);
      const keys = await getAllUserApiKeys(chatId);
      const activeProviders = keys.map(k => k.provider);
      await tgSendMessage(chatId, `${t(lang, 'api_key_deleted')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    } else {
      pendingCallbacks[chatId] = { action: 'api_key', provider, messageId };
      await tgSendMessage(chatId, t(lang, 'api_enter_key', { provider: providerName }), {
        reply_markup: confirmKeyKeyboard(lang, provider),
      });
    }
    return;
  }

  if (data === 'cb_lang') {
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: languageKeyboard(0) });
    return;
  }

  if (data.startsWith('cb_lang_page_')) {
    const page = parseInt(data.replace('cb_lang_page_', ''));
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: languageKeyboard(page) });
    return;
  }

  if (data.startsWith('cb_lang_') && !data.startsWith('cb_lang_page_')) {
    const newLang = data.replace('cb_lang_', '');
    await saveUser(chatId, { language: newLang });
    const msg = `<b>${t(newLang, 'settings_title')}</b>\n\n${t(newLang, 'settings_language_changed', { language: `${getLangFlag(newLang)} ${getLangName(newLang)}` })}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsKeyboard(newLang) });
    return;
  }

  if (data === 'cb_back_main') {
    const msg = `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: mainMenuKeyboard(lang) });
    return;
  }
}

// === Message Handler ===
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start' || text === '/help') {
    let user = await getUser(chatId);
    if (!user) {
      await saveUser(chatId, { enabled: true, language: 'uk' });
      user = await getUser(chatId);
    }
    const lang = user?.language || 'uk';
    await tgSendMessage(chatId,
      `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`,
      { reply_markup: mainMenuKeyboard(lang) }
    );
    return;
  }

  if (text === '/stop') {
    await saveUser(chatId, { enabled: false });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await tgSendMessage(chatId, t(lang, 'btn_stop') || 'Сповіщення вимкнено.', { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/check') {
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    if (!user || !user.latitude) {
      await tgSendMessage(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(user.latitude, user.longitude, chatId);
    const msg = formatWeatherMessage(weatherData, lang);
    const result = await tgSendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(lang) });
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (message.location) {
    await saveUser(chatId, {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      enabled: true,
    });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    const weatherData = await getRainForecast(message.location.latitude, message.location.longitude, chatId);
    const msg = `<b>${t(lang, 'location_saved')}</b>\n\n${formatWeatherMessage(weatherData, lang)}`;
    const result = await tgSendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(lang) });
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  // Handle pending API key input
  if (pendingCallbacks[chatId]?.action === 'api_key') {
    const { provider } = pendingCallbacks[chatId];
    delete pendingCallbacks[chatId];

    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    const providerNames = { weatherapi: 'WeatherAPI.com', owm: 'OpenWeatherMap', rainbow: 'Rainbow Weather' };
    const providerName = providerNames[provider] || provider;

    if (!text || text.length < 10) {
      await tgSendMessage(chatId, t(lang, 'api_key_too_short'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }

    await saveUserApiKey(chatId, provider, text.trim());
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    await tgSendMessage(chatId, `${t(lang, 'api_key_saved')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    return;
  }

  const user = await getUser(chatId);
  const lang = user?.language || 'uk';
  await tgSendMessage(chatId, t(lang, 'send_location_prompt'), { reply_markup: mainMenuKeyboard(lang) });
}

// === Auto-Update (Cron) ===
async function updateAllUsers() {
  const users = await getAllUsers();
  let updated = 0;

  for (const user of users) {
    if (!user.latitude || !user.last_message_id) continue;

    try {
      const weatherData = await getRainForecast(user.latitude, user.longitude, user.chat_id);
      const lang = user.language || 'uk';
      const msg = formatWeatherMessage(weatherData, lang);
      const result = await tgEditMessage(user.chat_id, user.last_message_id, msg, {
        reply_markup: mainMenuKeyboard(lang),
      });
      if (result.ok) {
        updated++;
      } else {
        console.warn(`Edit failed for ${user.chat_id}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.error(`Update error for ${user.chat_id}:`, err.message);
    }
  }
  return updated;
}

// === Cron Check: edit existing + send new ONLY on rain transition ===
async function checkAllUsers() {
  const users = await getAllUsers();
  let edited = 0, alertsSent = 0;

  for (const user of users) {
    if (!user.latitude) continue;

    try {
      const weatherData = await getRainForecast(user.latitude, user.longitude, user.chat_id);
      const lang = user.language || 'uk';
      const rainSoon = weatherData.minutely?.some(m =>
        m.ms > weatherData.nowLocalMs &&
        m.ms < weatherData.nowLocalMs + 30 * 60 * 1000 &&
        m.precip_mm > 0.1
      );
      const needsRainAlert = weatherData.isRaining || rainSoon;
      const msg = formatWeatherMessage(weatherData, lang);

      // ALWAYS edit existing message (silent update, like /update)
      if (user.last_message_id) {
        const editResult = await tgEditMessage(user.chat_id, user.last_message_id, msg, {
          reply_markup: mainMenuKeyboard(lang),
        });
        if (editResult.ok) edited++;
      }

      // Send NEW message ONLY on rain transition (triggers notification)
      // Cooldown: 30 min between new alerts
      const COOLDOWN_MS = 30 * 60 * 1000;
      const lastAlert = user.last_alert_time || 0;
      if (needsRainAlert && Date.now() - lastAlert > COOLDOWN_MS) {
        const sendResult = await tgSendMessage(user.chat_id, msg, { reply_markup: mainMenuKeyboard(lang) });
        if (sendResult.ok) {
          await saveUser(user.chat_id, {
            last_alert_time: Date.now(),
            last_message_id: sendResult.result.message_id,
          });
          alertsSent++;
        }
      }
    } catch (err) {
      console.error(`Check error for ${user.chat_id}:`, err.message);
    }
  }
  return { edited, alertsSent };
}

// === HTTP Server ===
const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', bot: 'rain-alert-bot' }));
  }

  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const update = JSON.parse(body);
      if (update.message) await handleMessage(update.message);
      if (update.callback_query) await handleCallbackQuery(update.callback_query);
    } catch (err) {
      console.error('Webhook error:', err);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.url === '/check') {
    try {
      const result = await checkAllUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, edited: result.edited, alertsSent: result.alertsSent }));
    } catch (err) {
      console.error('Check error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.url === '/update') {
    try {
      const updated = await updateAllUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, updated }));
    } catch (err) {
      console.error('Update error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.url === '/setup-webhook' && req.method === 'POST') {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const webhookUrl = `${protocol}://${host}/webhook`;
    const result = await tgSetWebhook(webhookUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  res.writeHead(404);
  res.end('Not Found');
});

// === Start ===
server.listen(PORT, async () => {
  console.log(`Rain Alert Bot running on port ${PORT}`);
  initDB();
});
