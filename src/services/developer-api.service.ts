import EventTicket, { IEventTicket } from '../models/event-ticket';
import TicketOrder from '../models/ticket-order';
import AttendanceNullifier from '../models/attendance-nullifier';
import {
  attendanceNullifierDigest,
  AttendanceNullifierPepperError,
} from '../utils/attendance-nullifier-digest';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ServiceUnavailableError,
} from '../errors/AppError';

export interface EventTicketAvailability {
  eventId: string;
  name: string;
  eventStatus: string;
  eventDate: Date;
  totalTickets: number;
  availableTickets: number;
  soldTickets: number;
  ticketType: Array<{
    ticketName: string;
    quantity: number;
    currencyOrToken: string;
    price: number;
  }>;
}

export interface TicketVerificationResult {
  valid: boolean;
  reason?: string;
  ticket: {
    id: string;
    eventId: string;
    eventName: string;
    ticketType: string;
    quantity: number;
    isUsed: boolean;
    usedAt: Date | null;
    purchasedAt: Date;
  };
}

export interface CredentialVerificationResult {
  verified: boolean;
  eventId: string;
  attendedAt: Date | null;
  onChainTxHash: string | null;
}

/**
 * BR-09 / Section 12 — Developer Infrastructure API.
 *
 * Every method here is scoped to the organizer that issued the calling
 * API key (`organizerId`, taken from `req.developer` after
 * `developerAuthGuard`). A developer key can only ever see or verify
 * data for events its own organizer owns — never other organizers'
 * events — regardless of what event/ticket id is passed in.
 *
 * These read/verify paths are intentionally kept separate from the
 * authenticated attendee-facing `EventTicketService.scanTicket` /
 * `validateTicket` (which check *buyer* ownership for self-service
 * check-in). This service checks *organizer* ownership instead, since
 * the caller here is a third-party app acting on the organizer's
 * behalf, not the ticket holder.
 */
export class DeveloperApiService {
  /**
   * GET /api/v1/developer/events/:id/tickets
   * Ticket availability for one event, for organizers/portals that need
   * to display live inventory without querying Zicket's internal APIs.
   */
  static async getEventTicketAvailability(
    eventId: string,
    organizerId: string,
  ): Promise<EventTicketAvailability> {
    const event = await EventTicket.findById(eventId);

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    DeveloperApiService.assertOrganizerOwnsEvent(event, organizerId);

    return {
      eventId: event._id.toString(),
      name: event.name,
      eventStatus: event.eventStatus,
      eventDate: event.eventDate,
      totalTickets: event.totalTickets,
      availableTickets: event.availableTickets,
      soldTickets: event.soldTickets,
      ticketType: event.ticketType.map((t) => ({
        ticketName: t.ticketName,
        quantity: t.quantity,
        currencyOrToken: t.currencyOrToken,
        price: t.price,
      })),
    };
  }

  /**
   * POST /api/v1/developer/tickets/verify
   * Read-only ticket state + ownership check. Deliberately does NOT mark
   * the ticket as used — this is a "can this person get in" check for
   * third-party portals, not a scan. Actual check-in (marking a ticket
   * used) remains the organizer-authenticated `/event-tickets/scan`
   * endpoint, per the proposed developer route surface.
   */
  static async verifyTicket(
    input: { ticketOrderId: string; eventId?: string },
    organizerId: string,
  ): Promise<TicketVerificationResult> {
    const { ticketOrderId, eventId } = input;

    const ticketOrder =
      await TicketOrder.findById(ticketOrderId).populate('eventTicket');

    if (!ticketOrder) {
      throw new NotFoundError('Ticket not found');
    }

    const event = ticketOrder.eventTicket as unknown as IEventTicket | null;
    if (!event) {
      throw new NotFoundError('Event for this ticket not found');
    }

    DeveloperApiService.assertOrganizerOwnsEvent(event, organizerId);

    if (eventId && event._id.toString() !== eventId) {
      throw new ValidationError('Ticket does not belong to the given event');
    }

    const isCompleted = ticketOrder.status === 1;
    const isUsed = Boolean(ticketOrder.isUsed);
    const valid = isCompleted && !isUsed;

    let reason: string | undefined;
    if (!isCompleted) reason = 'TICKET_NOT_COMPLETED';
    else if (isUsed) reason = 'TICKET_ALREADY_USED';

    return {
      valid,
      reason,
      ticket: {
        id: ticketOrder._id.toString(),
        eventId: event._id.toString(),
        eventName: ticketOrder.eventName,
        ticketType: ticketOrder.ticketType,
        quantity: ticketOrder.quantity,
        isUsed,
        usedAt: ticketOrder.usedAt ?? null,
        purchasedAt: ticketOrder.datePurchased,
      },
    };
  }

  /**
   * POST /api/v1/developer/credentials/verify
   * Confirms whether a zkPassport-derived attendance nullifier was
   * recorded for the given event, without exposing attendee identity —
   * mirrors the privacy posture of `attendance-nullifier.ts` (only the
   * HMAC digest is ever stored/compared, never the raw nullifier).
   */
  static async verifyCredential(
    input: { eventId: string; nullifier: string },
    organizerId: string,
  ): Promise<CredentialVerificationResult> {
    const { eventId, nullifier } = input;

    const event = await EventTicket.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    DeveloperApiService.assertOrganizerOwnsEvent(event, organizerId);

    let digest: string;
    try {
      digest = attendanceNullifierDigest(eventId, nullifier);
    } catch (error) {
      if (error instanceof AttendanceNullifierPepperError) {
        throw new ServiceUnavailableError(
          'Credential verification is temporarily unavailable',
        );
      }
      throw new ValidationError('Invalid nullifier format');
    }

    const record = await AttendanceNullifier.findOne({
      eventId,
      nullifier: digest,
    });

    return {
      verified: Boolean(record),
      eventId,
      attendedAt: record?.createdAt ?? null,
      onChainTxHash: record?.onChainTxHash ?? null,
    };
  }

  /** Ensures the calling developer key's organizer owns the given event. */
  private static assertOrganizerOwnsEvent(
    event: IEventTicket,
    organizerId: string,
  ): void {
    if (event.organizedBy.toString() !== organizerId) {
      throw new ForbiddenError('This API key is not authorized for this event');
    }
  }
}

export default DeveloperApiService;
