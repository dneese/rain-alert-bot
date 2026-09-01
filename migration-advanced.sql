-- Advanced notification settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS quiet_hours_start VARCHAR(5) DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS quiet_hours_end VARCHAR(5) DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS wind_threshold_kmh NUMERIC(5,1) DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS humidity_threshold_pct INTEGER DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS temp_threshold_c NUMERIC(4,1) DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS alert_drizzle BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS alert_light_rain BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS alert_heavy_rain BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS alert_thunderstorm BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_minutely BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_hourly BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_current BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_radar BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS early_warn_hours INTEGER DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS last_advance_warn_ms BIGINT DEFAULT NULL;

-- Multi-location table
CREATE TABLE IF NOT EXISTS user_locations (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  name VARCHAR(50) NOT NULL DEFAULT 'Дім',
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_locations_chat_id ON user_locations(chat_id);

-- Migrate existing user lat/lon to user_locations as default
INSERT INTO user_locations (chat_id, name, latitude, longitude, is_default)
SELECT chat_id, 'Дім', latitude, longitude, true
FROM users
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
ON CONFLICT DO NOTHING;
