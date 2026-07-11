const fs = require('fs');
const path = require('path');
const { getDataRoot } = require('./configStore');

function getCommandsFile() {
  const dataRoot = getDataRoot();
  if (!dataRoot) {
    throw new Error('DATA_ROOT_MISSING');
  }
  return path.join(dataRoot, 'commands.jsonl');
}

function appendCommand(payload) {
  const commandsFile = getCommandsFile();
  const dir = path.dirname(commandsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify({
    ...payload,
    ts: Date.now(),
  });

  fs.appendFileSync(commandsFile, `${line}\n`, 'utf8');
}

function setThirdPersonEnabled(enabled, options = {}) {
  appendCommand({
    cmd: 'third-person',
    action: 'set',
    enabled: Boolean(enabled),
    force: Boolean(options.force),
  });
}

function setThirdPersonDistance(percent, options = {}) {
  const value = Math.max(1, Math.min(99, Math.round(Number(percent) || 50)));
  appendCommand({
    cmd: 'third-person-distance',
    percent: value,
    smooth: Boolean(options.smooth),
  });
}

module.exports = {
  getCommandsFile,
  appendCommand,
  setThirdPersonEnabled,
  setThirdPersonDistance,
};
