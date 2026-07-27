import mongoose from 'mongoose';
import Waitlist from '../src/models/waitlist';
import EventTicket from '../src/models/event-ticket';
import User from '../src/models/user';
import WaitlistService from '../src/services/waitlist.service';
import queueService from '../src/services/queue.service';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../src/errors/AppError';

jest.mock('../src/models/waitlist');
jest.mock('../src/models/event-ticket');
jest.mock('../src/models/user');
jest.mock('../src/services/queue.service');

const mockWaitlist = Waitlist as jest.Mocked<typeof Waitlist>;
const mockEventTicket = EventTicket as jest.Mocked<typeof EventTicket>;
const mockUser = User as jest.Mocked<typeof User>;
const mockQueueService = queueService as jest.Mocked<typeof queueService>;

const userId = new mongoose.Types.ObjectId().toString();
const eventId = new mongoose.Types.ObjectId().toString();

describe('WaitlistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('join', () => {
    it('throws NotFoundError when the event does not exist', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        WaitlistService.join(userId, eventId),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws ValidationError when the event is cancelled', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'cancelled',
        availableTickets: 0,
      });

      await expect(
        WaitlistService.join(userId, eventId),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when tickets are still available', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'upcoming',
        availableTickets: 5,
      });

      await expect(
        WaitlistService.join(userId, eventId),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ConflictError when already on the waitlist', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'upcoming',
        availableTickets: 0,
      });
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue({
        status: 'waiting',
      });

      await expect(
        WaitlistService.join(userId, eventId),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('creates a waiting entry for a sold-out event', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'upcoming',
        availableTickets: 0,
      });
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue(null);
      (mockWaitlist.create as unknown as jest.Mock).mockResolvedValue({
        status: 'waiting',
      });

      const result = await WaitlistService.join(userId, eventId);

      expect(mockWaitlist.create).toHaveBeenCalledWith({
        user: userId,
        eventTicket: eventId,
        status: 'waiting',
      });
      expect(result).toEqual({ status: 'waiting' });
    });
  });

  describe('leave', () => {
    it('throws NotFoundError when there is no active entry', async () => {
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        WaitlistService.leave(userId, eventId),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('cancels a waiting entry without processing the next person', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue({
        status: 'waiting',
        save,
      });

      await WaitlistService.leave(userId, eventId);

      expect(save).toHaveBeenCalled();
      expect(mockEventTicket.findById).not.toHaveBeenCalled();
    });

    it('cancels a notified (held) entry and processes the next person', async () => {
      const entry: any = {
        status: 'notified',
        save: jest.fn().mockResolvedValue(undefined),
      };
      (mockWaitlist.findOne as jest.Mock)
        .mockResolvedValueOnce(entry) // leave() lookup
        .mockResolvedValueOnce(null); // processNextForEvent's internal find via .find(), not findOne - safe no-op path
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'upcoming',
      });
      (mockWaitlist.find as unknown as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => Promise.resolve([]) }),
      });

      await WaitlistService.leave(userId, eventId);

      expect(entry.save).toHaveBeenCalled();
      expect(entry.status).toBe('cancelled');
      expect(mockEventTicket.findById).toHaveBeenCalledWith(eventId);
    });
  });

  describe('getStatus', () => {
    it('returns not_waitlisted when there is no active entry', async () => {
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue(null);

      const result = await WaitlistService.getStatus(userId, eventId);

      expect(result).toEqual({
        status: 'not_waitlisted',
        position: null,
        holdExpiresAt: null,
      });
    });

    it('returns a 1-based position for a waiting entry', async () => {
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue({
        status: 'waiting',
        createdAt: new Date('2026-01-01'),
        holdExpiresAt: null,
      });
      (mockWaitlist.countDocuments as jest.Mock).mockResolvedValue(2);

      const result = await WaitlistService.getStatus(userId, eventId);

      expect(result.status).toBe('waiting');
      expect(result.position).toBe(3);
    });

    it('returns holdExpiresAt for a notified entry without a position', async () => {
      const holdExpiresAt = new Date('2026-02-01');
      (mockWaitlist.findOne as jest.Mock).mockResolvedValue({
        status: 'notified',
        holdExpiresAt,
      });

      const result = await WaitlistService.getStatus(userId, eventId);

      expect(result).toEqual({
        status: 'notified',
        position: null,
        holdExpiresAt,
      });
    });
  });

  describe('processNextForEvent', () => {
    it('does nothing for a cancelled event', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'cancelled',
      });

      await WaitlistService.processNextForEvent(eventId, 1);

      expect(mockWaitlist.find).not.toHaveBeenCalled();
    });

    it('notifies the oldest waiting user and enqueues emails + hold expiry', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        _id: eventId,
        name: 'Test Event',
        eventStatus: 'upcoming',
      });

      const entry: any = {
        _id: 'entry-1',
        user: userId,
        status: 'waiting',
        save: jest.fn().mockResolvedValue(undefined),
      };
      (mockWaitlist.find as unknown as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => Promise.resolve([entry]) }),
      });
      (mockUser.findById as jest.Mock).mockResolvedValue({
        email: 'user@example.com',
        name: 'Test User',
      });

      await WaitlistService.processNextForEvent(eventId, 1);

      expect(entry.status).toBe('notified');
      expect(entry.save).toHaveBeenCalled();
      expect(
        mockQueueService.enqueueWaitlistSpotAvailable,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'user@example.com',
          eventName: 'Test Event',
        }),
      );
      expect(mockQueueService.enqueueExpireWaitlistHold).toHaveBeenCalledWith(
        'entry-1',
        expect.any(Number),
      );
    });

    it('expires an entry with no usable email instead of notifying it', async () => {
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        _id: eventId,
        name: 'Test Event',
        eventStatus: 'upcoming',
      });

      const entry: any = {
        _id: 'entry-2',
        user: userId,
        status: 'waiting',
        save: jest.fn().mockResolvedValue(undefined),
      };
      (mockWaitlist.find as unknown as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => Promise.resolve([entry]) }),
      });
      (mockUser.findById as jest.Mock).mockResolvedValue(null);

      await WaitlistService.processNextForEvent(eventId, 1);

      expect(entry.status).toBe('expired');
      expect(
        mockQueueService.enqueueWaitlistSpotAvailable,
      ).not.toHaveBeenCalled();
    });
  });

  describe('expireHold', () => {
    it('does nothing when the entry is not in notified status', async () => {
      (mockWaitlist.findById as jest.Mock).mockResolvedValue({
        status: 'converted',
      });

      await WaitlistService.expireHold('entry-1');

      expect(mockEventTicket.findById).not.toHaveBeenCalled();
    });

    it('expires a notified entry and processes the next person', async () => {
      const entry: any = {
        status: 'notified',
        eventTicket: eventId,
        save: jest.fn().mockResolvedValue(undefined),
      };
      (mockWaitlist.findById as jest.Mock).mockResolvedValue(entry);
      (mockEventTicket.findById as jest.Mock).mockResolvedValue({
        eventStatus: 'upcoming',
      });
      (mockWaitlist.find as unknown as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => Promise.resolve([]) }),
      });

      await WaitlistService.expireHold('entry-1');

      expect(entry.status).toBe('expired');
      expect(entry.save).toHaveBeenCalled();
      expect(mockEventTicket.findById).toHaveBeenCalledWith(eventId);
    });
  });

  describe('cancelForEvent', () => {
    it('marks all active entries for the event as cancelled', async () => {
      (mockWaitlist.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });

      await WaitlistService.cancelForEvent(eventId);

      expect(mockWaitlist.updateMany).toHaveBeenCalledWith(
        { eventTicket: eventId, status: { $in: ['waiting', 'notified'] } },
        { $set: { status: 'cancelled' } },
      );
    });
  });
});
