import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import DeveloperApiKey from '../src/models/developer-key';
import DeveloperRateLimitService from '../src/services/developer-rate-limit.service';
import DeveloperApiService from '../src/services/developer-api.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../src/models/developer-key', () => {
  const MockDeveloperApiKey = jest.fn();
  (MockDeveloperApiKey as any).findOne = jest.fn();
  (MockDeveloperApiKey as any).updateOne = jest.fn().mockResolvedValue({});
  return {
    __esModule: true,
    default: MockDeveloperApiKey,
    DEVELOPER_API_PERMISSIONS: [
      'tickets:read',
      'tickets:verify',
      'credentials:verify',
    ],
  };
});

jest.mock('../src/services/developer-rate-limit.service', () => ({
  __esModule: true,
  default: {
    checkAndIncrement: jest.fn(),
  },
}));

jest.mock('../src/services/developer-api.service', () => ({
  __esModule: true,
  default: {
    getEventTicketAvailability: jest.fn(),
    verifyTicket: jest.fn(),
    verifyCredential: jest.fn(),
  },
}));

const bcrypt = require('bcrypt');
const mockCompare = bcrypt.compare as jest.Mock;
const mockFindOne = DeveloperApiKey.findOne as jest.Mock;
const mockRateLimit = DeveloperRateLimitService.checkAndIncrement as jest.Mock;
const mockGetAvailability =
  DeveloperApiService.getEventTicketAvailability as jest.Mock;
const mockVerifyTicket = DeveloperApiService.verifyTicket as jest.Mock;
const mockVerifyCredential = DeveloperApiService.verifyCredential as jest.Mock;

const VALID_KEY = 'zk_live_ab12cd34ef56_0123456789abcdefghijklmnopqrstuv';
const EVENT_ID = new mongoose.Types.ObjectId().toString();
const TICKET_ORDER_ID = new mongoose.Types.ObjectId().toString();

function mockActiveKey(overrides: Partial<Record<string, any>> = {}) {
  mockFindOne.mockReturnValue({
    select: jest.fn().mockResolvedValue({
      _id: 'key-1',
      organizerId: new mongoose.Types.ObjectId(),
      status: 'active',
      permissions: ['tickets:read', 'tickets:verify', 'credentials:verify'],
      hashedKey: 'hashed',
      rateLimit: { windowMs: 60_000, maxRequests: 60 },
      ...overrides,
    }),
  });
  mockCompare.mockResolvedValue(true);
  mockRateLimit.mockResolvedValue({
    allowed: true,
    count: 1,
    limit: 60,
    remaining: 59,
    retryAfterMs: 60_000,
  });
}

describe('Developer API routes (/api/v1/developer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 with no X-Zicket-API-Key header', async () => {
      const res = await request(app).get(
        `/api/v1/developer/events/${EVENT_ID}/tickets`,
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for an unknown API key', async () => {
      mockFindOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const res = await request(app)
        .get(`/api/v1/developer/events/${EVENT_ID}/tickets`)
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(401);
    });

    it('returns 401 for a revoked API key', async () => {
      mockActiveKey({ status: 'revoked' });

      const res = await request(app)
        .get(`/api/v1/developer/events/${EVENT_ID}/tickets`)
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(401);
    });

    it('returns 403 when the key lacks the required permission', async () => {
      mockActiveKey({ permissions: ['credentials:verify'] });

      const res = await request(app)
        .get(`/api/v1/developer/events/${EVENT_ID}/tickets`)
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 once the per-key budget is exhausted', async () => {
      mockActiveKey();
      mockRateLimit.mockResolvedValue({
        allowed: false,
        count: 61,
        limit: 60,
        remaining: 0,
        retryAfterMs: 15_000,
      });

      const res = await request(app)
        .get(`/api/v1/developer/events/${EVENT_ID}/tickets`)
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('DEVELOPER_RATE_LIMIT_EXCEEDED');
      expect(res.headers['retry-after']).toBe('15');
    });
  });

  describe('GET /events/:id/tickets', () => {
    it('returns 200 with availability data for a valid key', async () => {
      mockActiveKey();
      mockGetAvailability.mockResolvedValue({
        eventId: EVENT_ID,
        name: 'Test Event',
        eventStatus: 'upcoming',
        eventDate: new Date(),
        totalTickets: 100,
        availableTickets: 40,
        soldTickets: 60,
        ticketType: [],
      });

      const res = await request(app)
        .get(`/api/v1/developer/events/${EVENT_ID}/tickets`)
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(EVENT_ID);
    });

    it('returns 400 for a malformed event id', async () => {
      mockActiveKey();

      const res = await request(app)
        .get('/api/v1/developer/events/not-an-id/tickets')
        .set('X-Zicket-API-Key', VALID_KEY);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /tickets/verify', () => {
    it('returns 200 with the verification result', async () => {
      mockActiveKey();
      mockVerifyTicket.mockResolvedValue({
        valid: true,
        ticket: {
          id: TICKET_ORDER_ID,
          eventId: EVENT_ID,
          eventName: 'Test Event',
          ticketType: 'GA',
          quantity: 1,
          isUsed: false,
          usedAt: null,
          purchasedAt: new Date(),
        },
      });

      const res = await request(app)
        .post('/api/v1/developer/tickets/verify')
        .set('X-Zicket-API-Key', VALID_KEY)
        .send({ ticketOrderId: TICKET_ORDER_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('returns 400 when ticketOrderId is missing', async () => {
      mockActiveKey();

      const res = await request(app)
        .post('/api/v1/developer/tickets/verify')
        .set('X-Zicket-API-Key', VALID_KEY)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /credentials/verify', () => {
    it('returns 200 with the credential verification result', async () => {
      mockActiveKey();
      mockVerifyCredential.mockResolvedValue({
        verified: true,
        eventId: EVENT_ID,
        attendedAt: new Date(),
        onChainTxHash: '0xabc',
      });

      const res = await request(app)
        .post('/api/v1/developer/credentials/verify')
        .set('X-Zicket-API-Key', VALID_KEY)
        .send({ eventId: EVENT_ID, nullifier: '42' });

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
    });

    it('returns 400 when nullifier is missing', async () => {
      mockActiveKey();

      const res = await request(app)
        .post('/api/v1/developer/credentials/verify')
        .set('X-Zicket-API-Key', VALID_KEY)
        .send({ eventId: EVENT_ID });

      expect(res.status).toBe(400);
    });
  });
});
