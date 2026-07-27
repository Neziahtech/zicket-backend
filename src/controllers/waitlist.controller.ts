import { RequestHandler } from 'express';
import mongoose from 'mongoose';
import WaitlistService from '../services/waitlist.service';
import { UserAuthenticatedReq } from '../utils/types';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
} from '../errors/AppError';

function getUserId(req: UserAuthenticatedReq): string | undefined {
  return req.user?._id?.toString?.() ?? req.user?.id;
}

/**
 * POST /api/event-tickets/:eventId/waitlist
 * Join the waitlist for a sold-out event.
 */
export const joinWaitlist: RequestHandler = async (
  req: UserAuthenticatedReq,
  res,
) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { eventId } = req.params as { eventId: string };
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new ValidationError('Invalid event ID');
    }

    const entry = await WaitlistService.join(userId, eventId);
    return res.status(201).json({ success: true, data: entry });
  } catch (error) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, error: error.code, message: error.message });
    }
    return res.status(400).json({
      success: false,
      error: 'WAITLIST_JOIN_FAILED',
      message:
        error instanceof Error ? error.message : 'Failed to join waitlist',
    });
  }
};

/**
 * DELETE /api/event-tickets/:eventId/waitlist
 * Leave the waitlist (or give up a held spot).
 */
export const leaveWaitlist: RequestHandler = async (
  req: UserAuthenticatedReq,
  res,
) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { eventId } = req.params as { eventId: string };
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new ValidationError('Invalid event ID');
    }

    await WaitlistService.leave(userId, eventId);
    return res
      .status(200)
      .json({ success: true, message: 'Removed from waitlist' });
  } catch (error) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, error: error.code, message: error.message });
    }
    return res.status(400).json({
      success: false,
      error: 'WAITLIST_LEAVE_FAILED',
      message:
        error instanceof Error ? error.message : 'Failed to leave waitlist',
    });
  }
};

/**
 * GET /api/event-tickets/:eventId/waitlist/status
 * Current waitlist status + position for the authenticated user.
 */
export const getWaitlistStatus: RequestHandler = async (
  req: UserAuthenticatedReq,
  res,
) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { eventId } = req.params as { eventId: string };
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new ValidationError('Invalid event ID');
    }

    const status = await WaitlistService.getStatus(userId, eventId);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, error: error.code, message: error.message });
    }
    return res.status(400).json({
      success: false,
      error: 'WAITLIST_STATUS_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to fetch waitlist status',
    });
  }
};
