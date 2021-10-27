const request = require('axios');
const assert = require('assert');
const debug = require('debug')('arweave-cost');

const ARWEAVE_URL = 'https://arweave.net';
const CONVERSION_RATES_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana,arweave&vs_currencies=usd';
const WINSTON_MULTIPLIER = 10 ** 12;

const toInt = (val: any): number => parseInt(val, 10);

type asyncFunction = (...args: any[]) => Promise<any>;

/**
 * Cache promise results for 30 seconds
 */
let promiseCacheMs = 30000;
export const _setCacheMs = (ms: number) => promiseCacheMs = ms;

export const _promiseMap = new Map();

const memoPromise = (method: asyncFunction, args: any[]) => {
  const key = `${method.toString()}${JSON.stringify(args)}`;

  if (_promiseMap.has(key)) {
    return _promiseMap.get(key);
  }

  const promise = new Promise(function (resolve, reject) {
    return method(...args).catch((err) => {
      _promiseMap.delete(method);
      reject(err);
    }).then(resolve);
  });

  // cache for the configured time
  _promiseMap.set(key, promise);

  const timer = setTimeout(() => {
    _promiseMap.delete(key);
  }, promiseCacheMs);

  // allow program exit while timer is active
  timer.unref();

  return promise;
};

const memoize = (asyncFn: asyncFunction) => {
  return (...args: any[]) => {
    const result = memoPromise(asyncFn, args);
    return result
  };
};

export const fetchTokenPrices = memoize(() => {
  return request(CONVERSION_RATES_URL).then((response: any) => {
    const body = response.data;
    if (!(body.arweave?.usd && body.solana?.usd)) {
      debug('Invalid coingecko response', body);
      throw new Error('Invalid response from coingecko');
    }

    return body;
  })
});

export const fetchArweaveStorageCost = memoize((totalBytes: number) => {
  assert(Number.isFinite(totalBytes), `Invalid argument: totalBytes. Received: ${totalBytes}`);
  return request(`${ARWEAVE_URL}/price/${totalBytes}`).then((response: { data: any }) => toInt(response.data));
});

const validate = (fileSizes: number[]): void => {
  assert(
    Array.isArray(fileSizes) && fileSizes.length > 0 && fileSizes.every((k) => {
      return Number(k) === k && !isNaN(k) && k >= 0 && isFinite(k);
    }),
    'Invalid argument: fileSizes must be an array of integers');
};

const kb = (kilobytes: number) => kilobytes * 1024;
const MINIMUM_WINSTON_FEE = 10000000; // 0.00001 AR
const AR_FEE_MULTIPLIER = 15 / 100; // 15%

/**
 * 15% fee on top of storage cost or 0.00001 AR minimum for files < 100kb
 *
 * https://ardrive.atlassian.net/wiki/spaces/help/pages/86376465/Fees
 */
const calculateFee = (totalBytes: number, storageCost: number): number => {
  const fee = totalBytes < kb(100) ? MINIMUM_WINSTON_FEE :
    storageCost * AR_FEE_MULTIPLIER;

  return fee;
};

// test this. Then make public. Then pull into arweave cloud fn and metaplex
export const calculate = async (
  fileSizes: number[]
): Promise<{
  solana: number,
  arweave: number,
  arweavePrice: number,
  solanaPrice: number,
  exchangeRate: number,
  byteCost: number,
  totalBytes: number,
  fee: number
}> => {

  validate(fileSizes);

  const totalBytes = fileSizes.reduce((sum, fileSize) => {
    return sum += fileSize;
  }, 0);

  const [conversionRates, byteCost] = await Promise.all([
    fetchTokenPrices(),
    fetchArweaveStorageCost(totalBytes)
  ]);

  const fee = calculateFee(totalBytes, byteCost);
  const totalWinstonCost = byteCost + fee;
  const totalArCost = totalWinstonCost / WINSTON_MULTIPLIER;

  const arweavePrice = conversionRates.arweave.usd;
  const solanaPrice = conversionRates.solana.usd;
  const exchangeRate = arweavePrice / solanaPrice;

  debug('%j', {
    arweaveRate: arweavePrice,
    solanaRate: solanaPrice,
    exchangeRate,
    byteCost,
    WINSTON_MULTIPLIER,
    fee,
    totalWinstonCost,
    totalArCost,
    totalBytes
  });

  return {
    arweave: totalArCost,
    solana: totalArCost * exchangeRate,
    arweavePrice,
    solanaPrice,
    exchangeRate,
    byteCost,
    totalBytes,
    fee
  };
};
