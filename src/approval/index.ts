import { createInterface } from 'node:readline/promises';
import { config } from '../config.ts';
import type { Draft } from '../types.ts';

export async function requestApproval(draft: Draft): Promise<boolean> {
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    return approveViaTelegram(draft, config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);
  }
  return approveViaCli(draft);
}

async function approveViaCli(draft: Draft): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n--- DRAFT ---\n' + draft.text + '\n-------------');
    const answer = (await rl.question('Approve and publish? [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function tg<T>(token: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface TgSendResponse {
  result: { message_id: number };
}

interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data: string;
    message: { message_id: number };
  };
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

let topicOffset = 0;

export async function promptTopic(defaultTopic: string, prompt?: string): Promise<string> {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    return defaultTopic;
  }
  const token = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID;

  // Drain any pending updates so we only react to replies sent AFTER this prompt.
  const drained = await tg<{ result: TgUpdate[] }>(token, 'getUpdates', {
    offset: topicOffset,
    timeout: 0,
    allowed_updates: ['message'],
  });
  for (const u of drained.result) {
    if (u.update_id >= topicOffset) topicOffset = u.update_id + 1;
  }

  const text =
    prompt ??
    `Topic for this run? Reply with text, or "default" to use:\n${defaultTopic}\n\n(Times out in 2 min → uses default.)`;
  await tg(token, 'sendMessage', { chat_id: chatId, text });

  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const updates = await tg<{ result: TgUpdate[] }>(token, 'getUpdates', {
      offset: topicOffset,
      timeout: 25,
      allowed_updates: ['message'],
    });
    for (const u of updates.result) {
      topicOffset = u.update_id + 1;
      const msg = u.message;
      if (!msg || String(msg.chat.id) !== chatId) continue;
      const reply = msg.text?.trim();
      if (!reply) continue;
      // Ack consumed update so it isn't replayed on the next poll.
      await tg(token, 'getUpdates', { offset: topicOffset, timeout: 0, allowed_updates: ['message'] });
      if (reply.toLowerCase() === 'default') return defaultTopic;
      return reply;
    }
  }

  return defaultTopic;
}

async function approveViaTelegram(draft: Draft, token: string, chatId: string): Promise<boolean> {
  const sent = await tg<TgSendResponse>(token, 'sendMessage', {
    chat_id: chatId,
    text: `Draft post:\n\n${draft.text}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'approve' },
          { text: 'Reject', callback_data: 'reject' },
        ],
      ],
    },
  });
  const messageId = sent.result.message_id;

  const deadline = Date.now() + 30 * 60 * 1000;
  let offset = 0;
  while (Date.now() < deadline) {
    const updates = await tg<{ result: TgUpdate[] }>(token, 'getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['callback_query'],
    });
    for (const u of updates.result) {
      offset = u.update_id + 1;
      const cb = u.callback_query;
      if (!cb || cb.message.message_id !== messageId) continue;
      await tg(token, 'answerCallbackQuery', { callback_query_id: cb.id });
      return cb.data === 'approve';
    }
  }

  throw new Error('Approval timed out (no response within 30 minutes)');
}
