const express = require("express");
const SessionManager = require("../models/SessionManager");
const { authenticateToken } = require("../middleware/auth");
const router = express.Router();

const sessionManager = new SessionManager();

// Membuat session baru dengan opsi durasi kustom
router.post("/sessions", authenticateToken, async (req, res) => {
  try {
    const { hostId, sessionName, duration, maxParticipants } = req.body;

    if (!hostId || !sessionName) {
      return res.status(400).json({
        success: false,
        error: "hostId dan sessionName wajib diisi",
      });
    }

    const options = {};
    if (duration) options.duration = duration;
    if (maxParticipants) options.maxParticipants = maxParticipants;

    const session = await sessionManager.createSession(
      hostId,
      sessionName,
      options
    );

    res.json({
      success: true,
      session,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Mendapatkan detail sesi beserta statistik
router.get("/sessions/:sessionId", async (req, res) => {
  try {
    const session = await sessionManager.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Session tidak ditemukan",
      });
    }

    const stats = await sessionManager.getSessionStats(req.params.sessionId);

    res.json({
      success: true,
      session,
      stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Mengakhiri sesi secara manual
router.post("/sessions/:sessionId/end", authenticateToken, async (req, res) => {
  try {
    const result = await sessionManager.endSession(
      req.params.sessionId,
      "manual",
      req.user.id
    );

    res.json({
      success: true,
      message: "Session berhasil diakhiri",
      session: result.session,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Mendapatkan statistik sesi
router.get("/sessions/:sessionId/stats", async (req, res) => {
  try {
    const stats = await sessionManager.getSessionStats(req.params.sessionId);
    if (!stats) {
      return res.status(404).json({
        success: false,
        error: "Session tidak ditemukan",
      });
    }

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
