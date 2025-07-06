const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config/constants");

// Middleware untuk memverifikasi JWT di route (REST API)
const authenticateToken = (req, res, next) => {
  // ambil token dari header Authorization
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    // jika tidak ada token, tolak akses
    return res.status(401).json({
      success: false,
      error: "Token akses diperlukan",
    });
  }

  // verifikasi token
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: "Token tidak valid atau kedaluwarsa",
      });
    }
    // simpan data user ke req untuk digunakan controller
    req.user = user;
    next();
  });
};

// Middleware untuk memverifikasi JWT di handshake Socket.IO
const socketAuth = (socket, next) => {
  // ambil token dari handshake auth
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Token autentikasi diperlukan"));
  }

  try {
    // verifikasi token
    const payload = jwt.verify(token, SECRET_KEY);
    socket.user = payload; // tempel data user ke socket
    next();
  } catch (err) {
    next(new Error("Token tidak valid"));
  }
};

module.exports = {
  authenticateToken,
  socketAuth,
};
