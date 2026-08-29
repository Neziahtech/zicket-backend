import { RequestHandler } from 'express';
import DeveloperApiService from '../services/developer-api.service';
import { DeveloperAuthenticatedReq } from '../middlewares/developer-auth.middleware';
import { UnauthorizedError } from '../errors/AppError';

function getOrganizerId(req: DeveloperAuthenticatedReq): string {
  if (!req.developer) {
    // Defensive only — developerAuthGuard always runs first on these routes.
    throw new UnauthorizedError('Developer authentication required');
  }
  return req.developer.organizerId;
}

/**
 * GET /api/v1/developer/events/:id/tickets
 * Query ticket availability for an event owned by the calling API key's organizer.
 */
export const getEventTicketAvailability: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const organizerId = getOrganizerId(req as DeveloperAuthenticatedReq);
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    const data = await DeveloperApiService.getEventTicketAvailability(
      id,
      organizerId,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/developer/tickets/verify
 * Verifies ticket state and ownership without marking it as used.
 */
export const verifyTicket: RequestHandler = async (req, res, next) => {
  try {
    const organizerId = getOrganizerId(req as DeveloperAuthenticatedReq);
    const { ticketOrderId, eventId } = req.body;

    const data = await DeveloperApiService.verifyTicket(
      { ticketOrderId, eventId },
      organizerId,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/developer/credentials/verify
 * Verifies an attendance credential (zkPassport nullifier) for an event.
 */
export const verifyCredential: RequestHandler = async (req, res, next) => {
  try {
    const organizerId = getOrganizerId(req as DeveloperAuthenticatedReq);
    const { eventId, nullifier } = req.body;

    const data = await DeveloperApiService.verifyCredential(
      { eventId, nullifier },
      organizerId,
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
