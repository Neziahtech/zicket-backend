import mongoose, { Schema, Document } from 'mongoose';

/**
 * BR-09 / Section 12 — Developer Infrastructure API.
 *
 * Scoped permissions a developer API key can be granted. Third-party apps
 * only get read/verify access — nothing here can mutate ticket inventory
 * or issue tickets, so a leaked key can't be used to sell or forge tickets.
 */
export const DEVELOPER_API_PERMISSIONS = [
  'tickets:read',
  'tickets:verify',
  'credentials:verify',
] as const;

export type DeveloperApiPermission = (typeof DEVELOPER_API_PERMISSIONS)[number];

export interface IDeveloperApiKeyRateLimit {
  /** Rolling window size, in milliseconds. */
  windowMs: number;
  /** Max requests allowed per window for this key. */
  maxRequests: number;
}

export interface IDeveloperApiKey extends Document {
  /** Organizer (User) this key was issued to and acts on behalf of. */
  organizerId: mongoose.Types.ObjectId;
  /** Human-readable label, e.g. "Acme Event Portal — Production". */
  name: string;
  /**
   * Non-secret lookup prefix of the raw key (e.g. `zk_live_ab12cd34`).
   * Used to find the candidate document in O(1) before the expensive
   * bcrypt comparison against `hashedKey`. Never sufficient on its own
   * to authenticate.
   */
  keyPrefix: string;
  /** bcrypt hash of the full raw API key. The raw key is never stored. */
  hashedKey: string;
  /** Scopes this key is allowed to use. */
  permissions: DeveloperApiPermission[];
  status: 'active' | 'revoked';
  rateLimit: IDeveloperApiKeyRateLimit;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  /** Optional hard expiry; null/undefined means the key does not expire. */
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const rateLimitSchema = new Schema<IDeveloperApiKeyRateLimit>(
  {
    windowMs: { type: Number, required: true, min: 1000, default: 60_000 },
    maxRequests: { type: Number, required: true, min: 1, default: 60 },
  },
  { _id: false },
);

const developerApiKeySchema = new Schema<IDeveloperApiKey>(
  {
    organizerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    keyPrefix: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    hashedKey: { type: String, required: true, select: false },
    permissions: {
      type: [{ type: String, enum: DEVELOPER_API_PERMISSIONS }],
      required: true,
      default: [...DEVELOPER_API_PERMISSIONS],
      validate: {
        validator: (value: string[]) =>
          Array.isArray(value) && value.length > 0,
        message: 'At least one permission is required',
      },
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      required: true,
      index: true,
    },
    rateLimit: { type: rateLimitSchema, required: true, default: () => ({}) },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Fast per-organizer key listing ("show me my API keys").
developerApiKeySchema.index({ organizerId: 1, status: 1 });

const DeveloperApiKey = mongoose.model<IDeveloperApiKey>(
  'DeveloperApiKey',
  developerApiKeySchema,
);

export default DeveloperApiKey;
