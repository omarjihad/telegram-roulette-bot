import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listPrizes,
  createPrize,
  deletePrize,
  addStock,
  removeStock,
  setStockExact,
  setActive,
  updatePrizeDetails,
  validateWeightsAtMost100,
  setPrizeImage,
  clearPrizeImage,
  prizeImageUrl,
} from '../services/prize.service';
import { AppError } from '../utils/AppError';

export const adminListPrizes = asyncHandler(async (req: Request, res: Response) => {
  const prizes = await listPrizes();
  const weightCheck = await validateWeightsAtMost100();
  // toObject() so we can attach the computed imageUrl without fighting the Mongoose document shape
  const withImageUrls = prizes.map((p) => ({
    ...p.toObject(),
    imageUrl: prizeImageUrl(p.key, p.hasImage),
    dailyWeight: p.dailyWeight ?? p.baseWeight,
    pointsWeight: p.pointsWeight ?? p.baseWeight,
    dailyStock: p.dailyStock ?? p.stock,
    pointsStock: p.pointsStock ?? p.stock,
    dailyIsUnlimited: p.dailyIsUnlimited ?? p.isUnlimited,
    pointsIsUnlimited: p.pointsIsUnlimited ?? p.isUnlimited,
  }));
  res.json({ ok: true, prizes: withImageUrls, weightCheck });
});

export const adminCreatePrize = asyncHandler(async (req: Request, res: Response) => {
  const {
    key,
    name,
    icon,
    baseWeight,
    dailyWeight,
    pointsWeight,
    stock,
    dailyStock,
    pointsStock,
    isUnlimited,
    dailyIsUnlimited,
    pointsIsUnlimited,
    displayOrder,
    requiresManualDelivery,
  } = req.body;
  if (!key || !name || typeof baseWeight !== 'number') {
    throw new AppError('key, name, baseWeight are required', 422, 'VALIDATION_ERROR');
  }
  const prize = await createPrize({
    key,
    name,
    icon,
    baseWeight,
    dailyWeight,
    pointsWeight,
    stock: stock ?? 0,
    dailyStock,
    pointsStock,
    isUnlimited,
    dailyIsUnlimited,
    pointsIsUnlimited,
    displayOrder,
    requiresManualDelivery,
    actorId: req.telegramId!,
    actorUsername: req.dbUser!.username,
  });
  res.json({ ok: true, prize });
});

export const adminUpdatePrize = asyncHandler(async (req: Request, res: Response) => {
  const { name, icon, storePrice, dailyWeight, pointsWeight } = req.body as {
    name?: string;
    icon?: string;
    storePrice?: number | null;
    baseWeight?: number;
    dailyWeight?: number;
    pointsWeight?: number;
  };
  const prize = await updatePrizeDetails(req.params.key, { name, icon, storePrice, baseWeight: (req.body as any).baseWeight, dailyWeight, pointsWeight }, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize });
});

/** Sets (or clears, with null) this prize's Store price in spin-points. Separate from the
 *  general update endpoint so the admin UI can offer a quick "set price" prompt without
 *  touching name/icon/image. */
export const adminSetStorePrice = asyncHandler(async (req: Request, res: Response) => {
  const { storePrice } = req.body as { storePrice?: number | null };
  if (storePrice !== null && (typeof storePrice !== 'number' || storePrice <= 0)) {
    throw new AppError('storePrice must be a positive number or null', 422, 'VALIDATION_ERROR');
  }
  const prize = await updatePrizeDetails(req.params.key, { storePrice }, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize });
});

/** Multipart image upload for a prize — the file itself is handled by the uploadPrizeImage
 *  middleware (see routes/admin.routes.ts, now using memory storage) and stored directly
 *  in MongoDB rather than on local disk. */
export const adminUploadPrizeImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('لم يتم إرفاق صورة', 422, 'VALIDATION_ERROR');
  const prize = await setPrizeImage(req.params.key, req.file.buffer, req.file.mimetype, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize: { ...prize.toObject(), imageUrl: prizeImageUrl(prize.key, true) } });
});

export const adminClearPrizeImage = asyncHandler(async (req: Request, res: Response) => {
  const prize = await clearPrizeImage(req.params.key, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize: { ...prize.toObject(), imageUrl: null } });
});

export const adminDeletePrize = asyncHandler(async (req: Request, res: Response) => {
  const prize = await deletePrize(req.params.key, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize });
});

export const adminAddStock = asyncHandler(async (req: Request, res: Response) => {
  const { amount, mode } = req.body as { amount?: number; mode?: 'daily' | 'points' };
  if (typeof amount !== 'number') throw new AppError('amount is required', 422, 'VALIDATION_ERROR');
  const prize = await addStock(req.params.key, amount, req.telegramId!, req.dbUser!.username, mode);
  res.json({ ok: true, prize });
});

export const adminRemoveStock = asyncHandler(async (req: Request, res: Response) => {
  const { amount, mode } = req.body as { amount?: number; mode?: 'daily' | 'points' };
  if (typeof amount !== 'number') throw new AppError('amount is required', 422, 'VALIDATION_ERROR');
  const prize = await removeStock(req.params.key, amount, req.telegramId!, req.dbUser!.username, mode);
  res.json({ ok: true, prize });
});

export const adminSetStock = asyncHandler(async (req: Request, res: Response) => {
  const { stock, mode } = req.body as { stock?: number; mode?: 'daily' | 'points' };
  if (typeof stock !== 'number') throw new AppError('stock is required', 422, 'VALIDATION_ERROR');
  const prize = await setStockExact(req.params.key, stock, req.telegramId!, req.dbUser!.username, mode);
  res.json({ ok: true, prize });
});

export const adminSetPrizeActive = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== 'boolean') throw new AppError('isActive is required', 422, 'VALIDATION_ERROR');
  const prize = await setActive(req.params.key, isActive, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, prize });
});
