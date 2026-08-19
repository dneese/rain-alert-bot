import { readFileSync, writeFileSync, existsSync } from 'fs';
import https from 'https';

const TGCLOUD_TOKEN = process.env.TGCLOUD_TOKEN;
const DB_FILE = './users.json';

async function fetchServerlessUsers() {
  if (!TGCLOUD_TOKEN) {
    console.log('TGCLOUD_TOKEN not set, skipping sync');
    return null;
  }

  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${TGCLOUD_TOKEN}/getUpdates`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const existing = existsSync(DB_FILE)
    ? JSON.parse(readFileSync(DB_FILE, 'utf-8'))
    : { users: {} };

  console.log(`Current users: ${Object.keys(existing.users).length}`);

  writeFileSync(DB_FILE, JSON.stringify(existing, null, 2));
}

main().catch(console.error);
