/**
 * Structured logger for the Smart Form QA Bot.
 * Emits JSON-friendly log lines with consistent fields.
 */

import fs from 'fs';
import path from 'path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(options = {}) {
    this.level = LEVELS[options.level || process.env.LOG_LEVEL || 'info'] ?? 1;
    this.logFile = options.logFile || null;
    this.site = options.site || null;
    this.stream = null;
  }

  setLogFile(filePath) {
    this.logFile = filePath;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    } catch (err) {
      console.error('Failed to open log file:', err.message);
    }
  }

  setSite(site) {
    this.site = site;
  }

  _write(level, event, data = {}) {
    if (LEVELS[level] < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(this.site ? { site: this.site } : {}),
      ...data
    };

    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (this.stream) {
      this.stream.write(line + '\n');
    }
  }

  debug(event, data) { this._write('debug', event, data); }
  info(event, data) { this._write('info', event, data); }
  warn(event, data) { this._write('warn', event, data); }
  error(event, data) { this._write('error', event, data); }

  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

export default Logger;
