const statusText = document.getElementById('statusText');
const statusDetail = document.getElementById('statusDetail');
const statusIcon = document.getElementById('statusIcon');
const statusPill = document.getElementById('statusPill');
const appMeta = document.getElementById('appMeta');
const dataRootPath = document.getElementById('dataRootPath');
const startupProgress = document.getElementById('startupProgress');
const startupProgressFill = document.getElementById('startupProgressFill');
const folderBlock = document.getElementById('folderBlock');
const chooseFolderBtn = document.getElementById('chooseFolderBtn');
const uninstallBlock = document.getElementById('uninstallBlock');
const uninstallBtn = document.getElementById('uninstallBtn');
const uninstallConfirmBlock = document.getElementById('uninstallConfirmBlock');
const uninstallCancelBtn = document.getElementById('uninstallCancelBtn');
const uninstallConfirmBtn = document.getElementById('uninstallConfirmBtn');

// TEMP DEV START
const devSkipToMenuBtn = document.getElementById('devSkipToMenuBtn');
// TEMP DEV END

function setUninstallConfirmVisible(visible) {
  uninstallConfirmBlock.classList.toggle('visible', visible);
  uninstallBlock.classList.toggle('visible', !visible);
}

function setDataRootPath(pathValue) {
  if (!dataRootPath) return;
  if (pathValue) {
    dataRootPath.textContent = `Folder: ${pathValue}`;
    dataRootPath.classList.add('visible');
  } else {
    dataRootPath.textContent = '';
    dataRootPath.classList.remove('visible');
  }
}

function setUninstallVisible(visible) {
  uninstallBlock.classList.toggle('visible', visible);
}

function setStatus(label, { detected = false, showProgress = false, progress = null, indeterminate = false, detail = null } = {}) {
  statusText.textContent = label;
  statusIcon.classList.toggle('waiting', !detected);
  statusIcon.classList.toggle('detected', detected);
  statusPill.classList.toggle('detected', detected);

  if (statusDetail) {
    statusDetail.textContent = detail || '';
    statusDetail.classList.toggle('visible', Boolean(detail));
  }

  startupProgress.classList.toggle('visible', showProgress);
  startupProgress.classList.toggle('indeterminate', showProgress && indeterminate);

  if (showProgress && !indeterminate && typeof progress === 'number') {
    startupProgressFill.style.width = `${Math.round(progress * 100)}%`;
  }
}

function setDetected() {
  setStatus('SUBNAUTICA 2 DETECTED', {
    detected: true,
    detail: 'SonarLink is ready.',
  });
}

function setFolderPickerVisible(visible) {
  folderBlock.classList.toggle('visible', visible);
}

chooseFolderBtn.addEventListener('click', () => {
  window.sonarlink.pickDataFolder();
});

uninstallBtn.addEventListener('click', () => {
  setUninstallConfirmVisible(true);
});

// TEMP DEV START
devSkipToMenuBtn.addEventListener('click', async () => {
  devSkipToMenuBtn.disabled = true;
  await window.sonarlink.skipToMenu();
  devSkipToMenuBtn.disabled = false;
});
// TEMP DEV END

uninstallCancelBtn.addEventListener('click', () => {
  setUninstallConfirmVisible(false);
});

uninstallConfirmBtn.addEventListener('click', async () => {
  uninstallConfirmBtn.disabled = true;
  uninstallCancelBtn.disabled = true;

  const result = await window.sonarlink.uninstallSonarLink();

  uninstallConfirmBtn.disabled = false;
  uninstallCancelBtn.disabled = false;
  setUninstallConfirmVisible(false);

  if (!result?.ok) {
    if (result?.reason === 'GAME_RUNNING') {
      setStatus('CLOSE SUBNAUTICA 2', {
        showProgress: false,
        detail: 'Close Subnautica 2 before deleting SonarLink.',
      });
    }
    return;
  }

  setFolderPickerVisible(false);
  setUninstallVisible(false);
  setDataRootPath(null);
  setStatus('SONARLINK REMOVED', {
    showProgress: false,
    detail:
      'All SonarLink data and mod files have been removed. Delete SonarLink.exe manually to remove SonarLink completely from this PC.',
  });
});

window.sonarlink.getAppInfo().then((info) => {
  appMeta.textContent = `Version ${info.version}  ·  ${info.developer}`;
});

window.sonarlink.onStartupUpdate((payload) => {
  const {
    status,
    progress,
    showFolderPicker,
    detail,
    dataRootPath: rootPath,
  } = payload;

  setFolderPickerVisible(Boolean(showFolderPicker));
  setDataRootPath(rootPath || null);

  if (detail && detail.startsWith('Using: ')) {
    setDataRootPath(detail.replace('Using: ', ''));
  }

  if (status === 'WAITING FOR SUBNAUTICA 2' || status === 'CLOSE SUBNAUTICA 2') {
    setStatus(status, { showProgress: false, detail });
    return;
  }

  if (status === 'SUBNAUTICA 2 DETECTED') {
    setDetected();
    return;
  }

  const progressStatuses = [
    'DOWNLOADING UE4SS',
    'INSTALLING FILES',
    'INSTALL COMPLETE',
    'INSTALLING UE4SS',
    'INSTALLING SONARLINK MOD',
    'RETRYING INSTALL',
  ];

  if (progressStatuses.includes(status) || status?.startsWith('INSTALLING ')) {
    const hasProgress = typeof progress === 'number';
    setStatus(status, {
      showProgress: true,
      progress: hasProgress ? progress : null,
      indeterminate: !hasProgress,
      detail,
    });
    return;
  }

  setStatus(status || 'CHECKING', { showProgress: false, detail });
});

window.sonarlink.onStartupError((payload) => {
  if (payload.code === 'GAME_NOT_FOUND') {
    setStatus('SUBNAUTICA 2 NOT FOUND', {
      showProgress: false,
      detail: 'Install Subnautica 2 through Steam, then close SonarLink and open it again.',
    });
    return;
  }

  if (payload.code === 'GAME_FILES_LOCKED') {
    setStatus('CLOSE SUBNAUTICA 2', {
      showProgress: false,
      detail: 'Close the game completely, then close SonarLink and open it again.',
    });
    return;
  }

  if (payload.code === 'DATA_FOLDER_INVALID') {
    setStatus('FOLDER COULD NOT BE USED', {
      showProgress: false,
      detail: 'Choose a different folder for SonarLink.',
    });
    setFolderPickerVisible(true);
    return;
  }

  if (payload.code?.startsWith('INSTALL_FAILED')) {
    const detail = payload.code.replace(/^INSTALL_FAILED:/, '');
    setStatus('INSTALL FAILED', {
      showProgress: false,
      detail,
    });
  }
});

window.sonarlink.onGameDetected(() => setDetected());
