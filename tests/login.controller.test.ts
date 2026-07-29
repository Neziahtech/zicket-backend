import { loginController } from '../src/controllers/login.controller';
import User from '../src/models/user';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));
jest.mock('../src/models/user', () => {
  const MockUser = jest.fn();
  (MockUser as any).findOne = jest.fn();
  return { __esModule: true, default: MockUser };
});
jest.mock('../src/utils/token', () => ({
  generateAccessToken: jest.fn().mockReturnValue('mock-token'),
}));

describe('loginController', () => {
  const createResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when user not found', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(null);
    const req = {
      body: { email: 'nonexistent@example.com', password: 'secret123' },
    };
    const res = createResponse();
    await loginController(req as any, res as any, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('calls next(error) on unexpected error', async () => {
    (User.findOne as jest.Mock).mockRejectedValue(new Error('db down'));
    const req = {
      body: { email: 'test@example.com', password: 'secret123' },
    };
    const res = createResponse();
    const next = jest.fn();
    await loginController(req as any, res as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
