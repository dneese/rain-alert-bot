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

async function tgAnswerCallback(callbackQueryId, text = '', showAlert = false) {
  return tgApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

async function tgSetWebhook(url) {
  return tgApi('setWebhook', { url, allowed_updates: ['message', 'callback_query'] });
}

// === Rich Message helpers (Bot API 10.1+) with plain-HTML fallback ===
// InputRichMessage contract: rich_message must be { html } or { markdown }, never both.
let richEnabled = true; // latched off on permanent capability errors
async function tgSendRichMessage(chatId, html, options = {}) {
  return tgApi('sendRichMessage', { chat_id: chatId, rich_message: { html }, ...options });
}

async function tgEditRichMessage(chatId, messageId, html, options = {}) {
  return tgApi('editMessageText', { chat_id: chatId, message_id: messageId, rich_message: { html }, ...options });
}

async function sendWithFallback(chatId, richHtml, options = {}, plainHtml = null) {
  if (richEnabled) {
    try {
      const r = await tgSendRichMessage(chatId, richHtml, options);
      if (r?.ok) return r;
      if (r && r.error_code === 404) richEnabled = false; // endpoint not available
    } catch (e) {}
  }
  return tgSendMessage(chatId, plainHtml || richHtml, options);
}

async function editWithFallback(chatId, messageId, richHtml, options = {}, plainHtml = null) {
  if (richEnabled) {
    try {
      const r = await tgEditRichMessage(chatId, messageId, richHtml, options);
      if (r?.ok) return r;
      if (r && r.error_code === 404) richEnabled = false; // endpoint not available
    } catch (e) {}
  }
  return tgEditMessage(chatId, messageId, plainHtml || richHtml, options);
}

// === Keyboards ===
const SUPPORTED_LANGS = ['uk', 'en', 'ru', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'cs', 'sk', 'ro', 'hu', 'bg', 'hr', 'tr', 'ar', 'he', 'zh', 'ja', 'ko'];

function mainMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'btn_location'), callback_data: 'cb_location' },
        { text: t(lang, 'btn_check'), callback_data: 'cb_check' },
      ],
      [
        { text: `↻ ${t(lang, 'btn_refresh')}`, callback_data: 'cb_update' },
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

function languageKeyboard(page = 0, lang = 'uk') {
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

  rows.push([{ text: t(lang, 'btn_back'), callback_data: 'cb_settings' }]);
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
        { text: `🌧 ${t(lang, 'set_rain_threshold')}: ${s.rain_threshold_mm || 0.5}${t(lang, 'unit_mm')}`, callback_data: 'cb_settings_threshold' },
      ],
      [
        { text: `⏱ ${t(lang, 'set_lookahead')}: ${s.lookahead_min || 30}${t(lang, 'unit_min')}`, callback_data: 'cb_settings_lookahead' },
      ],
      [
        { text: `${radarLabel}`, callback_data: 'cb_settings_radar' },
      ],
      [
        { text: `⏰ ${t(lang, 'set_cooldown')}: ${s.alert_cooldown_min || 30}${t(lang, 'unit_min')}`, callback_data: 'cb_settings_cooldown' },
      ],
      [
        { text: `${s.posture === 'outside' ? '🚶' : '🏠'} ${t(lang, 'set_mode')}: ${s.posture === 'outside' ? t(lang, 'mode_outside') : t(lang, 'mode_inside')}`, callback_data: 'cb_settings_posture' },
      ],
      [
        { text: `🔧 ${t(lang, 'set_advanced') || 'Розширені'}`, callback_data: 'cb_adv_settings' },
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
  const earlyWarnH = s.early_warn_hours ? Number(s.early_warn_hours) : 0;
  return {
    inline_keyboard: [
      [{ text: `🔔 ${t(lang, 'set_early_warn')}: ${earlyWarnH ? t(lang, 'early_warn_hours', { hours: earlyWarnH }) : t(lang, 'off')}`, callback_data: 'cb_adv_earlywarn' }],
      [{ text: `🔕 ${t(lang, 'set_quiet_hours')}: ${qhOn ? s.quiet_hours_start + '-' + s.quiet_hours_end : t(lang, 'off')}`, callback_data: 'cb_adv_quiet' }],
      [{ text: `💨 ${t(lang, 'set_wind_threshold')}: ${windOn ? '>'+s.wind_threshold_kmh+'км/год' : t(lang, 'off')}`, callback_data: 'cb_adv_wind' }],
      [{ text: `💧 ${t(lang, 'set_humidity_threshold')}: ${humOn ? '>'+s.humidity_threshold_pct+'%' : t(lang, 'off')}`, callback_data: 'cb_adv_humidity' }],
      [{ text: `🌡 ${t(lang, 'set_temp_threshold')}: ${tempOn ? '<'+s.temp_threshold_c+'°C' : t(lang, 'off')}`, callback_data: 'cb_adv_temp' }],
      [{ text: `🌩 ${t(lang, 'set_rain_levels')}`, callback_data: 'cb_adv_rain_levels' }],
      [{ text: `📊 ${t(lang, 'set_sections')}`, callback_data: 'cb_adv_sections' }],
      [{ text: `📍 ${t(lang, 'set_locations')}`, callback_data: 'cb_adv_locations' }],
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
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_qh_off' }],
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
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_wind_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function humidityThresholdKeyboard(lang) {
  const options = [60, 70, 75, 80, 85, 90];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `>${v}%`, callback_data: `cb_set_hum_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_hum_0' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function tempThresholdKeyboard(lang) {
  const options = [0, 5, 10, 15, 20, 25, 30];
  return {
    inline_keyboard: [
      options.map(v => ({ text: `<${v}°C`, callback_data: `cb_set_temp_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_temp_999' }],
      [{ text: t(lang, 'btn_back'), callback_data: 'cb_adv_settings' }],
    ],
  };
}

function earlyWarnKeyboard(lang, settings) {
  const s = settings || {};
  const options = [3, 6, 12, 24, 48];
  return {
    inline_keyboard: [
      options.map(v => ({ text: t(lang, 'early_warn_hours', { hours: v }), callback_data: `cb_set_earlywarn_${v}` })),
      [{ text: t(lang, 'btn_disable'), callback_data: 'cb_set_earlywarn_0' }],
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
  rows.push([{ text: t(lang, 'btn_add_location'), callback_data: 'cb_loc_add' }]);
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
  75: { desc: 'Heavy snow', icon: '❄️', rain: true, severe: true },
  77: { desc: 'Snow grains', icon: '❄️', rain: true },
  80: { desc: 'Slight showers', icon: '🌦', rain: true },
  81: { desc: 'Moderate showers', icon: '🌧', rain: true },
  82: { desc: 'Violent showers', icon: '🌧', rain: true, severe: true },
  85: { desc: 'Slight snow showers', icon: '🌨', rain: true },
  86: { desc: 'Heavy snow showers', icon: '🌨', rain: true, severe: true },
  95: { desc: 'Thunderstorm', icon: '⛈', rain: true, severe: true },
  96: { desc: 'Thunderstorm with hail', icon: '⛈', rain: true, severe: true },
  99: { desc: 'Thunderstorm with heavy hail', icon: '⛈', rain: true, severe: true },
};

// Open-Meteo: current + minutely_15 + hourly in ONE call
async function fetchOpenMeteoFull(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&minutely_15=precipitation,precipitation_probability&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=3`;
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
      wmo_code: data.hourly.weather_code[i],
    }))
    .filter(h => h.ms >= nowLocalMs);

  const daily = data.daily ? {
    sunrise: data.daily.sunrise?.[0] || null,
    sunset: data.daily.sunset?.[0] || null,
    tmax: data.daily.temperature_2m_max?.[0] ?? null,
    tmin: data.daily.temperature_2m_min?.[0] ?? null,
    precip_sum: data.daily.precipitation_sum?.[0] ?? 0,
  } : null;

  return { current, minutely, hourly, daily, timezone: data.timezone, tzOffsetMs: tzOffsetSec * 1000, nowLocalMs };
}

// Open-Meteo Air Quality API: European AQI + UV index (+ pollen for Europe)
// Separate endpoint = separate free quota (10k/day), doesn't touch forecast limits
async function fetchAirQuality(lat, lon) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5,uv_index,grass_pollen,birch_pollen,alder_pollen&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AirQuality: ${res.status}`);
  const d = await res.json();
  const c = d.current || {};
  return {
    european_aqi: c.european_aqi,
    pm2_5: c.pm2_5,
    uv_index: c.uv_index,
    grass_pollen: c.grass_pollen,
    birch_pollen: c.birch_pollen,
    alder_pollen: c.alder_pollen,
  };
}

// MET Norway (api.met.no): free fallback source, no key needed, requires User-Agent.
// Used only when Open-Meteo is down. Display times are UTC in this degraded mode;
// alert logic stays correct because ms epochs are real UTC.
async function fetchMetNorway(lat, lon) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RainAlertBot/1.0 github.com/dneese/rain-alert-bot' } });
  if (!res.ok) throw new Error(`MET Norway: ${res.status}`);
  const d = await res.json();
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway: empty timeseries');
  const now = Date.now();

  let first = series[0];
  for (const s of series) {
    if (new Date(s.time).getTime() >= now - 30 * 60 * 1000) { first = s; break; }
  }
  const inst = first.data?.instant?.details || {};
  const next1 = first.data?.next_1_hours?.details || {};
  const current = {
    temp_c: inst.air_temperature ?? null,
    humidity: inst.relative_humidity ?? null,
    precipitation_mm: next1.precipitation_amount ?? 0,
    wind_speed: inst.wind_speed != null ? inst.wind_speed * 3.6 : null,
    weather_code: null,
    is_raining: (next1.precipitation_amount ?? 0) > 0.1,
    weather_icon: '🌧',
  };

  const pad = n => String(n).padStart(2, '0');
  const hourly = series
    .filter(s => new Date(s.time).getTime() >= now)
    .slice(0, 12)
    .map(s => {
      const dt = new Date(s.time);
      const n1h = s.data?.next_1_hours?.details || {};
      return {
        timeStr: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
        ms: dt.getTime(),
        probability: null,
        precip_mm: n1h.precipitation_amount ?? 0,
        temp_c: s.data?.instant?.details?.air_temperature ?? null,
        wmo_code: null,
      };
    });

  return { current, hourly };
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

  const zoom = 10;
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
      humidity: h.humidity,
      wind_kph: h.wind_kph,
    }));
}

async function fetchOWM(lat, lon, apiKey) {
  const key = apiKey || OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OWM: ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  return (data.list || [])
    .filter(item => item.dt * 1000 >= now - 3600000)
    .map(item => ({
      time: new Date(item.dt * 1000).toISOString().replace('.000Z', ''),
      ms: item.dt * 1000,
      probability: Math.round((item.pop || 0) * 100),
      precip_mm: item.rain?.['3h'] ? item.rain['3h'] / 3 : (item.snow?.['3h'] ? item.snow['3h'] / 3 : 0),
      temp_c: item.main?.temp ?? null,
      humidity: item.main?.humidity ?? null,
      wind_kph: item.wind?.speed ? item.wind.speed * 3.6 : null,
      description: item.weather?.[0]?.description || '',
      weather_id: item.weather?.[0]?.id ?? null,
    }));
}

async function fetchRainbowWeather(lat, lon, apiKey) {
  const key = apiKey || RAINBOW_KEY;
  if (!key) return null;
  const url = `https://api.rainbow.ai/weather/v1/one-call?lat=${lat}&lon=${lon}&unit=metric`;
  const res = await fetch(url, {
    headers: { 'x-api-key': key },
  });
  if (!res.ok) throw new Error(`Rainbow: ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const current = data.current || {};
  const hourly = (data.hourly || [])
    .filter(h => h.dt * 1000 >= now - 3600000)
    .map(h => ({
      time: new Date(h.dt * 1000).toISOString().replace('.000Z', ''),
      ms: h.dt * 1000,
      probability: Math.round((h.pop || 0) * 100),
      precip_mm: h.rain?.['1h'] || 0,
      temp_c: h.temp ?? null,
      humidity: h.humidity ?? null,
      wind_kph: h.wind_speed ? h.wind_speed * 3.6 : null,
      weather_id: h.weather?.[0]?.id ?? null,
    }));
  return {
    current: {
      temp_c: current.temp ?? null,
      humidity: current.humidity ?? null,
      precipitation_mm: current.rain?.['1h'] || 0,
      wind_speed: current.wind_speed ? current.wind_speed * 3.6 : null,
      weather_id: current.weather?.[0]?.id ?? null,
      is_raining: (current.rain?.['1h'] || 0) > 0.1,
    },
    hourly,
  };
}

async function getRainForecast(lat, lon, chatId) {
  let result = {
    current: null,
    minutely: [],
    forecast: [],
    daily: null,
    air: null,
    radar: { is_raining: false, intensity: 0 },
    source: 'none',
    isRaining: false,
    sourcesChecked: [],
    rainSignals: [],       // which independent sources report rain (dedup by provider name)
  };

  // === PHASE 1: Collect data from ALL sources ===

  // 1a. Open-Meteo: current + minutely_15 + hourly (PRIMARY - free, reliable)
  let openMeteoData = null;
  try {
    openMeteoData = await fetchOpenMeteoFull(lat, lon);
    result.current = openMeteoData.current;
    result.minutely = openMeteoData.minutely;
    result.forecast = openMeteoData.hourly;
    result.daily = openMeteoData.daily;
    result.source = 'Open-Meteo';
    result.nowLocalMs = openMeteoData.nowLocalMs;
    result.tzOffsetMs = openMeteoData.tzOffsetMs;
    result.sourcesChecked.push('Open-Meteo');
    if (openMeteoData.current.is_raining) {
      result.rainSignals.push('Open-Meteo-current');
    }
    console.log(`[RainCascade] Open-Meteo: current.is_raining=${openMeteoData.current.is_raining}, precip=${openMeteoData.current.precipitation_mm}mm, rain=${openMeteoData.current.rain_mm}mm, code=${openMeteoData.current.weather_code}`);
  } catch (e) {
    console.warn('Open-Meteo failed:', e.message);
  }

  // 1b. MET Norway: fallback when Open-Meteo is down
  if (!result.current) {
    try {
      const met = await fetchMetNorway(lat, lon);
      result.current = met.current;
      result.forecast = met.hourly;
      result.source = 'MET Norway';
      result.nowLocalMs = Date.now();
      result.tzOffsetMs = 0;
      result.sourcesChecked.push('MET Norway');
      if (met.current.is_raining) result.rainSignals.push('MET-current');
      console.log(`[RainCascade] MET Norway: current.is_raining=${met.current.is_raining}, precip=${met.current.precipitation_mm}mm`);
    } catch (e) {
      console.warn('MET Norway failed:', e.message);
    }
  }

  // 1c. Air quality + UV (separate free quota, non-critical)
  try {
    result.air = await fetchAirQuality(lat, lon);
  } catch (e) {
    console.warn('AirQuality failed:', e.message);
  }

  result.lat = lat;
  result.lon = lon;

  // 1d. Ensure nowLocalMs is set even if Open-Meteo failed
  if (!result.nowLocalMs) {
    result.nowLocalMs = Date.now();
    result.tzOffsetMs = 0;
  }

  // 2. RainViewer: real-time radar (FREE, no key) — INDEPENDENT source
  try {
    result.radar = await fetchRainViewer(lat, lon);
    if (result.radar.stale) console.warn('RainViewer radar data is stale');
    result.sourcesChecked.push('RainViewer');
    if (result.radar.is_raining && result.radar.intensity >= 3) {
      result.rainSignals.push('RainViewer-strong');
      console.log(`[RainCascade] RainViewer: strong rain, intensity=${result.radar.intensity}`);
    } else {
      console.log(`[RainCascade] RainViewer: weak/no rain, intensity=${result.radar.intensity}`);
    }
  } catch (e) {
    console.warn('RainViewer failed:', e.message);
  }

  // 3. Minutely_15: upcoming rain is "soon", handled by header. Do NOT flip "raining now".
  // Only counts as a vote if there is actual precipitation in the next 60 min.
  const next60minMs = result.nowLocalMs + 60 * 60 * 1000;
  const soonRain = result.minutely.some(m => m.ms > result.nowLocalMs && m.ms <= next60minMs && m.precip_mm > 0.1);
  if (soonRain) {
    result.rainSignals.push('Open-Meteo-minutely');
    console.log(`[RainCascade] Open-Meteo minutely: rain within 60 min`);
  }

  // 4. WeatherAPI/OWM/Rainbow: supplementary — ALWAYS check, not just when dry
  if (chatId) {
    const providers = [
      { name: 'weatherapi', fn: fetchWeatherAPI },
      { name: 'owm', fn: fetchOWM },
      { name: 'rainbow', fn: fetchRainbowWeather },
    ];
    for (const p of providers) {
      try {
        const key = await getUserApiKey(chatId, p.name);
        if (!key) continue;

        if (p.name === 'weatherapi') {
          const wa = await p.fn(lat, lon, key);
          if (wa) {
            result.sourcesChecked.push('WeatherAPI');
            const hasRain = wa.some(f => {
              const fMs = new Date(f.time.replace(' ', 'T') + 'Z').getTime() - (result.tzOffsetMs || 0);
              const diff = (fMs - result.nowLocalMs) / (1000 * 60);
              return diff <= 60 && diff >= -30 && f.precip_mm > 0.3;
            });
            if (hasRain) {
              result.rainSignals.push('WeatherAPI');
              console.log(`[RainCascade] WeatherAPI: rain in +60/-30min window`);
            } else {
              console.log(`[RainCascade] WeatherAPI: no rain`);
            }
          }
        } else if (p.name === 'owm') {
          const owmData = await p.fn(lat, lon, key);
          if (owmData) {
            result.sourcesChecked.push('OWM');
            const hasRain = owmData.some(f => {
              const diff = (f.ms - result.nowLocalMs) / (1000 * 60);
              return diff <= 60 && diff >= -30 && f.precip_mm > 0.3;
            });
            if (hasRain) {
              result.rainSignals.push('OWM');
              console.log(`[RainCascade] OWM: rain in +60/-30min window`);
            } else {
              console.log(`[RainCascade] OWM: no rain`);
            }
          }
        } else if (p.name === 'rainbow') {
          const rb = await p.fn(lat, lon, key);
          if (rb) {
            result.sourcesChecked.push('Rainbow');
            if (rb.current?.is_raining) {
              result.rainSignals.push('Rainbow-current');
              console.log(`[RainCascade] Rainbow: rain detected (current)`);
            } else {
              const hasRainSoon = rb.hourly?.some(f => {
                const diff = (f.ms - result.nowLocalMs) / (1000 * 60);
                return diff <= 60 && diff >= -30 && f.precip_mm > 0.3;
              });
              if (hasRainSoon) {
                result.rainSignals.push('Rainbow');
                console.log(`[RainCascade] Rainbow: rain in forecast`);
              } else {
                console.log(`[RainCascade] Rainbow: no rain`);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`${p.name} failed:`, e.message);
      }
    }
  }

  // === PHASE 2: Form a consensus opinion ===
  // A single strong, real-time observation is enough by itself:
  //   - Open-Meteo / MET current (WMO code or measured precip) = measured rain now
  //   - Radar intensity >= 4 = heavy precipitation overhead right now
  // Otherwise require at least 2 INDEPENDENT sources agreeing on rain,
  // so one noisy forecast provider cannot trigger a false "it is raining now".
  const strongCurrent =
    result.rainSignals.includes('Open-Meteo-current') ||
    result.rainSignals.includes('MET-current') ||
    result.rainSignals.includes('RainViewer-strong');
  const independentVotes = new Set(result.rainSignals).size;

  if (strongCurrent) {
    result.isRaining = true;
  } else if (independentVotes >= 2) {
    result.isRaining = true;
  }

  console.log(`[RainCascade] FINAL: isRaining=${result.isRaining}, signals=[${result.rainSignals.join(', ')}], independentVotes=${independentVotes}, sources=[${result.sourcesChecked.join(', ')}]`);
  return result;
}

// === Weather Display ===
function getWeatherEmoji(probability, precipMm, wmoCode) {
  if (precipMm > 2) return '🌧';
  if (precipMm > 0.5) return '🌧';
  if (precipMm > 0.1) return '🌦';
  if (probability > 60) return '🌧';
  if (probability > 30) return '⛅';
  if (wmoCode != null && WMO_CODES[wmoCode]) return WMO_CODES[wmoCode].icon;
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
  const localeMap = { uk: 'uk-UA', en: 'en-US', ru: 'ru-RU', pl: 'pl-PL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL', cs: 'cs-CZ', sk: 'sk-SK', ro: 'ro-RO', hu: 'hu-HU', bg: 'bg-BG', hr: 'hr-HR', tr: 'tr-TR', ar: 'ar-SA', he: 'he-IL', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };
  const locale = localeMap[lang] || 'en-US';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}

function formatWeatherMessage(weatherData, lang, settings) {
  const { current, minutely, forecast, radar, source, isRaining, nowLocalMs, tzOffsetMs } = weatherData;

  const err = `⚠️ ${t(lang, 'error_no_forecast')}`;
  if (!current && (!forecast || forecast.length === 0)) {
    return { rich: err, plain: err };
  }

  const nowLocalDate = new Date(Date.now() + (tzOffsetMs || 0));
  const nowTimeStr = `${nowLocalDate.getUTCHours().toString().padStart(2, '0')}:${nowLocalDate.getUTCMinutes().toString().padStart(2, '0')}`;

  // ===== SHARED: header =====
  let headerText = '';
  if (isRaining) {
    const rainMm = current?.precipitation_mm || 0;
    headerText = rainMm > 3 ? `⚠️ ${t(lang, 'alert_strong_rain')}` : rainMm > 1 ? `🌧 ${t(lang, 'alert_rain')}` : `🌦 ${t(lang, 'alert_light_rain')}`;
  } else {
    const nextRain = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    if (nextRain) {
      headerText = `🌧 ${t(lang, 'alert_rain_in_minutes', { minutes: Math.round((nextRain.ms - nowLocalMs) / 60000) })}`;
    } else {
      const rainInForecast = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
      if (rainInForecast) {
        headerText = `🌧 ${t(lang, 'alert_rain_in_hours', { hours: Math.round((rainInForecast.ms - nowLocalMs) / 3600000) })}`;
      } else {
        headerText = t(lang, 'no_rain_header');
      }
    }
  }

  // ===== SHARED: current conditions =====
  let curMain = null;
  let curExtra = [];
  let radarLine = null;
  if (current && settings?.show_current !== false) {
    const rainIcon = current.is_raining ? '🌧' : current.weather_icon;
    curMain = [`${rainIcon} <b>${Math.round(current.temp_c)}°C</b>`, `💧 ${Math.round(current.humidity)}%`];
    curExtra = [`💨 ${Math.round(current.wind_speed)}${t(lang, 'unit_kmh')}`];
    if (current.precipitation_mm > 0) {
      curExtra.push(`🌧 ${current.precipitation_mm}${t(lang, 'unit_mm')}`);
    }
    if (radar?.is_raining && isRaining && settings?.show_radar !== false) {
      const radarDesc = ['', t(lang, 'radar_weak'), t(lang, 'radar_moderate'), t(lang, 'radar_strong'), t(lang, 'radar_very_strong'), t(lang, 'radar_extreme')];
      radarLine = `📡 ${t(lang, 'radar_label')}: ${radarDesc[radar.intensity] || t(lang, 'yes')} (${radar.ageMinutes || '?'}${t(lang, 'unit_min_ago')})`;
    }
  }

  // ===== SHARED: minutely rows =====
  let minRows = [];
  if (minutely && minutely.length > 0 && settings?.show_minutely !== false) {
    for (const m of minutely.slice(0, 8)) {
      const time = m.timeStr.split('T')[1];
      const emoji = m.precip_mm > 2 ? '🌧' : m.precip_mm > 0.1 ? '🌦' : '☀️';
      const bar = makePrecipBar(m.precip_mm);
      const precip = m.precip_mm > 0 ? ` ${m.precip_mm.toFixed(1)}${t(lang, 'unit_mm')}` : '';
      minRows.push(`${time} ${emoji} ${bar}${precip}`);
    }
  }

  // ===== SHARED: hourly groups =====
  const hourGroups = [];
  if (forecast && forecast.length > 0 && settings?.show_hourly !== false) {
    let lastDate = '';
    for (const h of forecast.slice(0, 8)) {
      const dateStr = formatDate(h.timeStr, lang, tzOffsetMs);
      if (dateStr !== lastDate) {
        hourGroups.push({ dateStr, rows: [] });
        lastDate = dateStr;
      }
      const time = h.timeStr.split('T')[1];
      const emoji = getWeatherEmoji(h.probability, h.precip_mm, h.wmo_code);
      const temp = h.temp_c !== null ? `${Math.round(h.temp_c)}°` : '--';
      const precip = h.precip_mm > 0 ? ` ${h.precip_mm.toFixed(1)}${t(lang, 'unit_mm')}` : '';
      hourGroups[hourGroups.length - 1].rows.push(`${time} ${emoji} ${h.probability != null ? String(h.probability).padStart(2) + '%' : '  ·'} ${String(temp).padStart(3)}${precip}`);
    }
  }

  // ===== SHARED: recommendation =====
  const posture = settings?.posture || 'inside';
  const isOutside = posture === 'outside';
  let recText = '';

  if (isRaining) {
    recText = isOutside ? t(lang, 'rec_rain_outside') : t(lang, 'rec_rain_inside');
  } else {
    const nextRainMinutely = minutely?.find(m => m.precip_mm > 0.1 && m.ms > nowLocalMs);
    const nextRainHourly = forecast?.find(f => f.precip_mm > 0.2 && f.ms > nowLocalMs);
    let rainETAms = null;
    if (nextRainMinutely) rainETAms = nextRainMinutely.ms;
    else if (nextRainHourly) rainETAms = nextRainHourly.ms;

    if (rainETAms) {
      const minsAway = Math.round((rainETAms - nowLocalMs) / 60000);
      const hoursAway = Math.round(minsAway / 60);
      let timeStr;
      if (minsAway < 60) {
        timeStr = t(lang, 'eta_minutes', { minutes: minsAway });
      } else if (hoursAway === 1) {
        timeStr = t(lang, 'eta_hour');
      } else {
        timeStr = t(lang, 'eta_hours', { hours: hoursAway });
      }

      if (minsAway <= 30) {
        recText = isOutside ? t(lang, 'rec_urgent_outside', { time: timeStr }) : t(lang, 'rec_urgent_inside', { time: timeStr });
      } else if (minsAway <= 120) {
        recText = isOutside ? t(lang, 'rec_moderate_outside', { time: timeStr }) : t(lang, 'rec_moderate_inside', { time: timeStr });
      } else {
        recText = isOutside ? t(lang, 'rec_far_outside', { time: timeStr }) : t(lang, 'rec_far_inside', { time: timeStr });
      }
    } else {
      recText = isOutside ? t(lang, 'rec_no_rain_outside') : t(lang, 'rec_no_rain_inside');
    }
  }
  const recEmoji = isRaining ? '⚠️' : (recText === (isOutside ? t(lang, 'rec_no_rain_outside') : t(lang, 'rec_no_rain_inside')) ? '✅' : '🟡');

  // ===== SHARED: severe weather warnings =====
  const hasSevereCurrent = current && WMO_CODES[current.weather_code]?.severe;
  const hasSevereForecast = forecast?.some(f => WMO_CODES[f.wmo_code]?.severe && f.ms > nowLocalMs && f.ms < nowLocalMs + (settings?.lookahead_min || 60) * 60 * 1000);
  const hasHailNow = current && (current.weather_code === 96 || current.weather_code === 99);
  const hasHailSoon = forecast?.some(f => (f.wmo_code === 96 || f.wmo_code === 99) && f.ms > nowLocalMs && f.ms < nowLocalMs + 120 * 60 * 1000);

  let severeWarn = false;
  let severeLines = [];
  if (hasSevereCurrent || hasSevereForecast || hasHailNow || hasHailSoon) {
    severeWarn = true;
    if (hasHailNow) {
      severeLines.push(`⛈ <b>${t(lang, 'severe_hail_now')}</b>`);
      severeLines.push(t(lang, 'severe_hail_shelter'));
    } else if (hasSevereCurrent) {
      const sevDesc = t(lang, 'wmo_' + current.weather_code) || WMO_CODES[current.weather_code]?.desc || '';
      severeLines.push(`⛈ <b>${sevDesc} ${t(lang, 'severe_now')}</b>`);
      severeLines.push(t(lang, 'severe_wait_shelter'));
    }
    if (hasHailSoon && !hasHailNow) {
      const hailTime = forecast.find(f => (f.wmo_code === 96 || f.wmo_code === 99) && f.ms > nowLocalMs);
      if (hailTime) {
        const hailMins = Math.round((hailTime.ms - nowLocalMs) / 60000);
        const hailHrs = Math.round(hailMins / 60);
        const hailETA = hailMins < 60 ? t(lang, 'eta_minutes', { minutes: hailMins }) : t(lang, 'eta_hours', { hours: hailHrs });
        severeLines.push(`⛈ <b>${t(lang, 'severe_hail_soon', { time: hailETA })}</b>`);
        severeLines.push(t(lang, 'severe_hail_prepare'));
      }
    } else if (hasSevereForecast && !hasSevereCurrent) {
      const sevTime = forecast.find(f => WMO_CODES[f.wmo_code]?.severe && f.ms > nowLocalMs);
      if (sevTime) {
        const sevMins = Math.round((sevTime.ms - nowLocalMs) / 60000);
        const sevHrs = Math.round(sevMins / 60);
        const sevETA = sevMins < 60 ? t(lang, 'eta_minutes', { minutes: sevMins }) : t(lang, 'eta_hours', { hours: sevHrs });
        severeLines.push(`⛈ <b>${t(lang, 'severe_storm_soon', { time: sevETA })}</b>`);
        severeLines.push(t(lang, 'severe_prepare_shelter'));
      }
    }
  }

  // ===== SHARED: footer =====
  const footerParts = [t(lang, 'updated_at', { time: nowTimeStr })];
  if (weatherData.sourcesChecked?.length) {
    footerParts.push(weatherData.sourcesChecked.join(' + '));
  } else if (source) {
    footerParts.push(source);
  }

  // ===== SHARED: daily sun times =====
  let dailyLine = null;
  if (weatherData.daily && settings?.show_daily !== false) {
    const hm = s => s ? s.split('T')[1].slice(0, 5) : '--:--';
    const d = weatherData.daily;
    dailyLine = `🌅 ${hm(d.sunrise)} · 🌇 ${hm(d.sunset)} · ⬆️${d.tmax != null ? Math.round(d.tmax) : '--'}° ⬇️${d.tmin != null ? Math.round(d.tmin) : '--'}°`;
  }

  // ===== SHARED: air quality + UV =====
  let aqLines = [];
  if (weatherData.air && settings?.show_air !== false) {
    const aq = weatherData.air;
    if (aq.european_aqi != null) {
      const bands = [[20, 'aqi_good', '🟢'], [40, 'aqi_moderate', '🟡'], [60, 'aqi_poor', '🟠'], [80, 'aqi_unhealthy', '🔴'], [100, 'aqi_very_unhealthy', '🟣'], [Infinity, 'aqi_hazardous', '☠️']];
      const b = bands.find(([lim]) => aq.european_aqi <= lim);
      if (b) aqLines.push(`🌿 ${t(lang, 'aqi_label')}: ${b[2]} ${t(lang, b[1])} (${Math.round(aq.european_aqi)})`);
    }
    if (aq.uv_index != null) {
      const uvIcons = [[3, '🟢'], [6, '🟡'], [8, '🟠'], [11, '🔴'], [Infinity, '🟣']];
      const uvB = uvIcons.find(([lim]) => aq.uv_index < lim);
      aqLines.push(`🕶 ${t(lang, 'uv_label')}: ${Math.round(aq.uv_index)} ${uvB[1]}`);
    }
  }

  // ===== RICH VERSION (Bot API 10.1+ Rich Messages) =====
  // Best practices: one clear heading, short summary, h3 sections,
  // table with caption for structured data, blockquote/aside for key statuses,
  // details for optional depth, map + footer as closing blocks.
  let rich = `<h2>${headerText}</h2>`;
  if (dailyLine) rich += `<p>${dailyLine}</p>`;
  if (curMain) {
    rich += `<table bordered striped><caption>📍 ${t(lang, 'current_label')}</caption>`;
    rich += `<tr><td>${curMain[0]}</td><td>${curMain[1]}</td></tr>`;
    rich += `<tr><td>${curExtra[0] || ''}</td><td>${curExtra[1] || ''}</td></tr>`;
    if (radarLine) rich += `<tr><td colspan="2">${radarLine}</td></tr>`;
    for (const l of aqLines) rich += `<tr><td colspan="2">${l}</td></tr>`;
    rich += `</table>`;
  } else {
    for (const l of aqLines) rich += `<p>${l}</p>`;
  }
  if (minRows.length) {
    rich += `<details><summary>⏱ ${t(lang, 'minutely_label')}</summary>` +
      `<pre>${minRows.join('\n')}</pre></details>`;
  }
  if (hourGroups.length) {
    let hr = '';
    for (const g of hourGroups) {
      hr += `<b>${g.dateStr}</b>\n` + g.rows.join('\n');
    }
    rich += `<details open><summary>🗓 ${t(lang, 'forecast_label')}</summary><pre>${hr.trimEnd()}</pre></details>`;
  }
  rich += `<blockquote>${recEmoji} ${recText}</blockquote>`;
  if (severeWarn) {
    rich += `<aside>🚨 <b>${t(lang, 'severe_title')}</b></aside>` +
      severeLines.map(l => `<p>${l}</p>`).join('');
  }
  if (weatherData.lat != null) {
    rich += `<tg-map lat="${Number(weatherData.lat).toFixed(4)}" long="${Number(weatherData.lon).toFixed(4)}" zoom="13"/>`;
  }
  rich += `<hr/><footer>${footerParts.join(' | ')}</footer>`;

  // ===== PLAIN VERSION (fallback for Telegram Web/X/macOS) =====
  let plain = `<b>${headerText}</b>`;
  if (dailyLine) plain += `\n${dailyLine}`;
  if (curMain) {
    plain += `\n\n📍 <b>${t(lang, 'current_label')}</b>\n${curMain[0]}  ${curMain[1]}\n${curExtra.join('   ')}`;
    if (radarLine) plain += `\n${radarLine}`;
  }
  for (const l of aqLines) {
    plain += `\n${l}`;
  }
  if (minRows.length) {
    plain += `\n\n⏱ <b>${t(lang, 'minutely_label')}</b>\n<pre>${minRows.join('\n')}</pre>`;
  }
  if (hourGroups.length) {
    let hr = '';
    for (const g of hourGroups) {
      hr += `<b>${g.dateStr}</b>\n` + g.rows.join('\n');
    }
    plain += `\n\n🗓 <b>${t(lang, 'forecast_label')}</b>\n<pre>${hr.trimEnd()}</pre>`;
  }
  plain += `\n\n<blockquote>${recEmoji} ${recText}</blockquote>`;
  if (severeWarn) {
    plain += `\n\n🚨 <b>${t(lang, 'severe_title')}</b>\n${severeLines.join('\n')}`;
  }
  plain += `\n\n<i>${footerParts.join(' · ')}</i>`;

  return { rich, plain };
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
    await sendWithFallback(chatId, t(lang, 'send_location_prompt'), {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  if (data === 'cb_check') {
    const u = await getUser(chatId);
    if (!u || !u.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(u.latitude, u.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const msg = formatWeatherMessage(weatherData, lang, settings);
    const result = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
    if (result.ok) {
      await saveUser(chatId, { last_message_id: result.result.message_id });
    }
    return;
  }

  if (data === 'cb_update') {
    const u = await getUser(chatId);
    if (!u || !u.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(u.latitude, u.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const msg = formatWeatherMessage(weatherData, lang, settings);
    if (messageId) {
      const r = await editWithFallback(chatId, messageId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
      if (!r.ok) {
        const s2 = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
        if (s2.ok) await saveUser(chatId, { last_message_id: s2.result.message_id });
      } else {
        await saveUser(chatId, { last_message_id: messageId });
      }
    }
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_updated'));
    return;
  }

  if (data === 'cb_settings' || data === 'cb_settings_detail') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const keys = await getAllUserApiKeys(chatId);
    const postureEmoji = settings?.posture === 'outside' ? '🚶' : '🏠';
    const msg = `<b>${t(uLang, 'settings_title')}</b>\n\n` +
      `🌧 ${t(uLang, 'set_rain_threshold')}: <b>${settings?.rain_threshold_mm || 0.5}${t(uLang, 'unit_mm')}</b>\n` +
      `⏱ ${t(uLang, 'set_lookahead')}: <b>${settings?.lookahead_min || 30}${t(uLang, 'unit_min')}</b>\n` +
      `📡 ${t(uLang, 'set_radar')}: <b>${settings?.radar_enabled !== false ? t(uLang, 'on') : t(uLang, 'off')}</b>\n` +
      `⏰ ${t(uLang, 'set_cooldown')}: <b>${settings?.alert_cooldown_min || 30}${t(uLang, 'unit_min')}</b>\n` +
      `${postureEmoji} ${t(uLang, 'set_mode')}: <b>${settings?.posture === 'outside' ? t(uLang, 'mode_outside') : t(uLang, 'mode_inside')}</b>\n\n` +
      `🌐 ${t(uLang, 'language_label')}: ${getLangFlag(uLang)} ${getLangName(uLang)}\n` +
      `🔑 ${t(uLang, 'api_keys_label')}: ${keys.length}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_settings_threshold') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_threshold'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🌧 ${t(uLang, 'set_rain_threshold')}</b>\n\n${t(uLang, 'set_threshold_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.rain_threshold_mm || 0.5}${t(uLang, 'unit_mm')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_threshold_')) {
    const value = parseFloat(data.replace('cb_set_threshold_', ''));
    await saveUserSettings(chatId, { rain_threshold_mm: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'toast_threshold_set')}: ${value}`);
    const msg = `<b>${t(lang, 'settings_threshold_set', { value })}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: thresholdKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_lookahead') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_lookahead'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏱ ${t(uLang, 'set_lookahead')}</b>\n\n${t(uLang, 'set_lookahead_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.lookahead_min || 30}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_lookahead_')) {
    const value = parseInt(data.replace('cb_set_lookahead_', ''));
    await saveUserSettings(chatId, { lookahead_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'settings_lookahead_set')}: ${value}`);
    const msg = `<b>${t(lang, 'settings_lookahead_set', { value })}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: lookaheadKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_radar') {
    const settings = await getUserSettings(chatId);
    const newEnabled = settings?.radar_enabled === false;
    await saveUserSettings(chatId, { radar_enabled: newEnabled });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, newEnabled ? t(lang, 'toast_radar_on') : t(lang, 'toast_radar_off'));
    const msg = `<b>⚙️ ${t(uLang, 'set_radar')}</b>\n\n${t(uLang, 'set_radar_desc')}.\n${t(uLang, 'current_label')}: <b>${newEnabled ? t(uLang, 'on') : t(uLang, 'off')}</b>\n\n${t(uLang, 'btn_back')}.`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  if (data === 'cb_settings_cooldown') {
    await tgAnswerCallback(callbackQuery.id, t(lang, 'toast_select_cooldown'));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>⏰ ${t(uLang, 'set_cooldown')}</b>\n\n${t(uLang, 'set_cooldown_desc')}.\n${t(uLang, 'current_label')}: <b>${settings?.alert_cooldown_min || 30}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_cooldown_')) {
    const value = parseInt(data.replace('cb_set_cooldown_', ''));
    await saveUserSettings(chatId, { alert_cooldown_min: value });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await tgAnswerCallback(callbackQuery.id, `${t(lang, 'toast_select_cooldown')}: ${value}`);
    const msg = `<b>✅ ${t(uLang, 'set_cooldown')}: ${value}${t(uLang, 'unit_min')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: cooldownKeyboard(uLang) });
    return;
  }

  if (data === 'cb_settings_posture') {
    const settings = await getUserSettings(chatId);
    const newPosture = settings?.posture === 'outside' ? 'inside' : 'outside';
    await saveUserSettings(chatId, { posture: newPosture });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updatedSettings = await getUserSettings(chatId);
    const label = newPosture === 'outside' ? `${t(uLang, 'mode_outside')}` : `${t(uLang, 'mode_inside')}`;
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'toast_mode_changed')}: ${label}`);
    const msg = `<b>✅ ${t(uLang, 'toast_mode_changed')}: ${label}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsDetailKeyboard(uLang, updatedSettings) });
    return;
  }

  // === Advanced Settings ===

  if (data === 'cb_adv_settings') {
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    const msg = `<b>🔧 ${t(uLang, 'set_advanced')}</b>\n\n${t(uLang, 'set_posture_desc')}.`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_quiet') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const qhOn = settings?.quiet_hours_start && settings?.quiet_hours_end;
    const msg = `<b>🔕 ${t(uLang, 'set_quiet_hours')}</b>\n\n${t(uLang, 'set_quiet_hours_desc')}.\n${t(uLang, 'current_label')}: ${qhOn ? settings.quiet_hours_start + '-' + settings.quiet_hours_end : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: quietHoursKeyboard(uLang) });
    return;
  }

  if (data === 'cb_adv_earlywarn') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🔔 ${t(uLang, 'set_early_warn')}</b>\n\n${t(uLang, 'set_early_warn_desc')}.`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: earlyWarnKeyboard(uLang, settings) });
    return;
  }

  if (data.startsWith('cb_set_earlywarn_')) {
    const val = parseInt(data.replace('cb_set_earlywarn_', ''));
    await saveUserSettings(chatId, { early_warn_hours: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : t(uLang, 'early_warn_hours', { hours: val }));
    const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_early_warn')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_early_warn')}: ${t(uLang, 'early_warn_hours', { hours: val })}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data.startsWith('cb_qh_start_')) {
    const startHour = parseInt(data.replace('cb_qh_start_', ''));
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🔕 ${t(uLang, 'set_quiet_hours')}</b>\n\n${t(uLang, 'current_label')}: <b>${startHour.toString().padStart(2,'0')}:00</b>\n${t(uLang, 'set_quiet_hours_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: quietHoursEndKeyboard(uLang, startHour) });
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
    const msg = `<b>✅ ${t(uLang, 'set_quiet_hours')}: ${startStr} - ${endStr}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_qh_off') {
    await saveUserSettings(chatId, { quiet_hours_start: null, quiet_hours_end: null });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, t(uLang, 'off'));
    const msg = `<b>✅ ${t(uLang, 'set_quiet_hours')}: ${t(uLang, 'off')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_wind') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💨 ${t(uLang, 'set_wind_threshold')}</b>\n\n${t(uLang, 'set_wind_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.wind_threshold_kmh ? '>'+settings.wind_threshold_kmh+t(uLang, 'unit_kmh') : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: windThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_wind_')) {
    const val = parseInt(data.replace('cb_set_wind_', ''));
    await saveUserSettings(chatId, { wind_threshold_kmh: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : `>${val}${t(uLang, 'unit_kmh')}`);
    const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_wind_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_wind_threshold')}: >${val}${t(uLang, 'unit_kmh')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_humidity') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>💧 ${t(uLang, 'set_humidity_threshold')}</b>\n\n${t(uLang, 'set_humidity_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.humidity_threshold_pct ? '>'+settings.humidity_threshold_pct+'%' : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: humidityThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_hum_')) {
    const val = parseInt(data.replace('cb_set_hum_', ''));
    await saveUserSettings(chatId, { humidity_threshold_pct: val === 0 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 0 ? t(uLang, 'off') : `>${val}%`);
    const msg = val === 0 ? `<b>✅ ${t(uLang, 'set_humidity_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_humidity_threshold')}: >${val}%</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_temp') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌡 ${t(uLang, 'set_temp_threshold')}</b>\n\n${t(uLang, 'set_temp_threshold_desc')}.\n${t(uLang, 'current_label')}: ${settings?.temp_threshold_c != null ? '<'+settings.temp_threshold_c+'°C' : t(uLang, 'off')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: tempThresholdKeyboard(uLang) });
    return;
  }

  if (data.startsWith('cb_set_temp_')) {
    const val = parseInt(data.replace('cb_set_temp_', ''));
    await saveUserSettings(chatId, { temp_threshold_c: val === 999 ? null : val });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const settings = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, val === 999 ? t(uLang, 'off') : `<${val}°C`);
    const msg = val === 999 ? `<b>✅ ${t(uLang, 'set_temp_threshold')}: ${t(uLang, 'off')}</b>` : `<b>✅ ${t(uLang, 'set_temp_threshold')}: <${val}°C</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: advancedSettingsKeyboard(uLang, settings) });
    return;
  }

  if (data === 'cb_adv_rain_levels') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>🌩 ${t(uLang, 'set_rain_levels')}</b>\n\n${t(uLang, 'set_rain_levels_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, settings) });
    return;
  }

  const toggleRainLevel = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? t(uLang, 'off') : t(uLang, 'on'));
    const msg = `<b>🌩 ${t(uLang, 'set_rain_levels')}</b>\n\n${t(uLang, 'set_rain_levels_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: rainLevelsKeyboard(uLang, updated) });
  };

  if (data === 'cb_toggle_drizzle') { await toggleRainLevel('alert_drizzle'); return; }
  if (data === 'cb_toggle_light_rain') { await toggleRainLevel('alert_light_rain'); return; }
  if (data === 'cb_toggle_heavy_rain') { await toggleRainLevel('alert_heavy_rain'); return; }
  if (data === 'cb_toggle_thunderstorm') { await toggleRainLevel('alert_thunderstorm'); return; }

  if (data === 'cb_adv_sections') {
    const settings = await getUserSettings(chatId);
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const msg = `<b>📊 ${t(uLang, 'set_sections')}</b>\n\n${t(uLang, 'set_sections_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, settings) });
    return;
  }

  const toggleSection = async (field) => {
    const settings = await getUserSettings(chatId);
    const current = settings?.[field] !== false;
    await saveUserSettings(chatId, { [field]: !current });
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    const updated = await getUserSettings(chatId);
    await tgAnswerCallback(callbackQuery.id, current ? t(uLang, 'btn_disable') : t(uLang, 'on'));
    const msg = `<b>📊 ${t(uLang, 'set_sections')}</b>\n\n${t(uLang, 'set_sections_desc')}:`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: sectionsKeyboard(uLang, updated) });
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
    const msg = `<b>📍 ${t(uLang, 'set_locations')}</b>\n\n${t(uLang, 'set_locations_desc')}.\n⭐ = ${t(uLang, 'current_label')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
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
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'location_set_default')}: ${loc?.name}`);
    const msg = `<b>✅ ${t(uLang, 'location_set_default')}: ${loc?.name}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, locations) });
    return;
  }

  if (data.startsWith('cb_loc_delete_')) {
    const locId = parseInt(data.replace('cb_loc_delete_', ''));
    const locations = await getUserLocations(chatId);
    if (locations.length <= 1) {
      const u = await getUser(chatId);
      const uLang = u?.language || 'uk';
      await tgAnswerCallback(callbackQuery.id, t(uLang, 'location_cannot_delete_last'), true);
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
    await tgAnswerCallback(callbackQuery.id, `${t(uLang, 'location_deleted')}: ${loc?.name}`);
    const msg = `<b>🗑 ${t(uLang, 'location_deleted')}: "${loc?.name}"</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: locationsKeyboard(uLang, updatedLocations) });
    return;
  }

  if (data === 'cb_loc_add') {
    pendingCallbacks[chatId] = { action: 'location_name', messageId };
    const u = await getUser(chatId);
    const uLang = u?.language || 'uk';
    await sendWithFallback(chatId, `📍 ${t(uLang, 'location_name_prompt')}:`, {
      reply_markup: {
        keyboard: [[{ text: `📍 ${t(uLang, 'send_geolocation')}`, request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    await sendWithFallback(chatId, `${t(uLang, 'location_add_prompt')}:`, {
      reply_markup: { inline_keyboard: [[{ text: t(uLang, 'btn_back'), callback_data: 'cb_adv_locations' }]] },
    });
    return;
  }

  if (data === 'cb_api_keys') {
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    const msg = `<b>${t(lang, 'api_keys_title')}</b>\n\n${t(lang, 'api_keys_desc')}\n\n${t(lang, 'api_register_hint')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
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
      await sendWithFallback(chatId, `${t(lang, 'api_key_deleted')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    } else {
      pendingCallbacks[chatId] = { action: 'api_key', provider, messageId };
      await sendWithFallback(chatId, t(lang, 'api_enter_key', { provider: providerName }), {
        reply_markup: confirmKeyKeyboard(lang, provider),
      });
    }
    return;
  }

  if (data === 'cb_lang') {
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: languageKeyboard(0, lang) });
    return;
  }

  if (data.startsWith('cb_lang_page_')) {
    const page = parseInt(data.replace('cb_lang_page_', ''));
    const msg = `<b>${t(lang, 'language_title')}</b>`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: languageKeyboard(page, lang) });
    return;
  }

  if (data.startsWith('cb_lang_') && !data.startsWith('cb_lang_page_')) {
    const newLang = data.replace('cb_lang_', '');
    await saveUser(chatId, { language: newLang });
    const msg = `<b>${t(newLang, 'settings_title')}</b>\n\n${t(newLang, 'settings_language_changed', { language: `${getLangFlag(newLang)} ${getLangName(newLang)}` })}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: settingsKeyboard(newLang) });
    return;
  }

  if (data === 'cb_back_main') {
    const msg = `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`;
    await editWithFallback(chatId, messageId, msg, { reply_markup: mainMenuKeyboard(lang) });
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
      const tgLang = (message.from?.language_code || '').split('-')[0];
      const lang = SUPPORTED_LANGS.includes(tgLang) ? tgLang : 'uk';
      await saveUser(chatId, { enabled: true, language: lang });
      user = await getUser(chatId);
    }
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId,
      `<b>${t(lang, 'welcome')}</b>\n\n${t(lang, 'subtitle')}`,
      { reply_markup: mainMenuKeyboard(lang) }
    );
    return;
  }

  if (text === '/stop') {
    await saveUser(chatId, { enabled: false });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'btn_stop') || t(lang, 'notifications_disabled'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/inside') {
    await saveUserSettings(chatId, { posture: 'inside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'mode_inside_msg'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/outside') {
    await saveUserSettings(chatId, { posture: 'outside' });
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    await sendWithFallback(chatId, t(lang, 'mode_outside_msg'), { reply_markup: mainMenuKeyboard(lang) });
    return;
  }

  if (text === '/check') {
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    if (!user || !user.latitude) {
      await sendWithFallback(chatId, t(lang, 'location_needed'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }
    const weatherData = await getRainForecast(user.latitude, user.longitude, chatId);
    const settings = await getUserSettings(chatId);
    const msg = formatWeatherMessage(weatherData, lang, settings);
    const result = await sendWithFallback(chatId, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
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
    const w = formatWeatherMessage(weatherData, lang, settings);
    const savedPrefix = `<b>${t(lang, 'location_saved')}</b>`;
    const result = await sendWithFallback(chatId, `${savedPrefix}\n\n${w.rich}`, { reply_markup: mainMenuKeyboard(lang) }, `${savedPrefix}\n\n${w.plain}`);
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
      await sendWithFallback(chatId, t(lang, 'api_key_too_short'), { reply_markup: mainMenuKeyboard(lang) });
      return;
    }

    await saveUserApiKey(chatId, provider, text.trim());
    const keys = await getAllUserApiKeys(chatId);
    const activeProviders = keys.map(k => k.provider);
    await sendWithFallback(chatId, `${t(lang, 'api_key_saved')} ${providerName}`, { reply_markup: apiKeysKeyboard(lang, activeProviders) });
    return;
  }

  // Handle pending location name for multi-location
  if (pendingCallbacks[chatId]?.action === 'location_name') {
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';
    if (message.location) {
      const lat = message.location.latitude;
      const lon = message.location.longitude;
      delete pendingCallbacks[chatId];
      await addUserLocation(chatId, t(lang, 'set_locations'), lat, lon);
      const locations = await getUserLocations(chatId);
      await sendWithFallback(chatId, t(lang, 'location_saved_success'), {
        reply_markup: { remove_keyboard: true },
      });
      await sendWithFallback(chatId, `${t(lang, 'your_locations')}`, { reply_markup: locationsKeyboard(lang, locations) });
      return;
    }
    const locName = text?.trim();
    if (!locName || locName.length > 50) {
      await sendWithFallback(chatId, t(lang, 'name_too_long'));
      return;
    }
    pendingCallbacks[chatId] = { action: 'location_coords', name: locName, messageId: pendingCallbacks[chatId].messageId };
    await sendWithFallback(chatId, `📍 ${t(lang, 'location_add_prompt')}: "${locName}"`, {
      reply_markup: {
        keyboard: [[{ text: `📍 ${t(lang, 'send_geolocation')}`, request_location: true }]],
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
    const user = await getUser(chatId);
    const lang = user?.language || 'uk';

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
      await sendWithFallback(chatId, `${t(lang, 'error_name_empty')}. ${t(lang, 'location_add_prompt')}:`, {
        reply_markup: {
          keyboard: [[{ text: `📍 ${t(lang, 'send_geolocation')}`, request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }

    await addUserLocation(chatId, name, lat, lon);
    const user2 = await getUser(chatId);
    const lang2 = user2?.language || 'uk';
    const locations = await getUserLocations(chatId);
    await sendWithFallback(chatId, `✅ ${t(lang2, 'location_saved_success')} "${name}"`, {
      reply_markup: { remove_keyboard: true },
    });
    await sendWithFallback(chatId, `${t(lang2, 'your_locations')}`, { reply_markup: locationsKeyboard(lang2, locations) });
    return;
  }

  const user = await getUser(chatId);
  const lang = user?.language || 'uk';
  await sendWithFallback(chatId, t(lang, 'send_location_prompt'), { reply_markup: mainMenuKeyboard(lang) });
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
      const result = await editWithFallback(user.chat_id, user.last_message_id, msg.rich, {
        reply_markup: mainMenuKeyboard(lang),
      }, msg.plain);
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
        const editResult = await editWithFallback(user.chat_id, user.last_message_id, msg.rich, {
          reply_markup: mainMenuKeyboard(lang),
        }, msg.plain);
        if (editResult.ok) edited++;
      }

      // Send NEW message ONLY on rain transition (triggers notification)
      // Uses per-user cooldown from settings
      const lastAlert = user.last_alert_time || 0;
      if (rainTransition && Date.now() - lastAlert > cooldownMs) {
        const sendResult = await sendWithFallback(user.chat_id, msg.rich, { reply_markup: mainMenuKeyboard(lang) }, msg.plain);
        if (sendResult.ok) {
          await saveUser(user.chat_id, {
            last_alert_time: Date.now(),
            last_message_id: sendResult.result.message_id,
          });
          alertsSent++;
        }
      }
      // Round up: advance warning for rain hours/days ahead (once per rain event)
      const earlyWarnH = Number(settings?.early_warn_hours) || 0;
      if (earlyWarnH > 0 && weatherData.forecast?.length) {
        const earlyWarnHorizon = weatherData.nowLocalMs + earlyWarnH * 3600 * 1000;
        const advanceGapMs = Math.max(lookaheadMs, 60 * 60 * 1000);
        let earliestRainStart = null;
        for (const h of weatherData.forecast) {
          if (h.ms > weatherData.nowLocalMs + advanceGapMs && h.ms <= earlyWarnHorizon && h.precip_mm >= threshold) {
            if (earliestRainStart === null || h.ms < earliestRainStart) earliestRainStart = h.ms;
          }
        }
        if (earliestRainStart) {
          const lastAdvanceWarn = Number(settings.last_advance_warn_ms) || 0;
          const alreadyWarned = lastAdvanceWarn > 0 && Math.abs(earliestRainStart - lastAdvanceWarn) < 30 * 60 * 1000;
          if (!alreadyWarned) {
            const advItem = weatherData.forecast.find(h => h.ms === earliestRainStart);
            const hoursAway = Math.round((earliestRainStart - weatherData.nowLocalMs) / 3600000);
            const advDate = formatDate(advItem.timeStr, lang, weatherData.tzOffsetMs);
            const advTime = formatTime(advItem.timeStr);
            const recAdv = settings?.posture === 'outside' ? t(lang, 'advance_rain_outside') : t(lang, 'advance_rain_inside');
            const advMsg = `<b>☔ ${t(lang, 'advance_rain_title')}</b>\n\n${t(lang, 'advance_rain_msg', { date: advDate, time: advTime, hours: hoursAway })}\n\n${recAdv}`;
            const advSend = await sendWithFallback(user.chat_id, advMsg, {});
            if (advSend.ok) {
              await saveUserSettings(user.chat_id, { last_advance_warn_ms: earliestRainStart });
              alertsSent++;
            }
          }
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

  // Anti-sleep: ping own /health every 5 min so PandaStack scale-to-zero keeps container awake
  const PUBLIC_URL = process.env.PUBLIC_URL || 'https://rain-alert-bot.pandastack.app';
  setInterval(() => {
    fetch(`${PUBLIC_URL}/health`).catch(() => {});
  }, 5 * 60 * 1000);
  console.log(`Self-ping enabled: ${PUBLIC_URL}`);
});
