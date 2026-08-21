import { createServer } from 'http';
import { createRequire } from 'module';
import { initDB, getUser, saveUser, getAllUsers, getUserApiKey, getAllUserApiKeys, saveUserApiKey, deleteUserApiKey, getUserSettings, saveUserSettings, getUserLocations, getDefaultLocation, addUserLocation, setDefaultLocation, deleteUserLocation } from './lib/db.js';
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

function settingsDetailKeyboard(lang, settings) {
  const s = settings || {};
  const radarLabel = s.radar_enabled !== false ? '📡 Radar ✅' : '📡 Radar ❌';
  return {
    inline_keyboard: [
      [
        { text: `🌧 Поріг: ${s.rain_threshold_mm || 0.5}мм`, callback_data: 'cb_settings_threshold' },
      ],
      [
        { text: `⏱ Прогноз: ${s.lookahead_min || 30}хв`, callback_data: 'cb_settings_lookahead' },
      ],
      [
        { text: radarLabel, callback_data: 'cb_settings_radar' },
      ],
      [
        { text: `⏰ Кулдаун: ${s.alert_cooldown_min || 30}хв`, callback_data: 'cb_settings_cooldown' },
      ],
      [
        { text: s.posture === 'outside' ? '🚶 Зараз надворі' : '🏠 Зараз вдома', callback_data: 'cb_settings_posture' },
      ],
      [
        { text: '🔧 Розширені', callback_data: 'cb_adv_settings' },
      ],
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

function thresholdKeyboard(lang) {
  const thresholds = [0.1, 0.3, 0.5, 1.0, 2.0];
  return {
    inline_keyboard: [
      thresholds.map(v => ({ text: `${v}мм`, callback_data: `cb_set_threshold_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function lookaheadKeyboard(lang) {
  const options = [15, 30, 60, 120];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v}хв`, callback_data: `cb_set_lookahead_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function cooldownKeyboard(lang) {
  const options = [10, 15, 30, 60];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `${v}хв`, callback_data: `cb_set_cooldown_${v}` })),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function advancedSettingsKeyboard(lang, settings) {
  const s = settings || {};
  const qhOn = s.quiet_hours_start && s.quiet_hours_end;
  const windOn = s.wind_threshold_kmh != null;
  const humOn = s.humidity_threshold_pct != null;
  const tempOn = s.temp_threshold_c != null;
  return {
    inline_keyboard: [
      [{ text: `🔕 Тихі години: ${qhOn ? s.quiet_hours_start + '-' + s.quiet_hours_end : 'Вимкнено'}`, callback_data: 'cb_adv_quiet' }],
      [{ text: `💨 Вітер: ${windOn ? '>'+s.wind_threshold_kmh+'км/год' : 'Вимкнено'}`, callback_data: 'cb_adv_wind' }],
      [{ text: `💧 Вологість: ${humOn ? '>'+s.humidity_threshold_pct+'%' : 'Вимкнено'}`, callback_data: 'cb_adv_humidity' }],
      [{ text: `🌡 Температура: ${tempOn ? '<'+s.temp_threshold_c+'°C' : 'Вимкнено'}`, callback_data: 'cb_adv_temp' }],
      [{ text: '🌩 Рівні дощу', callback_data: 'cb_adv_rain_levels' }],
      [{ text: '📊 Секції повідомлення', callback_data: 'cb_adv_sections' }],
      [{ text: '📍 Локації', callback_data: 'cb_adv_locations' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_settings_detail' }],
    ],
  };
}

function quietHoursKeyboard(lang) {
  const hours = [];
  for (let h = 0; h < 24; h += 2) {
    hours.push({ text: `${h.toString().padStart(2,'0')}:00`, callback_data: `cb_qh_start_${h}` });
  }
  return {
    inline_keyboard: [
      hours.slice(0, 6),
      hours.slice(6, 12),
      [{ text: '❌ Вимкнути', callback_data: 'cb_qh_off' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function quietHoursEndKeyboard(lang, startHour) {
  const hours = [];
  for (let h = 0; h < 24; h += 2) {
    hours.push({ text: `${h.toString().padStart(2,'0')}:00`, callback_data: `cb_qh_end_${startHour}_${h}` });
  }
  return {
    inline_keyboard: [
      hours.slice(0, 6),
      hours.slice(6, 12),
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_quiet' }],
    ],
  };
}

function windThresholdKeyboard(lang) {
  const options = [10, 15, 20, 30, 40, 50];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `>${v}`, callback_data: `cb_set_wind_${v}` })),
      [{ text: '❌ Вимкнути', callback_data: 'cb_set_wind_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function humidityThresholdKeyboard(lang) {
  const options = [60, 70, 75, 80, 85, 90];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `>${v}%`, callback_data: `cb_set_hum_${v}` })),
      [{ text: '❌ Вимкнути', callback_data: 'cb_set_hum_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function tempThresholdKeyboard(lang) {
  const options = [0, 5, 10, 15, 20, 25, 30];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `<${v}°C`, callback_data: `cb_set_temp_${v}` })),
      [{ text: '❌ Вимкнути', callback_data: 'cb_set_temp_999' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function rainLevelsKeyboard(lang, settings) {
  const s = settings || {};
  return {
    inline_keyboard: [
      [{ text: `🌦 Мряка: ${s.alert_drizzle !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_drizzle' }],
      [{ text: `🌧 Легкий дощ: ${s.alert_light_rain !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_light_rain' }],
      [{ text: `🌧 Сильний дощ: ${s.alert_heavy_rain !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_heavy_rain' }],
      [{ text: `⛈ Гроза: ${s.alert_thunderstorm !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_thunderstorm' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function sectionsKeyboard(lang, settings) {
  const s = settings || {};
  return {
    inline_keyboard: [
      [{ text: `📸 Поточна: ${s.show_current !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_current' }],
      [{ text: `⏱ Міні-15: ${s.show_minutely !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_minutely' }],
      [{ text: `📅 Годинний: ${s.show_hourly !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_hourly' }],
      [{ text: `📡 Радар: ${s.show_radar !== false ? '✅' : '❌'}`, callback_data: 'cb_toggle_show_radar' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function locationsKeyboard(lang, locations) {
  const rows = locations.map(loc => ([
    { text: `${loc.is_default ? '⭐' : '📍'} ${loc.name} (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`, callback_data: `cb_loc_default_${loc.id}` },
    { text: '🗑', callback_data: `cb_loc_delete_${loc.id}` },
  ]));
  rows.push([{ text: '➕ Додати локацію', callback_data: 'cb_loc_add' }]);
  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }]);
  return { inline_keyboard: rows };
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

  // 2. RainViewer: real-time radar (FREE, no key) — SUPPLEMENTARY only
  try {
    result.radar = await fetchRainViewer(lat, lon);
    if (result.radar.stale) console.warn('RainViewer radar data is stale');
    // Radar ONLY confirms rain if Open-Meteo ALREADY shows rain signs
    // Don't let radar alone trigger isRaining (causes false positives)
    if (result.radar.is_raining && (result.isRaining || result.current?.precipitation_mm > 0)) {
      result.isRaining = true;
    }
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

function formatWeatherMessage(weatherData, lang, settings) {
  const { current, minutely, forecast, radar, source, isRaining, nowLocalMs, tzOffsetMs } = weatherData;

  if (!current && (!forecast || forecast.length === 0)) {
    return `<b>${t(lang, 'error_no_forecast')}</b>`;
  }

  // Get current time string in local timezone for display
  const nowLocalDate = new Date(Date.now() + (tzOffsetMs || 0));
  const nowTimeStr = `${nowLocalDate.getUTCHours().toString().padStart(2, '0')}:${nowLocalDate.getUTCMinutes().toString().padStart(2, '0')}`;

  let msg = '';

  // === HEADER ===
  if (isRaining) {
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
  if (current && settings?.show_current !== false) {
    const rainIcon = current.is_raining ? '🌧' : current.weather_icon;
    msg += `<b>Зараз:</b> ${rainIcon} ${Math.round(current.temp_c)}°C\n`;
    msg += `💧 ${Math.round(current.humidity)}%  💨 ${Math.round(current.wind_speed)}км/год\n`;
    if (current.precipitation_mm > 0) {
      msg += `🌧 Опади: ${current.precipitation_mm}мм\n`;
    }
    if (radar?.is_raining && settings?.show_radar !== false) {
      const radarDesc = ['', 'Слабкий', 'Помірний', 'Середній', 'Сильний', 'Дуже сильний'];
      msg += `📡 Радар: ${radarDesc[radar.intensity] || 'Так'} (${radar.ageMinutes || '?'}хв тому)\n`;
    }
    msg += '\n';
  }

  // === MINUTELY (next 2 hours, most accurate) ===
  if (minutely && minutely.length > 0 && settings?.show_minutely !== false) {
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
  if (forecast && forecast.length > 0 && settings?.show_hourly !== false) {
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
  const posture = settings?.posture || 'inside';
  const isOutside = posture === 'outside';
  
  if (isRaining) {
    if (isOutside) {
      msg += `⚠️ <b>Йде дощ! Знайди укриття!</b>\n`;
    } else {
      msg += `⚠️ <b>Йде дощ! Не забудь парасольку!</b>\n`;
    }
  } else {
    const nextRainMinutely = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    const nextRainHourly = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
    if (nextRainMinutely || nextRainHourly) {
      if (isOutside) {
        msg += `⚠️ <b>Дощ через хвилини! Повертайся додому!</b>\n`;
      } else {
        msg += `⚠️ <b>Дощ очікується! Візьми парасольку!</b>\n`;
      }
    } else {
      if (isOutside) {
        msg += `✅ <b>Погода нормальна, залишайся надворі.</b>\n`;
      } else {
        msg += `✅ <b>Можна виходити без парасольки.</b>\n`;
      }
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
    const settings = await getUserSettings(chatId);
    const msg = formatWeatherMessage(weatherData, lang, settings);
    const result = await tgSendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(lang) });
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (data === 'cb_settings') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const keys = await getAllUserApiKeys(chatId);
    const postureEmoji = settings?.posture === 'outside' ? '🚶' : '🏠';
    const msg = `<b>⚙️ Налаштування</b>\n\n` +
      `🌧 Поріг дощу: <b>${settings?.rain_threshold_mm || 0.5}мм</b>\n` +
      `⏱ Вікно прогнозу: <b>${settings?.lookahead_min || 30}хв</b>\n` +
      `📡 Радар: <b>${settings?.radar_enabled !== false ? 'Увімкнено' : 'Вимкнено'}</b>\n` +
      `⏰ Кулдаун алертів: <b>${settings?.alert_cooldown_min || 30}хв</b>\n` +
      `${postureEmoji} Режим: <b>${settings?.posture === 'outside' ? 'Надворі 🚶' : 'Вдома 🏠'}</b>\n\n` +
      `🌐 Мова: ${getLangFlag(uLang)} ${getLangName(uLang)}\n` +
      `🔑 API ключі: ${keys.length}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_settings_detail') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const keys = await getAllUserApiKeys(chatId);
    const postureEmoji = settings?.posture === 'outside' ? '🚶' : '🏠';
    const msg = `<b>⚙️ Налаштування</b>\n\n` +
      `🌧 Поріг дощу: <b>${settings?.rain_threshold_mm || 0.5}мм</b>\n` +
      `⏱ Вікно прогнозу: <b>${settings?.lookahead_min || 30}хв</b>\n` +
      `📡 Радар: <b>${settings?.radar_enabled !== false ? 'Увімкнено' : 'Вимкнено'}</b>\n` +
      `⏰ Кулдаун алертів: <b>${settings?.alert_cooldown_min || 30}хв</b>\n` +
      `${postureEmoji} Режим: <b>${settings?.posture === 'outside' ? 'Надворі 🚶' : 'Вдома 🏠'}</b>\n\n` +
      `🌐 Мова: ${getLangFlag(uLang)} ${getLangName(uLang)}\n` +
      `🔑 API ключі: ${keys.length}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_settings_threshold') {
    await tgAnswerCallback(callbackQuery.id, 'Оберіть поріг дощу');
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🌧 Поріг дощу</b>\n\nМінімальна кількість опадів для сповіщення.\nЗараз: <b>${settings?.rain_threshold_mm || 0.5}мм</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_threshold_')) {
    const value = parseFloat(data.replace('cb_set_threshold_', ''));
    await saveUserSettings(chatId, { rain_threshold_mm: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `Поріг: ${value}мм`);
    const msg = `<b>✅ Поріг дощу встановлено: ${value}мм</b>\n\nНатисніть кнопку щоб повернутись.`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_lookahead') {
    await tgAnswerCallback(callbackQuery.id, 'Оберіть вікно прогнозу');
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏱ Вікно прогнозу</b>\n\nНа скільки хвилин вперед дивитись для алертів.\nЗараз: <b>${settings?.lookahead_min || 30}хв</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_lookahead_')) {
    const value = parseInt(data.replace('cb_set_lookahead_', ''));
    await saveUserSettings(chatId, { lookahead_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `Прогноз: ${value}хв`);
    const msg = `<b>✅ Вікно прогнозу встановлено: ${value}хв</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_radar') {
    const settings = await getUserSettings(chatId);
    const newEnabled = settings?.radar_enabled === false;
    await saveUserSettings(chatId, { radar_enabled: newEnabled });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, newEnabled ? 'Радар увімкнено' : 'Радар вимкнено');
    const msg = `<b>⚙️ Налаштування</b>\n\n📡 Радар: <b>${newEnabled ? 'Увімкнено' : 'Вимкнено'}</b>\n\nНатисніть кнопку щоб повернутись.`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  if (data === 'cb_settings_cooldown') {
    await tgAnswerCallback(callbackQuery.id, 'Оберіть кулдаун');
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏰ Кулдаун алертів</b>\n\nМінімальний інтервал між сповіщеннями про дощ.\nЗараз: <b>${settings?.alert_cooldown_min || 30}хв</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_cooldown_')) {
    const value = parseInt(data.replace('cb_set_cooldown_', ''));
    await saveUserSettings(chatId, { alert_cooldown_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `Кулдаун: ${value}хв`);
    const msg = `<b>✅ Кулдаун встановлено: ${value}хв</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_posture') {
    const settings = await getUserSettings(chatId);
    const newPosture = settings?.posture === 'outside' ? 'inside' : 'outside';
    await saveUserSettings(chatId, { posture: newPosture });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    const label = newPosture === 'outside' ? '🚶 Надворі' : '🏠 Вдома';
    await tgAnswerCallback(callbackQuery.id, label);
    const msg = `<b>✅ Режим змінено: ${label}</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  // === Advanced Settings ===

  if (data === 'cb_adv_settings') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🔧 Розширені налаштування</b>\n\nТут можна налаштувати додаткові параметри сповіщень.`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_quiet') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const qhOn = settings?.quiet_hours_start && settings?.quiet_hours_end;
    const msg = `<b>🔕 Тихі години</b>\n\nОберіть час ПОЧАТКУ тихих годин.\nЗараз: ${qhOn ? settings.quiet_hours_start + '-' + settings.quiet_hours_end : 'Вимкнено'}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: quietHoursKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_qh_start_')) {
    const startHour = parseInt(data.replace('cb_qh_start_', ''));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🔕 Тихі години</b>\n\nПочаток: <b>${startHour.toString().padStart(2,'0')}:00</b>\nОберіть час КІНЦЯ:`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: quietHoursEndKeyboard(uLang, startHour) });
    return;
  }

  if (data.startsWith('cb_qh_end_')) {
    const parts = data.replace('cb_qh_end_', '').split('_');
    const startHour = parseInt(parts[0]);
    const endHour = parseInt(parts[1]);
    const startStr = startHour.toString().padStart(2,'0') + ':00';
    const endStr = endHour.toString().padStart(2,'0') + ':00';
    await saveUserSettings(chatId, { quiet_hours_start: startStr, quiet_hours_end: endStr });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `${startStr}-${endStr}`);
    const msg = `<b>✅ Тихі години: ${startStr} - ${endStr}</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_qh_off') {
    await saveUserSettings(chatId, { quiet_hours_start: null, quiet_hours_end: null });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, 'Тихі години вимкнено');
    const msg = `<b>✅ Тихі години вимкнено</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_wind') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💨 Поріг вітру</b>\n\nАлерт коли вітер перевищує значення.\nЗараз: ${settings?.wind_threshold_kmh ? '>'+settings.wind_threshold_kmh+'км/год' : 'Вимкнено'}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: windThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_wind_')) {
    const val = parseInt(data.replace('cb_set_wind_', ''));
    await saveUserSettings(chatId, { wind_threshold_kmh: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? 'Вимкнено' : `>${val}км/год`);
    const msg = val === 0 ? `<b>✅ Вітер: вимкнено</b>` : `<b>✅ Вітер: >${val}км/год</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_humidity') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💧 Поріг вологості</b>\n\nАлерт коли вологість перевищує значення.\nЗараз: ${settings?.humidity_threshold_pct ? '>'+settings.humidity_threshold_pct+'%' : 'Вимкнено'}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: humidityThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_hum_')) {
    const val = parseInt(data.replace('cb_set_hum_', ''));
    await saveUserSettings(chatId, { humidity_threshold_pct: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? 'Вимкнено' : `>${val}%`);
    const msg = val === 0 ? `<b>✅ Вологість: вимкнено</b>` : `<b>✅ Вологість: >${val}%</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_temp') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌡 Поріг температури</b>\n\nАлерт коли температура нижче значення.\nЗараз: ${settings?.temp_threshold_c != null ? '<'+settings.temp_threshold_c+'°C' : 'Вимкнено'}`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: tempThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_temp_')) {
    const val = parseInt(data.replace('cb_set_temp_', ''));
    await saveUserSettings(chatId, { temp_threshold_c: val === 999 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 999 ? 'Вимкнено' : `<${val}°C`);
    const msg = val === 999 ? `<b>✅ Температура: вимкнено</b>` : `<b>✅ Температура: <${val}°C</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_rain_levels') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌩 Рівні дощу</b>\n\nОберіть які типи опадів викликатимуть сповіщення:`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, settings) });
    return;
  }

  const toggleRainLevel = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? 'Вимкнено' : 'Увімкнено');
    const msg = `<b>🌩 Рівні дощу</b>\n\nОберіть які типи опадів викликатимуть сповіщення:`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, updated) });
  };

  if (data === 'cb_toggle_drizzle') { await toggleRainLevel('alert_drizzle'); return; }
  if (data === 'cb_toggle_light_rain') { await toggleRainLevel('alert_light_rain'); return; }
  if (data === 'cb_toggle_heavy_rain') { await toggleRainLevel('alert_heavy_rain'); return; }
  if (data === 'cb_toggle_thunderstorm') { await toggleRainLevel('alert_thunderstorm'); return; }

  if (data === 'cb_adv_sections') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>📊 Секції повідомлення</b>\n\nОберіть які секції показувати в повідомленні:`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, settings) });
    return;
  }

  const toggleSection = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? 'Приховано' : 'Показано');
    const msg = `<b>📊 Секції повідомлення</b>\n\nОберіть які секції показувати:`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, updated) });
  };

  if (data === 'cb_toggle_current') { await toggleSection('show_current'); return; }
  if (data === 'cb_toggle_minutely') { await toggleSection('show_minutely'); return; }
  if (data === 'cb_toggle_hourly') { await toggleSection('show_hourly'); return; }
  if (data === 'cb_toggle_show_radar') { await toggleSection('show_radar'); return; }

  // === Multi-Location ===

  if (data === 'cb_adv_locations') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const locations = await getUserLocations(chatId);
    const msg = `<b>📍 Локації</b>\n\nУправління вашими локаціями.\n⭐ = поточна локація`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
    return;
  }

  if (data.startsWith('cb_loc_default_')) {
    const locId = parseInt(data.replace('cb_loc_default_', ''));
    await setDefaultLocation(chatId, locId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const locations = await getUserLocations(chatId);
    const loc = locations.find(l => l.id === locId);
    await saveUser(chatId, { latitude: loc.latitude, longitude: loc.longitude });
    await tgAnswerCallback(callbackQuery.id, `Локація: ${loc?.name}`);
    const msg = `<b>✅ Локацію змінено: ${loc?.name}</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
    return;
  }

  if (data.startsWith('cb_loc_delete_')) {
    const locId = parseInt(data.replace('cb_loc_delete_', ''));
    const locations = await getUserLocations(chatId);
    if (locations.length <= 1) {
      await tgAnswerCallback(callbackQuery.id, 'Неможливо видалити останню локацію', true);
      return;
    }
    const loc = locations.find(l => l.id === locId);
    await deleteUserLocation(chatId, locId);
    if (loc?.is_default) {
      const remaining = locations.filter(l => l.id !== locId);
      if (remaining.length > 0) {
        await setDefaultLocation(chatId, remaining[0].id);
        await saveUser(chatId, { latitude: remaining[0].latitude, longitude: remaining[0].longitude });
      }
    }
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedLocations = await getUserLocations(chatId);
    await tgAnswerCallback(callbackQuery.id, `Видалено: ${loc?.name}`);
    const msg = `<b>🗑 Локацію "${loc?.name}" видалено</b>`;
    await tgEditMessage(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, updatedLocations) });
    return;
  }

  if (data === 'cb_loc_add') {
    pendingCallbacks[chatId] = { action: 'location_name', messageId };
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgSendMessage(chatId, '📍 Надішліть назву нової локації (напр. "Робота"):', {
      reply_markup: {
        keyboard: [[{ text: '📍 Надіслати геолокацію', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    await tgSendMessage(chatId, 'Або введіть назву текстом:', {
      reply_markup: { inline_keyboard: [[{ text: '◀ Назад', callback_data: 'cb_adv_locations' }]] },
    });
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

  if (text === '/inside') {
    await saveUserSettings(chatId, { posture: 'inside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await tgSendMessage(chatId, '🏠 Режим: <b>Вдома</b>\n\nПоради з урахуванням того, що ви вдома.', { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/outside') {
    await saveUserSettings(chatId, { posture: 'outside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await tgSendMessage(chatId, '🚶 Режим: <b>Надворі</b>\n\nПоради з урахуванням того, що ви надворі.', { reply_markup: mainMenuKeyboard(lang) });
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
    const settings = await getUserSettings(chatId);
    const msg = formatWeatherMessage(weatherData, lang, settings);
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
    const settings = await getUserSettings(chatId);
    const msg = `<b>${t(lang, 'location_saved')}</b>\n\n${formatWeatherMessage(weatherData, lang, settings)}`;
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

  // Handle pending location name for multi-location
  if (pendingCallbacks[chatId]?.action === 'location_name') {
    // If user sends location directly (not a name), use default name
    if (message.location) {
      const lat = message.location.latitude;
      const lon = message.location.longitude;
      delete pendingCallbacks[chatId];
      await addUserLocation(chatId, 'Локація', lat, lon);
      const user = await getUser(chatId);
      const lang = user?.language || 'uk';
      const locations = await getUserLocations(chatId);
      await tgSendMessage(chatId, `✅ Локацію додано!`, {
        reply_markup: { remove_keyboard: true },
      });
      await tgSendMessage(chatId, `📍 Ваши локації:`, { reply_markup: locationsKeyboard(lang, locations) });
      return;
    }
    const locName = text?.trim();
    if (!locName || locName.length > 50) {
      await tgSendMessage(chatId, '❌ Назва занадто довга (макс 50 символів). Спробуйте ще:');
      return;
    }
    pendingCallbacks[chatId] = { action: 'location_coords', name: locName, messageId: pendingCallbacks[chatId].messageId };
    await tgSendMessage(chatId, `📍 Тепер надішліть геолокацію для "${locName}" або введіть координати:`, {
      reply_markup: {
        keyboard: [[{ text: '📍 Надіслати геолокацію', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    return;
  }

  // Handle pending location coordinates for multi-location
  if (pendingCallbacks[chatId]?.action === 'location_coords') {
    const { name } = pendingCallbacks[chatId];
    delete pendingCallbacks[chatId];

    let lat, lon;
    if (message.location) {
      lat = message.location.latitude;
      lon = message.location.longitude;
    } else if (text) {
      const parts = text.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lon = parts[1];
      }
    }

    if (lat == null || lon == null) {
      await tgSendMessage(chatId, '❌ Невірний формат. Надішліть геолокацію або координати (49.825,23.951):', {
        reply_markup: {
          keyboard: [[{ text: '📍 Надіслати геолокацію', request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }

    await addUserLocation(chatId, name, lat, lon);
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    const locations = await getUserLocations(chatId);
    await tgSendMessage(chatId, `✅ Локацію "${name}" додано!`, {
      reply_markup: { remove_keyboard: true },
    });
    await tgSendMessage(chatId, `📍 Ваши локації:`, { reply_markup: locationsKeyboard(lang, locations) });
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
      const settings = await getUserSettings(user.chat_id);
      const msg = formatWeatherMessage(weatherData, lang, settings);
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
      const settings = await getUserSettings(user.chat_id);
      const weatherData = await getRainForecast(user.latitude, user.longitude, user.chat_id);
      const lang = user.language || 'uk';

      // Quiet hours check
      if (settings?.quiet_hours_start && settings?.quiet_hours_end) {
        const now = new Date();
        const [sh, sm] = settings.quiet_hours_start.split(':').map(Number);
        const [eh, em] = settings.quiet_hours_end.split(':').map(Number);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        let inQuiet = false;
        if (startMin <= endMin) {
          inQuiet = nowMin >= startMin && nowMin < endMin;
        } else {
          inQuiet = nowMin >= startMin || nowMin < endMin;
        }
        if (inQuiet) continue;
      }

      const lookaheadMs = (settings?.lookahead_min || 30) * 60 * 1000;
      const threshold = settings?.rain_threshold_mm || 0.5;
      const cooldownMs = (settings?.alert_cooldown_min || 30) * 60 * 1000;

      const rainSoon = weatherData.minutely?.some(m =>
        m.ms > weatherData.nowLocalMs &&
        m.ms < weatherData.nowLocalMs + lookaheadMs &&
        m.precip_mm >= threshold
      );
      let needsRainAlert = weatherData.isRaining || rainSoon;

      // Additional threshold checks
      if (needsRainAlert && weatherData.current) {
        if (settings?.wind_threshold_kmh && weatherData.current.wind_speed < settings.wind_threshold_kmh) {
          needsRainAlert = false;
        }
        if (settings?.humidity_threshold_pct && weatherData.current.humidity < settings.humidity_threshold_pct) {
          needsRainAlert = false;
        }
        if (settings?.temp_threshold_c != null && weatherData.current.temp_c > settings.temp_threshold_c) {
          needsRainAlert = false;
        }
      }

      // Debounce: check if rain state changed from last check
      const wasRaining = user.last_rain_state || false;
      const rainTransition = needsRainAlert && !wasRaining;

      // Update rain state
      await saveUser(user.chat_id, { last_rain_state: needsRainAlert });

      const msg = formatWeatherMessage(weatherData, lang, settings);

      // ALWAYS edit existing message (silent update, like /update)
      if (user.last_message_id) {
        const editResult = await tgEditMessage(user.chat_id, user.last_message_id, msg, {
          reply_markup: mainMenuKeyboard(lang),
        });
        if (editResult.ok) edited++;
      }

      // Send NEW message ONLY on rain transition (triggers notification)
      // Uses per-user cooldown from settings
      const lastAlert = user.last_alert_time || 0;
      if (rainTransition && Date.now() - lastAlert > cooldownMs) {
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
