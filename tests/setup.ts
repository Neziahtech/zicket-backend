process.env.GOOGLE_CLIENT_ID = 'mock-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'mock-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/auth/google/callback';
process.env.NODE_ENV = 'test';
process.env.INDEXER_CONTRACT_ADDRESS = 'CA123456789012345678901234567890123456789012345678901234';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000/soroban/rpc';

jest.mock('express-rate-limit', () => {
  return jest.fn().mockImplementation(() => {
    return (req: any, res: any, next: any) => next();
  });
});

global.console.error = jest.fn();

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
