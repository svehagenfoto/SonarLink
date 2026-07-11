const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const RegisterHotKey = user32.func('bool __stdcall RegisterHotKey(void *hWnd, int iId, uint32_t fsModifiers, uint32_t vk)');
const UnregisterHotKey = user32.func('bool __stdcall UnregisterHotKey(void *hWnd, int iId)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)');

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;

const WM_HOTKEY = 0x0312;
const VK_HOME = 0x24;
const VK_LBUTTON = 0x01;
const MOD_NOREPEAT = 0x4000;
const HOTKEY_ID = 9107;
const THIRD_PERSON_HOTKEY_ID = 9108;

let hotkeyHwnd = null;
let hotkeyCallback = null;
let thirdPersonHotkeyCallback = null;
let thirdPersonMousePoll = null;
let thirdPersonMouseWasDown = false;

function toNum(value) {
  if (value == null) return null;
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function hwndToPtr(win) {
  if (!win || win.isDestroyed()) return null;
  return koffi.decode(win.getNativeWindowHandle(), 'void *');
}

function getWindowHwnd(win) {
  if (!win || win.isDestroyed()) return null;
  return win.getNativeWindowHandle().readUInt32LE(0) >>> 0;
}

function isMouseLeftDown() {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;
}

function hideWindowFromTaskbar(win) {
  const hwnd = hwndToPtr(win);
  if (!hwnd) return;

  let style = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  style = (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
  SetWindowPos(
    hwnd,
    null,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
  );
}

function ensureHotkeyMessageHook(win) {
  if (!win || win.isDestroyed() || win._sonarHotkeyHooked) return;
  win._sonarHotkeyHooked = true;

  win.hookWindowMessage(WM_HOTKEY, (wParam) => {
    const id = toNum(wParam);
    if (id === HOTKEY_ID && hotkeyCallback) {
      hotkeyCallback();
      return;
    }
    if (id === THIRD_PERSON_HOTKEY_ID && thirdPersonHotkeyCallback) {
      thirdPersonHotkeyCallback();
    }
  });
}

let homeKeyPoll = null;
let homeKeyWasDown = false;

function registerHomeKeyPoll(onToggle) {
  unregisterHomeKeyPoll();
  if (!onToggle) return false;

  homeKeyWasDown = (GetAsyncKeyState(VK_HOME) & 0x8000) !== 0;
  homeKeyPoll = setInterval(() => {
    const down = (GetAsyncKeyState(VK_HOME) & 0x8000) !== 0;
    if (down && !homeKeyWasDown) {
      onToggle();
    }
    homeKeyWasDown = down;
  }, 40);

  return true;
}

function unregisterHomeKeyPoll() {
  if (homeKeyPoll) {
    clearInterval(homeKeyPoll);
    homeKeyPoll = null;
  }
  homeKeyWasDown = false;
}

function registerHomeHotkey(win, onToggle) {
  unregisterHomeHotkey();
  const hwnd = hwndToPtr(win);
  if (!hwnd) return false;

  ensureHotkeyMessageHook(win);

  const ok = RegisterHotKey(hwnd, HOTKEY_ID, MOD_NOREPEAT, VK_HOME);
  if (!ok) return false;

  hotkeyHwnd = hwnd;
  hotkeyCallback = onToggle;

  return true;
}

function stopThirdPersonMousePoll() {
  if (thirdPersonMousePoll) {
    clearInterval(thirdPersonMousePoll);
    thirdPersonMousePoll = null;
  }
  thirdPersonMouseWasDown = false;
}

function unregisterThirdPersonHotkey() {
  if (hotkeyHwnd) {
    UnregisterHotKey(hotkeyHwnd, THIRD_PERSON_HOTKEY_ID);
  }
  thirdPersonHotkeyCallback = null;
  stopThirdPersonMousePoll();
}

function registerThirdPersonMouseBind(vk, onToggle) {
  unregisterThirdPersonHotkey();

  thirdPersonMouseWasDown = (GetAsyncKeyState(vk) & 0x8000) !== 0;
  thirdPersonMousePoll = setInterval(() => {
    const down = (GetAsyncKeyState(vk) & 0x8000) !== 0;
    if (down && !thirdPersonMouseWasDown && onToggle) {
      onToggle();
    }
    thirdPersonMouseWasDown = down;
  }, 40);

  return true;
}

function registerThirdPersonHotkey(win, modifiers, vk, onToggle) {
  unregisterThirdPersonHotkey();
  const hwnd = hwndToPtr(win);
  if (!hwnd || modifiers == null || vk == null) return false;

  ensureHotkeyMessageHook(win);

  const ok = RegisterHotKey(hwnd, THIRD_PERSON_HOTKEY_ID, modifiers, vk);
  if (!ok) return false;

  hotkeyHwnd = hwnd;
  thirdPersonHotkeyCallback = onToggle;
  return true;
}

function unregisterHomeHotkey() {
  if (hotkeyHwnd) {
    UnregisterHotKey(hotkeyHwnd, HOTKEY_ID);
  }
  hotkeyCallback = null;
}

function unregisterAllHotkeys() {
  unregisterHomeKeyPoll();
  if (hotkeyHwnd) {
    UnregisterHotKey(hotkeyHwnd, HOTKEY_ID);
    UnregisterHotKey(hotkeyHwnd, THIRD_PERSON_HOTKEY_ID);
    hotkeyHwnd = null;
  }
  hotkeyCallback = null;
  thirdPersonHotkeyCallback = null;
  stopThirdPersonMousePoll();
}

module.exports = {
  WM_HOTKEY,
  getWindowHwnd,
  hideWindowFromTaskbar,
  registerHomeHotkey,
  registerHomeKeyPoll,
  unregisterHomeKeyPoll,
  registerThirdPersonHotkey,
  registerThirdPersonMouseBind,
  unregisterHomeHotkey,
  unregisterThirdPersonHotkey,
  unregisterAllHotkeys,
  isMouseLeftDown,
};
