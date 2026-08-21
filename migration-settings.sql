-- Add user settings table for configurable thresholds
CREATE TABLE IF NOT EXISTS user_settings (
  chat_id BIGINT PRIMARY KEY,
  rain_threshold_mm NUMERIC(4,2) DEFAULT 0.5,
  lookahead_min INTEGER DEFAULT 30,
  radar_enabled BOOLEAN DEFAULT true,
  alert_cooldown_min INTEGER DEFAULT 30,
  posture VARCHAR(10) DEFAULT 'inside',
  units VARCHAR(10) DEFAULT 'metric',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS posture VARCHAR(10) DEFAULT 'inside';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_rain_state BOOLEAN DEFAULT false;

-- Migrate existing users to user_settings
INSERT INTO user_settings (chat_id)
SELECT chat_id FROM users
ON CONFLICT (chat_id) DO NOTHING;
