const assert = require('assert');

const {
  fetchPrices,
  fetchArweaveStorageCost,
  calculate,
  _setCacheMs,
  _promiseMap
} = require('./index');

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe('fetchPrices', () => {
  it('should work', async () => {
    const result = await fetchPrices();
    assert(!!(result?.solana?.usd && result?.arweave?.usd), 'invalid fetchPrices response');
  })
})

describe('fetchArweaveStorageCost', () => {
  it('should fail when bytes are not passed', async () => {
    assert.rejects(async () => {
      await fetchArweaveStorageCost();
    }, /Invalid argument: totalBytes/);
  })

  it('should work', async () => {
    const result = await fetchArweaveStorageCost(1);
    assert(result > 100, 'invalid fetchArweaveStorageCost response');
  })
})

describe('cache', () => {
  it('caches results for the configured milliseconds', async () => {
    _promiseMap.clear();

    {
      _setCacheMs(0)
      await fetchPrices();
      await sleep(50);
      assert(_promiseMap.size === 0, 'value still cached');
    }

    {
      _setCacheMs(1000)
      await fetchPrices();
      await sleep(20);
      assert(_promiseMap.size === 1, 'value not cached');
      await sleep(1200);
      assert(_promiseMap.size === 0, 'value still cached');
    }

  })
})

describe('calculate', () => {
  it('should fail when file sizes are not passed', async () => {
    assert.rejects(async () => {
      await calculate();
    }, /Invalid argument: fileSizes must be an array of integers/);

    assert.rejects(async () => {
      await calculate([]);
    }, /Invalid argument: fileSizes must be an array of integers/);

    assert.rejects(async () => {
      await calculate('nope');
    }, /Invalid argument: fileSizes must be an array of integers/);

    assert.rejects(async () => {
      await calculate(['fail']);
    }, /Invalid argument: fileSizes must be an array of integers/);

  })

  it('returns the estimated total cost to upload files of the given sizes', async () => {
    const fileSizes = [2000, 2022000];
    const result = await calculate(fileSizes);

    assert(result.arweave > 0);
    assert(result.solana > 0);
    assert(result.arweavePrice > 0);
    assert(result.solanaPrice > 0);
    assert(result.exchangeRate > 0);
    assert(result.byteCostInWinstons > 0);
    assert.strictEqual(result.totalBytes, fileSizes[0] + fileSizes[1]);
    assert(result.fee > 0);
  })
})