import mongoose from 'mongoose';
import EventTicket from '../src/models/event-ticket';
import TicketOrder from '../src/models/ticket-order';
import { TicketOrderService } from '../src/services/ticket-order.service';
import { encodePaginationCursor } from '../src/utils/pagination-cursor';

jest.mock('../src/models/ticket-order', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock('../src/models/event-ticket', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}));

describe('TicketOrderService pagination', () => {
  const ticketOrderModel = TicketOrder as unknown as {
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  const eventTicketModel = EventTicket as unknown as {
    find: jest.Mock;
  };

  const mockLean = jest.fn();
  const mockLimit = jest.fn(() => ({ lean: mockLean }));
  const mockSkip = jest.fn(() => ({ limit: mockLimit }));
  const mockSort = jest.fn(() => ({ skip: mockSkip, limit: mockLimit }));

  beforeEach(() => {
    jest.clearAllMocks();
    ticketOrderModel.find.mockReturnValue({ sort: mockSort });
    eventTicketModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue([
          { _id: new mongoose.Types.ObjectId('507f191e810c19729de860ed') },
        ]),
    });
  });

  it('uses cursor-based pagination for user orders', async () => {
    mockLean.mockResolvedValue([
      {
        _id: '507f191e810c19729de860ea',
        datePurchased: new Date('2026-07-10T12:00:00.000Z'),
        eventName: 'Event 1',
      },
      {
        _id: '507f191e810c19729de860eb',
        datePurchased: new Date('2026-07-09T12:00:00.000Z'),
        eventName: 'Event 2',
      },
      {
        _id: '507f191e810c19729de860ec',
        datePurchased: new Date('2026-07-08T12:00:00.000Z'),
        eventName: 'Event 3',
      },
    ]);
    ticketOrderModel.countDocuments.mockResolvedValue(7);

    const result = await TicketOrderService.getUserOrders(
      '507f191e810c19729de860ff',
      1,
      2,
      {
        sortValue: new Date('2026-07-11T12:00:00.000Z'),
        id: '507f191e810c19729de860aa',
      },
    );

    expect(ticketOrderModel.find).toHaveBeenCalledWith({
      user: expect.any(mongoose.Types.ObjectId),
      $or: [
        { datePurchased: { $lt: new Date('2026-07-11T12:00:00.000Z') } },
        {
          datePurchased: new Date('2026-07-11T12:00:00.000Z'),
          _id: { $lt: expect.any(mongoose.Types.ObjectId) },
        },
      ],
    });
    expect(mockLimit).toHaveBeenCalledWith(3);
    expect(mockSkip).not.toHaveBeenCalled();
    expect(result.orders).toHaveLength(2);
    expect(result.nextCursor).toBe(
      encodePaginationCursor(
        new Date('2026-07-09T12:00:00.000Z'),
        '507f191e810c19729de860eb',
      ),
    );
    expect(result.totalPages).toBe(4);
  });

  it('uses cursor-based pagination for organizer orders', async () => {
    mockLean.mockResolvedValue([
      {
        _id: '507f191e810c19729de860ea',
        datePurchased: new Date('2026-07-10T12:00:00.000Z'),
        eventName: 'Event 1',
      },
      {
        _id: '507f191e810c19729de860eb',
        datePurchased: new Date('2026-07-09T12:00:00.000Z'),
        eventName: 'Event 2',
      },
    ]);
    ticketOrderModel.countDocuments.mockResolvedValue(2);

    const result = await TicketOrderService.getOrganizerOrders(
      '507f191e810c19729de860ff',
      1,
      2,
      {
        sortValue: new Date('2026-07-11T12:00:00.000Z'),
        id: '507f191e810c19729de860aa',
      },
    );

    expect(result.orders).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(mockLimit).toHaveBeenCalledWith(3);
  });
});
