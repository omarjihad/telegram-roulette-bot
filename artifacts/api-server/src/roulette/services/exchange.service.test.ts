import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  listingCount: vi.fn(),
  listingCreate: vi.fn(),
  listingFindById: vi.fn(),
  listingUpdateOne: vi.fn(),
  imageInsert: vi.fn(),
  imageDelete: vi.fn(),
  reportExists: vi.fn(),
  reportCreate: vi.fn(),
  notify: vi.fn(),
  admins: vi.fn(),
  audit: vi.fn(),
  listingFind: vi.fn(),
  offerExists: vi.fn(),
  offerCreate: vi.fn(),
}));

vi.mock('../models/Settings', () => ({ getSettings: mocks.settings }));
vi.mock('../models/User', () => ({ User: {} }));
vi.mock('../models/ExchangeListing', () => ({
  EXCHANGE_CURRENCIES: ['usd', 'asia', 'zain', 'master', 'ton', 'pound', 'riyal'],
  ExchangeListing: {
    countDocuments: mocks.listingCount,
    create: mocks.listingCreate,
    findById: mocks.listingFindById,
    updateOne: mocks.listingUpdateOne,
    find: mocks.listingFind,
  },
  LISTING_LIFETIME_MS: 4 * 24 * 60 * 60 * 1000,
}));
vi.mock('../models/ExchangeImage', () => ({ ExchangeImage: { insertMany: mocks.imageInsert, deleteMany: mocks.imageDelete } }));
vi.mock('../models/ExchangeReport', () => ({
  REPORT_REASONS: ['scammer', 'no_middleman', 'not_owner', 'fake_info', 'other'],
  ExchangeReport: { exists: mocks.reportExists, create: mocks.reportCreate },
}));
vi.mock('../models/ExchangeOffer', () => ({ ExchangeOffer: { exists: mocks.offerExists, create: mocks.offerCreate } }));
vi.mock('../models/AuditLog', () => ({ writeAudit: mocks.audit }));
vi.mock('./notification.service', () => ({ createNotification: mocks.notify }));
vi.mock('./admin.service', () => ({ listAllAdminTelegramIds: mocks.admins }));
vi.mock('./ban.service', () => ({ banUser: vi.fn() }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot', MINI_APP_SHORT_NAME: 'MFR' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { buildListingLink, createListing, exchangeAllowed, expireOldListings, listingPrices, makeOffer, removeListing, reportListing } from './exchange.service';

const user = { _id: new mongoose.Types.ObjectId(), telegramId: 77, username: 'seller', firstName: 'S' } as never;
const img = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 };

function listing(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    owner: new mongoose.Types.ObjectId(),
    ownerTelegramId: 99,
    ownerUsername: 'owner',
    mode: 'both',
    details: 'Account with many characters',
    prices: [{ currency: 'usd', amount: 10 }],
    price: null,
    currency: null,
    images: [new mongoose.Types.ObjectId()],
    status: 'active',
    pinned: false,
    reportsCount: 0,
    createdAt: new Date(),
    save: vi.fn(),
    ...overrides,
  };
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ exchangePublic: false, exchangeMiddlemanGroup: 'MF_MMMM' });
  mocks.listingCount.mockResolvedValue(0);
  mocks.imageInsert.mockImplementation(async (docs: unknown[]) => docs.map(() => ({ _id: new mongoose.Types.ObjectId() })));
  mocks.listingCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), pinned: false, status: 'active', createdAt: new Date(), ...doc }));
  mocks.notify.mockResolvedValue(undefined);
  mocks.admins.mockResolvedValue([]);
});

describe('exchange access', () => {
  it('is developers-only until made public', () => {
    expect(exchangeAllowed({ exchangePublic: false }, null)).toBe(false);
    expect(exchangeAllowed({ exchangePublic: false }, 'developer')).toBe(true);
    expect(exchangeAllowed({ exchangePublic: true }, null)).toBe(true);
  });

  it('refuses members while the section is not public', async () => {
    await expect(createListing(user, null, { mode: 'trade', details: 'long enough details' }, [img])).rejects.toMatchObject({ code: 'EXCHANGE_COMING_SOON' });
  });

  it('builds a Mini App deep link to a listing', () => {
    expect(buildListingLink('abc')).toBe('https://t.me/MfRuLiTbot/MFR?startapp=listing_abc');
  });
});

describe('createListing', () => {
  it('stores a trade-only post without prices and with a 4-day expiry', async () => {
    const res = await createListing(user, 'developer', { mode: 'trade', details: 'Level 70 account', prices: '[{"currency":"usd","amount":5}]' }, [img, img]);
    const doc = mocks.listingCreate.mock.calls[0][0];
    expect(doc).toMatchObject({ mode: 'trade', prices: [] });
    expect(doc.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 24 * 3600e3 - 5000);
    expect(res.listing.imageCount).toBe(2);
  });

  it('accepts several payment methods, each with its own price', async () => {
    await createListing(user, 'developer', { mode: 'both', details: 'Level 70 account', prices: JSON.stringify([{ currency: 'usd', amount: 25 }, { currency: 'asia', amount: '40000' }]) }, [img]);
    expect(mocks.listingCreate).toHaveBeenCalledWith(expect.objectContaining({ prices: [{ currency: 'usd', amount: 25 }, { currency: 'asia', amount: 40000 }] }));
  });

  it('rejects sale posts without a valid payment method', async () => {
    await expect(createListing(user, 'developer', { mode: 'sell', details: 'Level 70 account' }, [img])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createListing(user, 'developer', { mode: 'sell', details: 'Level 70 account', prices: '[{"currency":"euro","amount":5}]' }, [img])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createListing(user, 'developer', { mode: 'sell', details: 'Level 70 account', prices: '[{"currency":"usd","amount":5},{"currency":"usd","amount":6}]' }, [img])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('puts the chosen cover photo first', async () => {
    const a = { ...img, buffer: Buffer.from('a') };
    const b = { ...img, buffer: Buffer.from('b') };
    const c = { ...img, buffer: Buffer.from('c') };
    await createListing(user, 'developer', { mode: 'trade', details: 'Level 70 account', cover: '2' }, [a, b, c]);
    expect(mocks.imageInsert.mock.calls[0][0].map((d: { data: Buffer }) => d.data.toString())).toEqual(['c', 'a', 'b']);
  });

  it('needs at least one photo and respects the active-post limit', async () => {
    await expect(createListing(user, 'developer', { mode: 'trade', details: 'Level 70 account' }, [])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mocks.settings.mockResolvedValue({ exchangePublic: true });
    mocks.listingCount.mockResolvedValue(5);
    await expect(createListing(user, null, { mode: 'trade', details: 'Level 70 account' }, [img])).rejects.toMatchObject({ code: 'EXCHANGE_LIMIT' });
  });

  it('reads the single price of older posts as one payment method', () => {
    expect(listingPrices({ prices: [], price: 10, currency: 'zain' } as never)).toEqual([{ currency: 'zain', amount: 10 }]);
  });
});

describe('expireOldListings', () => {
  it('removes posts past their 4 days and tells the owner', async () => {
    const doc = listing();
    mocks.listingFind.mockReturnValue({ limit: () => Promise.resolve([doc]) });
    mocks.listingUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    expect(await expireOldListings()).toBe(1);
    expect(mocks.listingUpdateOne).toHaveBeenCalledWith({ _id: doc._id, status: 'active' }, expect.anything());
    expect(mocks.imageDelete).toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 99 }));
  });
});

describe('makeOffer', () => {
  it("can't be sent on your own post or twice while one is waiting", async () => {
    mocks.listingFindById.mockResolvedValue(listing({ ownerTelegramId: 77 }));
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { message: '20$' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mocks.listingFindById.mockResolvedValue(listing());
    mocks.offerExists.mockResolvedValue({ _id: 1 });
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { message: '20$' })).rejects.toMatchObject({ code: 'OFFER_PENDING' });
  });

  it('only takes account photos with a trade offer, on posts that accept a trade', async () => {
    mocks.offerExists.mockResolvedValue(null);
    mocks.listingFindById.mockResolvedValue(listing({ mode: 'sell' }));
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { kind: 'trade', message: 'my level 90 account' }, [img])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mocks.listingFindById.mockResolvedValue(listing({ mode: 'both' }));
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { kind: 'buy', message: '20$' }, [img])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { kind: 'trade', message: 'my account' }, Array(8).fill(img))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses expired posts', async () => {
    mocks.listingFindById.mockResolvedValue(listing({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(makeOffer(user, 'developer', String(new mongoose.Types.ObjectId()), { message: '20$' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('removeListing', () => {
  it('lets only the owner or a developer delete, and tells the owner when admins remove it', async () => {
    const doc = listing();
    mocks.listingFindById.mockResolvedValue(doc);
    await expect(removeListing(String(doc._id), { telegramId: 5, isAdmin: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await removeListing(String(doc._id), { telegramId: 5, isAdmin: true }, 'scam');
    expect(doc.status).toBe('removed');
    expect(mocks.imageDelete).toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 99 }));
  });

  it("doesn't notify the owner when they delete their own post", async () => {
    const doc = listing();
    mocks.listingFindById.mockResolvedValue(doc);
    await removeListing(String(doc._id), { telegramId: 99, isAdmin: false });
    expect(doc.status).toBe('removed');
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('reportListing', () => {
  it('saves a report and counts it on the listing', async () => {
    const doc = listing();
    mocks.listingFindById.mockResolvedValue(doc);
    mocks.reportExists.mockResolvedValue(null);
    mocks.reportCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    await reportListing(user, 'developer', String(doc._id), { reason: 'scammer', description: 'He took my account' }, []);
    expect(mocks.reportCreate).toHaveBeenCalledWith(expect.objectContaining({ reason: 'scammer', reporterTelegramId: 77 }));
    expect(mocks.listingUpdateOne).toHaveBeenCalledWith({ _id: doc._id }, { $inc: { reportsCount: 1 } });
  });

  it('rejects reporting your own post or reporting twice', async () => {
    mocks.listingFindById.mockResolvedValue(listing({ ownerTelegramId: 77 }));
    await expect(reportListing(user, 'developer', String(new mongoose.Types.ObjectId()), { reason: 'scammer', description: 'abcdef' }, [])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mocks.listingFindById.mockResolvedValue(listing());
    mocks.reportExists.mockResolvedValue({ _id: 1 });
    await expect(reportListing(user, 'developer', String(new mongoose.Types.ObjectId()), { reason: 'scammer', description: 'abcdef' }, [])).rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
  });
});
