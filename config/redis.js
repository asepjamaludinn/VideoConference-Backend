const Redis = require("ioredis");

let redis;

/**
 * Fungsi untuk menginisialisasi koneksi Redis
 * konfigurasi diambil dari environment variable
 */
const connectRedis = () => {
  redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryDelayOnFailover: 100, // jika terjadi failover, tunggu 100ms
    maxRetriesPerRequest: 3, // maksimal 3 kali percobaan sebelum gagal
  });

  // event saat Redis berhasil connect
  redis.on("connect", () => {
    console.log("Koneksi ke Redis");
  });

  // event jika Redis error
  redis.on("error", (err) => {
    console.error("Koneksi Redis Erorr:", err);
  });

  return redis;
};

// Mendapatkan instance Redis yang sudah diinisialisasi
const getRedisClient = () => {
  if (!redis) {
    throw new Error("Redis client belum diinisialisasi");
  }
  return redis;
};

module.exports = {
  connectRedis,
  getRedisClient,
};
