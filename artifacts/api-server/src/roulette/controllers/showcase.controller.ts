import { asyncHandler } from '../utils/asyncHandler';
import { getCanonicalPrizes, prizeImageUrl } from '../services/prize.service';
import { Settings } from '../models/Settings';
import { env } from '../config/env';

// Read-only preview. Never call getSettings(), which creates a record when absent.
export const getShowcase = asyncHandler(async (_req, res) => {
  const [prizes, settings] = await Promise.all([
    getCanonicalPrizes(),
    Settings.findOne({ singleton: 'main' }).select('spinCooldownHours').lean(),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    botUsername: env.BOT_USERNAME,
    configured: env.GAMEPLAY_ENABLED && env.OWNER_ID > 0,
    spinCooldownHours: settings?.spinCooldownHours ?? 24,
    prizes: prizes
      .filter((p) => p.isActive && p.key !== 'referral_bonus')
      .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({
        key: p.key,
        name: p.name,
        icon: p.icon,
        imageUrl: prizeImageUrl(p.key, p.hasImage),
        stock: p.isUnlimited || p.stock === -1 ? -1 : p.stock,
        active: p.isActive,
        probability: p.baseWeight,
      })),
  });
});