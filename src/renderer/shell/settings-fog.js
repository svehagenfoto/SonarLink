const REFRESH_MS = 2000;

let refreshTimer = null;
let fogSaveUnsubscribe = null;
let confirmingSaveId = null;
let confirmingOrphanClean = false;
let settingsPageActive = false;

function formatPercent(value) {
  const percent = Number.isFinite(value) ? value : 0;
  return `${percent.toFixed(1)}% explored`;
}

function sortFogSaves(saves, activeSaveId) {
  const sorted = [...saves];

  sorted.sort((a, b) => {
    if (activeSaveId) {
      if (a.saveId === activeSaveId) return -1;
      if (b.saveId === activeSaveId) return 1;
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return sorted;
}

function buildWorldIcon() {
  const icon = document.createElement('span');
  icon.className = 'settings-fog-world-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <span class="sn2-ring-outer"></span>
    <span class="sn2-ring-inner"></span>
    <span class="core"></span>
  `;
  return icon;
}

function closeConfirmState() {
  confirmingSaveId = null;
  confirmingOrphanClean = false;
}

function renderOrphanCleanPanel(listEl, orphanCount) {
  const existing = document.getElementById('settingsFogOrphanClean');
  if (existing) {
    existing.remove();
  }

  if (!orphanCount) return;

  const panel = document.createElement('li');
  panel.className = 'settings-fog-orphan-clean';
  panel.id = 'settingsFogOrphanClean';

  const row = document.createElement('div');
  row.className = 'settings-fog-orphan-clean-row';

  const summary = document.createElement('p');
  summary.className = 'settings-fog-orphan-clean-text';
  summary.textContent = `${orphanCount} unused fog map${orphanCount === 1 ? '' : 's'} with no save file`;

  const cleanBtn = document.createElement('button');
  cleanBtn.type = 'button';
  cleanBtn.className = 'settings-fog-delete-btn settings-fog-orphan-clean-btn';
  cleanBtn.textContent = 'Remove unused';
  cleanBtn.addEventListener('click', () => {
    confirmingOrphanClean = true;
    panel.classList.add('is-confirming');
  });

  row.appendChild(summary);
  row.appendChild(cleanBtn);

  const confirm = document.createElement('div');
  confirm.className = 'settings-fog-delete-confirm settings-fog-orphan-clean-confirm';

  const confirmText = document.createElement('p');
  confirmText.className = 'settings-fog-delete-confirm-text';
  confirmText.textContent = `Remove ${orphanCount} unused fog map${orphanCount === 1 ? '' : 's'}?`;

  const confirmActions = document.createElement('div');
  confirmActions.className = 'settings-fog-delete-confirm-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'settings-fog-confirm-btn';
  confirmBtn.textContent = 'Remove';
  confirmBtn.addEventListener('click', async () => {
    if (!window.sonarlink?.deleteOrphanMapFogSaves) return;
    await window.sonarlink.deleteOrphanMapFogSaves();
    closeConfirmState();
    refreshFogSaveList();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-fog-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    closeConfirmState();
    panel.classList.remove('is-confirming');
  });

  confirmActions.appendChild(confirmBtn);
  confirmActions.appendChild(cancelBtn);
  confirm.appendChild(confirmText);
  confirm.appendChild(confirmActions);

  panel.appendChild(row);
  panel.appendChild(confirm);

  if (confirmingOrphanClean) {
    panel.classList.add('is-confirming');
  }

  listEl.appendChild(panel);
}

function renderFogSaveList(payload) {
  const listEl = document.getElementById('settingsFogList');
  if (!listEl) return;

  const saves = sortFogSaves(payload?.saves || [], payload?.active?.saveId || null);
  const activeSaveId = payload?.active?.saveId || null;
  const orphanCount = Number(payload?.orphanCount || 0);
  const pendingConfirmId = confirmingSaveId;

  listEl.innerHTML = '';

  if (!pendingConfirmId) {
    closeConfirmState();
  }

  if (!saves.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-fog-empty';
    empty.textContent = 'No fog maps saved yet';
    listEl.appendChild(empty);
    return;
  }

  saves.forEach((save) => {
    const item = document.createElement('li');
    item.className = 'settings-fog-world-item';
    if (save.saveId === activeSaveId) {
      item.classList.add('is-live');
    }
    if (save.orphan) {
      item.classList.add('is-orphan');
    }

    const row = document.createElement('div');
    row.className = 'settings-fog-world-row';

    row.appendChild(buildWorldIcon());

    const content = document.createElement('div');
    content.className = 'settings-fog-world-content';

    const top = document.createElement('div');
    top.className = 'settings-fog-world-top';

    const labelText = save.saveLabel || save.saveId;
    const title = document.createElement('span');
    title.className = 'settings-fog-world-name';
    title.textContent = labelText;
    title.title = labelText;

    top.appendChild(title);

    if (save.saveId === activeSaveId) {
      const liveBadge = document.createElement('span');
      liveBadge.className = 'settings-fog-live-badge';
      liveBadge.textContent = 'Live';
      top.appendChild(liveBadge);
    } else if (save.orphan) {
      const unusedBadge = document.createElement('span');
      unusedBadge.className = 'settings-fog-unused-badge';
      unusedBadge.textContent = 'Unused';
      top.appendChild(unusedBadge);
    }

    content.appendChild(top);

    const meta = document.createElement('span');
    meta.className = 'settings-fog-world-meta';
    meta.textContent = formatPercent(save.exploredPercent);

    content.appendChild(meta);
    row.appendChild(content);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'settings-fog-delete-btn';
    deleteBtn.textContent = 'Delete fog map';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmingSaveId = save.saveId;
      listEl.querySelectorAll('.settings-fog-world-item.is-confirming').forEach((node) => {
        node.classList.remove('is-confirming');
      });
      item.classList.add('is-confirming');
    });

    if (save.saveId === pendingConfirmId) {
      item.classList.add('is-confirming');
    }

    row.appendChild(deleteBtn);

    const confirm = document.createElement('div');
    confirm.className = 'settings-fog-delete-confirm';

    const confirmText = document.createElement('p');
    confirmText.className = 'settings-fog-delete-confirm-text';
    confirmText.textContent = `Delete fog map for ${save.saveLabel || 'this world'}?`;

    const confirmActions = document.createElement('div');
    confirmActions.className = 'settings-fog-delete-confirm-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'settings-fog-confirm-btn';
    confirmBtn.textContent = 'Delete';
    confirmBtn.addEventListener('click', async () => {
      if (!window.sonarlink?.deleteMapFogSave) return;
      await window.sonarlink.deleteMapFogSave(save.saveId);
      closeConfirmState();
      refreshFogSaveList();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'settings-fog-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      closeConfirmState();
      item.classList.remove('is-confirming');
    });

    confirmActions.appendChild(confirmBtn);
    confirmActions.appendChild(cancelBtn);
    confirm.appendChild(confirmText);
    confirm.appendChild(confirmActions);

    item.appendChild(row);
    item.appendChild(confirm);
    listEl.appendChild(item);
  });

  renderOrphanCleanPanel(listEl, orphanCount);
}

async function refreshFogSaveList() {
  if (!window.sonarlink?.listMapFogSaves) return;
  if (!settingsPageActive) return;
  if (confirmingSaveId || confirmingOrphanClean) return;

  const payload = await window.sonarlink.listMapFogSaves();
  renderFogSaveList(payload);
}

function stopFogSaveRefresh() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

function startFogSaveRefresh() {
  stopFogSaveRefresh();
  if (!settingsPageActive) return;

  refreshFogSaveList();
  refreshTimer = setInterval(refreshFogSaveList, REFRESH_MS);
}

function setSettingsFogPageActive(isActive) {
  settingsPageActive = Boolean(isActive);
  if (settingsPageActive) {
    startFogSaveRefresh();
    return;
  }
  stopFogSaveRefresh();
}

function initSettingsFogPage() {
  if (!window.sonarlink?.listMapFogSaves) return;

  const settingsPanel = document.querySelector('.page-panel[data-page="settings"]');
  setSettingsFogPageActive(settingsPanel?.classList.contains('visible') ?? false);

  if (window.sonarlink.onMapFogSavesChanged) {
    if (fogSaveUnsubscribe) {
      fogSaveUnsubscribe();
    }

    fogSaveUnsubscribe = window.sonarlink.onMapFogSavesChanged(() => {
      if (!settingsPageActive) return;
      refreshFogSaveList();
    });
  }
}

window.SonarSettingsFog = {
  init: initSettingsFogPage,
  refresh: refreshFogSaveList,
  setActive: setSettingsFogPageActive,
};
