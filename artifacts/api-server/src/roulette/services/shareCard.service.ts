import { Settings } from '../models/Settings';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getBotInstance } from '../bot/instance';

/**
 * Prize share cards are Telegram "prepared inline messages" (savePreparedInlineMessage),
 * sent from the Mini App with Telegram.WebApp.shareMessage. They go to private chats with
 * people only (no groups, channels or bots).
 */

/** Uploads the share image to Telegram once and keeps its file_id. */
async function shareImageFileId(): Promise<string | null> {
  const settings = await Settings.findOne({ singleton: 'main' }).select('+shareImageData shareImageMimeType hasShareImage shareImageFileId');
  if (!settings?.hasShareImage || !settings.shareImageData) return null;
  if (settings.shareImageFileId) return settings.shareImageFileId;
  if (!env.OWNER_ID) return null;
  try {
    const bot = getBotInstance();
    const msg = await bot.sendPhoto(
      env.OWNER_ID,
      settings.shareImageData,
      { disable_notification: true },
      { filename: 'share.jpg', contentType: settings.shareImageMimeType || 'image/jpeg' }
    );
    const fileId = msg.photo?.[msg.photo.length - 1]?.file_id ?? null;
    await bot.deleteMessage(env.OWNER_ID, msg.message_id).catch(() => undefined);
    if (fileId) await Settings.updateOne({ _id: settings._id }, { $set: { shareImageFileId: fileId } });
    return fileId;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'could not upload the share image to Telegram');
    return null;
  }
}

async function savePrepared(userId: number, result: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      result,
      // Friends only: the chat picker shows private chats with people.
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: false,
      allow_channel_chats: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: { id: string }; description?: string };
  if (!data.ok || !data.result) throw new Error(data.description || `savePreparedInlineMessage failed (${res.status})`);
  return data.result.id;
}

/**
 * Prepares one share card. Tries the cached photo, then the photo URL, then plain text,
 * so a problem with the picture never stops the share itself.
 */
export async function prepareShareCard(params: {
  userId: number;
  resultId: string;
  title: string;
  caption: string;
  buttonText: string;
  link: string;
}) {
  const replyMarkup = { inline_keyboard: [[{ text: params.buttonText, url: params.link }]] };
  const attempts: Record<string, unknown>[] = [];

  const fileId = await shareImageFileId();
  if (fileId) {
    attempts.push({ type: 'photo', id: params.resultId, photo_file_id: fileId, caption: params.caption, reply_markup: replyMarkup });
  }
  const settings = await Settings.findOne({ singleton: 'main' }).select('hasShareImage');
  if (settings?.hasShareImage && env.MINI_APP_URL) {
    const photoUrl = `${env.MINI_APP_URL.replace(/\/$/, '')}/api/settings/share-image`;
    attempts.push({ type: 'photo', id: params.resultId, photo_url: photoUrl, thumbnail_url: photoUrl, caption: params.caption, reply_markup: replyMarkup });
  }
  attempts.push({
    type: 'article',
    id: params.resultId,
    title: params.title,
    input_message_content: { message_text: params.caption },
    reply_markup: replyMarkup,
  });

  let lastError: unknown = null;
  for (const result of attempts) {
    try {
      return await savePrepared(params.userId, result);
    } catch (err) {
      lastError = err;
      logger.warn({ err: err instanceof Error ? err.message : err, type: result.type, viaFileId: 'photo_file_id' in result }, 'share card attempt failed');
      // A stale file_id (e.g. the image was replaced in Telegram) is dropped and re-uploaded next time.
      if ('photo_file_id' in result) await Settings.updateOne({ singleton: 'main' }, { $set: { shareImageFileId: null } }).catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('share card failed');
}
