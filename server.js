const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

const { initializeSocket } = require("./socket/socketHandler");
const { connectRedis } = require("./config/redis");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors()); // mengizinkan CORS agar bisa diakses dari mana saja
app.use(express.json()); // parsing JSON body
app.use(express.static("public")); // serve file statis

// Inisialisasi koneksi Redis terlebih dulu
connectRedis();

// setelah Redis connect, baru require routes agar tidak error
const sessionRoutes = require("./routes/sessionRoutes");

// Routes untuk endpoint session
app.use("/api", sessionRoutes);

// Middleware penanganan error global
app.use(errorHandler);

// Inisialisasi Socket.IO
initializeSocket(server);

const PORT = process.env.PORT || 3001;

// Menjalankan server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
