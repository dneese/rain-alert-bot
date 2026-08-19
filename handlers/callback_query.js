import { api } from 'sdk';

export default async function (callbackQuery) {
  await api.answerCallbackQuery({
    callback_query_id: callbackQuery.id,
  });
}
