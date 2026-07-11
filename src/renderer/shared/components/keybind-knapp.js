/**
 * Keybind knapp — click anywhere on the row to bind a key.
 * ESC while listening from unbound: cancel.
 * ESC while listening from bound: clear bind.
 */

let activeKeybind = null;

const KEY_LABELS = {
  ' ': 'SPACE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Enter: 'ENTER',
  Tab: 'TAB',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  Insert: 'INSERT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGE UP',
  PageDown: 'PAGE DOWN',
};

const BLOCKED_MOUSE_BUTTONS = new Set([0, 2]);

const MOUSE_BUTTON_LABELS = {
  1: 'MOUSE 3',
  3: 'MOUSE 4',
  4: 'MOUSE 5',
};

function formatMouseLabel(event) {
  if (BLOCKED_MOUSE_BUTTONS.has(event.button)) return null;
  return MOUSE_BUTTON_LABELS[event.button] || null;
}

function formatKeyLabel(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('CTRL');
  if (event.altKey) modifiers.push('ALT');
  if (event.shiftKey) modifiers.push('SHIFT');
  if (event.metaKey) modifiers.push('WIN');

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return null;
  }

  const key = KEY_LABELS[event.key] || (event.key.length === 1
    ? event.key.toUpperCase()
    : event.key.toUpperCase());

  modifiers.push(key);
  return modifiers.join('+');
}

class KeybindKnapp {
  constructor(element) {
    this.element = element;
    this.slotText = element.querySelector('.keybind-slot-text');
    this.boundKey = null;
    this.state = 'unbound';
    this.cameFromBound = false;
    this.onDocumentKeyDown = this.onDocumentKeyDown.bind(this);
    this.onDocumentMouseDown = this.onDocumentMouseDown.bind(this);

    element.setAttribute('data-state', 'unbound');
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.addEventListener('click', () => this.startListening());
  }

  startListening() {
    if (this.state === 'listening') return;

    if (activeKeybind && activeKeybind !== this) {
      activeKeybind.stopListening(true);
    }

    this.cameFromBound = this.state === 'bound';
    this.setState('listening');
    this.element.setAttribute(
      'data-listening-from',
      this.cameFromBound ? 'bound' : 'unbound',
    );
    this.element.focus();
    activeKeybind = this;
    document.addEventListener('keydown', this.onDocumentKeyDown, true);
    setTimeout(() => {
      document.addEventListener('mousedown', this.onDocumentMouseDown, true);
    }, 0);
  }

  stopListening() {
    document.removeEventListener('keydown', this.onDocumentKeyDown, true);
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
    if (activeKeybind === this) activeKeybind = null;
  }

  onDocumentKeyDown(event) {
    if (activeKeybind !== this) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      if (this.cameFromBound) {
        this.boundKey = null;
        this.setState('unbound');
      } else {
        this.setState(this.boundKey ? 'bound' : 'unbound');
      }
      this.stopListening();
      return;
    }

    const label = formatKeyLabel(event);
    if (!label) return;

    this.boundKey = label;
    this.setState('bound');
    this.stopListening();
  }

  onDocumentMouseDown(event) {
    if (activeKeybind !== this) return;

    const label = formatMouseLabel(event);
    if (!label) return;

    event.preventDefault();
    event.stopPropagation();

    this.boundKey = label;
    this.setState('bound');
    this.stopListening();
  }

  setState(state) {
    this.state = state;
    this.element.setAttribute('data-state', state);

    if (state !== 'listening') {
      this.element.removeAttribute('data-listening-from');
    }

    if (state === 'unbound') {
      this.slotText.textContent = 'NONE';
      this.element.removeAttribute('data-key');
      this.element.dispatchEvent(new CustomEvent('sonar-keybind-change', {
        bubbles: true,
        detail: { state, key: null },
      }));
      return;
    }

    if (state === 'listening') {
      this.slotText.textContent = this.cameFromBound ? 'UNBIND ESC' : 'PRESS KEY OR MOUSE';
      return;
    }

    this.slotText.textContent = this.boundKey;
    this.element.setAttribute('data-key', this.boundKey);
    this.element.dispatchEvent(new CustomEvent('sonar-keybind-change', {
      bubbles: true,
      detail: { state, key: this.boundKey },
    }));
  }
}

function initKeybindKnapps(root = document) {
  root.querySelectorAll('.keybind-knapp').forEach((element) => {
    if (!element.keybindKnapp) {
      element.keybindKnapp = new KeybindKnapp(element);
    }
  });
}

window.SonarKeybindKnapp = {
  init: initKeybindKnapps,
  KeybindKnapp,
};
