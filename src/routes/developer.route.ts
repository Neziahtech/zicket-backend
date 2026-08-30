import { Router } from 'express';
import { developerAuthGuard } from '../middlewares/developer-auth.middleware';
import { developerRateLimiter } from '../middlewares/developer-rate-limit.middleware';
import { validateSchema } from '../middlewares/validator';
import {
  DeveloperEventParamsSchema,
  DeveloperVerifyTicketBodySchema,
  DeveloperVerifyCredentialBodySchema,
} from '../validators/developer.validator';
import {
  getEventTicketAvailability,
  verifyTicket,
  verifyCredential,
} from '../controllers/developer.controller';

/**
 * BR-09 / Section 12 — Developer Infrastructure API.
 *
 * Mounted at `/api/v1/developer` in `src/app.ts`. Every route requires a
 * valid `X-Zicket-API-Key` header (see `developerAuthGuard`) scoped to
 * the specific permission it needs, and is rate-limited per API key
 * (see `developerRateLimiter`). Request bodies/params are validated with
 * `validateSchema` before hitting the controller, consistent with the
 * rest of the codebase.
 *
 * Auth runs before rate limiting so an invalid key is rejected with 401
 * without consuming any of a real key's request budget.
 */
const developerRoutes = Router();

// GET /api/v1/developer/events/:id/tickets — ticket availability for an event.
developerRoutes.get(
  '/events/:id/tickets',
  developerAuthGuard('tickets:read'),
  developerRateLimiter,
  validateSchema(DeveloperEventParamsSchema, 'params'),
  getEventTicketAvailability,
);

// POST /api/v1/developer/tickets/verify — verify ticket state and ownership.
developerRoutes.post(
  '/tickets/verify',
  developerAuthGuard('tickets:verify'),
  developerRateLimiter,
  validateSchema(DeveloperVerifyTicketBodySchema, 'body'),
  verifyTicket,
);

// POST /api/v1/developer/credentials/verify — verify attendance credentials.
developerRoutes.post(
  '/credentials/verify',
  developerAuthGuard('credentials:verify'),
  developerRateLimiter,
  validateSchema(DeveloperVerifyCredentialBodySchema, 'body'),
  verifyCredential,
);

export default developerRoutes;
