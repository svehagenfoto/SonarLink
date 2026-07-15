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

function readLatestCommandsFromDisk(commandsFile) {
  const state = {
    thirdPerson: null,
    thirdPersonDistance: null,
    otherByCmd: {},
  };

  if (!fs.existsSync(commandsFile)) {
    return state;
  }

  try {
    const content = fs.readFileSync(commandsFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.cmd === 'third-person') {
          state.thirdPerson = trimmed;
        } else if (parsed.cmd === 'third-person-distance') {
          state.thirdPersonDistance = trimmed;
        } else if (parsed.cmd) {
          state.otherByCmd[parsed.cmd] = trimmed;
        }
      } catch {
        // Skip invalid lines from legacy or partial writes.
      }
    }
  } catch {
    // Ignore unreadable command files; next write recreates a compact file.
  }

  return state;
}

function writeCompactCommands(commandsFile, state) {
  const lines = [];
  if (state.thirdPerson) lines.push(state.thirdPerson);
  if (state.thirdPersonDistance) lines.push(state.thirdPersonDistance);

  for (const cmd of Object.keys(state.otherByCmd).sort()) {
    lines.push(state.otherByCmd[cmd]);
  }

  const content = lines.length ? `${lines.join('\n')}\n` : '';
  const dir = path.dirname(commandsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${commandsFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');

  try {
    fs.renameSync(tmpPath, commandsFile);
  } catch {
    fs.writeFileSync(commandsFile, content, 'utf8');
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore stale temp files.
    }
  }
}

function compactCommandsFile() {
  const commandsFile = getCommandsFile();
  const state = readLatestCommandsFromDisk(commandsFile);
  writeCompactCommands(commandsFile, state);
}

function thirdPersonSemanticallyEqual(existingLine, payload) {
  if (payload.force) return false;

  try {
    const parsed = JSON.parse(existingLine);
    return (
      parsed.cmd === 'third-person'
      && Boolean(parsed.enabled) === Boolean(payload.enabled)
      && Boolean(parsed.force) === Boolean(payload.force)
    );
  } catch {
    return false;
  }
}

function distanceSemanticallyEqual(existingLine, payload) {
  const value = Math.max(1, Math.min(99, Math.round(Number(payload.percent) || 50)));

  try {
    const parsed = JSON.parse(existingLine);
    return (
      parsed.cmd === 'third-person-distance'
      && Number(parsed.percent) === value
      && Boolean(parsed.smooth) === Boolean(payload.smooth)
    );
  } catch {
    return false;
  }
}

function appendCommand(payload) {
  if (!payload?.cmd) return;

  const commandsFile = getCommandsFile();
  const state = readLatestCommandsFromDisk(commandsFile);
  const line = JSON.stringify({
    ...payload,
    ts: Date.now(),
  });

  if (payload.cmd === 'third-person') {
    if (state.thirdPerson && thirdPersonSemanticallyEqual(state.thirdPerson, payload)) {
      return;
    }
    state.thirdPerson = line;
  } else if (payload.cmd === 'third-person-distance') {
    if (state.thirdPersonDistance && distanceSemanticallyEqual(state.thirdPersonDistance, payload)) {
      return;
    }
    state.thirdPersonDistance = line;
  } else {
    state.otherByCmd[payload.cmd] = line;
  }

  writeCompactCommands(commandsFile, state);
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
  compactCommandsFile,
  setThirdPersonEnabled,
  setThirdPersonDistance,
};
