import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id BIGINT PRIMARY KEY,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      enabled BOOLEAN DEFAULT true,
      last_alert_time BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database initialized');
}

export async function getUser(chatId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  return rows[0] || null;
}

export async function saveUser(chatId, data) {
  const existing = await getUser(chatId);
  if (existing) {
    const fields = [];
    const values = [];
    let i = 1;
    for (const [key, val] of Object.entries(data)) {
      if (key === 'chat_id') continue;
      fields.push(`${key} = $${i}`);
      values.push(val);
      i++;
    }
    values.push(chatId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE chat_id = $${i}`, values);
  } else {
    const cols = ['chat_id', ...Object.keys(data)];
    const vals = [chatId, ...Object.values(data)];
    const placeholders = cols.map((_, idx) => `$${idx + 1}`);
    await pool.query(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      vals
    );
  }
}

export async function getAllUsers() {
  const { rows } = await pool.query('SELECT * FROM users WHERE enabled = true');
  return rows;
}
