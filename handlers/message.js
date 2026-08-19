import { api, db } from 'sdk';
import { users } from 'schema';
import { eq } from 'sdk/db';
import { checkWeatherForLocation } from 'lib/weather';

const WELCOME = `🌧 Rain Alert Bot

I'll warn you when rain is approaching your area!

Send me your 📍 location and I'll monitor the weather for you.

Commands:
/check — check weather now
/stop — stop alerts
/start — show this message`;

export default async function (message) {
  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start') {
    await api.sendMessage({
      chat_id: chatId,
      text: WELCOME,
    });
    return;
  }

  if (text === '/stop') {
    await db.update(users)
      .set({ enabled: false })
      .where(eq(users.chatId, chatId))
      .run();
    await api.sendMessage({
      chat_id: chatId,
      text: 'Alerts disabled. Send /start to re-enable.',
    });
    return;
  }

  if (text === '/check') {
    const [user] = await db.select()
      .from(users)
      .where(eq(users.chatId, chatId))
      .limit(1)
      .all();

    if (!user) {
      await api.sendMessage({
        chat_id: chatId,
        text: 'Send me your location first!',
      });
      return;
    }

    const result = await checkWeatherForLocation(user.latitude, user.longitude);
    await api.sendMessage({
      chat_id: chatId,
      text: result,
    });
    return;
  }

  if (message.location) {
    const lat = message.location.latitude;
    const lon = message.location.longitude;

    await db.insert(users)
      .values({ chatId, latitude: lat, longitude: lon })
      .onConflictDoUpdate({
        target: users.chatId,
        set: {
          latitude: lat,
          longitude: lon,
          enabled: true,
        },
      })
      .run();

    const result = await checkWeatherForLocation(lat, lon);
    await api.sendMessage({
      chat_id: chatId,
      text: `Location saved!\n\n${result}`,
    });
    return;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: 'Send me your location or type /start',
  });
}
