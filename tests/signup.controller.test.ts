import { signupController } from '../src/controllers/signup.controller';
import User from '../src/models/user';
import emailService from '../src/services/email.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
}));

jest.mock('../src/models/user', () => {
  const mockSave = jest.fn().mockResolvedValue(undefined);
  const MockUser = jest.fn().mockImplementation(function (
    this: any,
    data: any,
  ) {
    this.save = mockSave;
    this.name = data?.name;
    this.email = data?.email;
    this.password = data?.password;
    this.provider = data?.provider;
    this.otp = data?.otp;
    this.otpExpires = data?.otpExpires;
    return this;
  });
  (MockUser as any).findOne = jest.fn();
  return { __esModule: true, default: MockUser };
});

jest.mock('../src/services/email.service', () => ({
  __esModule: true,
  default: { sendVerificationOtp: jest.fn() },
}));

describe('signup controller', () => {
  const mockSendVerificationOtp = emailService.sendVerificationOtp as jest.Mock;

  const createResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendVerificationOtp.mockResolvedValue(undefined);
  });

  it('returns 400 when email is already in use', async () => {
    (User.findOne as jest.Mock).mockResolvedValue({
      email: 'existing@example.com',
    });
    const req = {
      body: {
        name: 'Test',
        email: 'existing@example.com',
        password: 'secret123',
      },
    };
    const res = createResponse();
    await signupController(req as any, res as any, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Email is already in use',
    });
  });

  it('returns 400 without leaking database details when save hits duplicate key', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(null);
    (User as unknown as jest.Mock).mockImplementationOnce(function (
      this: any,
      data: any,
    ) {
      Object.assign(this, data);
      this.save = jest.fn().mockRejectedValue({
        code: 11000,
        message:
          'E11000 duplicate key error collection: zicket.users index: email_1 dup key',
      });
      return this;
    });

    const req = {
      body: {
        name: 'Race User',
        email: 'race@example.com',
        password: 'secret123',
      },
    };
    const res = createResponse();
    await signupController(req as any, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Email is already in use',
    });
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('E11000'),
      }),
    );
    expect(mockSendVerificationOtp).not.toHaveBeenCalled();
  });

  it('calls next(error) on unexpected save error', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(null);
    (User as unknown as jest.Mock).mockImplementationOnce(function (
      this: any,
      data: any,
    ) {
      Object.assign(this, data);
      this.save = jest.fn().mockRejectedValue(new Error('db down'));
      return this;
    });

    const req = {
      body: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'secret123',
      },
    };
    const res = createResponse();
    const next = jest.fn();
    await signupController(req as any, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('creates user with OTP and sends verification email', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(null);

    const req = {
      body: {
        name: 'New User',
        email: 'new@example.com',
        password: 'secret123',
      },
    };
    const res = createResponse();
    await signupController(req as any, res as any, jest.fn());

    expect(User).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New User',
        email: 'new@example.com',
        provider: 'local',
      }),
    );
    const constructorCall = (User as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorCall.otp).toBeDefined();
    expect(typeof constructorCall.otp).toBe('number');
    expect(constructorCall.otpExpires).toBeInstanceOf(Date);
    const createdInstance = (User as unknown as jest.Mock).mock.results[0]
      .value;
    expect(createdInstance.save).toHaveBeenCalled();
    expect(mockSendVerificationOtp).toHaveBeenCalledWith(
      'new@example.com',
      constructorCall.otp,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message:
        'User registered successfully. Please verify your account with the OTP sent to your email.',
    });
  });
});
