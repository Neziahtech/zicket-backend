import mongoose, { Schema, Document } from 'mongoose';

export type WaitlistStatus =
  | 'waiting'
  | 'notified'
  | 'converted'
  | 'expired'
  | 'cancelled';

/**
 * #168 - Event Waitlist
 *
 * Links a User to an EventTicket they want to buy into once a spot frees
 * up on a sold-out event. Only one active (waiting/notified) entry is
 * allowed per user per event - see the partial unique index below.
 */
export interface IWaitlist extends Document {
  user: mongoose.Types.ObjectId;
  eventTicket: mongoose.Types.ObjectId;
  status: WaitlistStatus;
  /** When the user was last notified that a spot opened up. */
  notifiedAt?: Date | null;
  /** Time-limited hold deadline - the spot moves to the next person after this. */
  holdExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const waitlistSchema = new Schema<IWaitlist>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventTicket: {
      type: Schema.Types.ObjectId,
      ref: 'EventTicket',
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'notified', 'converted', 'expired', 'cancelled'],
      default: 'waiting',
      required: true,
    },
    notifiedAt: { type: Date, default: null },
    holdExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Only one active entry (waiting or notified) per user per event.
waitlistSchema.index(
  { user: 1, eventTicket: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['waiting', 'notified'] } },
  },
);

// Used to find the oldest waiting entries for an event (FIFO notification order).
waitlistSchema.index({ eventTicket: 1, status: 1, createdAt: 1 });

const Waitlist = mongoose.model<IWaitlist>('Waitlist', waitlistSchema);
export default Waitlist;
