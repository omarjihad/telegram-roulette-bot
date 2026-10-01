import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getMediationAdminStats } from '../services/mediation.service';
import { AppError } from '../utils/AppError';
import {
  createListing,
  deleteListingByUser,
  getExchangeAdminSettings,
  getExchangeImage,
  getExchangeStatus,
  getListing,
  listListings,
  listMyListings,
  listReports,
  removeListing,
  reportListing,
  resolveReport,
  setListingPinned,
  updateExchangeAdminSettings,
  UploadedFile,
  banListingOwner,
  makeOffer,
  renewListingByUser,
  updateListing,
} from '../services/exchange.service';

const files = (req: Request) => ((req.files as UploadedFile[] | undefined) ?? []);
const actor = (req: Request) => ({ telegramId: req.dbUser!.telegramId, username: req.dbUser!.username ?? null });

export const getExchange = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getExchangeStatus(req.dbUser!, req.adminRole ?? null)) });
});

export const getExchangeListings = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ ok: true, ...(await listListings(req.adminRole ?? null, Number(q.page ?? 1))) });
});

export const getMyExchangeListings = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await listMyListings(req.dbUser!, req.adminRole ?? null)) });
});

export const getExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getListing(req.dbUser!, req.adminRole ?? null, req.params.id)) });
});

export const postExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await createListing(req.dbUser!, req.adminRole ?? null, req.body ?? {}, files(req))) });
});

export const postExchangeOffer = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await makeOffer(req.dbUser!, req.adminRole ?? null, req.params.id, req.body ?? {}, files(req))) });
});

export const patchExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await updateListing(req.dbUser!, req.adminRole ?? null, req.params.id, req.body ?? {}, files(req))) });
});

export const postRenewExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await renewListingByUser(req.dbUser!, req.adminRole ?? null, req.params.id)) });
});

export const deleteExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await deleteListingByUser(req.dbUser!, req.adminRole ?? null, req.params.id)) });
});

export const postExchangeReport = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await reportListing(req.dbUser!, req.adminRole ?? null, req.params.id, req.body ?? {}, files(req))) });
});

/** Public (no initData) because <img> tags can't send headers; ids are random ObjectIds. */
export const getExchangeImageFile = asyncHandler(async (req: Request, res: Response) => {
  const image = await getExchangeImage(req.params.id);
  if (!image) throw new AppError('Image not found', 404, 'NOT_FOUND');
  res.setHeader('Content-Type', image.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.send(image.data);
});

export const adminGetExchange = asyncHandler(async (_req: Request, res: Response) => {
  const [settings, mediation] = await Promise.all([getExchangeAdminSettings(), getMediationAdminStats()]);
  res.json({ ok: true, settings: { ...settings, mediation } });
});

export const adminUpdateExchange = asyncHandler(async (req: Request, res: Response) => {
  const [settings, mediation] = await Promise.all([
    updateExchangeAdminSettings((req.body ?? {}) as Record<string, unknown>),
    getMediationAdminStats(),
  ]);
  res.json({ ok: true, settings: { ...settings, mediation } });
});

export const adminGetExchangeReports = asyncHandler(async (req: Request, res: Response) => {
  const status = (req.query as { status?: string }).status === 'resolved' ? 'resolved' : 'open';
  res.json({ ok: true, reports: await listReports(status) });
});

export const adminResolveExchangeReport = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await resolveReport(req.params.id, actor(req))) });
});

export const adminPinExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  const pinned = (req.body as { pinned?: boolean } | undefined)?.pinned !== false;
  res.json({ ok: true, ...(await setListingPinned(req.params.id, pinned, actor(req))) });
});

export const adminRemoveExchangeListing = asyncHandler(async (req: Request, res: Response) => {
  const reason = String((req.body as { reason?: string } | undefined)?.reason ?? '').trim() || undefined;
  res.json({ ok: true, ...(await removeListing(req.params.id, { ...actor(req), isAdmin: true }, reason)) });
});

export const adminBanExchangeOwner = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await banListingOwner(req.params.id, actor(req))) });
});
