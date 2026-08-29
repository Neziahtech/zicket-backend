import { Router } from 'express';
import {
  getErasureAssessment,
  requestErasure,
} from '../controllers/account.controller';
import {
  createDeveloperKey,
  listDeveloperKeys,
  revokeDeveloperKey,
} from '../controllers/developer-key.controller';
import { authGuard, authGuardIdentity } from '../middlewares/auth';
import { validateSchema } from '../middlewares/validator';
import { CreateDeveloperKeyBodySchema } from '../validators/developer-key.validator';

const accountRoutes = Router();

accountRoutes.get(
  '/erasure-assessment',
  authGuardIdentity,
  getErasureAssessment,
);
accountRoutes.post('/request-erasure', authGuardIdentity, requestErasure);

// BR-09 / Section 12 — organizer self-service developer API key management.
// Distinct from the public /api/v1/developer/* routes: these are
// authenticated with the organizer's normal JWT session, not an API key.
accountRoutes.post(
  '/developer-keys',
  authGuard,
  validateSchema(CreateDeveloperKeyBodySchema),
  createDeveloperKey,
);
accountRoutes.get('/developer-keys', authGuard, listDeveloperKeys);
accountRoutes.delete('/developer-keys/:id', authGuard, revokeDeveloperKey);

export default accountRoutes;
