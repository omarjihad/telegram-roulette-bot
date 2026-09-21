import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getDashboardStats } from '../services/stats.service';
import { AuditLog } from '../models/AuditLog';
import { getSettings, Settings } from '../models/Settings';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { runBroadcast, BroadcastTarget, BroadcastButton } from '../services/broadcast.service';
import { getBotInstance } from '../bot/instance';
import { resetGameState } from '../services/gameReset.service';
import { findDuplicatePrizes, fixDuplicatePrizes } from '../services/prize.service';
import { ensureDemoToken, getDemoAccessLink } from '../services/demo.service';

/** Report-only — safe to call anytime. See getCanonicalPrizes() in prize.service.ts for
 *  why duplicate keys can cause "wheel shows one prize, delivers another". */
export const adminCheckDuplicatePrizes = asyncHandler(async (req: Request, res: Response) => {
  const duplicates = await findDuplicatePrizes();
  res.json({ ok: true, duplicates });
});

/** Actually merges/deletes the duplicates found above. */
export const adminFixDuplicatePrizes = asyncHandler(async (req: Request, res: Response) => {
  const results = await fixDuplicatePrizes();
  await writeAudit({
    actorId: req.telegramId!,
    actorUsername: req.dbUser!.username,
    action: 'prize.fix_duplicates',
    metadata: { results },
  });
  res.json({ ok: true, results });
});

/**
 * Wipes all user progress (inventories, spin-points, referrals) but never the prize
 * catalog. Requires the exact phrase "RESET" in the request body as a server-side
 * confirmation — a stray/misclicked request without it is rejected outright, on top of
 * whatever confirmation dialog the admin panel shows before sending this.
 */
export const adminResetGameState = asyncHandler(async (req: Request, res: Response) => {
  const { confirm } = req.body as { confirm?: string };
  if (confirm !== 'RESET') {
    throw new AppError('Send { confirm: "RESET" } to actually perform this — too dangerous to trigger by accident', 422, 'CONFIRMATION_REQUIRED');
  }
  const summary = await resetGameState(req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, summary });
});

export const adminUploadShareImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('لم يتم إرفاق صورة', 422, 'VALIDATION_ERROR');
  const settings = await getSettings();
  settings.shareImageData = req.file.buffer;
  settings.shareImageMimeType = req.file.mimetype;
  settings.hasShareImage = true;
  await settings.save();
  await writeAudit({
    actorId: req.telegramId!,
    actorUsername: req.dbUser!.username,
    action: 'settings.update',
    metadata: { hasShareImage: true, sizeBytes: req.file.buffer.length },
  });
  res.json({ ok: true, settings: { ...settings.toObject(), shareImageUrl: '/api/settings/share-image' } });
});

export const adminClearShareImage = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getSettings();
  settings.shareImageData = null;
  settings.shareImageMimeType = null;
  settings.hasShareImage = false;
  await settings.save();
  await writeAudit({ actorId: req.telegramId!, actorUsername: req.dbUser!.username, action: 'settings.update', metadata: { hasShareImage: false } });
  res.json({ ok: true, settings: { ...settings.toObject(), shareImageUrl: null } });
});

/** Public (unauthenticated) route — streams the configured share-card image straight from
 * MongoDB. Used both by <img> previews in the admin panel and as the photo_url Telegram
 * fetches when building the prepared inline share message. */
export const getShareImage = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await Settings.findOne({ singleton: 'main' }).select('+shareImageData shareImageMimeType hasShareImage');
  if (!settings || !settings.hasShareImage || !settings.shareImageData) throw new AppError('Image not found', 404, 'NOT_FOUND');
  res.setHeader('Content-Type', settings.shareImageMimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(settings.shareImageData);
});

export const adminGetStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await getDashboardStats();
  res.json({ ok: true, stats });
});

export const adminListAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 50);
  const [logs, total] = await Promise.all([
    AuditLog.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    AuditLog.countDocuments({}),
  ]);
  res.json({ ok: true, logs, total, page, pageSize });
});

export const adminGetSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getSettings();
  res.json({
    ok: true,
    settings: {
      ...settings.toObject(),
      shareImageUrl: settings.hasShareImage ? '/api/settings/share-image' : null,
      demoAccessLink: await getDemoAccessLink(),
    },
  });
});

export const adminUpdateSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getSettings();
  const {
    spinCooldownHours,
    prizeExpiryHours,
    expiryReminderIntervalHours,
    referralBonusEnabled,
    referralBonusPrizeKey,
    wheelClaimReferralsRequired,
    dailyClaimReferralsRequired,
  } =
    req.body as Partial<{
      spinCooldownHours: number;
      prizeExpiryHours: number;
      expiryReminderIntervalHours: number;
      referralBonusEnabled: boolean;
      referralBonusPrizeKey: string | null;
      wheelClaimReferralsRequired: number;
      dailyClaimReferralsRequired: number;
    }>;

  if (typeof spinCooldownHours === 'number') settings.spinCooldownHours = spinCooldownHours;
  if (typeof prizeExpiryHours === 'number') settings.prizeExpiryHours = prizeExpiryHours;
  if (typeof expiryReminderIntervalHours === 'number') settings.expiryReminderIntervalHours = expiryReminderIntervalHours;
  if (typeof referralBonusEnabled === 'boolean') settings.referralBonusEnabled = referralBonusEnabled;
  if (referralBonusPrizeKey !== undefined) settings.referralBonusPrizeKey = referralBonusPrizeKey;
  if (typeof wheelClaimReferralsRequired === 'number') settings.wheelClaimReferralsRequired = wheelClaimReferralsRequired;
  if (typeof dailyClaimReferralsRequired === 'number') settings.dailyClaimReferralsRequired = dailyClaimReferralsRequired;

  await settings.save();
  await writeAudit({ actorId: req.telegramId!, actorUsername: req.dbUser!.username, action: 'settings.update', metadata: req.body });

  res.json({ ok: true, settings });
});

export const adminToggleMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') throw new AppError('enabled is required', 422, 'VALIDATION_ERROR');

  const settings = await getSettings();
  if (!enabled && settings.demoModeEnabled) {
    throw new AppError('أوقف وضع الرابط التجريبي أولاً', 409, 'DEMO_MODE_ACTIVE');
  }
  settings.maintenanceMode = enabled;
  await settings.save();

  await writeAudit({
    actorId: req.telegramId!,
    actorUsername: req.dbUser!.username,
    action: 'settings.maintenance_mode',
    metadata: { enabled },
  });

  res.json({ ok: true, settings });
});

export const adminToggleDemoMode = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') throw new AppError('enabled is required', 422, 'VALIDATION_ERROR');

  const settings = await getSettings();
  settings.demoModeEnabled = enabled;
  settings.maintenanceMode = enabled;
  if (enabled) {
    await ensureDemoToken(settings);
  } else {
    settings.demoAccessToken = null;
    settings.demoAccessTokenUpdatedAt = null;
  }
  await settings.save();
  await writeAudit({
    actorId: req.telegramId!,
    actorUsername: req.dbUser!.username,
    action: 'settings.demo_mode',
    metadata: { enabled },
  });
  res.json({ ok: true, settings: { ...settings.toObject(), demoAccessLink: await getDemoAccessLink() } });
});

export const adminRunBroadcast = asyncHandler(async (req: Request, res: Response) => {
  const { message, scope, telegramIds, buttons } = req.body as {
    message?: string;
    scope?: BroadcastTarget['scope'];
    telegramIds?: number[];
    buttons?: BroadcastButton[];
  };

  if (!message || !scope) throw new AppError('message and scope are required', 422, 'VALIDATION_ERROR');

  const result = await runBroadcast(
    getBotInstance(),
    message,
    { scope, telegramIds },
    buttons,
    req.telegramId!,
    req.dbUser!.username
  );

  res.json({ ok: true, result });
});
