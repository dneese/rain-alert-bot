import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY;
const OWM_KEY = process.env.OWM_KEY;
const RAINBOW_KEY = process.env.RAINBOW_KEY;
const DB_FILE = join(__dirname, 'users.json');

// === Database ===
function loadUsers() {
  if (!existsSync(DB_FILE)) {
    saveUsers({ users: {} });
  }
  return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
}

function saveUsers(data) {
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(chatId) {
  const db = loadUsers();
  return db.users[chatId] || null;
}

function saveUser(chatId, userData) {
  const db = loadUsers();
  db.users[chatId] = { ...db.users[chatId], ...userData, chatId };
  saveUsers(db);
}

function getAllUsers() {
  const db = loadUsers();
  return Object.values(db.users);
}

// === Telegram API ===
async function tgSendMessage(chatId, text, options = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options }),
  });
  return res.json();
}

async function tgSetWebhook(url) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message'] }),
  });
  return res.json();
}

// === Weather APIs ===
async function fetchWeatherAPI(lat, lon) {
  if (!WEATHERAPI_KEY) return null;
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${lat},${lon}&days=2&alerts=yes`;
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

async function fetchOWMNowcast(lat, lon) {
  if (!OWM_KEY) return null;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=hourly,daily,alerts&appid=${OWM_KEY}&units=metric`;
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

async function fetchRainbowNowcast(lat, lon) {
  if (!RAINBOW_KEY) return null;
  const url = `https://api.rainbow.ai/nowcast/v1/precip/${lon}/${lat}`;
  const res = await fetch(url, { headers: { 'x-api-key': RAINBOW_KEY } });
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
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,temperature_2m&timezone=auto&forecast_days=2`;
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
    }))
    .filter(h => new Date(h.time) >= now);
}

async function getRainForecast(lat, lon) {
  let forecast = [];
  let source = 'none';

  try {
    forecast = await fetchWeatherAPI(lat, lon);
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
      const nowcast = await fetchOWMNowcast(lat, lon);
      if (nowcast?.length > 0) { forecast = nowcast; source = 'OpenWeatherMap'; }
    } catch (e) {
      console.warn('OWM failed:', e.message);
      try {
        const nowcast = await fetchRainbowNowcast(lat, lon);
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

function formatRainAlert(forecast, source) {
  if (!forecast || forecast.length === 0) return 'Could not fetch weather data.';
  const rainHours = forecast.filter(f => f.probability > 40);

  if (rainHours.length === 0) {
    const temp = forecast[0]?.temp_c;
    return `No rain expected in the next few hours.${temp !== null ? `\nCurrent: ${temp}°C` : ''}`;
  }

  let msg = `Rain Alert!\n\nRain expected at:\n`;
  for (const r of rainHours.slice(0, 5)) {
    const time = new Date(r.time);
    const h = time.getHours().toString().padStart(2, '0');
    const m = time.getMinutes().toString().padStart(2, '0');
    msg += `${h}:${m} - ${r.probability}% chance, ${r.precip_mm}mm\n`;
  }
  if (rainHours[0]?.temp_c !== null) {
    msg += `\nTemperature: ${rainHours[0].temp_c}°C`;
  }
  msg += `\nDon't forget your umbrella!`;
  return msg;
}

// === Message Handler ===
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start') {
    await tgSendMessage(chatId,
      `Rain Alert Bot\n\n` +
      `I'll warn you when rain is approaching!\n\n` +
      `Send me your location to get started.\n\n` +
      `Commands:\n` +
      `/check - check weather now\n` +
      `/stop - stop alerts\n` +
      `/start - show this message`
    );
    return;
  }

  if (text === '/stop') {
    saveUser(chatId, { enabled: false });
    await tgSendMessage(chatId, 'Alerts disabled. Send /start to re-enable.');
    return;
  }

  if (text === '/check') {
    const user = getUser(chatId);
    if (!user || !user.latitude) {
      await tgSendMessage(chatId, 'Send me your location first!');
      return;
    }
    const { forecast, source } = await getRainForecast(user.latitude, user.longitude);
    const msg = formatRainAlert(forecast, source);
    await tgSendMessage(chatId, msg);
    return;
  }

  if (message.location) {
    saveUser(chatId, {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      enabled: true,
    });
    const { forecast, source } = await getRainForecast(message.location.latitude, message.location.longitude);
    const msg = formatRainAlert(forecast, source);
    await tgSendMessage(chatId, `Location saved!\n\n${msg}`);
    return;
  }

  await tgSendMessage(chatId, 'Send me your location or type /start');
}

// === Cron Check ===
async function checkAllUsers() {
  const users = getAllUsers();
  let alertsSent = 0;

  for (const user of users) {
    if (!user.enabled || !user.latitude) continue;
    if (user.lastAlertTime && Date.now() - user.lastAlertTime < 2 * 60 * 60 * 1000) continue;

    try {
      const { forecast } = await getRainForecast(user.latitude, user.longitude);
      const rainSoon = forecast.some(f => {
        const diff = (new Date(f.time) - new Date()) / (1000 * 60);
        return diff <= 60 && f.probability > 60;
      });

      if (rainSoon) {
        const msg = formatRainAlert(forecast, 'auto');
        await tgSendMessage(user.chatId, msg);
        saveUser(user.chatId, { lastAlertTime: Date.now() });
        alertsSent++;
      }
    } catch (err) {
      console.error(`Error for ${user.chatId}:`, err.message);
    }
  }
  return alertsSent;
}

// === HTTP Server ===
const server = createServer(async (req, res) => {
  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', bot: 'rain-alert-bot' }));
  }

  // Telegram webhook
  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const update = JSON.parse(body);
      if (update.message) await handleMessage(update.message);
    } catch (err) {
      console.error('Webhook error:', err);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Cron check endpoint
  if (req.url === '/check') {
    const alertsSent = await checkAllUsers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, alertsSent }));
  }

  // Setup webhook
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

server.listen(PORT, () => {
  console.log(`Rain Alert Bot running on port ${PORT}`);
});
