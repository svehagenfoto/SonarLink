const MOD_NOREPEAT = 0x4000;

const MODIFIERS = {
  CTRL: 0x0002,
  ALT: 0x0001,
  SHIFT: 0x0004,
  WIN: 0x0008,
};

const NAMED_KEYS = {
  SPACE: 0x20,
  ENTER: 0x0d,
  TAB: 0x09,
  ESCAPE: 0x1b,
  BACKSPACE: 0x08,
  DELETE: 0x2e,
  INSERT: 0x2d,
  HOME: 0x24,
  END: 0x23,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
  'PAGE UP': 0x21,
  'PAGE DOWN': 0x22,
};

const MOUSE_BIND_KEYS = {
  'MOUSE 3': 0x04,
  'MOUSE 4': 0x05,
  'MOUSE 5': 0x06,
};

const BLOCKED_MOUSE_BIND_KEYS = new Set(['MOUSE 1', 'MOUSE 2']);

const ACCELERATOR_KEYS = {
  SPACE: 'Space',
  ENTER: 'Enter',
  TAB: 'Tab',
  ESCAPE: 'Escape',
  ESC: 'Escape',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  'PAGE UP': 'PageUp',
  'PAGE DOWN': 'PageDown',
};

const ACCELERATOR_MODIFIERS = {
  CTRL: 'Ctrl',
  ALT: 'Alt',
  SHIFT: 'Shift',
  WIN: 'Super',
};

function parseKeyLabel(label) {
  if (!label || typeof label !== 'string') return null;

  const normalized = label.trim().toUpperCase();
  if (BLOCKED_MOUSE_BIND_KEYS.has(normalized)) return null;

  const mouseVk = MOUSE_BIND_KEYS[normalized];
  if (mouseVk != null) {
    return { type: 'mouse', vk: mouseVk };
  }

  const parts = normalized.split('+').map((part) => part.trim());
  let modifiers = 0;
  let vk = null;

  for (const part of parts) {
    if (MODIFIERS[part]) {
      modifiers |= MODIFIERS[part];
      continue;
    }

    if (NAMED_KEYS[part]) {
      vk = NAMED_KEYS[part];
      continue;
    }

    if (part.length === 1 && part >= 'A' && part <= 'Z') {
      vk = part.charCodeAt(0);
      continue;
    }

    if (part.length === 1 && part >= '0' && part <= '9') {
      vk = part.charCodeAt(0);
      continue;
    }

    const fMatch = part.match(/^F(\d{1,2})$/);
    if (fMatch) {
      const n = Number(fMatch[1]);
      if (n >= 1 && n <= 24) {
        vk = 0x6f + n;
      }
    }
  }

  if (vk == null) return null;
  return { type: 'keyboard', modifiers: modifiers | MOD_NOREPEAT, vk };
}

function keyLabelToAccelerator(label) {
  if (!label || typeof label !== 'string') return null;

  const normalized = label.trim().toUpperCase();
  if (BLOCKED_MOUSE_BIND_KEYS.has(normalized)) return null;
  if (MOUSE_BIND_KEYS[normalized] != null) return null;

  const parts = normalized.split('+').map((part) => part.trim()).filter(Boolean);
  const acceleratorParts = [];
  let keyPart = null;

  for (const part of parts) {
    if (ACCELERATOR_MODIFIERS[part]) {
      acceleratorParts.push(ACCELERATOR_MODIFIERS[part]);
      continue;
    }

    if (ACCELERATOR_KEYS[part]) {
      keyPart = ACCELERATOR_KEYS[part];
      continue;
    }

    if (part.length === 1 && part >= 'A' && part <= 'Z') {
      keyPart = part;
      continue;
    }

    if (part.length === 1 && part >= '0' && part <= '9') {
      keyPart = part;
      continue;
    }

    const fMatch = part.match(/^F(\d{1,2})$/);
    if (fMatch) {
      const n = Number(fMatch[1]);
      if (n >= 1 && n <= 24) {
        keyPart = `F${n}`;
      }
    }
  }

  if (!keyPart) return null;
  acceleratorParts.push(keyPart);
  return acceleratorParts.join('+');
}

/** Home is reserved for the SonarLink menu and cannot be used as a feature bind. */
function isReservedHomeBind(label) {
  if (!label || typeof label !== 'string') return false;
  const parts = label.trim().toUpperCase().split('+').map((part) => part.trim());
  return parts.includes('HOME');
}

function sanitizeFeatureBindKey(label) {
  if (!label || typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (!trimmed || isReservedHomeBind(trimmed)) return null;
  return trimmed;
}

module.exports = {
  parseKeyLabel,
  keyLabelToAccelerator,
  isReservedHomeBind,
  sanitizeFeatureBindKey,
  MOUSE_BIND_KEYS,
  BLOCKED_MOUSE_BIND_KEYS,
};
