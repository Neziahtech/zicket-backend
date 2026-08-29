import { z } from 'zod';
import { DEVELOPER_API_PERMISSIONS } from '../models/developer-key';

export const CreateDeveloperKeyBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  permissions: z
    .array(z.enum([...DEVELOPER_API_PERMISSIONS]))
    .min(1)
    .optional(),
  rateLimit: z
    .object({
      windowMs: z.number().int().min(1000).optional(),
      maxRequests: z.number().int().min(1).optional(),
    })
    .optional(),
});

export type CreateDeveloperKeyBody = z.infer<
  typeof CreateDeveloperKeyBodySchema
>;
