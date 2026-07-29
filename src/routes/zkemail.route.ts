import { Router } from 'express';
import {
  zkEmailHookController,
  ZkEmailHookSchema,
} from '../controllers/zkemail.controller';
import { validateSchema } from '../middlewares/validator';

const zkEmailRoutes = Router();

zkEmailRoutes.post(
  '/hook',
  validateSchema(ZkEmailHookSchema),
  zkEmailHookController,
);

export default zkEmailRoutes;
