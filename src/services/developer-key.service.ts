import DeveloperApiKey, {
  DEVELOPER_API_PERMISSIONS,
  DeveloperApiPermission,
} from '../models/developer-key';
import {
  generateDeveloperApiKey,
  maskDeveloperApiKey,
} from '../utils/developer-api-key';
import { NotFoundError, ForbiddenError } from '../errors/AppError';

export interface CreateDeveloperKeyInput {
  organizerId: string;
  name: string;
  permissions?: DeveloperApiPermission[];
  rateLimit?: { windowMs?: number; maxRequests?: number };
}

export interface CreatedDeveloperKey {
  id: string;
  name: string;
  /** Shown ONLY on creation — never retrievable again after this response. */
  apiKey: string;
  maskedKey: string;
  permissions: DeveloperApiPermission[];
  rateLimit: { windowMs: number; maxRequests: number };
  createdAt: Date;
}

export interface DeveloperKeySummary {
  id: string;
  name: string;
  maskedKey: string;
  permissions: DeveloperApiPermission[];
  status: 'active' | 'revoked';
  rateLimit: { windowMs: number; maxRequests: number };
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Organizer self-service management of their own developer API keys.
 * Mounted behind the normal JWT `authGuard` (see `account.route.ts`) —
 * distinct from `developerAuthGuard`, which authenticates *with* an
 * API key rather than managing one.
 */
export class DeveloperKeyService {
  static async createKey(
    input: CreateDeveloperKeyInput,
  ): Promise<CreatedDeveloperKey> {
    const { organizerId, name } = input;
    const permissions =
      input.permissions && input.permissions.length > 0
        ? input.permissions
        : [...DEVELOPER_API_PERMISSIONS];

    const { rawKey, keyPrefix, hashedKey } = await generateDeveloperApiKey();

    const doc = await DeveloperApiKey.create({
      organizerId,
      name,
      keyPrefix,
      hashedKey,
      permissions,
      rateLimit: {
        windowMs: input.rateLimit?.windowMs ?? 60_000,
        maxRequests: input.rateLimit?.maxRequests ?? 60,
      },
    });

    return {
      id: doc._id.toString(),
      name: doc.name,
      apiKey: rawKey,
      maskedKey: maskDeveloperApiKey(doc.keyPrefix),
      permissions: doc.permissions,
      rateLimit: doc.rateLimit,
      createdAt: doc.createdAt as Date,
    };
  }

  static async listKeys(organizerId: string): Promise<DeveloperKeySummary[]> {
    const keys = await DeveloperApiKey.find({ organizerId }).sort({
      createdAt: -1,
    });

    return keys.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      maskedKey: maskDeveloperApiKey(doc.keyPrefix),
      permissions: doc.permissions,
      status: doc.status,
      rateLimit: doc.rateLimit,
      lastUsedAt: doc.lastUsedAt ?? null,
      createdAt: doc.createdAt as Date,
    }));
  }

  static async revokeKey(organizerId: string, keyId: string): Promise<void> {
    const doc = await DeveloperApiKey.findById(keyId);

    if (!doc) {
      throw new NotFoundError('API key not found');
    }

    if (doc.organizerId.toString() !== organizerId) {
      throw new ForbiddenError('You do not own this API key');
    }

    if (doc.status === 'revoked') {
      return; // idempotent
    }

    doc.status = 'revoked';
    doc.revokedAt = new Date();
    await doc.save();
  }
}

export default DeveloperKeyService;
