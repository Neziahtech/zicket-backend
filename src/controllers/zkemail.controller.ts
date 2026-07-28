import { RequestHandler } from 'express';
import { z } from 'zod';
import queueService from '../services/queue.service';

export const ZkEmailHookSchema = z.object({
  hashedEmail: z
    .string()
    .regex(
      /^[a-f0-9]{64}$/,
      'hashedEmail must be a SHA256 hex string (64 lowercase hex characters)',
    ),
});

export const zkEmailHookController: RequestHandler = async (req, res, next) => {
  try {
    const { hashedEmail } = req.body;
    const jobId = await queueService.enqueueZkEmailHook(hashedEmail);
    res.status(202).json({
      message: 'zkEmail flow queued',
      jobId,
    });
  } catch (error) {
    next(error);
  }
};
