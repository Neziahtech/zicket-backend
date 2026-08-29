import { z } from 'zod';
import mongoose from 'mongoose';

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), {
    message: 'Must be a valid ObjectId',
  });

/** GET /api/v1/developer/events/:id/tickets */
export const DeveloperEventParamsSchema = z.object({
  id: objectIdSchema,
});

/** POST /api/v1/developer/tickets/verify */
export const DeveloperVerifyTicketBodySchema = z.object({
  ticketOrderId: objectIdSchema,
  // Optional cross-check: if provided, the ticket must belong to this event.
  eventId: objectIdSchema.optional(),
});

/** POST /api/v1/developer/credentials/verify */
export const DeveloperVerifyCredentialBodySchema = z.object({
  eventId: objectIdSchema,
  nullifier: z.string().min(1, 'nullifier is required'),
});

export type DeveloperEventParams = z.infer<typeof DeveloperEventParamsSchema>;
export type DeveloperVerifyTicketBody = z.infer<
  typeof DeveloperVerifyTicketBodySchema
>;
export type DeveloperVerifyCredentialBody = z.infer<
  typeof DeveloperVerifyCredentialBodySchema
>;
