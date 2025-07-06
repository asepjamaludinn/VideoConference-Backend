module.exports = {
  SECRET_KEY: process.env.JWT_SECRET || "MY_SUPER_SECRET_KEY",

  // Pengaturan default sesi
  SESSION_DEFAULTS: {
    maxParticipants: 100, // Maksimum jumlah peserta
    allowChat: true, // Apakah chat diizinkan
    allowScreenShare: true, // Apakah berbagi layar diizinkan
    requireApproval: false, // Apakah peserta butuh persetujuan host
    sessionDuration:
      Number.parseInt(process.env.SESSION_DURATION) || 60 * 60 * 1000, // Durasi sesi (1 jam dalam milidetik)
    idleTimeout: Number.parseInt(process.env.IDLE_TIMEOUT) || 15 * 60 * 1000, // Timeout idle (15 menit dalam milidetik)
    expiryWarning: 5 * 60 * 1000, // Peringatan sebelum sesi berakhir (5 menit)
  },

  // Konstanta nama event untuk Socket.IO
  SOCKET_EVENTS: {
    JOIN_SESSION: "join-session", // Bergabung ke sesi
    LEAVE_SESSION: "leave-session", // Keluar dari sesi
    KICK_PARTICIPANT: "kick-participant", // Tendang peserta
    END_SESSION: "end-session", // Akhiri sesi manual oleh host
    SESSION_JOINED: "session-joined", // Berhasil bergabung ke sesi
    SESSION_ERROR: "session-error", // Terjadi kesalahan pada sesi
    SESSION_ENDED: "session-ended", // Pemberitahuan sesi diakhiri
    SESSION_WARNING: "session-warning", // Peringatan sesi akan habis
    PARTICIPANT_JOINED: "participant-joined", // Peserta baru bergabung
    PARTICIPANT_LEFT: "participant-left", // Peserta keluar
    PARTICIPANT_KICKED: "participant-kicked", // Peserta ditendang
    KICKED_FROM_SESSION: "kicked-from-session", // Pemberitahuan ditendang
    TOGGLE_MUTE: "toggle-mute", // Perintah mute/unmute
    PARTICIPANT_MUTE_CHANGED: "participant-mute-changed", // Notifikasi mute/unmute
    ACTIVITY_PING: "activity-ping", // Ping aktivitas (agar tidak idle)
  },
};
