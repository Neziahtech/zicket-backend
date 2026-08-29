import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import {
  developerAuthGuard,
  DeveloperAuthenticatedReq,
} from '../src/middlewares/developer-auth.middleware';
import DeveloperApiKey from '../src/models/developer-key';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

jest.mock('../src/models/developer-key', () => {
  const MockDeveloperApiKey = jest.fn();
  (MockDeveloperApiKey as any).findOne = jest.fn();
  (MockDeveloperApiKey as any).updateOne = jest.fn().mockResolvedValue({});
  return { __esModule: true, default: MockDeveloperApiKey };
});

const mockCompare = bcrypt.compare as jest.Mock;
const mockFindOne = DeveloperApiKey.findOne as jest.Mock;
const mockUpdateOne = DeveloperApiKey.updateOne as jest.Mock;

const VALID_KEY = 'zk_live_ab12cd34ef56_0123456789abcdefghijklmnopqrstuv';

function createReq(headerValue?: string) {
  return {
    headers: headerValue ? { 'x-zicket-api-key': headerValue } : {},
  } as unknown as DeveloperAuthenticatedReq;
}

function createOrganizerId() {
  return new mongoose.Types.ObjectId();
}

describe('developerAuthGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOne.mockResolvedValue({});
  });

  it('rejects requests with no X-Zicket-API-Key header', async () => {
    const req = createReq();
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
  });

  it('rejects malformed keys without querying the database', async () => {
    const req = createReq('not-a-real-key');
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    expect(mockFindOne).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects when no key matches the prefix', async () => {
    mockFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/Invalid API key/);
  });

  it('rejects revoked keys', async () => {
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'key-1',
        organizerId: createOrganizerId(),
        status: 'revoked',
        permissions: ['tickets:read'],
        hashedKey: 'hashed',
        rateLimit: { windowMs: 60000, maxRequests: 60 },
      }),
    });
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/revoked/);
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('rejects expired keys', async () => {
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'key-1',
        organizerId: createOrganizerId(),
        status: 'active',
        expiresAt: new Date(Date.now() - 1000),
        permissions: ['tickets:read'],
        hashedKey: 'hashed',
        rateLimit: { windowMs: 60000, maxRequests: 60 },
      }),
    });
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/expired/);
  });

  it('rejects when bcrypt comparison fails', async () => {
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'key-1',
        organizerId: createOrganizerId(),
        status: 'active',
        permissions: ['tickets:read'],
        hashedKey: 'hashed',
        rateLimit: { windowMs: 60000, maxRequests: 60 },
      }),
    });
    mockCompare.mockResolvedValue(false);
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard()(req as any, {} as any, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/Invalid API key/);
  });

  it('rejects when the key lacks the required permission', async () => {
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'key-1',
        organizerId: createOrganizerId(),
        status: 'active',
        permissions: ['tickets:read'],
        hashedKey: 'hashed',
        rateLimit: { windowMs: 60000, maxRequests: 60 },
      }),
    });
    mockCompare.mockResolvedValue(true);
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard('credentials:verify')(req as any, {} as any, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.message).toMatch(/credentials:verify/);
  });

  it('attaches req.developer and calls next() on a valid key with the right permission', async () => {
    const organizerId = createOrganizerId();
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'key-1',
        organizerId,
        status: 'active',
        permissions: ['tickets:read', 'tickets:verify'],
        hashedKey: 'hashed',
        rateLimit: { windowMs: 60000, maxRequests: 60 },
      }),
    });
    mockCompare.mockResolvedValue(true);
    const req = createReq(VALID_KEY);
    const next = jest.fn();

    await developerAuthGuard('tickets:read')(req as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(req.developer).toEqual({
      apiKeyId: 'key-1',
      organizerId: organizerId.toString(),
      permissions: ['tickets:read', 'tickets:verify'],
      rateLimit: { windowMs: 60000, maxRequests: 60 },
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'key-1' },
      { $set: { lastUsedAt: expect.any(Date) } },
    );
  });
});
