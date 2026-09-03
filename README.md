# 🌧 Rain Alert Bot

[**🚀 Відкрити бота: @AlertRain_bot →**](https://t.me/AlertRain_bot)

Telegram-бот, який попереджає про дощ **до того**, як він почнеться. Радар + поточна погода + хвилинний прогноз, 22 мови, повністю безкоштовний.

## ✨ Можливості

- ⚡ **Проактивні сповіщення** — повідомляє про дощ за 15–120 хв до початку
- 📡 **RainViewer радар** — підтвердження опадів у реальному часі
- 🔀 **Каскад API з фолбеком**: Open-Meteo → MET Norway → WeatherAPI / OpenWeatherMap / Rainbow (ключі юзера)
- 💨 **Хвилинний прогноз (minutely_15)** — ASCII-графік опадів на 2 години
- 🌿 **Якість повітря + УФ-індекс** — European AQI з кольоровою шкалою
- 🌅 **Схід/захід сонця, мін/макс температури дня**
- 🎨 **Rich Messages** (Bot API 10.1) — заголовки, таблиці, collapsible-секції, вбудована карта; автоматичний fallback на звичайний HTML для старих клієнтів
- 🌍 **22 мови** з повним покриттям перекладів
- ⚙️ **Гнучкі налаштування**: поріг дощу, горизонт попередження, кулдаун, тихі години, режим «вдома/надворі», свої API-ключі
- 📍 **Мультилокація** — декілька точок з переключенням
- ↻ **Кнопка оновлення** прямо під повідомленням
- 🛡 **Шторм/град попередження завжди працюють**, незалежно від налаштувань

## 🏗 Архітектура

- Zero npm dependencies — тільки вбудовані модулі Node.js (+ `pg` для прямого підключення, опційно)
- Supabase REST API для зберігання (users, settings, api_keys, locations)
- Деплой на PandaStack (free tier), auto-deploy з GitHub
- Self-ping кожні 5 хв проти scale-to-zero

---

## 🚀 Швидкий старт

### 1. Створіть Telegram-бота

1. Відкрийте [@BotFather](https://t.me/BotFather) у Telegram.
2. Надішліть `/newbot`, вкажіть ім'я та username.
3. Скопіюйте токен у форматі `123456789:AA...` — знадобиться у змінній `TELEGRAM_BOT_TOKEN`.

### 2. Налаштуйте Supabase (база даних)

1. Зареєструйтесь на [supabase.com](https://supabase.com) і створіть проєкт.
2. Відкрийте **SQL Editor** та виконайте скрипти. Спочатку базові таблиці:

```sql
-- users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT UNIQUE NOT NULL,
  latitude DECIMAL(10, 6),
  longitude DECIMAL(10, 6),
  username TEXT,
  language TEXT DEFAULT 'uk',
  enabled BOOLEAN DEFAULT true,
  last_message_id BIGINT,
  posture VARCHAR(10) DEFAULT 'inside',
  last_rain_state BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- user_api_keys
CREATE TABLE IF NOT EXISTS user_api_keys (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  provider TEXT NOT NULL,       -- weatherapi | owm | rainbow
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, provider)
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations" ON user_api_keys FOR ALL USING (true) WITH CHECK (true);

-- user_settings
CREATE TABLE IF NOT EXISTS user_settings (
  chat_id BIGINT PRIMARY KEY,
  rain_threshold_mm NUMERIC(4,2) DEFAULT 0.5,
  lookahead_min INTEGER DEFAULT 30,
  radar_enabled BOOLEAN DEFAULT true,
  alert_cooldown_min INTEGER DEFAULT 30,
  posture VARCHAR(10) DEFAULT 'inside',
  units VARCHAR(10) DEFAULT 'metric',
  quiet_hours_start VARCHAR(5),
  quiet_hours_end VARCHAR(5),
  wind_threshold_kmh NUMERIC(5,1),
  humidity_threshold_pct INTEGER,
  temp_threshold_c NUMERIC(4,1),
  alert_drizzle BOOLEAN DEFAULT true,
  alert_light_rain BOOLEAN DEFAULT true,
  alert_heavy_rain BOOLEAN DEFAULT true,
  alert_thunderstorm BOOLEAN DEFAULT true,
  show_minutely BOOLEAN DEFAULT true,
  show_hourly BOOLEAN DEFAULT true,
  show_current BOOLEAN DEFAULT true,
  show_radar BOOLEAN DEFAULT true,
  show_air BOOLEAN DEFAULT true,
  show_daily BOOLEAN DEFAULT true,
  early_warn_hours INTEGER,
  last_advance_warn_ms BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- user_locations
CREATE TABLE IF NOT EXISTS user_locations (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  name VARCHAR(50) NOT NULL DEFAULT 'Дім',
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_locations_chat_id ON user_locations(chat_id);
```

3. У розділі **Settings → API** знайдіть:
   - `Project URL` → це `SUPABASE_URL`
   - ключ `anon`/`publishable` та `secret`/`service_role` → це `SUPABASE_ANON_KEY` та `SUPABASE_SECRET_KEY`
   - `JWT JWKS URL` → це `SUPABASE_JWKS_URL`

### 3. Змінні середовища (env)

Повний список змінних, які розуміє бот:

| Змінна | Обов'язкова | Опис |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота від @BotFather |
| `SUPABASE_URL` | ✅ | Адреса проєкту Supabase (https://xxx.supabase.co) |
| `SUPABASE_SECRET_KEY` / `SUPABASE_ANON_KEY` | ✅ | Ключ доступу (secret або anon) |
| `PORT` | ❌ | Порт HTTP (за замовчуванням `3000`) |
| `PUBLIC_URL` | ❌ | Публічна URL-адреса застосунку для self-ping (зобов'язана бути реальним робочим URL!) |
| `WEATHERAPI_KEY` | ❌ | Ключ WeatherAPI.com (запасне джерело) |
| `OWM_KEY` | ❌ | Ключ OpenWeatherMap (запасне джерело) |
| `RAINBOW_KEY` | ❌ | Ключ Rainbow Weather (запасне джерело) |

> ⚠️ **`RAINBOW_KEY`**: у Rainbow є Primary та Secondary ключі — **вони взаємозамінні**, можете використовувати обидва. Рекомендуємо вставити Primary, а Secondary тримати як резерв.

### 4. Локальний запуск

```bash
git clone https://github.com/dneese/rain-alert-bot.git
cd rain-alert-bot
npm install

# на Linux/macOS
TELEGRAM_BOT_TOKEN=your_token \
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SECRET_KEY=your_secret_key \
node server.js

# на Windows (PowerShell)
$env:TELEGRAM_BOT_TOKEN="your_token"
$env:SUPABASE_URL="https://xxx.supabase.co"
$env:SUPABASE_SECRET_KEY="your_secret_key"
node server.js
```

Бот підніметься на `http://localhost:3000`.

### 5. Деплой на PandaStack

**Варіант А — з Git (recommended, авто-деплой):**
1. Створіть проєкт у [dashboard.pandastack.io](https://dashboard.pandastack.io).
2. Підключіть GitHub-репозиторій `dneese/rain-alert-bot` (гілка `master`).
3. Вкажіть `start command`: `node server.js`, порт: `3000`.
4. Додайте всі змінні з таблиці вище у **Environment Variables**.
5. Після деплою дізнайтесь **публічний URL** застосунку (видається автоматично, вигляд `https://xxxx.pandastack.ai/`).

**Варіант Б — через CLI:**
```bash
npx @pandastack/cli deploy   # або panda deploy
```

### 6. Налаштування вебхука Telegram

Після успішного деплою (важливо — на **актуальному** публічному URL):

```bash
# Замініть URL на реальну адресу ВАШОГО застосунку!
curl -X POST -d '' "https://YOUR-APP.pandastack.ai/setup-webhook"
```

Або встановіть webhook напряму через Telegram Bot API:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://YOUR-APP.pandastack.ai/webhook&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D"
```

Перевірка:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

> ⚠️ Якщо бот мовчить — перевірте `getWebhookInfo`: URL має збігатися з **поточним** робочим URL застосунку (після передеплою URL може змінитися!). При оновленні застосунку обов'язково пересетапwebhook.

### 7. Cron для перевірок (сповіщення про дощ)

Щоб бот активно сповіщав про дощ, налаштуйте зовнішній cron-джоб (наприклад, [cron-job.org](https://cron-job.org), [UptimeRobot](https://uptimerobot.com) або рідний cron на сервері), який викликає:

```
GET https://YOUR-APP.pandastack.ai/check
```

кожні **10 хвилин**. Також доступні:
- `GET /health` — перевірка здоров'я
- `GET /update` — примусове оновлення всіх користувачів

### 8. Анти-сон (щоб бот не засинав на free tier)

PandaStack на free тарифі за замовчуванням припиняє застосунок після ~15 хв бездіяльності (`auto_hibernate`). Щоб бот працював постійно:

1. У налаштуваннях застосунку PandaStack вимкніть **Auto-hibernate** (`auto_hibernate: false`) — доступно на free.
2. Переконайтеся, що `PUBLIC_URL` вказує на **реальний** робочий URL застосунку (з `https://`), щоб вбудований self-ping кожні 5 хв коректно тримав застосунок "несплячим".

---

## 🔌 Ендпоінти HTTP

| Метод | Шлях | Призначення |
|---|---|---|
| POST | `/webhook` | Приймає оновлення від Telegram |
| GET | `/health` | Перевірка здоров'я (self-ping) |
| GET | `/check` | Перевірка всіх користувачів на дощ (cron) |
| GET | `/update` | Примусове оновлення користувачів |
| POST | `/setup-webhook` | Встановлює webhook Telegram на поточний URL |

## 🗄 Деплой локально без Supabase (опційно)

Якщо не хочете використовувати Supabase хмару, можна підняти власний PostgreSQL та замінити логіку в `lib/db.js` (використовує Supabase REST API). Для прямого підключення `pg` вже є в залежностях.

---

## 📄 Ліцензія

MIT
