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

- Zero npm dependencies — тільки вбудовані модулі Node.js
- Supabase REST API для зберігання (users, settings, api_keys, locations)
- Деплой на PandaStack (free tier), auto-deploy з GitHub
- Self-ping кожні 5 хв проти scale-to-zero

## 🚀 Швидкий старт

```bash
git clone https://github.com/dneese/rain-alert-bot.git
cd rain-alert-bot
TELEGRAM_BOT_TOKEN=your_token node server.js
```

Деплой на PandaStack:

```bash
npx @pandastack/cli deploy
curl -X POST https://YOUR_APP.pandastack.app/setup-webhook
```

Cron для перевірок (кожні 10 хв): `GET /check`

## Ліцензія

MIT
