import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { cancelTicket, createTicket, listMyTickets, lookupPartner } from '../services/mediation.service';

export const getMediation = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await listMyTickets(req.dbUser!, req.adminRole ?? null)) });
});

export const postMediationLookup = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await lookupPartner(req.dbUser!, req.adminRole ?? null, (req.body ?? {}).username)) });
});

export const postMediationTicket = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await createTicket(req.dbUser!, req.adminRole ?? null, req.body ?? {})) });
});

export const postCancelMediationTicket = asyncHandler(async (req: Request, res: Response) => {
  res.json(await cancelTicket(req.dbUser!, req.params.id));
});
