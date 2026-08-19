import { readFileSync, writeFileSync, existsSync } from 'fs';
import https from 'https';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_FILE = './users.json';

function loadUsers() {
  if (!existsSync(DB_FILE)) {
    writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
}

function saveUsers(data) {
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function fetchWeather(lat, lon) {
  return new Promise((resolve, reject) => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,temperature_2m&timezone=auto&forecast_days=1`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function sendTelegramMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
  }

  const db = loadUsers();
  const now = new Date();
  const currentHour = now.getHours();
  let alertsSent = 0;

  for (const [chatId, user] of Object.entries(db.users)) {
    if (!user.enabled) continue;
    if (user.lastAlertHour !== undefined && Math.abs(currentHour - user.lastAlertHour) < 3) continue;

    try {
      const weather = await fetchWeather(user.latitude, user.longitude);
      const times = weather.hourly.time;
      const probs = weather.hourly.precipitation_probability;
      const precips = weather.hourly.precipitation;

      let rainDetected = false;
      let rainInfo = '';

      for (let i = currentHour; i < Math.min(currentHour + 6, times.length); i++) {
        if (probs[i] > 50) {
          rainDetected = true;
          const time = new Date(times[i]);
          const h = time.getHours().toString().padStart(2, '0');
          rainInfo += `${h}:00 - ${probs[i]}% chance, ${precips[i]}mm\n`;
        }
      }

      if (rainDetected) {
        await sendTelegramMessage(chatId,
          `<b>Rain Alert!</b>\n\nRain expected soon:\n${rainInfo}\nTake an umbrella!`
        );
        db.users[chatId].lastAlertHour = currentHour;
        alertsSent++;
      }
    } catch (err) {
      console.error(`Error for ${chatId}:`, err.message);
    }
  }

  saveUsers(db);
  console.log(`Done. ${alertsSent} alerts sent.`);
}

main().catch(console.error);
