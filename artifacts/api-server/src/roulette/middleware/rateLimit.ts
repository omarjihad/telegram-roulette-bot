import rateLimit from 'express-rate-limit';

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
});

export const spinLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 3, // anti double-click; the real 24h cooldown is enforced server-side in roulette.service
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Please wait before trying again.' },
});

export const claimLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Please wait before trying again.' },
});

export const purchaseLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 3, // anti double-click; balance is still checked atomically server-side either way
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Please wait before trying again.' },
});
