(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * Unit tests for asset pricing + payment verification conversion (#161).
 */
import {
  usdToAssetBaseUnits,
  minAcceptableAmount,
  getPricingConfig,
  getUsdPerAsset,
  resolveExpectedPaymentBaseUnits,
  _resetPricingCache,
} from '../src/services/asset-pricing.service';
import { PaymentVerificationService } from '../src/services/paymentVerification.service';
import {
  PaymentVerificationError,
  ServiceUnavailableError,
} from '../src/errors/AppError';
import Transaction from '../src/models/transaction';

jest.mock('../src/models/transaction');
jest.mock('../src/provider/blockchain.provider', () => ({
  BlockchainProvider: {
    getInstance: jest.fn().mockReturnValue({
      fetchTransaction: jest.fn(),
      getMinConfirmations: jest.fn().mockReturnValue(2),
      getPlatformWallet: jest.fn().mockReturnValue('0xplatformwallet'),
    }),
  },
}));

const mockTransaction = Transaction as jest.Mocked<typeof Transaction>;
const originalFetch = global.fetch;

function forceFallbackPricing(usdPerAsset = 2000) {
  _resetPricingCache();
  process.env.PAYMENT_ASSET = 'ETH';
  process.env.PAYMENT_ASSET_DECIMALS = '18';
  process.env.PAYMENT_TOLERANCE_BPS = '100';
  process.env.PRICE_CACHE_TTL_MS = '60000';
  process.env.FALLBACK_USD_PER_ASSET = String(usdPerAsset);
  process.env.PRICE_API_URL = 'http://127.0.0.1:9/nope';
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
}

describe('asset-pricing.service', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    forceFallbackPricing(2000);
  });

  afterEach(() => {
    process.env = { ...envBackup };
    _resetPricingCache();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('usdToAssetBaseUnits', () => {
    it('converts USD to wei using live rate (no 1:1 hardcoded)', () => {
      // $100 at $2000/ETH = 0.05 ETH = 5e16 wei
      const base = usdToAssetBaseUnits(100, 2000, 18);
      expect(base).toBe(50000000000000000n);
    });

    it('handles XLM-style 7 decimals', () => {
      // $7 at $0.10/XLM = 70 XLM = 700_000_000 stroops
      const base = usdToAssetBaseUnits(7, 0.1, 7);
      expect(base).toBe(700000000n);
    });

    it('rejects non-positive rates', () => {
      expect(() => usdToAssetBaseUnits(10, 0, 18)).toThrow(
        /Invalid USD-per-asset/,
      );
    });
  });

  describe('minAcceptableAmount', () => {
    it('applies tolerance bps below expected', () => {
      const expected = 1_000_000n;
      // 100 bps = 1% â†’ min = 990_000
      expect(minAcceptableAmount(expected, 100)).toBe(990000n);
    });

    it('returns full expected when tolerance is 0', () => {
      expect(minAcceptableAmount(12345n, 0)).toBe(12345n);
    });
  });

  describe('getPricingConfig', () => {
    it('reads env and remains asset-agnostic', () => {
      process.env.PAYMENT_ASSET = 'XLM';
      process.env.PAYMENT_ASSET_DECIMALS = '7';
      process.env.PAYMENT_TOLERANCE_BPS = '250';
      const cfg = getPricingConfig();
      expect(cfg.asset).toBe('XLM');
      expect(cfg.decimals).toBe(7);
      expect(cfg.toleranceBps).toBe(250);
      expect(cfg.fallbackUsdPerAsset).toBe(2000);
    });
  });

  describe('getUsdPerAsset fallback', () => {
    it('uses FALLBACK_USD_PER_ASSET when live fetch fails', async () => {
      forceFallbackPricing(3333);
      const quote = await getUsdPerAsset('ETH');
      expect(quote.source).toBe('fallback');
      expect(quote.usdPerAsset).toBe(3333);
    });

    it('throws when live fails and no fallback configured', async () => {
      forceFallbackPricing(2000);
      delete process.env.FALLBACK_USD_PER_ASSET;
      await expect(getUsdPerAsset('ETH')).rejects.toBeTruthy();
    });

    it('parses CoinGecko-shaped JSON from PRICE_API_URL', async () => {
      _resetPricingCache();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2500 } }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      process.env.PRICE_API_URL =
        'https://example.test/price?ids=ethereum&vs_currencies=usd';
      delete process.env.FALLBACK_USD_PER_ASSET;

      const quote = await getUsdPerAsset('ETH');
      expect(quote.source).toBe('api');
      expect(quote.usdPerAsset).toBe(2500);
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('resolveExpectedPaymentBaseUnits', () => {
    it('returns expected + min with tolerance', async () => {
      forceFallbackPricing(2000);
      process.env.PAYMENT_TOLERANCE_BPS = '100';

      const r = await resolveExpectedPaymentBaseUnits(100);
      // 100/2000 ETH = 0.05 â†’ 5e16
      expect(r.expectedBaseUnits).toBe(50000000000000000n);
      expect(r.minAcceptable).toBe((50000000000000000n * 9900n) / 10000n);
      expect(r.quote.source).toBe('fallback');
    });
  });
});

describe('PaymentVerificationService.verify â€” conversion', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    forceFallbackPricing(2000);
    (mockTransaction.findOne as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...envBackup };
    _resetPricingCache();
    global.fetch = originalFetch;
  });

  function chainMocks() {
    const {
      BlockchainProvider,
    } = require('../src/provider/blockchain.provider');
    return BlockchainProvider.getInstance();
  }

  it('accepts payment matching USD converted at current rate', async () => {
    const blockchain = chainMocks();
    // $100 @ $2000/ETH = 0.05 ETH = 5e16 wei
    blockchain.fetchTransaction.mockResolvedValue({
      hash: '0xabc',
      from: '0xsender',
      to: '0xplatformwallet',
      valueWei: 50000000000000000n,
      blockNumber: 1,
      confirmations: 5,
      status: 'confirmed',
    });

    const result = await PaymentVerificationService.verify({
      txHash: '0xabc',
      expectedAmountUsd: 100,
      orderRef: 'order-1',
    });

    expect(result.txHash).toBe('0xabc');
    expect(result.confirmedAmountWei).toBe(50000000000000000n);
  });

  it('accepts underpayment within tolerance', async () => {
    const blockchain = chainMocks();
    // expected 5e16, tol 1% â†’ min 4.95e16
    blockchain.fetchTransaction.mockResolvedValue({
      hash: '0xabc',
      from: '0xsender',
      to: '0xplatformwallet',
      valueWei: 49500000000000000n,
      blockNumber: 1,
      confirmations: 5,
      status: 'confirmed',
    });

    await expect(
      PaymentVerificationService.verify({
        txHash: '0xabc',
        expectedAmountUsd: 100,
        orderRef: 'order-1',
      }),
    ).resolves.toMatchObject({ txHash: '0xabc' });
  });

  it('rejects underpayment beyond tolerance (no longer 1 USD = 1 ETH)', async () => {
    const blockchain = chainMocks();
    // Old bug would expect 100e18 wei for $100; we now expect ~0.05 ETH.
    // Send only 0.01 ETH â†’ should fail.
    blockchain.fetchTransaction.mockResolvedValue({
      hash: '0xabc',
      from: '0xsender',
      to: '0xplatformwallet',
      valueWei: 10000000000000000n, // 0.01 ETH
      blockNumber: 1,
      confirmations: 5,
      status: 'confirmed',
    });

    await expect(
      PaymentVerificationService.verify({
        txHash: '0xabc',
        expectedAmountUsd: 100,
        orderRef: 'order-1',
      }),
    ).rejects.toBeInstanceOf(PaymentVerificationError);
  });

  it('surfaces ServiceUnavailableError when pricing has no fallback', async () => {
    forceFallbackPricing(2000);
    delete process.env.FALLBACK_USD_PER_ASSET;
    const blockchain = chainMocks();
    blockchain.fetchTransaction.mockResolvedValue({
      hash: '0xabc',
      from: '0xsender',
      to: '0xplatformwallet',
      valueWei: 1n,
      blockNumber: 1,
      confirmations: 5,
      status: 'confirmed',
    });

    await expect(
      PaymentVerificationService.verify({
        txHash: '0xabc',
        expectedAmountUsd: 100,
        orderRef: 'order-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
