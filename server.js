import { createServer } from 'http';
import { initDB, getUser, saveUser, getAllUsers, getUserApiKey, getAllUserApiKeys, saveUserApiKey, deleteUserApiKey } from './lib/db.js';
import { t, getLangName, getLangFlag, languagePages } from './lib/i18n.js';

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

async function fetchOWMNowcast(lat, lon, apiKey) {
  const key = apiKey || OWM_KEY;
  if (!key) return null;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=hourly,daily,alerts&appid=${key}&units=metric`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OWM: ${res.status}`);
  const data = await res.json();
  if (!data.minutely) return [];
  return data.minutely.map(m => ({
    time: new Date(m.dt * 1000).toISOString(),
    probability: m.precipitation > 0 ? 100 : 0,
    precip_mm: m.precipitation,
    temp_c: null,
  }));
}

async function fetchRainbowNowcast(lat, lon, apiKey) {
  const key = apiKey || RAINBOW_KEY;
  if (!key) return null;
  const url = `https://api.rainbow.ai/nowcast/v1/precip/${lon}/${lat}`;
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`Rainbow: ${res.status}`);
  const data = await res.json();
  if (!data.forecast) return [];
  return data.forecast.map(f => ({
    time: new Date(f.timestampBegin * 1000).toISOString(),
    probability: f.precipRate > 0 ? 100 : 0,
    precip_mm: f.precipRate,
    temp_c: null,
  }));
}

async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
  const data = await res.json();
  const now = new Date();
  return data.hourly.time
    .map((t, i) => ({
      time: t,
      probability: data.hourly.precipitation_probability[i],
      precip_mm: data.hourly.precipitation[i],
      temp_c: data.hourly.temperature_2m[i],
      wind_speed: data.hourly.wind_speed_10m[i],
    }))
    .filter(h => new Date(h.time) >= now);
}

async function getRainForecast(lat, lon, chatId) {
  let forecast = [];
  let source = 'none';

  const userKeys = {};
  if (chatId) {
    const providers = ['weatherapi', 'owm', 'rainbow'];
    for (const p of providers) {
      const key = await getUserApiKey(chatId, p);
      if (key) userKeys[p] = key;
    }
  }

  try {
    forecast = await fetchWeatherAPI(lat, lon, userKeys.weatherapi);
    source = 'WeatherAPI';
  } catch (e) {
    console.warn('WeatherAPI failed:', e.message);
  }

  const rainSoon = forecast?.some(f => {
    const diff = (new Date(f.time) - new Date()) / (1000 * 60);
    return diff <= 120 && f.probability > 50;
  });

  if (rainSoon) {
    try {
      const nowcast = await fetchOWMNowcast(lat, lon, userKeys.owm);
      if (nowcast?.length > 0) { forecast = nowcast; source = 'OpenWeatherMap'; }
    } catch (e) {
      console.warn('OWM failed:', e.message);
      try {
        const nowcast = await fetchRainbowNowcast(lat, lon, userKeys.rainbow);
        if (nowcast?.length > 0) { forecast = nowcast; source = 'Rainbow'; }
      } catch (e2) {
        console.warn('Rainbow failed:', e2.message);
      }
    }
  }

  if (!forecast || forecast.length === 0) {
    try {
      forecast = await fetchOpenMeteo(lat, lon);
      source = 'Open-Meteo';
    } catch (e) {
      console.warn('Open-Meteo failed:', e.message);
    }
  }

  return { forecast: forecast || [], source };
}

// === Weather Display ===
function getWeatherEmoji(probability, precipMm) {
  if (precipMm > 2) return '🌧';
  if (probability > 60) return '🌧';
  if (probability > 30) return '🌤';
  return '☀️';
}

function makeRainBar(probability) {
  const filled = Math.round(probability / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDate(isoStr, lang) {
  const d = new Date(isoStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return t(lang, 'date_today');
  if (d.toDateString() === tomorrow.toDateString()) return t(lang, 'date_tomorrow');
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

function formatWeatherMessage(forecast, lang, source) {
  if (!forecast || forecast.length === 0) {
    return `<b>${t(lang, 'error_no_forecast')}</b>`;
  }

  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  const rainSoon = forecast.filter(f => {
    const d = new Date(f.time);
    return d >= now && d <= twoHoursFromNow && f.probability > 50;
  });

  const rainLater = forecast.filter(f => {
    const d = new Date(f.time);
    return d > twoHoursFromNow && d <= sixHoursFromNow && f.probability > 40;
  });

  const header = rainSoon.length > 0
    ? `<b>${t(lang, 'rain_coming', { minutes: Math.round((new Date(rainSoon[0].time) - now) / 60000) })}</b>`
    : rainLater.length > 0
    ? `<b>${t(lang, 'rain_alert_title')}</b>`
    : `<b>${t(lang, 'no_rain_header')}</b>`;

  let msg = header + '\n\n';

  const displayHours = forecast.slice(0, 12);
  let lastDate = '';

  for (const h of displayHours) {
    const dateStr = formatDate(h.time, lang);
    if (dateStr !== lastDate) {
      msg += `<b>${dateStr}</b>\n`;
      lastDate = dateStr;
    }

    const time = formatTime(h.time);
    const emoji = getWeatherEmoji(h.probability, h.precip_mm);
    const bar = makeRainBar(h.probability);
    const temp = h.temp_c !== null && h.temp_c !== undefined ? `${Math.round(h.temp_c)}°` : '--';
    const precip = h.precip_mm > 0 ? `${h.precip_mm.toFixed(1)}мм` : '';

    msg += `<code>${time}  ${emoji} ${bar}  ${h.probability}%  ${temp}</code>`;
    if (precip) msg += ` <i>${precip}</i>`;
    msg += '\n';
  }

  const currentTemp = forecast[0]?.temp_c;
  const currentWind = forecast[0]?.wind_speed;
  if (currentTemp !== null && currentTemp !== undefined) {
    msg += `\n${t(lang, 'temp_now', { temp: Math.round(currentTemp) })}`;
  }
  if (currentWind !== null && currentWind !== undefined) {
    msg += `\n${t(lang, 'wind_now', { speed: Math.round(currentWind) })}`;
  }

  if (rainSoon.length > 0 || rainLater.length > 0) {
    msg += `\n\n${t(lang, 'recommendation_umbrella')}`;
  } else {
    msg += `\n\n${t(lang, 'recommendation_no_rain')}`;
  }

  const nowTime = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  msg += `\n\n${t(lang, 'updated_at', { time: nowTime })}`;
  msg += `\n<i>${source}</i>`;

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
    const { forecast, source } = await getRainForecast(u.latitude, u.longitude, chatId);
    const msg = formatWeatherMessage(forecast, lang, source);
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
    const { forecast, source } = await getRainForecast(user.latitude, user.longitude, chatId);
    const msg = formatWeatherMessage(forecast, lang, source);
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
    const { forecast, source } = await getRainForecast(message.location.latitude, message.location.longitude, chatId);
    const msg = `<b>${t(lang, 'location_saved')}</b>\n\n${formatWeatherMessage(forecast, lang, source)}`;
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
      const { forecast, source } = await getRainForecast(user.latitude, user.longitude, user.chat_id);
      const lang = user.language || 'uk';
      const msg = formatWeatherMessage(forecast, lang, source);
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

// === Cron Check (send new alerts only when rain imminent) ===
async function checkAllUsers() {
  const users = await getAllUsers();
  let alertsSent = 0;

  for (const user of users) {
    if (!user.latitude) continue;
    if (user.last_alert_time && Date.now() - user.last_alert_time < 2 * 60 * 60 * 1000) continue;

    try {
      const { forecast, source } = await getRainForecast(user.latitude, user.longitude, user.chat_id);
      const lang = user.language || 'uk';

      const rainSoon = forecast.filter(f => {
        const diff = (new Date(f.time) - new Date()) / (1000 * 60);
        return diff <= 60 && f.probability > 60;
      });

      if (rainSoon.length > 0) {
        const msg = formatWeatherMessage(forecast, lang, source);
        const result = await tgSendMessage(user.chat_id, msg, { reply_markup: mainMenuKeyboard(lang) });
        if (result.ok) {
          await saveUser(user.chat_id, {
            last_alert_time: Date.now(),
            last_message_id: result.result.message_id,
          });
          alertsSent++;
        }
      }
    } catch (err) {
      console.error(`Check error for ${user.chat_id}:`, err.message);
    }
  }
  return alertsSent;
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
      const alertsSent = await checkAllUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, alertsSent }));
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
