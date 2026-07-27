import { Queue, Worker } from 'bullmq';
import crypto from 'crypto';
import { redisConfig, queueConfig } from '../config/queue';
import {
  EmailJobType,
  EmailJobPayload,
  ZkEmailJobType,
  ZkEmailJobPayload,
  SendTicketPurchaseNotificationPayload,
  SendTicketUpdateNotificationPayload,
  SendEventCancellationNotificationPayload,
  SendWaitlistSpotAvailablePayload,
  WaitlistJobType,
  ExpireHoldPayload,
  QUEUE_NAMES,
} from '../config/queue-jobs';

/**
 * QueueService - Manages BullMQ queue instances
 * Provides methods to enqueue jobs for async processing
 */
class QueueService {
  private emailQueue: Queue | null = null;
  private zkEmailQueue: Queue | null = null;
  private waitlistQueue: Queue | null = null;
  private emailWorker: Worker | null = null;
  private initialized = false;

  /**
   * Initialize queue and worker instances
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('QueueService already initialized');
      return;
    }

    try {
      this.emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
        connection: redisConfig,
        ...queueConfig,
      });

      this.zkEmailQueue = new Queue(QUEUE_NAMES.ZKEMAIL, {
        connection: redisConfig,
        ...queueConfig,
      });


      this.waitlistQueue = new Queue(QUEUE_NAMES.WAITLIST, {
        connection: redisConfig,
        ...queueConfig,
      });
      this.initialized = true;
      console.log('QueueService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize QueueService:', error);
      throw error;
    }
  }

  /**
   * Enqueue a verification OTP email
   */
  async enqueueVerificationOtp(email: string, otp: number): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const emailHash = crypto
      .createHash('sha256')
      .update(email)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_VERIFICATION_OTP,
      { email, otp } as EmailJobPayload,
      {
        jobId: `otp-${emailHash}-${Date.now()}`,
      },
    );

    console.log(
      `Queued verification OTP email for ${email}, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * Enqueue a magic link email
   */
  async enqueueMagicLink(email: string, token: string): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const emailHash = crypto
      .createHash('sha256')
      .update(email)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_MAGIC_LINK,
      { email, token } as EmailJobPayload,
      {
        jobId: `magic-${emailHash}-${Date.now()}`,
      },
    );

    console.log(`Queued magic link email for ${email}, Job ID: ${job.id}`);
    return job.id!;
  }

  /**
   * Enqueue a generic email
   */
  async enqueueEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const toHash = crypto
      .createHash('sha256')
      .update(to)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_EMAIL,
      { to, subject, html, text } as EmailJobPayload,
      {
        jobId: `email-${toHash}-${Date.now()}`,
      },
    );

    console.log(
      `Queued email to ${to} with subject "${subject}", Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * Enqueue a zkEmail hook job
   */
  async enqueueZkEmailHook(hashedEmail: string): Promise<string> {
    if (!this.zkEmailQueue) {
      throw new Error('zkEmail queue not initialized');
    }

    const job = await this.zkEmailQueue.add(
      ZkEmailJobType.ZK_EMAIL_HOOK,
      { hashedEmail } as ZkEmailJobPayload,
      {
        jobId: `zkemail-${hashedEmail.slice(0, 16)}-${Date.now()}`,
      },
    );

    console.log(`Queued zkEmail hook for hashed email, Job ID: ${job.id}`);
    return job.id!;
  }

  /**
    return job.id!;
  }

  /**
   * Enqueue a ticket purchase notification
   */
  async enqueueTicketPurchaseNotification(
    payload: SendTicketPurchaseNotificationPayload,
  ): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const userEmailHash = crypto
      .createHash('sha256')
      .update(payload.userEmail)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_TICKET_PURCHASE_NOTIFICATION,
      payload as EmailJobPayload,
      {
        jobId: `purchase-${userEmailHash}-${Date.now()}`,
      },
    );

    console.log(
      `Queued ticket purchase notification for ${payload.userEmail}, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * Enqueue a ticket update notification
   */
  async enqueueTicketUpdateNotification(
    payload: SendTicketUpdateNotificationPayload,
  ): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const userEmailHash = crypto
      .createHash('sha256')
      .update(payload.userEmail)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_TICKET_UPDATE_NOTIFICATION,
      payload as EmailJobPayload,
      {
        jobId: `update-${userEmailHash}-${Date.now()}`,
      },
    );

    console.log(
      `Queued ticket update notification for ${payload.userEmail}, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * Enqueue an event cancellation notification
   */
  async enqueueEventCancellationNotification(
    payload: SendEventCancellationNotificationPayload,
  ): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const job = await this.emailQueue.add(
      EmailJobType.SEND_EVENT_CANCELLATION_NOTIFICATION,
      payload as EmailJobPayload,
      {
        jobId: `cancellation-${payload.userEmail}-${Date.now()}`,
      },
    );

    console.log(
      `Queued event cancellation notification for ${payload.userEmail}, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * #168 - Enqueue a waitlist spot-available email notification
   */
  async enqueueWaitlistSpotAvailable(
    payload: SendWaitlistSpotAvailablePayload,
  ): Promise<string> {
    if (!this.emailQueue) {
      throw new Error('Queue not initialized');
    }

    const emailHash = crypto
      .createHash('sha256')
      .update(payload.userEmail)
      .digest('hex')
      .slice(0, 12);
    const job = await this.emailQueue.add(
      EmailJobType.SEND_WAITLIST_SPOT_AVAILABLE,
      payload as EmailJobPayload,
      {
        jobId: `waitlist-${emailHash}-${Date.now()}`,
      },
    );

    console.log(
      `Queued waitlist spot-available email for ${payload.userEmail}, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * #168 - Enqueue a delayed job to expire a waitlist hold if the user
   * does not convert it into a purchase in time.
   */
  async enqueueExpireWaitlistHold(
    waitlistId: string,
    delayMs: number,
  ): Promise<string> {
    if (!this.waitlistQueue) {
      throw new Error('Waitlist queue not initialized');
    }

    const job = await this.waitlistQueue.add(
      WaitlistJobType.EXPIRE_HOLD,
      { waitlistId } as ExpireHoldPayload,
      {
        jobId: `expire-hold-${waitlistId}`,
        delay: delayMs,
      },
    );

    console.log(
      `Queued waitlist hold expiry for ${waitlistId} in ${delayMs}ms, Job ID: ${job.id}`,
    );
    return job.id!;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    if (!this.emailQueue) {
      return null;
    }

    return {
      name: QUEUE_NAMES.EMAIL,
      active: await this.emailQueue.getActiveCount(),
      waiting: await this.emailQueue.getWaitingCount(),
      failed: await this.emailQueue.getFailedCount(),
      completed: await this.emailQueue.getCompletedCount(),
      delayed: await this.emailQueue.getDelayedCount(),
    };
  }

  /**
   * Close queue connections (for graceful shutdown)
   */
  async close(): Promise<void> {
    if (this.emailQueue) {
      await this.emailQueue.close();
    }
    if (this.zkEmailQueue) {
      await this.zkEmailQueue.close();
    }
    if (this.waitlistQueue) {
      await this.waitlistQueue.close();
    }
    if (this.emailWorker) {
      await this.emailWorker.close();
    }
    console.log('QueueService closed');
  }

  /**
   * Get queue instance (for worker registration)
   */
  getEmailQueue(): Queue | null {
    return this.emailQueue;
  }
}

export default new QueueService();
