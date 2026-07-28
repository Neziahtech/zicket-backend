import EventTicket from '../src/models/event-ticket';
import { EventTicketService } from '../src/services/event-ticket.service';
import { encodePaginationCursor } from '../src/utils/pagination-cursor';

jest.mock('../src/models/event-ticket', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

describe('EventTicketService pagination', () => {
  const eventTicketModel = EventTicket as unknown as {
    find: jest.Mock;
    countDocuments: jest.Mock;
  };

  const mockLean = jest.fn();
  const mockLimit = jest.fn(() => ({ lean: mockLean }));
  const mockSkip = jest.fn(() => ({ limit: mockLimit }));
  const mockSort = jest.fn(() => ({ skip: mockSkip, limit: mockLimit }));

  beforeEach(() => {
    jest.clearAllMocks();
    eventTicketModel.find.mockReturnValue({ sort: mockSort });
  });

  it('uses skip-based pagination when cursor is not provided', async () => {
    mockLean.mockResolvedValue([
      {
        _id: '507f191e810c19729de860ea',
        createdAt: new Date('2026-07-10T12:00:00.000Z'),
        name: 'Ticket 1',
        privacyLevel: 1,
        soldTickets: 10,
        eventDate: new Date('2026-08-01T12:00:00.000Z'),
        location: 'Lagos',
        price: 100,
        imageUrl: 'https://example.com/1.png',
      },
    ]);
    eventTicketModel.countDocuments.mockResolvedValue(9);

    const result = await EventTicketService.getEventTickets(2, 1);

    expect(eventTicketModel.find).toHaveBeenCalledWith({});
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(mockSkip).toHaveBeenCalledWith(1);
    expect(mockLimit).toHaveBeenCalledWith(1);
    expect(result.nextCursor).toBeNull();
    expect(result.page).toBe(2);
    expect(result.limit).toBe(1);
    expect(result.total).toBe(9);
  });

  it('uses cursor-based pagination and returns a next cursor when more data exists', async () => {
    mockLean.mockResolvedValue([
      {
        _id: '507f191e810c19729de860ea',
        createdAt: new Date('2026-07-10T12:00:00.000Z'),
        name: 'Ticket 1',
        privacyLevel: 1,
        soldTickets: 10,
        eventDate: new Date('2026-08-01T12:00:00.000Z'),
        location: 'Lagos',
        price: 100,
        imageUrl: 'https://example.com/1.png',
      },
      {
        _id: '507f191e810c19729de860eb',
        createdAt: new Date('2026-07-09T12:00:00.000Z'),
        name: 'Ticket 2',
        privacyLevel: 1,
        soldTickets: 8,
        eventDate: new Date('2026-08-02T12:00:00.000Z'),
        location: 'Abuja',
        price: 50,
        imageUrl: 'https://example.com/2.png',
      },
      {
        _id: '507f191e810c19729de860ec',
        createdAt: new Date('2026-07-08T12:00:00.000Z'),
        name: 'Ticket 3',
        privacyLevel: 1,
        soldTickets: 5,
        eventDate: new Date('2026-08-03T12:00:00.000Z'),
        location: 'Port Harcourt',
        price: 25,
        imageUrl: 'https://example.com/3.png',
      },
    ]);
    eventTicketModel.countDocuments.mockResolvedValue(12);

    const result = await EventTicketService.getEventTickets(1, 2, {
      sortValue: new Date('2026-07-11T12:00:00.000Z'),
      id: '507f191e810c19729de860ff',
    });

    expect(eventTicketModel.find).toHaveBeenCalledWith({
      $or: [
        { createdAt: { $lt: new Date('2026-07-11T12:00:00.000Z') } },
        {
          createdAt: new Date('2026-07-11T12:00:00.000Z'),
          _id: { $lt: expect.anything() },
        },
      ],
    });
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(mockSkip).not.toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(3);
    expect(result.tickets).toHaveLength(2);
    expect(result.nextCursor).toBe(
      encodePaginationCursor(
        new Date('2026-07-09T12:00:00.000Z'),
        '507f191e810c19729de860eb',
      ),
    );
    expect(result.total).toBe(12);
  });
});