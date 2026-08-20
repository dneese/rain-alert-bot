-- Rain Alert Bot - Supabase Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/ljavyrmgcepwximavjyz/sql/new

-- Add new columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_message_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'uk';

-- Create user_api_keys table
CREATE TABLE IF NOT EXISTS user_api_keys (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, provider)
);

-- Enable RLS on user_api_keys
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Create policy for user_api_keys (allow all with service key)
CREATE POLICY "Allow all operations" ON user_api_keys FOR ALL USING (true) WITH CHECK (true);
