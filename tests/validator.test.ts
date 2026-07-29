import { validateSchema } from '../src/middlewares/validator';
import { LoginSchema, SignupSchema } from '../src/validators/auth.validator';

describe('validateSchema middleware', () => {
  const createRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  it('calls next() and replaces req.body with parsed data on success', () => {
    const req: any = {
      body: { email: 'test@example.com', password: 'secret123' },
    };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({
      email: 'test@example.com',
      password: 'secret123',
    });
  });

  it('calls next(error) with a ZodError when a required field is missing', () => {
    const req: any = { body: { password: 'secret123' } };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    const err = next.mock.calls[0][0];
    expect(err.name).toBe('ZodError');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next(error) when email is not a valid email format', () => {
    const req: any = { body: { email: 'not-an-email', password: 'secret123' } };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  it('calls next(error) when email is a NoSQL injection payload ($ne)', () => {
    const req: any = { body: { email: { $ne: null }, password: 'secret123' } };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  it('calls next(error) when email is a NoSQL injection payload ($gt)', () => {
    const req: any = { body: { email: { $gt: '' }, password: 'secret123' } };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  it('calls next(error) when password is a NoSQL injection payload', () => {
    const req: any = {
      body: { email: 'test@example.com', password: { $ne: null } },
    };
    const res = createRes();
    const next = jest.fn();

    validateSchema(LoginSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  it('validates the signup schema and rejects a NoSQL injection payload in name', () => {
    const req: any = {
      body: {
        name: { $ne: null },
        email: 'test@example.com',
        password: 'secret123',
      },
    };
    const res = createRes();
    const next = jest.fn();

    validateSchema(SignupSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  it('validates against req.params when source is "params"', () => {
    const req: any = { params: { id: 'invalid' } };
    const res = createRes();
    const next = jest.fn();
    const IdSchema = require('zod').z.object({
      id: require('zod').z.string().uuid(),
    });

    validateSchema(IdSchema, 'params')(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Object));
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });
});
