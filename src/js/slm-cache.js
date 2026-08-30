// IndexedDB-backed cache for the small language model weights.
//
// transformers.js accepts a custom cache implementing the `match`/`put` subset
// of the Web Cache API. Persisting the weights in IndexedDB means the (large)
// model files are downloaded once per browser instead of on every visit.

export const CACHE_DB_NAME = 'gh-aw-wizard-slm';
export const CACHE_STORE_NAME = 'model-files';
export const CACHE_DB_VERSION = 1;

export function cacheKeyFor(request) {
  if (typeof request === 'string') return request;
  if (request && typeof request.url === 'string') return request.url;
  return String(request);
}

// Cached entries keep the bytes plus the headers transformers.js relies on
// (content-type / content-length) so `match` can rebuild a faithful Response.
export function serializeHeaders(headers) {
  const serialized = {};
  if (!headers || typeof headers.forEach !== 'function') return serialized;
  headers.forEach((value, key) => { serialized[String(key).toLowerCase()] = value; });
  return serialized;
}

export function openCacheDatabase(factory) {
  const indexedDBImpl = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!indexedDBImpl) return Promise.reject(new Error('IndexedDB is not available'));
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) db.createObjectStore(CACHE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the model cache'));
    request.onblocked = () => reject(new Error('The model cache is blocked by another tab'));
  });
}

function transactionRequest(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE_NAME, mode);
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Model cache request failed'));
  });
}

async function responseBytes(response) {
  if (!response) return null;
  if (typeof response.arrayBuffer === 'function') return await response.arrayBuffer();
  if (response instanceof ArrayBuffer) return response;
  if (ArrayBuffer.isView(response)) return response.buffer.slice(0);
  return null;
}

// Creates the object handed to `env.customCache`. Failures degrade to a plain
// network fetch rather than breaking model loading.
export function createModelCache(options) {
  const opts = options || {};
  const logger = opts.logger || null;
  let dbPromise = null;

  function database() {
    if (!dbPromise) {
      if (logger) logger.log('database.opening', { database: CACHE_DB_NAME, version: CACHE_DB_VERSION });
      dbPromise = openCacheDatabase(opts.indexedDB).catch((error) => {
        dbPromise = null;
        if (logger) logger.error('database.open.failed', { error });
        throw error;
      });
    }
    return dbPromise;
  }

  return {
    async match(request) {
      const key = cacheKeyFor(request);
      try {
        const db = await database();
        const entry = await transactionRequest(db, 'readonly', (store) => store.get(key));
        if (!entry || !entry.body) {
          if (logger) logger.debug('entry.missed', { key });
          return undefined;
        }
        if (logger) logger.log('entry.hit', { key, byteLength: entry.body.byteLength });
        return new Response(entry.body, { headers: entry.headers || {} });
      } catch (error) {
        if (logger) logger.warn('entry.read.failed', { key, error });
        return undefined;
      }
    },
    async put(request, response, progressCallback) {
      const key = cacheKeyFor(request);
      try {
        const headers = serializeHeaders(response && response.headers);
        const body = await responseBytes(response);
        if (!body) {
          if (logger) logger.warn('entry.skipped', { key, reason: 'response body unavailable' });
          return;
        }
        if (typeof progressCallback === 'function') {
          progressCallback({ progress: 100, loaded: body.byteLength, total: body.byteLength });
        }
        const db = await database();
        await transactionRequest(db, 'readwrite', (store) => {
          return store.put({ body, headers, stored_at: Date.now() }, key);
        });
        if (logger) logger.log('entry.stored', { key, byteLength: body.byteLength });
      } catch (error) {
        // Storing is best effort: a full quota must not block the model.
        if (logger) logger.warn('entry.write.failed', { key, error });
      }
    },
    async delete(request) {
      const key = cacheKeyFor(request);
      try {
        const db = await database();
        await transactionRequest(db, 'readwrite', (store) => store.delete(key));
        if (logger) logger.log('entry.deleted', { key });
        return true;
      } catch (error) {
        if (logger) logger.warn('entry.delete.failed', { key, error });
        return false;
      }
    }
  };
}
