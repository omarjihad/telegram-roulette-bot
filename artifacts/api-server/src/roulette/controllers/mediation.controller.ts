import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { cancelTicket, createTicket, listMyTickets, lookupPartner } from '../services/mediation.service';
import { getOfferMediationTarget } from '../services/exchange.service';

export const getMediation = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await listMyTickets(req.dbUser!, req.adminRole ?? null)) });
});

export const postMediationLookup = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  res.json({ ok: true, ...(await lookupPartner(req.dbUser!, req.adminRole ?? null, body.username, body.telegramId)) });
});

/** The other side of an accepted offer, for the bot's "request a middleman" button. */
export const getMediationOfferTarget = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, target: await getOfferMediationTarget(req.dbUser!, req.adminRole ?? null, req.params.id) });
});

export const postMediationTicket = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await createTicket(req.dbUser!, req.adminRole ?? null, req.body ?? {})) });
});

export const postCancelMediationTicket = asyncHandler(async (req: Request, res: Response) => {
  res.json(await cancelTicket(req.dbUser!, req.params.id));
});
