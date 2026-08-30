import { RequestHandler } from 'express';
import DeveloperRateLimitService from '../services/developer-rate-limit.service';
import { DeveloperAuthenticatedReq } from './developer-auth.middleware';
import { UnauthorizedError } from '../errors/AppError';

const DEFAULT_WINDOW_MS =
  Number(process.env.DEVELOPER_API_RATE_LIMIT_WINDOW_MS) || 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS =
  Number(process.env.DEVELOPER_API_RATE_LIMIT_MAX) || 60; // 60 req/min

/**
 * BR-09 / Section 12 — per-API-key rate limiting for the public developer
 * API. Must run *after* `developerAuthGuard`, which populates
 * `req.developer` (used both as the rate-limit key and as the source of
 * any per-key override of the default window/quota).
 *
 * Responds 429 with `Retry-After` / `X-RateLimit-*` headers when the
 * key's budget for the current window is exhausted.
 */
export const developerRateLimiter: RequestHandler = async (req, res, next) => {
  const developer = (req as DeveloperAuthenticatedReq).developer;

  if (!developer) {
    // developerAuthGuard should always run first; this is a defensive
    // guard against misconfigured route ordering, not the normal path.
    return next(new UnauthorizedError('Developer authentication required'));
  }

  const windowMs = developer.rateLimit?.windowMs || DEFAULT_WINDOW_MS;
  const maxRequests = developer.rateLimit?.maxRequests || DEFAULT_MAX_REQUESTS;

  const result = await DeveloperRateLimitService.checkAndIncrement(
    developer.apiKeyId,
    windowMs,
    maxRequests,
  );

  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader(
    'X-RateLimit-Reset',
    String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)),
  );

  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(429).json({
      status: 429,
      message:
        'Developer API rate limit exceeded. Please slow down your requests.',
      code: 'DEVELOPER_RATE_LIMIT_EXCEEDED',
      retryAfterMs: result.retryAfterMs,
    });
  }

  next();
};
