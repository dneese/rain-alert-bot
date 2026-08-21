const SUPABASE_URL = 'https://ljavyrmgcepwximavjyz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
  if (!res.ok) throw new Error(`Supabase GET: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPost(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase POST: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase PATCH: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function initDB() {
  console.log('Database: using Supabase REST API');
}

export async function getUser(chatId) {
  const rows = await supaGet('users', `chat_id=eq.${chatId}&select=*`);
  return rows[0] || null;
}

export async function saveUser(chatId, data) {
  const existing = await getUser(chatId);
  if (existing) {
    await supaPatch('users', `chat_id=eq.${chatId}`, data);
  } else {
    await supaPost('users', { chat_id: chatId, ...data });
  }
}

export async function getAllUsers() {
  return supaGet('users', 'enabled=eq.true&select=*');
}

export async function getUserApiKey(chatId, provider) {
  const rows = await supaGet('user_api_keys', `chat_id=eq.${chatId}&provider=eq.${provider}&select=api_key`);
  return rows[0]?.api_key || null;
}

export async function getAllUserApiKeys(chatId) {
  const rows = await supaGet('user_api_keys', `chat_id=eq.${chatId}&select=provider,api_key`);
  return rows || [];
}

export async function saveUserApiKey(chatId, provider, apiKey) {
  const existing = await getUserApiKey(chatId, provider);
  if (existing) {
    await supaPatch('user_api_keys', `chat_id=eq.${chatId}&provider=eq.${provider}`, { api_key: apiKey });
  } else {
    await supaPost('user_api_keys', { chat_id: chatId, provider: provider, api_key: apiKey });
  }
}

export async function deleteUserApiKey(chatId, provider) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_api_keys?chat_id=eq.${chatId}&provider=eq.${provider}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`Supabase DELETE: ${res.status}`);
  return true;
}

// === User Settings ===

export async function getUserSettings(chatId) {
  const rows = await supaGet('user_settings', `chat_id=eq.${chatId}&select=*`);
  return rows[0] || null;
}

export async function saveUserSettings(chatId, data) {
  data.updated_at = new Date().toISOString();
  const existing = await getUserSettings(chatId);
  if (existing) {
    await supaPatch('user_settings', `chat_id=eq.${chatId}`, data);
  } else {
    await supaPost('user_settings', { chat_id: chatId, ...data });
  }
}
