import { RequestHandler } from 'express';
import { UserAuthenticatedReq } from '../utils/types';
import DeveloperKeyService from '../services/developer-key.service';

function getOrganizerId(req: UserAuthenticatedReq): string | undefined {
  return req.user?._id?.toString() || (req.user as { id?: string })?.id;
}

/**
 * POST /account/developer-keys
 * Issues a new developer API key for the authenticated organizer.
 * The raw key is returned ONLY in this response — Zicket never stores
 * or displays it again after this point.
 */
export const createDeveloperKey: RequestHandler = async (req, res, next) => {
  try {
    const organizerId = getOrganizerId(req as UserAuthenticatedReq);
    if (!organizerId) {
      return res
        .status(401)
        .json({ error: 'Unauthorized', message: 'Authentication required' });
    }

    const { name, permissions, rateLimit } = req.body;

    const key = await DeveloperKeyService.createKey({
      organizerId,
      name,
      permissions,
      rateLimit,
    });

    res.status(201).json({ success: true, data: key });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /account/developer-keys
 * Lists the authenticated organizer's developer API keys (masked — the
 * raw secret is never returned after creation).
 */
export const listDeveloperKeys: RequestHandler = async (req, res, next) => {
  try {
    const organizerId = getOrganizerId(req as UserAuthenticatedReq);
    if (!organizerId) {
      return res
        .status(401)
        .json({ error: 'Unauthorized', message: 'Authentication required' });
    }

    const keys = await DeveloperKeyService.listKeys(organizerId);
    res.status(200).json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /account/developer-keys/:id
 * Revokes a developer API key. Idempotent — revoking an already-revoked
 * key succeeds without error.
 */
export const revokeDeveloperKey: RequestHandler = async (req, res, next) => {
  try {
    const organizerId = getOrganizerId(req as UserAuthenticatedReq);
    if (!organizerId) {
      return res
        .status(401)
        .json({ error: 'Unauthorized', message: 'Authentication required' });
    }

    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    await DeveloperKeyService.revokeKey(organizerId, id);

    res.status(200).json({
      success: true,
      message: 'API key revoked',
    });
  } catch (error) {
    next(error);
  }
};
