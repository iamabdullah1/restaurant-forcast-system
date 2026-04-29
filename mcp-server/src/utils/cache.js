import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

const globalForCache = globalThis;
if (!globalForCache.__restaurantRedisCache) {
  globalForCache.__restaurantRedisCache = {
    redis: null,
  };
}

function getRedisClient() {
  if (!REDIS_URL) return null;
  if (!globalForCache.__restaurantRedisCache.redis) {
    globalForCache.__restaurantRedisCache.redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return globalForCache.__restaurantRedisCache.redis;
}

async function ensureConnected(redis) {
  if (!redis) return false;
  if (redis.status === "ready") return true;
  if (redis.status === "connecting") return false;
  try {
    await redis.connect();
    return true;
  } catch {
    return false;
  }
}

export async function cacheGet(key) {
  const redis = getRedisClient();
  if (!redis) return null;

  const ok = await ensureConnected(redis);
  if (!ok) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlMs) {
  const redis = getRedisClient();
  if (!redis) return false;

  const ok = await ensureConnected(redis);
  if (!ok) return false;

  try {
    if (ttlMs && ttlMs > 0) {
      await redis.set(key, JSON.stringify(value), "PX", ttlMs);
    } else {
      await redis.set(key, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}
