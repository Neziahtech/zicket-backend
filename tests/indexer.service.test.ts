import mongoose from 'mongoose';
import { rpc, nativeToScVal } from '@stellar/stellar-sdk';
import IndexerService from '../src/services/indexer.service';
import ContractEvent from '../src/models/contract-event';
import IndexerState from '../src/models/indexer-state';

jest.mock('@stellar/stellar-sdk', () => {
  const mockServer = {
    getLatestLedger: jest.fn(),
    getEvents: jest.fn(),
  };
  return {
    rpc: {
      Server: jest.fn().mockImplementation(() => mockServer),
    },
    __mockServer: mockServer,
    nativeToScVal: jest.fn((val) => val),
    scValToNative: jest.fn((val) => val),
  };
});

const { __mockServer: mockServer } = require('@stellar/stellar-sdk');

jest.mock('../src/models/contract-event', () => {
  return {
    __esModule: true,
    default: {
      updateOne: jest.fn(),
      find: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
});

jest.mock('../src/models/indexer-state', () => {
  const mockFindOne = jest.fn();
  const mockCreate = jest.fn();
  const mockDeleteMany = jest.fn();

  function IndexerStateMock(this: any, data: any) {
    Object.assign(this, data);
    this.save = jest.fn().mockResolvedValue(this);
  }

  IndexerStateMock.findOne = mockFindOne;
  IndexerStateMock.create = mockCreate;
  IndexerStateMock.deleteMany = mockDeleteMany;

  return {
    __esModule: true,
    default: IndexerStateMock,
  };
});

describe('IndexerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServer.getEvents.mockReset();
    mockServer.getLatestLedger.mockReset();

    // Reset singleton state that might be cached or stuck
    (IndexerService as any).contractAddress =
      process.env.INDEXER_CONTRACT_ADDRESS?.toLowerCase();
    (IndexerService as any).rpcUrl = process.env.SOROBAN_RPC_URL;
    (IndexerService as any).isSyncing = false;
  });

  it('should sync events from Soroban RPC and insert into MongoDB', async () => {
    mockServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });

    mockServer.getEvents
      .mockResolvedValueOnce({
        latestLedger: 1000,
        events: [
          {
            type: 'contract',
            ledger: 950,
            ledgerClosedAt: '2023-10-01T12:00:00Z',
            contractId: process.env.INDEXER_CONTRACT_ADDRESS,
            id: '00000001-00000001',
            inSuccessfulContractCall: true,
            topic: [nativeToScVal('TicketMinted')],
            value: nativeToScVal({ ticketId: 1, owner: 'GBABC' }),
            txHash: 'tx123',
          },
        ],
        cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        latestLedger: 1000,
        events: [],
        cursor: 'cursor-2',
      });

    await IndexerService.syncEvents();

    expect(IndexerState.findOne).toHaveBeenCalledWith({
      contractAddress: process.env.INDEXER_CONTRACT_ADDRESS?.toLowerCase(),
    });

    expect(ContractEvent.updateOne).toHaveBeenCalledWith(
      { transactionHash: 'tx123', ledgerSequence: 950, eventIndex: 1 },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          eventName: 'TicketMinted',
          args: { ticketId: 1, owner: 'GBABC' },
        }),
      }),
      { upsert: true },
    );
  });

  it('should resume from lastIndexedLedger after simulated restart', async () => {
    mockServer.getLatestLedger.mockResolvedValue({ sequence: 1050 });

    const contractAddress =
      process.env.INDEXER_CONTRACT_ADDRESS?.toLowerCase() || '';

    (IndexerState.findOne as jest.Mock).mockResolvedValueOnce({
      contractAddress,
      lastIndexedLedger: 1000,
      save: jest.fn(),
    });

    mockServer.getEvents
      .mockResolvedValueOnce({
        latestLedger: 1050,
        events: [
          {
            type: 'contract',
            ledger: 1010,
            ledgerClosedAt: '2023-10-01T12:05:00Z',
            contractId: process.env.INDEXER_CONTRACT_ADDRESS,
            id: '00000002-00000001',
            inSuccessfulContractCall: true,
            topic: [nativeToScVal('PaymentProcessed')],
            value: nativeToScVal({ amount: 100 }),
            txHash: 'tx456',
          },
        ],
        cursor: 'cursor-3',
      })
      .mockResolvedValueOnce({
        latestLedger: 1050,
        events: [],
        cursor: 'cursor-4',
      });

    await IndexerService.syncEvents();

    expect(mockServer.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 1001,
      }),
    );

    expect(ContractEvent.updateOne).toHaveBeenCalledWith(
      { transactionHash: 'tx456', ledgerSequence: 1010, eventIndex: 1 },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          eventName: 'PaymentProcessed',
          args: { amount: 100 },
        }),
      }),
      { upsert: true },
    );
  });
});
