const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const RegisterHotKey = user32.func('bool __stdcall RegisterHotKey(void *hWnd, int iId, uint32_t fsModifiers, uint32_t vk)');
const UnregisterHotKey = user32.func('bool __stdcall UnregisterHotKey(void *hWnd, int iId)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void *hWnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(void *hWnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)');
const ShowCursor = user32.func('int __stdcall ShowCursor(bool bShow)');
const ClipCursor = user32.func('bool __stdcall ClipCursor(void *lpRect)');
const ReleaseCapture = user32.func('bool __stdcall ReleaseCapture()');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, uint32_t *lpdwProcessId)');
const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, bool fAttach)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SW_SHOW = 5;
const SW_RESTORE = 9;
const KEYEVENTF_KEYUP = 0x0002;
const VK_MENU = 0x12;

const WM_HOTKEY = 0x0312;
const VK_HOME = 0x24;
const VK_LBUTTON = 0x01;
const MOD_NOREPEAT = 0x4000;
const HOTKEY_ID = 9107;
const THIRD_PERSON_HOTKEY_ID = 9108;
const BIG_MAP_HOTKEY_ID = 9109;

let hotkeyHwnd = null;
let hotkeyCallback = null;
let thirdPersonHotkeyCallback = null;
let bigMapHotkeyCallback = null;
let thirdPersonMousePoll = null;
let thirdPersonMouseWasDown = false;
let bigMapMousePoll = null;
let bigMapMouseWasDown = false;

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

function handleToPtr(handle) {
  if (!handle || handle <= 0) return null;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(handle), 0);
  return koffi.decode(buf, 'void *');
}

function releaseGameInputCapture() {
  ClipCursor(null);
  ReleaseCapture();
}

function showSystemCursor() {
  let count = ShowCursor(true);
  let guard = 0;
  while (count < 0 && guard < 24) {
    count = ShowCursor(true);
    guard += 1;
  }
}

function nudgeForegroundPermission() {
  keybd_event(VK_MENU, 0, 0, 0);
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
}

function activateWindowPtr(hwndPtr) {
  if (!hwndPtr) return false;

  const currentThread = GetCurrentThreadId();
  const foreground = GetForegroundWindow();
  let attached = false;
  let foregroundThread = 0;

  if (foreground) {
    foregroundThread = GetWindowThreadProcessId(foreground, null);
    if (foregroundThread && foregroundThread !== currentThread) {
      attached = AttachThreadInput(currentThread, foregroundThread, true) === true;
    }
  }

  nudgeForegroundPermission();
  ShowWindow(hwndPtr, SW_SHOW);
  BringWindowToTop(hwndPtr);
  SetForegroundWindow(hwndPtr);

  if (attached && foregroundThread) {
    AttachThreadInput(currentThread, foregroundThread, false);
  }

  return true;
}

function focusExternalWindowHandle(handle) {
  const hwnd = handleToPtr(handle);
  if (!hwnd) return false;

  ShowWindow(hwnd, SW_RESTORE);
  return activateWindowPtr(hwnd);
}

function forceWindowFocus(win) {
  if (!win || win.isDestroyed()) return false;

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.moveTop();

  const hwnd = hwndToPtr(win);
  if (hwnd) {
    activateWindowPtr(hwnd);
  }

  win.focus();
  if (!win.webContents.isDestroyed()) {
    win.webContents.focus();
  }

  return true;
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
      return;
    }
    if (id === BIG_MAP_HOTKEY_ID && bigMapHotkeyCallback) {
      bigMapHotkeyCallback();
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

function stopBigMapMousePoll() {
  if (bigMapMousePoll) {
    clearInterval(bigMapMousePoll);
    bigMapMousePoll = null;
  }
  bigMapMouseWasDown = false;
}

function unregisterBigMapBind() {
  if (hotkeyHwnd) {
    UnregisterHotKey(hotkeyHwnd, BIG_MAP_HOTKEY_ID);
  }
  bigMapHotkeyCallback = null;
  stopBigMapMousePoll();
}

function registerBigMapMouseBind(vk, onToggle) {
  unregisterBigMapBind();

  bigMapMouseWasDown = (GetAsyncKeyState(vk) & 0x8000) !== 0;
  bigMapMousePoll = setInterval(() => {
    const down = (GetAsyncKeyState(vk) & 0x8000) !== 0;
    if (down && !bigMapMouseWasDown && onToggle) {
      onToggle();
    }
    bigMapMouseWasDown = down;
  }, 40);

  return true;
}

function registerBigMapHotkey(win, modifiers, vk, onToggle) {
  unregisterBigMapBind();
  const hwnd = hwndToPtr(win);
  if (!hwnd || modifiers == null || vk == null) return false;

  ensureHotkeyMessageHook(win);

  const ok = RegisterHotKey(hwnd, BIG_MAP_HOTKEY_ID, modifiers, vk);
  if (!ok) return false;

  hotkeyHwnd = hwnd;
  bigMapHotkeyCallback = onToggle;
  return true;
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
    UnregisterHotKey(hotkeyHwnd, BIG_MAP_HOTKEY_ID);
    hotkeyHwnd = null;
  }
  hotkeyCallback = null;
  thirdPersonHotkeyCallback = null;
  bigMapHotkeyCallback = null;
  stopThirdPersonMousePoll();
  stopBigMapMousePoll();
}

module.exports = {
  WM_HOTKEY,
  getWindowHwnd,
  hideWindowFromTaskbar,
  forceWindowFocus,
  focusExternalWindowHandle,
  releaseGameInputCapture,
  showSystemCursor,
  registerHomeHotkey,
  registerHomeKeyPoll,
  unregisterHomeKeyPoll,
  registerThirdPersonHotkey,
  registerThirdPersonMouseBind,
  registerBigMapHotkey,
  registerBigMapMouseBind,
  unregisterBigMapBind,
  unregisterHomeHotkey,
  unregisterThirdPersonHotkey,
  unregisterAllHotkeys,
  isMouseLeftDown,
};
