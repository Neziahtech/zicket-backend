import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Developer API key format (mirrors the Stripe/GitHub PAT pattern):
 *
 *   zk_live_<12-char prefix><31-char secret>
 *
 * The prefix portion is stored in plaintext (`keyPrefix`) so the auth
 * middleware can look up the candidate key document with a single indexed
 * query before paying the cost of a bcrypt comparison. The prefix alone
 * is never sufficient to authenticate — only `bcrypt.compare` against the
 * full raw key can succeed.
 */
const KEY_LABEL = 'zk_live';
const PREFIX_BYTES = 9; // -> 12 base64url chars
const SECRET_BYTES = 24; // -> 32 base64url chars
const BCRYPT_SALT_ROUNDS = 10;

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface GeneratedDeveloperApiKey {
  /** The full secret to hand to the developer exactly once — never persisted. */
  rawKey: string;
  /** Non-secret prefix persisted for fast lookup. */
  keyPrefix: string;
  /** bcrypt hash of `rawKey`, safe to persist. */
  hashedKey: string;
}

/**
 * Mints a brand new developer API key. The caller is responsible for
 * persisting `keyPrefix` + `hashedKey` and returning `rawKey` to the
 * developer exactly once (it cannot be recovered afterwards).
 */
export async function generateDeveloperApiKey(): Promise<GeneratedDeveloperApiKey> {
  const prefixPart = toBase64Url(crypto.randomBytes(PREFIX_BYTES));
  const secretPart = toBase64Url(crypto.randomBytes(SECRET_BYTES));

  const keyPrefix = `${KEY_LABEL}_${prefixPart}`;
  const rawKey = `${keyPrefix}_${secretPart}`;
  const hashedKey = await bcrypt.hash(rawKey, BCRYPT_SALT_ROUNDS);

  return { rawKey, keyPrefix, hashedKey };
}

/**
 * Extracts the lookup prefix (`zk_live_<12 chars>`) from a raw API key
 * presented on a request, or `null` if it doesn't match the expected
 * shape at all (cheap rejection before hitting the database).
 */
export function extractDeveloperApiKeyPrefix(rawKey: string): string | null {
  if (typeof rawKey !== 'string') return null;
  const match = rawKey.match(/^(zk_live_[A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{32}$/);
  return match ? match[1] : null;
}

/**
 * Verifies a raw key against a stored bcrypt hash.
 */
export async function verifyDeveloperApiKey(
  rawKey: string,
  hashedKey: string,
): Promise<boolean> {
  return bcrypt.compare(rawKey, hashedKey);
}

/** Masked form safe to display back to organizers, e.g. `zk_live_ab12cd34…`. */
export function maskDeveloperApiKey(keyPrefix: string): string {
  return `${keyPrefix}…`;
}
