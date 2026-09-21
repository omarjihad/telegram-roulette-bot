import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  getDeliveryAccountStatus,
  getDeliveryContactLink,
  hasVerifiedDeliveryContact,
  removeDeliveryAccount,
  sendDeliveryLoginCode,
  verifyDeliveryContactBySending,
  verifyDeliveryLoginCode,
} from '../services/deliveryAccount.service';

export const adminGetDeliveryAccount = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, account: await getDeliveryAccountStatus() });
});

export const adminStartDeliveryLogin = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) throw new AppError('phone is required', 422, 'VALIDATION_ERROR');
  const result = await sendDeliveryLoginCode(req.telegramId!, phone);
  res.json({ ok: true, ...result });
});

export const adminVerifyDeliveryLogin = asyncHandler(async (req: Request, res: Response) => {
  const { code, password } = req.body as { code?: string; password?: string };
  if (!code) throw new AppError('code is required', 422, 'VALIDATION_ERROR');
  const result = await verifyDeliveryLoginCode(req.telegramId!, code, password);
  res.json({ ok: true, ...result });
});

export const adminRemoveDeliveryAccount = asyncHandler(async (_req: Request, res: Response) => {
  await removeDeliveryAccount();
  res.json({ ok: true });
});

export const getDeliveryContact = asyncHandler(async (req: Request, res: Response) => {
  res.json({
    ok: true,
    deliveryContact: {
      ...(await getDeliveryContactLink()),
      verified: await hasVerifiedDeliveryContact(req.telegramId!),
    },
  });
});

export const verifyDeliveryContact = asyncHandler(async (req: Request, res: Response) => {
  const result = await verifyDeliveryContactBySending(req.telegramId!);
  res.json({ ok: true, ...result });
});