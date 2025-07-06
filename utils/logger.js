const fs = require("fs");
const path = require("path");

class Logger {
  constructor() {
    // menentukan folder tempat menyimpan log
    this.logDir = path.join(__dirname, "../logs");
    this.ensureLogDir();
  }

  // Memastikan folder logs sudah ada
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  // Membentuk format log standar (JSON string)
  formatMessage(level, message, meta = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    });
  }

  // Log level info
  info(message, meta = {}) {
    const logMessage = this.formatMessage("INFO", message, meta);
    console.log(logMessage);
    this.writeToFile("info.log", logMessage);
  }

  // Log level error
  error(message, meta = {}) {
    const logMessage = this.formatMessage("ERROR", message, meta);
    console.error(logMessage);
    this.writeToFile("error.log", logMessage);
  }

  // Log level warning
  warn(message, meta = {}) {
    const logMessage = this.formatMessage("WARN", message, meta);
    console.warn(logMessage);
    this.writeToFile("warn.log", logMessage);
  }

  // Menulis pesan log ke file
  writeToFile(filename, message) {
    const filePath = path.join(this.logDir, filename);
    fs.appendFileSync(filePath, message + "\n");
  }
}

module.exports = new Logger();
