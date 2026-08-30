import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import mongoose from 'mongoose';
import { ReconciliationService } from '../src/services/reconciliation.service';
import Transaction from '../src/models/transaction';
import TicketOrder from '../src/models/ticket-order';
import EventTicket from '../src/models/event-ticket';
import InventoryService from '../src/services/inventory.service';
import { BlockchainProvider } from '../src/provider/blockchain.provider';

// Mock DB models
jest.mock('../src/models/transaction');
jest.mock('../src/models/ticket-order');
jest.mock('../src/models/event-ticket');

// Mock InventoryService
jest.mock('../src/services/inventory.service', () => ({
  __esModule: true,
  default: {
    confirmInventoryDeduction: jest
      .fn<any>()
      .mockResolvedValue({ success: true }),
    releaseInventory: jest.fn<any>().mockResolvedValue({ success: true }),
    reserveInventory: jest.fn<any>().mockResolvedValue({ success: true }),
  },
}));

// Mock BlockchainProvider
jest.mock('../src/provider/blockchain.provider', () => ({
  BlockchainProvider: {
    getInstance: jest.fn<any>().mockReturnValue({
      fetchSorobanTransactionStatus: jest.fn<any>(),
      fetchTransaction: jest.fn<any>(),
      getMinConfirmations: jest.fn<any>().mockReturnValue(2),
      getPlatformWallet: jest.fn<any>().mockReturnValue('0xPlatformWallet'),
    }),
  },
}));

// Mock mongoose startSession
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose') as any;
  return {
    ...actual,
    startSession: jest.fn<any>().mockResolvedValue({
      startTransaction: jest.fn<any>(),
      commitTransaction: jest.fn<any>(),
      abortTransaction: jest.fn<any>(),
      endSession: jest.fn<any>(),
    }),
    isValidObjectId: jest.fn<any>().mockReturnValue(true),
  };
});

describe('ReconciliationService - Soroban integration', () => {
  const originalSorobanRpcUrl = process.env.SOROBAN_RPC_URL;
  const originalPaymentsContractId = process.env.PAYMENTS_CONTRACT_ID;
  const originalNetworkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE;

  let mockTransactions: any[] = [];
  let mockOrders: any[] = [];

  beforeEach(() => {
    mockTransactions = [];
    mockOrders = [];
    jest.clearAllMocks();

    // Enable Soroban environment
    process.env.SOROBAN_RPC_URL = 'http://localhost:8000/soroban/rpc';
    process.env.PAYMENTS_CONTRACT_ID =
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    process.env.SOROBAN_NETWORK_PASSPHRASE =
      'Test SDF Network ; September 2015';

    // Mock Transaction query interface
    (Transaction.find as any) = jest
      .fn<any>()
      .mockImplementation((query: any) => {
        let filtered = mockTransactions;
        if (query && query.$or) {
          filtered = mockTransactions.filter(
            (t) => t.status === 'pending' || t.status === 'failed',
          );
        } else if (query && query.status) {
          filtered = mockTransactions.filter((t) => t.status === query.status);
        }
        return {
          lean: jest.fn<any>().mockReturnThis(),
          limit: jest
            .fn<any>()
            .mockImplementation(() => Promise.resolve(filtered)),
        };
      });

    (Transaction.findOne as any) = jest
      .fn<any>()
      .mockImplementation(async (query: any) => {
        if (query.transactionId) {
          return (
            mockTransactions.find(
              (t) => t.transactionId === query.transactionId,
            ) || null
          );
        }
        return null;
      });

    (Transaction.findByIdAndUpdate as any) = jest
      .fn<any>()
      .mockImplementation(async (id: any, update: any) => {
        const tx = mockTransactions.find((t) => t._id === id);
        if (tx) {
          Object.assign(tx, update);
          return tx;
        }
        return null;
      });

    // Mock TicketOrder query interface
    (TicketOrder.findOne as any) = jest
      .fn<any>()
      .mockImplementation((query: any) => {
        return {
          sort: jest.fn<any>().mockReturnThis(),
          session: jest.fn<any>().mockImplementation(() => {
            const order = mockOrders.find(
              (o) =>
                o.status === query.status &&
                String(o.user) === String(query.user) &&
                String(o.eventTicket) === String(query.eventTicket),
            );
            return Promise.resolve(order || null);
          }),
        };
      });

    (TicketOrder.findByIdAndUpdate as any) = jest
      .fn<any>()
      .mockImplementation(async (id: any, update: any) => {
        const order = mockOrders.find((o) => o._id === id);
        if (order) {
          if (update.$set) {
            Object.assign(order, update.$set);
          } else {
            Object.assign(order, update);
          }
          return order;
        }
        return null;
      });

    // Mock EventTicket
    (EventTicket.findById as any) = jest
      .fn<any>()
      .mockImplementation((id: any) => ({
        session: jest.fn<any>().mockResolvedValue({
          _id: id,
          name: 'Test Event',
          availableTickets: 100,
          soldTickets: 10,
          totalTickets: 110,
        }),
      }));
  });

  afterEach(() => {
    process.env.SOROBAN_RPC_URL = originalSorobanRpcUrl;
    process.env.PAYMENTS_CONTRACT_ID = originalPaymentsContractId;
    process.env.SOROBAN_NETWORK_PASSPHRASE = originalNetworkPassphrase;
  });

  it('handles SUCCESS: transitions pending transaction to confirmed', async () => {
    const txId = 'stellarTxHash123'; // No '0x' prefix -> Soroban transaction
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'pending',
      transactionDate: new Date(),
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 0, // pending
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockResolvedValue({
        status: 'SUCCESS',
        ledger: 45000,
        createdAt: Date.now(),
      });

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.errors).toHaveLength(0);

    expect(tx.status).toBe('confirmed');
    expect(order.status).toBe(1); // completed
    expect(InventoryService.confirmInventoryDeduction).toHaveBeenCalledWith(
      eventObjectId.toString(),
      2,
      expect.any(Object),
    );
  });

  it('handles FAILED: transitions pending transaction to failed', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'pending',
      transactionDate: new Date(),
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 0, // pending
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockResolvedValue({
        status: 'FAILED',
        ledger: 45000,
        createdAt: Date.now(),
      });

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(0);

    expect(tx.status).toBe('failed');
    expect(order.status).toBe(3); // failed
    expect(InventoryService.releaseInventory).toHaveBeenCalledWith(
      eventObjectId.toString(),
      2,
      expect.any(Object),
    );
  });

  it('handles NOT_FOUND: keeps fresh transaction in pending status', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'pending',
      transactionDate: new Date(), // fresh
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 0,
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockResolvedValue({
        status: 'NOT_FOUND',
      });

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.errors).toHaveLength(0);

    expect(tx.status).toBe('pending');
    expect(order.status).toBe(0);
  });

  it('handles NOT_FOUND: transitions stale transaction to failed', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    // 40 minutes ago (exceeds default stale threshold of 30 minutes)
    const staleDate = new Date(Date.now() - 40 * 60 * 1000);

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'pending',
      transactionDate: staleDate,
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 0,
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockResolvedValue({
        status: 'NOT_FOUND',
      });

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(0);

    expect(tx.status).toBe('failed');
    expect(order.status).toBe(3);
  });

  it('handles RPC/network error: keeps transaction pending and logs error', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'pending',
      transactionDate: new Date(),
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 0,
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockRejectedValue(new Error('Connection timed out'));

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('Connection timed out');

    expect(tx.status).toBe('pending');
    expect(order.status).toBe(0);
  });

  it('handles Locally Failed, On-chain SUCCESSful: transitions failed to confirmed and re-reserves inventory', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'failed', // locally failed
      transactionDate: new Date(),
    };
    mockTransactions.push(tx);

    const order = {
      _id: 'order1',
      user: userObjectId,
      eventTicket: eventObjectId,
      status: 3, // failed
      quantity: 2,
    };
    mockOrders.push(order);

    const blockchain = BlockchainProvider.getInstance();
    (blockchain.fetchSorobanTransactionStatus as any) = jest
      .fn<any>()
      .mockResolvedValue({
        status: 'SUCCESS',
        ledger: 45000,
        createdAt: Date.now(),
      });

    const report = await ReconciliationService.reconcilePendingTransactions();

    expect(report.confirmed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.errors).toHaveLength(0);

    expect(tx.status).toBe('confirmed');
    expect(order.status).toBe(1); // completed
    expect(InventoryService.reserveInventory).toHaveBeenCalledWith(
      eventObjectId.toString(),
      2,
      expect.any(Object),
    );
  });

  it('is idempotent: already confirmed transactions are skipped and not updated again', async () => {
    const txId = 'stellarTxHash123';
    const userObjectId = new mongoose.Types.ObjectId();
    const eventObjectId = new mongoose.Types.ObjectId();

    const tx = {
      _id: 'tx1',
      transactionId: txId,
      user: userObjectId,
      eventTicket: eventObjectId,
      amount: 50,
      status: 'confirmed', // already confirmed
      transactionDate: new Date(),
    };
    mockTransactions.push(tx);

    const report = await ReconciliationService.reconcilePendingTransactions();

    // Since it's confirmed, the query in reconcilePendingTransactions shouldn't retrieve it
    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.scanned).toBe(0);
  });
});
