const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);

  // jika terjadi error validasi
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.message,
    });
  }

  // jika JWT tidak valid
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      error: "Token tidak valid",
    });
  }

  // jika JWT kadaluarsa
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      error: "Token kadaluarsa",
    });
  }

  // fallback error 500
  res.status(500).json({
    success: false,
    error: "Terjadi kesalahan pada server",
  });
};

module.exports = {
  errorHandler,
};
