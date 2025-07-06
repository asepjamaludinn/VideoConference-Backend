const socketIo = require("socket.io");
const { socketAuth } = require("../middleware/auth");
const SessionManager = require("../models/SessionManager");
const { SOCKET_EVENTS, SESSION_DEFAULTS } = require("../config/constants");
const { getRedisClient } = require("../config/redis");
const logger = require("../utils/logger");

let io;

const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const sessionManager = new SessionManager();
  const redis = getRedisClient();

  // Middleware otentikasi JWT di socket
  io.use(socketAuth);

  io.on("connection", (socket) => {
    logger.info("User terhubung", {
      userId: socket.user.id,
      name: socket.user.name,
    });

    // Ping aktivitas untuk mencegah idle timeout
    socket.on(SOCKET_EVENTS.ACTIVITY_PING, async () => {
      try {
        const userData = await redis.get(`user:${socket.user.id}`);
        if (userData) {
          const { sessionId } = JSON.parse(userData);
          await sessionManager.updateActivity(sessionId);
        }
      } catch (err) {
        logger.error("Kesalahan activity ping", {
          error: err.message,
          userId: socket.user.id,
        });
      }
    });

    // Gabung ke sesi dengan peringatan expiry
    socket.on(SOCKET_EVENTS.JOIN_SESSION, async (data) => {
      try {
        const user = {
          id: socket.user.id,
          name: socket.user.name,
          email: socket.user.email,
          socketId: socket.id,
        };

        const result = await sessionManager.joinSession(data.sessionId, user);
        socket.join(data.sessionId);

        // Kirim info sesi beserta statistik waktu
        const stats = await sessionManager.getSessionStats(data.sessionId);

        socket.emit(SOCKET_EVENTS.SESSION_JOINED, {
          success: true,
          session: result.session,
          participant: result.participant,
          participants: result.session.participants,
          stats: stats,
        });

        // Beri tahu peserta lain
        socket.to(data.sessionId).emit(SOCKET_EVENTS.PARTICIPANT_JOINED, {
          participant: result.participant,
          participantCount: result.session.participants.length,
        });

        // Pasang timer peringatan expiry
        setupExpiryWarning(socket, data.sessionId, stats.timeUntilExpiry);
      } catch (err) {
        socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
          message: err.message,
        });
      }
    });

    // Mengakhiri sesi secara manual (hanya host)
    socket.on(SOCKET_EVENTS.END_SESSION, async (data) => {
      try {
        const result = await sessionManager.endSession(
          data.sessionId,
          "manual",
          socket.user.id
        );

        // Beri tahu semua peserta bahwa sesi telah diakhiri
        io.to(data.sessionId).emit(SOCKET_EVENTS.SESSION_ENDED, {
          reason: "ended_by_host",
          message: "Sesi telah diakhiri oleh host",
          stats: await sessionManager.getSessionStats(data.sessionId),
        });

        // Memaksa semua peserta keluar dari room
        const room = io.sockets.adapter.rooms.get(data.sessionId);
        if (room) {
          room.forEach((socketId) => {
            const participantSocket = io.sockets.sockets.get(socketId);
            if (participantSocket) {
              participantSocket.leave(data.sessionId);
            }
          });
        }

        logger.info("Sesi diakhiri manual oleh host", {
          sessionId: data.sessionId,
          hostId: socket.user.id,
        });
      } catch (err) {
        socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
          message: err.message,
        });
      }
    });

    // Peserta keluar dari sesi
    socket.on(SOCKET_EVENTS.LEAVE_SESSION, async () => {
      try {
        const userId = socket.user.id;
        const leftData = await sessionManager.leaveSession(userId);

        if (leftData) {
          socket.to(leftData.sessionId).emit(SOCKET_EVENTS.PARTICIPANT_LEFT, {
            userId: userId,
          });
          socket.leave(leftData.sessionId);
        }
      } catch (err) {
        logger.error("Kesalahan saat keluar sesi", {
          error: err.message,
          userId: socket.user.id,
        });
      }
    });

    // Kick peserta dari sesi
    socket.on(SOCKET_EVENTS.KICK_PARTICIPANT, async (data) => {
      try {
        const result = await sessionManager.kickParticipant(
          socket.user.id,
          data.targetUserId
        );

        const kickedSocket = await getSocketByUserId(result.targetUserId);
        if (kickedSocket) {
          kickedSocket.emit(SOCKET_EVENTS.KICKED_FROM_SESSION, {
            reason: "Dikeluarkan oleh host",
          });
          kickedSocket.leave(result.session.id);
        }

        io.to(result.session.id).emit(SOCKET_EVENTS.PARTICIPANT_KICKED, {
          userId: data.targetUserId,
        });
      } catch (err) {
        socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
          message: err.message,
        });
      }
    });

    // Mute/unmute peserta
    socket.on(SOCKET_EVENTS.TOGGLE_MUTE, async (data) => {
      try {
        const result = await sessionManager.toggleMute(
          socket.user.id,
          data.targetUserId,
          data.isMuted
        );

        io.to(result.session.id).emit(SOCKET_EVENTS.PARTICIPANT_MUTE_CHANGED, {
          userId: data.targetUserId,
          isMuted: data.isMuted,
        });
      } catch (err) {
        socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
          message: err.message,
        });
      }
    });

    // Tangani disconnect
    socket.on("disconnect", async () => {
      logger.info("User terputus", {
        userId: socket.user.id,
        name: socket.user.name,
      });

      try {
        const userId = socket.user.id;
        const leftData = await sessionManager.leaveSession(userId);

        if (leftData) {
          socket.to(leftData.sessionId).emit(SOCKET_EVENTS.PARTICIPANT_LEFT, {
            userId,
          });
        }
      } catch (err) {
        logger.error("Kesalahan saat disconnect", {
          error: err.message,
          userId: socket.user.id,
        });
      }
    });
  });

  // Fungsi pembantu untuk timer peringatan expiry
  function setupExpiryWarning(socket, sessionId, timeUntilExpiry) {
    const warningTime = timeUntilExpiry - SESSION_DEFAULTS.expiryWarning;

    if (warningTime > 0) {
      setTimeout(() => {
        socket.emit(SOCKET_EVENTS.SESSION_WARNING, {
          message: "Sesi akan berakhir dalam 5 menit",
          timeRemaining: SESSION_DEFAULTS.expiryWarning,
        });
      }, warningTime);
    }
  }

  // Fungsi pembantu untuk mencari socket berdasarkan user ID
  async function getSocketByUserId(userId) {
    const userData = await redis.get(`user:${userId}`);
    if (userData) {
      const { socketId } = JSON.parse(userData);
      return io.sockets.sockets.get(socketId);
    }
    return null;
  }
};

// Getter untuk IO
const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO belum diinisialisasi");
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
};
