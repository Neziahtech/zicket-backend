import mongoose from 'mongoose';
import DeveloperApiService from '../src/services/developer-api.service';
import EventTicket from '../src/models/event-ticket';
import TicketOrder from '../src/models/ticket-order';
import AttendanceNullifier from '../src/models/attendance-nullifier';
import { attendanceNullifierDigest } from '../src/utils/attendance-nullifier-digest';

jest.mock('../src/models/event-ticket');
jest.mock('../src/models/ticket-order');
jest.mock('../src/models/attendance-nullifier');

const mockEventTicket = EventTicket as jest.Mocked<typeof EventTicket>;
const mockTicketOrder = TicketOrder as jest.Mocked<typeof TicketOrder>;
const mockAttendanceNullifier = AttendanceNullifier as jest.Mocked<
  typeof AttendanceNullifier
>;

const ORGANIZER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_ORGANIZER_ID = new mongoose.Types.ObjectId().toString();
const EVENT_ID = new mongoose.Types.ObjectId().toString();

describe('DeveloperApiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ATTENDANCE_NULLIFIER_PEPPER = 'test-pepper';
  });

  describe('getEventTicketAvailability', () => {
    it('throws NotFoundError when the event does not exist', async () => {
      mockEventTicket.findById.mockResolvedValue(null as any);

      await expect(
        DeveloperApiService.getEventTicketAvailability(EVENT_ID, ORGANIZER_ID),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws ForbiddenError when the key does not own the event', async () => {
      mockEventTicket.findById.mockResolvedValue({
        _id: EVENT_ID,
        organizedBy: OTHER_ORGANIZER_ID,
      } as any);

      await expect(
        DeveloperApiService.getEventTicketAvailability(EVENT_ID, ORGANIZER_ID),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns availability data for the organizer's own event", async () => {
      mockEventTicket.findById.mockResolvedValue({
        _id: EVENT_ID,
        organizedBy: ORGANIZER_ID,
        name: 'Devcon',
        eventStatus: 'upcoming',
        eventDate: new Date('2026-10-01'),
        totalTickets: 100,
        availableTickets: 30,
        soldTickets: 70,
        ticketType: [
          {
            ticketName: 'GA',
            quantity: 100,
            currencyOrToken: 'XLM',
            price: 10,
          },
        ],
      } as any);

      const result = await DeveloperApiService.getEventTicketAvailability(
        EVENT_ID,
        ORGANIZER_ID,
      );

      expect(result.availableTickets).toBe(30);
      expect(result.ticketType).toHaveLength(1);
    });
  });

  describe('verifyTicket', () => {
    it('throws NotFoundError when the ticket does not exist', async () => {
      mockTicketOrder.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(
        DeveloperApiService.verifyTicket(
          { ticketOrderId: 'ticket-1' },
          ORGANIZER_ID,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws ForbiddenError when the event belongs to another organizer', async () => {
      mockTicketOrder.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: 'ticket-1',
          user: 'user-1',
          eventTicket: { _id: EVENT_ID, organizedBy: OTHER_ORGANIZER_ID },
          status: 1,
          isUsed: false,
        }),
      } as any);

      await expect(
        DeveloperApiService.verifyTicket(
          { ticketOrderId: 'ticket-1' },
          ORGANIZER_ID,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws ValidationError when eventId does not match the ticket', async () => {
      const otherEventId = new mongoose.Types.ObjectId().toString();
      mockTicketOrder.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: 'ticket-1',
          eventTicket: { _id: EVENT_ID, organizedBy: ORGANIZER_ID },
          status: 1,
          isUsed: false,
        }),
      } as any);

      await expect(
        DeveloperApiService.verifyTicket(
          { ticketOrderId: 'ticket-1', eventId: otherEventId },
          ORGANIZER_ID,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns valid=true for a completed, unused ticket', async () => {
      mockTicketOrder.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: 'ticket-1',
          eventTicket: { _id: EVENT_ID, organizedBy: ORGANIZER_ID },
          eventName: 'Devcon',
          ticketType: 'GA',
          quantity: 1,
          status: 1,
          isUsed: false,
          usedAt: null,
          datePurchased: new Date(),
        }),
      } as any);

      const result = await DeveloperApiService.verifyTicket(
        { ticketOrderId: 'ticket-1' },
        ORGANIZER_ID,
      );

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns valid=false with TICKET_ALREADY_USED for a used ticket', async () => {
      mockTicketOrder.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: 'ticket-1',
          eventTicket: { _id: EVENT_ID, organizedBy: ORGANIZER_ID },
          eventName: 'Devcon',
          ticketType: 'GA',
          quantity: 1,
          status: 1,
          isUsed: true,
          usedAt: new Date(),
          datePurchased: new Date(),
        }),
      } as any);

      const result = await DeveloperApiService.verifyTicket(
        { ticketOrderId: 'ticket-1' },
        ORGANIZER_ID,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('TICKET_ALREADY_USED');
    });
  });

  describe('verifyCredential', () => {
    it('throws NotFoundError when the event does not exist', async () => {
      mockEventTicket.findById.mockResolvedValue(null as any);

      await expect(
        DeveloperApiService.verifyCredential(
          { eventId: EVENT_ID, nullifier: '42' },
          ORGANIZER_ID,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws ForbiddenError when the key does not own the event', async () => {
      mockEventTicket.findById.mockResolvedValue({
        _id: EVENT_ID,
        organizedBy: OTHER_ORGANIZER_ID,
      } as any);

      await expect(
        DeveloperApiService.verifyCredential(
          { eventId: EVENT_ID, nullifier: '42' },
          ORGANIZER_ID,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns verified=true when the nullifier digest was recorded', async () => {
      mockEventTicket.findById.mockResolvedValue({
        _id: EVENT_ID,
        organizedBy: ORGANIZER_ID,
      } as any);

      const digest = attendanceNullifierDigest(EVENT_ID, '42');
      mockAttendanceNullifier.findOne.mockResolvedValue({
        createdAt: new Date('2026-01-01'),
        onChainTxHash: '0xabc',
      } as any);

      const result = await DeveloperApiService.verifyCredential(
        { eventId: EVENT_ID, nullifier: '42' },
        ORGANIZER_ID,
      );

      expect(mockAttendanceNullifier.findOne).toHaveBeenCalledWith({
        eventId: EVENT_ID,
        nullifier: digest,
      });
      expect(result.verified).toBe(true);
      expect(result.onChainTxHash).toBe('0xabc');
    });

    it('returns verified=false when no matching nullifier is found', async () => {
      mockEventTicket.findById.mockResolvedValue({
        _id: EVENT_ID,
        organizedBy: ORGANIZER_ID,
      } as any);
      mockAttendanceNullifier.findOne.mockResolvedValue(null as any);

      const result = await DeveloperApiService.verifyCredential(
        { eventId: EVENT_ID, nullifier: '42' },
        ORGANIZER_ID,
      );

      expect(result.verified).toBe(false);
      expect(result.attendedAt).toBeNull();
    });
  });
});
