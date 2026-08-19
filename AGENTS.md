# Rain Alert Bot

Telegram bot that alerts users when rain is approaching their location.

## Architecture

- **Telegram Serverless**: Collects user geolocation, stores in DB
- **GitHub Actions cron** (every hour): Checks weather for all users, sends alerts
- **Open-Meteo API**: Free weather API (no key needed)

## Commands

- `/start` - Welcome message + request location
- `/check` - Check weather for saved location
- `/stop` - Disable alerts

## Deployment

1. Enable Serverless in @BotFather
2. `npx tgcloud login` - paste CLI access token
3. `npx tgcloud push` - deploy code
4. `npx tgcloud migrate` - create database table
5. Push to GitHub
6. Add `TELEGRAM_BOT_TOKEN` secret to GitHub repo

## Environment Variables

- `TELEGRAM_BOT_TOKEN` - Bot API token
- `TGCLOUD_TOKEN` - Serverless CLI token (for sync-users.js)
