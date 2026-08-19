# Rain Alert Bot

Telegram bot that warns users when rain is approaching.

## Features
- Multi-API weather fallback: WeatherAPI → OpenWeatherMap → Rainbow Weather → Open-Meteo
- Hourly forecast monitoring with targeted minute-by-minute nowcast
- Free tier compatible (0$ total cost)
- Auto-alerts every 30 minutes via cron

## Setup
1. Set environment variables:
   - `TELEGRAM_BOT_TOKEN` - Telegram bot token
   - `WEATHERAPI_KEY` - WeatherAPI.com key
   - `OWM_KEY` - OpenWeatherMap key
   - `RAINBOW_KEY` - Rainbow Weather key

2. Deploy to PandaStack:
   ```
   npx @pandastack/cli login
   npx @pandastack/cli deploy
   ```

3. Set webhook:
   ```
   curl -X POST https://YOUR_APP.pandastack.app/setup-webhook
   ```

4. Configure cron for 30-minute weather checks.

## License
MIT
