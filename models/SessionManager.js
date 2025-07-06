const { v4: uuidv4 } = require("uuid");
const { getRedisClient } = require("../config/redis");
const { SESSION_DEFAULTS } = require("../config/constants");
const logger = require("../utils/logger");

class SessionManager {
  constructor() {
    this.redis = getRedisClient();
    // Memulai proses cleanup saat SessionManager dibuat
    this.startCleanupJob();
  }

  // Membuat session baru dengan pelacakan waktu kedaluwarsa
  async createSession(hostId, sessionName, options = {}) {
    const sessionId = uuidv4();
    const now = new Date();

    const session = {
      id: sessionId,
      name: sessionName,
      hostId,
      participants: [],
      createdAt: now.toISOString(),
      lastActivity: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + (options.duration || SESSION_DEFAULTS.sessionDuration)
      ).toISOString(),
      isActive: true,
      settings: {
        ...SESSION_DEFAULTS,
        ...options,
      },
      stats: {
        totalJoins: 0,
        peakParticipants: 0,
      },
    };

    await this.redis.set(`session:${sessionId}`, JSON.stringify(session));

    // Atur waktu kedaluwarsa di Redis sebagai cadangan pembersihan
    await this.redis.expire(
      `session:${sessionId}`,
      Math.ceil(SESSION_DEFAULTS.sessionDuration / 1000)
    );

    logger.info("Session dibuat", { sessionId, hostId, sessionName });
    return session;
  }

  // Mengambil session berdasarkan ID
  async getSession(sessionId) {
    const session = await this.redis.get(`session:${sessionId}`);
    return session ? JSON.parse(session) : null;
  }

  // Menyimpan session ke Redis
  async saveSession(session) {
    await this.redis.set(`session:${session.id}`, JSON.stringify(session));
  }

  // Menghapus session beserta data peserta
  async deleteSession(sessionId) {
    const session = await this.getSession(sessionId);
    if (session) {
      for (const participant of session.participants) {
        await this.redis.del(`user:${participant.id}`);
      }
      await this.redis.del(`session:${sessionId}`);

      logger.info("Session dihapus", {
        sessionId,
        reason: "manual_cleanup",
        duration: new Date() - new Date(session.createdAt),
        participantCount: session.participants.length,
      });
    }
  }

  // Memperbarui timestamp aktivitas
  async updateActivity(sessionId) {
    const session = await this.getSession(sessionId);
    if (session && session.isActive) {
      session.lastActivity = new Date().toISOString();
      await this.saveSession(session);
    }
  }

  // Bergabung ke session dengan pelacakan aktivitas
  async joinSession(sessionId, user) {
    const session = await this.getSession(sessionId);
    if (!session || !session.isActive) {
      throw new Error("Session tidak ditemukan atau tidak aktif");
    }

    // Periksa apakah session sudah kedaluwarsa
    if (new Date() > new Date(session.expiresAt)) {
      await this.endSession(sessionId, "expired");
      throw new Error("Session telah berakhir");
    }

    if (session.participants.length >= session.settings.maxParticipants) {
      throw new Error("Session sudah penuh");
    }

    // Cek apakah user sudah bergabung sebelumnya
    const existingParticipant = session.participants.find(
      (p) => p.id === user.id
    );
    if (existingParticipant) {
      // Update socket ID untuk reconnect
      existingParticipant.socketId = user.socketId;
      existingParticipant.reconnectedAt = new Date().toISOString();
    } else {
      const participant = {
        id: user.id,
        name: user.name,
        email: user.email,
        isHost: user.id === session.hostId,
        isMuted: false,
        isVideoOn: true,
        isScreenSharing: false,
        joinedAt: new Date().toISOString(),
        socketId: user.socketId,
      };
      session.participants.push(participant);
      session.stats.totalJoins++;
    }

    // Update statistik
    session.stats.peakParticipants = Math.max(
      session.stats.peakParticipants,
      session.participants.length
    );
    session.lastActivity = new Date().toISOString();

    await this.saveSession(session);
    await this.redis.set(
      `user:${user.id}`,
      JSON.stringify({
        sessionId,
        socketId: user.socketId,
        lastActivity: new Date().toISOString(),
      })
    );

    logger.info("User bergabung ke session", {
      sessionId,
      userId: user.id,
      participantCount: session.participants.length,
    });

    return {
      session,
      participant: session.participants.find((p) => p.id === user.id),
    };
  }

  // Peserta keluar dari session
  async leaveSession(userId) {
    const userData = await this.redis.get(`user:${userId}`);
    if (!userData) return null;

    const { sessionId } = JSON.parse(userData);
    const session = await this.getSession(sessionId);
    if (!session) return null;

    // Hapus peserta dari daftar
    session.participants = session.participants.filter((p) => p.id !== userId);
    session.lastActivity = new Date().toISOString();

    // Transfer host jika host keluar
    if (session.hostId === userId && session.participants.length > 0) {
      const newHost = session.participants[0];
      session.hostId = newHost.id;
      newHost.isHost = true;
      logger.info("Host dipindahkan", {
        sessionId,
        oldHostId: userId,
        newHostId: newHost.id,
      });
    }

    // Akhiri session otomatis jika peserta habis
    if (session.participants.length === 0) {
      await this.endSession(sessionId, "empty");
    } else {
      await this.saveSession(session);
    }

    await this.redis.del(`user:${userId}`);

    logger.info("User keluar dari session", {
      sessionId,
      userId,
      remainingParticipants: session.participants.length,
    });

    return { sessionId };
  }

  // Mengakhiri session (manual atau otomatis)
  async endSession(sessionId, reason = "manual", hostId = null) {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error("Session tidak ditemukan");
    }

    // Verifikasi izin host jika mengakhiri manual
    if (reason === "manual" && hostId && session.hostId !== hostId) {
      throw new Error("Hanya host yang dapat mengakhiri session");
    }

    session.isActive = false;
    session.endedAt = new Date().toISOString();
    session.endReason = reason;

    // Bersihkan semua data peserta
    const participantIds = session.participants.map((p) => p.id);
    for (const participantId of participantIds) {
      await this.redis.del(`user:${participantId}`);
    }

    // Simpan status akhir untuk log, lalu hapus
    await this.saveSession(session);

    // Tunggu sebentar sebelum menghapus data session
    setTimeout(async () => {
      await this.redis.del(`session:${sessionId}`);
    }, 5000);

    logger.info("Session diakhiri", {
      sessionId,
      reason,
      duration: new Date(session.endedAt) - new Date(session.createdAt),
      totalParticipants: session.stats.totalJoins,
      peakParticipants: session.stats.peakParticipants,
    });

    return { session, participantIds };
  }

  // Kick participant oleh host
  async kickParticipant(hostId, targetUserId) {
    const hostData = await this.redis.get(`user:${hostId}`);
    if (!hostData) throw new Error("Host tidak ditemukan");

    const { sessionId } = JSON.parse(hostData);
    const session = await this.getSession(sessionId);

    if (!session || session.hostId !== hostId) {
      throw new Error("Hanya host yang boleh menendang participant");
    }

    session.participants = session.participants.filter(
      (p) => p.id !== targetUserId
    );
    session.lastActivity = new Date().toISOString();

    await this.saveSession(session);
    await this.redis.del(`user:${targetUserId}`);

    logger.info("Participant ditendang", { sessionId, hostId, targetUserId });

    return { session, targetUserId };
  }

  // Mute/unmute participant
  async toggleMute(hostId, targetUserId, isMuted) {
    const hostData = await this.redis.get(`user:${hostId}`);
    if (!hostData) throw new Error("Host tidak ditemukan");

    const { sessionId } = JSON.parse(hostData);
    const session = await this.getSession(sessionId);

    if (!session || session.hostId !== hostId) {
      throw new Error("Hanya host yang boleh mute/unmute participant");
    }

    const participant = session.participants.find((p) => p.id === targetUserId);
    if (!participant) throw new Error("Participant tidak ditemukan");

    participant.isMuted = isMuted;
    session.lastActivity = new Date().toISOString();

    await this.saveSession(session);

    return { session, participant };
  }

  // Job background untuk pembersihan session
  startCleanupJob() {
    // Jalankan setiap 5 menit
    setInterval(async () => {
      await this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    logger.info("Pembersih session berjalan");
  }

  // Membersihkan session yang sudah kedaluwarsa atau idle
  async cleanupExpiredSessions() {
    try {
      const keys = await this.redis.keys("session:*");
      const now = new Date();
      let cleanedCount = 0;

      for (const key of keys) {
        const sessionData = await this.redis.get(key);
        if (!sessionData) continue;

        const session = JSON.parse(sessionData);
        const sessionId = session.id;

        let shouldCleanup = false;
        let reason = "";

        // Cek expired
        if (now > new Date(session.expiresAt)) {
          shouldCleanup = true;
          reason = "expired";
        }
        // Cek idle
        else if (
          now - new Date(session.lastActivity) >
          SESSION_DEFAULTS.idleTimeout
        ) {
          shouldCleanup = true;
          reason = "idle";
        }
        // Cek inactive
        else if (!session.isActive) {
          shouldCleanup = true;
          reason = "inactive";
        }

        if (shouldCleanup) {
          await this.endSession(sessionId, reason);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info("Pembersihan selesai", { cleanedSessions: cleanedCount });
      }
    } catch (error) {
      logger.error("Cleanup gagal", { error: error.message });
    }
  }

  // Mendapatkan statistik session
  async getSessionStats(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const now = new Date();
    const createdAt = new Date(session.createdAt);
    const lastActivity = new Date(session.lastActivity);

    return {
      id: sessionId,
      name: session.name,
      isActive: session.isActive,
      duration: now - createdAt,
      timeSinceLastActivity: now - lastActivity,
      timeUntilExpiry: new Date(session.expiresAt) - now,
      participantCount: session.participants.length,
      totalJoins: session.stats.totalJoins,
      peakParticipants: session.stats.peakParticipants,
      isExpired: now > new Date(session.expiresAt),
      isIdle: now - lastActivity > SESSION_DEFAULTS.idleTimeout,
    };
  }
}

module.exports = SessionManager;
