const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getDataRoot } = require('./configStore');

const CRASH_LOG_MAX_LINES = 100;

let registered = false;

function getCrashLogPath() {
  const dataRoot = getDataRoot();
  if (dataRoot) {
    return path.join(dataRoot, 'logs', 'crash.log');
  }

  try {
    return path.join(app.getPath('userData'), 'logs', 'crash.log');
  } catch {
    return null;
  }
}

function appendCrashLog(kind, detail) {
  try {
    const logPath = getCrashLogPath();
    if (!logPath) return;

    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    let message = detail;
    if (detail instanceof Error) {
      message = detail.stack || detail.message;
    } else if (typeof detail === 'object' && detail !== null) {
      message = JSON.stringify(detail);
    } else {
      message = String(detail);
    }

    const line = `[${new Date().toISOString()}] ${kind} ${message}`;

    let lines = [];
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      lines = content.split(/\r?\n/).filter(Boolean);
    }

    lines.push(line);
    if (lines.length > CRASH_LOG_MAX_LINES) {
      lines = lines.slice(-CRASH_LOG_MAX_LINES);
    }

    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Ignore logging failures.
  }
}

function registerCrashDiagnostics(electronApp) {
  if (registered) return;
  registered = true;

  process.on('uncaughtException', (err) => {
    appendCrashLog('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    appendCrashLog('unhandledRejection', reason);
  });

  electronApp.on('render-process-gone', (_event, webContents, details) => {
    appendCrashLog('render-process-gone', {
      reason: details?.reason,
      exitCode: details?.exitCode,
      url: typeof webContents?.getURL === 'function' ? webContents.getURL() : null,
    });
  });

  electronApp.on('child-process-gone', (_event, details) => {
    appendCrashLog('child-process-gone', details);
  });
}

module.exports = {
  registerCrashDiagnostics,
  appendCrashLog,
};
