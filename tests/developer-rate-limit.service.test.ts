import DeveloperRateLimitService from '../src/services/developer-rate-limit.service';

const mockIncr = jest.fn();
const mockPExpire = jest.fn();
const mockPTTL = jest.fn();
const mockDel = jest.fn();
const mockOn = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/config/queue', () => ({
  redisConfig: { host: 'localhost', port: 6379 },
}));

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    isOpen: true,
    on: mockOn,
    connect: mockConnect,
    incr: mockIncr,
    pExpire: mockPExpire,
    pTTL: mockPTTL,
    del: mockDel,
  })),
}));

describe('DeveloperRateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the lazily-created singleton client between tests.
    (DeveloperRateLimitService as any).redisClient = null;
  });

  it('allows the first request in a window and sets an expiry', async () => {
    mockIncr.mockResolvedValue(1);
    mockPTTL.mockResolvedValue(60_000);

    const result = await DeveloperRateLimitService.checkAndIncrement(
      'key-1',
      60_000,
      5,
    );

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.remaining).toBe(4);
    expect(mockPExpire).toHaveBeenCalledWith(
      'developer_api:rate_limit:key-1',
      60_000,
    );
  });

  it('does not reset the expiry on subsequent requests within the window', async () => {
    mockIncr.mockResolvedValue(3);
    mockPTTL.mockResolvedValue(30_000);

    const result = await DeveloperRateLimitService.checkAndIncrement(
      'key-1',
      60_000,
      5,
    );

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(3);
    expect(mockPExpire).not.toHaveBeenCalled();
  });

  it('blocks requests once the count exceeds the limit', async () => {
    mockIncr.mockResolvedValue(6);
    mockPTTL.mockResolvedValue(10_000);

    const result = await DeveloperRateLimitService.checkAndIncrement(
      'key-1',
      60_000,
      5,
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(10_000);
  });

  it('fails open when Redis throws', async () => {
    mockIncr.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await DeveloperRateLimitService.checkAndIncrement(
      'key-1',
      60_000,
      5,
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
