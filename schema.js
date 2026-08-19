import { table, integer, text, real, sql } from 'sdk/db';

export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').unique().notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  lastAlertHour: integer('last_alert_hour'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
