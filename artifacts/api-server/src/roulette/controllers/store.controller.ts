import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listStoreProducts, purchaseProduct } from '../services/store.service';
import { AppError } from '../utils/AppError';

export const getStoreProducts = asyncHandler(async (_req: Request, res: Response) => {
  const products = await listStoreProducts();
  res.json({ ok: true, products });
});

export const postStorePurchase = asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.body as { key?: string };
  if (!key) throw new AppError('key is required', 422, 'VALIDATION_ERROR');

  const result = await purchaseProduct(req.telegramId!, key);
  res.json({ ok: true, ...result });
});
