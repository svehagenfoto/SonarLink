const fs = require('fs');

const HEADER_READ_BYTES = 16384;
const DISPLAY_MARKER = 'DisplayName';

const SKIP_NAMES = new Set([
  'StrProperty',
  'StructProperty',
  'IntProperty',
  'SlotName',
  'DisplayName',
  'LevelName',
  'Guid',
  'None',
  'SaveId',
]);

function findDisplayNameAfterMarker(slice, markerIndex) {
  const start = markerIndex + DISPLAY_MARKER.length;

  for (let offset = start; offset < slice.length - 4; offset += 1) {
    const length = slice.readInt32LE(offset);
    if (length < 1 || length > 64) continue;
    if (offset + 4 + length > slice.length) continue;

    const raw = slice.toString('utf8', offset + 4, offset + 4 + length).replace(/\0/g, '');
    const trimmed = raw.trim();
    if (!trimmed || SKIP_NAMES.has(trimmed)) continue;
    if (!/^[\x20-\x7E]+$/.test(trimmed)) continue;

    return trimmed;
  }

  return null;
}

function readDisplayNameFromSav(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  let handle = null;
  try {
    handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(HEADER_READ_BYTES);
    const bytesRead = fs.readSync(handle, buffer, 0, HEADER_READ_BYTES, 0);
    if (!bytesRead || bytesRead < 32) return null;

    const slice = buffer.subarray(0, bytesRead);
    const markerIndex = slice.indexOf(DISPLAY_MARKER);
    if (markerIndex < 0) return null;

    return findDisplayNameAfterMarker(slice, markerIndex);
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  readDisplayNameFromSav,
};
