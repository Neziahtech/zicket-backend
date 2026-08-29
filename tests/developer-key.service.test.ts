import mongoose from 'mongoose';
import DeveloperKeyService from '../src/services/developer-key.service';
import DeveloperApiKey from '../src/models/developer-key';
import * as apiKeyUtil from '../src/utils/developer-api-key';

jest.mock('../src/models/developer-key', () => {
  const MockDeveloperApiKey = jest.fn();
  (MockDeveloperApiKey as any).create = jest.fn();
  (MockDeveloperApiKey as any).find = jest.fn();
  (MockDeveloperApiKey as any).findById = jest.fn();
  return {
    __esModule: true,
    default: MockDeveloperApiKey,
    DEVELOPER_API_PERMISSIONS: [
      'tickets:read',
      'tickets:verify',
      'credentials:verify',
    ],
  };
});

jest.mock('../src/utils/developer-api-key', () => ({
  generateDeveloperApiKey: jest.fn(),
  maskDeveloperApiKey: jest.fn((prefix: string) => `${prefix}…`),
}));

const mockCreate = DeveloperApiKey.create as jest.Mock;
const mockFind = DeveloperApiKey.find as jest.Mock;
const mockFindById = DeveloperApiKey.findById as jest.Mock;
const mockGenerate = apiKeyUtil.generateDeveloperApiKey as jest.Mock;

const ORGANIZER_ID = new mongoose.Types.ObjectId().toString();

describe('DeveloperKeyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createKey', () => {
    it('generates a key, persists the hash, and returns the raw key once', async () => {
      mockGenerate.mockResolvedValue({
        rawKey: 'zk_live_abc_secret',
        keyPrefix: 'zk_live_abc',
        hashedKey: 'hashed-value',
      });
      mockCreate.mockResolvedValue({
        _id: 'key-1',
        name: 'My Portal',
        keyPrefix: 'zk_live_abc',
        permissions: ['tickets:read', 'tickets:verify', 'credentials:verify'],
        rateLimit: { windowMs: 60_000, maxRequests: 60 },
        createdAt: new Date(),
      });

      const result = await DeveloperKeyService.createKey({
        organizerId: ORGANIZER_ID,
        name: 'My Portal',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizerId: ORGANIZER_ID,
          name: 'My Portal',
          keyPrefix: 'zk_live_abc',
          hashedKey: 'hashed-value',
        }),
      );
      expect(result.apiKey).toBe('zk_live_abc_secret');
      expect(result.maskedKey).toBe('zk_live_abc…');
    });

    it('defaults to all permissions when none are provided', async () => {
      mockGenerate.mockResolvedValue({
        rawKey: 'zk_live_abc_secret',
        keyPrefix: 'zk_live_abc',
        hashedKey: 'hashed-value',
      });
      mockCreate.mockResolvedValue({
        _id: 'key-1',
        name: 'My Portal',
        keyPrefix: 'zk_live_abc',
        permissions: ['tickets:read', 'tickets:verify', 'credentials:verify'],
        rateLimit: { windowMs: 60_000, maxRequests: 60 },
        createdAt: new Date(),
      });

      await DeveloperKeyService.createKey({
        organizerId: ORGANIZER_ID,
        name: 'My Portal',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: ['tickets:read', 'tickets:verify', 'credentials:verify'],
        }),
      );
    });
  });

  describe('listKeys', () => {
    it("returns masked summaries for the organizer's keys", async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockResolvedValue([
          {
            _id: 'key-1',
            name: 'Portal A',
            keyPrefix: 'zk_live_abc',
            permissions: ['tickets:read'],
            status: 'active',
            rateLimit: { windowMs: 60_000, maxRequests: 60 },
            lastUsedAt: null,
            createdAt: new Date(),
          },
        ]),
      });

      const result = await DeveloperKeyService.listKeys(ORGANIZER_ID);

      expect(mockFind).toHaveBeenCalledWith({ organizerId: ORGANIZER_ID });
      expect(result).toHaveLength(1);
      expect(result[0].maskedKey).toBe('zk_live_abc…');
      expect((result[0] as any).hashedKey).toBeUndefined();
    });
  });

  describe('revokeKey', () => {
    it('throws NotFoundError when the key does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        DeveloperKeyService.revokeKey(ORGANIZER_ID, 'key-1'),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws ForbiddenError when the key belongs to another organizer', async () => {
      mockFindById.mockResolvedValue({
        organizerId: new mongoose.Types.ObjectId(),
        status: 'active',
      });

      await expect(
        DeveloperKeyService.revokeKey(ORGANIZER_ID, 'key-1'),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('marks the key as revoked and saves it', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      mockFindById.mockResolvedValue({
        organizerId: ORGANIZER_ID,
        status: 'active',
        save,
      });

      await DeveloperKeyService.revokeKey(ORGANIZER_ID, 'key-1');

      expect(save).toHaveBeenCalled();
    });

    it('is idempotent for an already-revoked key', async () => {
      const save = jest.fn();
      mockFindById.mockResolvedValue({
        organizerId: ORGANIZER_ID,
        status: 'revoked',
        save,
      });

      await DeveloperKeyService.revokeKey(ORGANIZER_ID, 'key-1');

      expect(save).not.toHaveBeenCalled();
    });
  });
});
