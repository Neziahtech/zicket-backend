import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

type ValidationSource = 'body' | 'params' | 'query';

/**
 * #167 - Centralized Zod validation middleware.
 *
 * Parses `req[source]` against the given schema. On success, applies the
 * parsed (and possibly coerced/defaulted) data and calls `next()`. On
 * failure, passes the raw ZodError to `next(error)` so it flows through the
 * existing `globalErrorHandler`, which already knows how to format
 * ZodErrors into a consistent `{ status, message, code, details }`
 * response — the same shape every other validation failure in the app
 * already uses.
 *
 * `req.query` is a getter-only property in Express 5, so it can't be
 * reassigned directly like `req.body`/`req.params` can. When source is
 * 'query', the existing object's own keys are cleared and replaced with
 * the parsed values instead of assigning a new object to `req.query`.
 *
 * This replaces the old pattern of calling `schema.safeParse(...)` by hand
 * inside each controller and formatting the error response ad hoc.
 */
export function validateSchema(
  schema: ZodType,
  source: ValidationSource = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(result.error);
      return;
    }
    if (source === 'query') {
      const target = req.query as Record<string, unknown>;
      for (const key of Object.keys(target)) {
        delete target[key];
      }
      Object.assign(target, result.data as Record<string, unknown>);
    } else {
      (req as any)[source] = result.data;
    }
    next();
  };
}
