(() => {
const REFRESH_MS = 2000;

let refreshTimer = null;
let worldSettingsSaveUnsubscribe = null;
let confirmingSaveId = null;
let confirmingOrphanClean = false;
let settingsPageActive = false;

function sortWorldSettingsSaves(saves, activeSaveId) {
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
  icon.className = 'settings-world-settings-world-icon';
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
  const existing = document.getElementById('settingsWorldSettingsOrphanClean');
  if (existing) {
    existing.remove();
  }

  if (!orphanCount) return;

  const panel = document.createElement('li');
  panel.className = 'settings-world-settings-orphan-clean';
  panel.id = 'settingsWorldSettingsOrphanClean';

  const row = document.createElement('div');
  row.className = 'settings-world-settings-orphan-clean-row';

  const summary = document.createElement('p');
  summary.className = 'settings-world-settings-orphan-clean-text';
  summary.textContent = `${orphanCount} unused world setting${orphanCount === 1 ? '' : 's'} with no save file`;

  const cleanBtn = document.createElement('button');
  cleanBtn.type = 'button';
  cleanBtn.className = 'settings-world-settings-delete-btn settings-world-settings-orphan-clean-btn';
  cleanBtn.textContent = 'Remove unused';
  cleanBtn.addEventListener('click', () => {
    confirmingOrphanClean = true;
    panel.classList.add('is-confirming');
  });

  row.appendChild(summary);
  row.appendChild(cleanBtn);

  const confirm = document.createElement('div');
  confirm.className = 'settings-world-settings-delete-confirm settings-world-settings-orphan-clean-confirm';

  const confirmText = document.createElement('p');
  confirmText.className = 'settings-world-settings-delete-confirm-text';
  confirmText.textContent = `Remove ${orphanCount} unused world setting${orphanCount === 1 ? '' : 's'}?`;

  const confirmActions = document.createElement('div');
  confirmActions.className = 'settings-world-settings-delete-confirm-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'settings-world-settings-confirm-btn';
  confirmBtn.textContent = 'Remove';
  confirmBtn.addEventListener('click', async () => {
    if (!window.sonarlink?.deleteOrphanWorldSettingsSaves) return;
    await window.sonarlink.deleteOrphanWorldSettingsSaves();
    closeConfirmState();
    refreshWorldSettingsSaveList();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-world-settings-cancel-btn';
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

function renderWorldSettingsSaveList(payload) {
  const listEl = document.getElementById('settingsWorldSettingsList');
  if (!listEl) return;

  const saves = sortWorldSettingsSaves(payload?.saves || [], payload?.active?.saveId || null);
  const activeSaveId = payload?.active?.saveId || null;
  const orphanCount = Number(payload?.orphanCount || 0);
  const pendingConfirmId = confirmingSaveId;

  listEl.innerHTML = '';

  if (!pendingConfirmId) {
    closeConfirmState();
  }

  if (!saves.length) {
    const empty = document.createElement('li');
    empty.className = 'settings-world-settings-empty';
    empty.textContent = 'No world settings saved yet';
    listEl.appendChild(empty);
    return;
  }

  saves.forEach((save) => {
    const item = document.createElement('li');
    item.className = 'settings-world-settings-world-item';
    if (save.saveId === activeSaveId) {
      item.classList.add('is-live');
    }
    if (save.orphan) {
      item.classList.add('is-orphan');
    }

    const row = document.createElement('div');
    row.className = 'settings-world-settings-world-row';

    row.appendChild(buildWorldIcon());

    const content = document.createElement('div');
    content.className = 'settings-world-settings-world-content';

    const top = document.createElement('div');
    top.className = 'settings-world-settings-world-top';

    const labelText = save.saveLabel || save.saveId;
    const title = document.createElement('span');
    title.className = 'settings-world-settings-world-name';
    title.textContent = labelText;
    title.title = labelText;

    top.appendChild(title);

    if (save.saveId === activeSaveId) {
      const liveBadge = document.createElement('span');
      liveBadge.className = 'settings-world-settings-live-badge';
      liveBadge.textContent = 'Live';
      top.appendChild(liveBadge);
    } else if (save.orphan) {
      const unusedBadge = document.createElement('span');
      unusedBadge.className = 'settings-world-settings-unused-badge';
      unusedBadge.textContent = 'Unused';
      top.appendChild(unusedBadge);
    }

    content.appendChild(top);

    const meta = document.createElement('span');
    meta.className = 'settings-world-settings-world-meta';
    meta.textContent = save.meta || '';

    content.appendChild(meta);
    row.appendChild(content);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'settings-world-settings-delete-btn';
    deleteBtn.textContent = 'Delete world settings';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmingSaveId = save.saveId;
      listEl.querySelectorAll('.settings-world-settings-world-item.is-confirming').forEach((node) => {
        node.classList.remove('is-confirming');
      });
      item.classList.add('is-confirming');
    });

    if (save.saveId === pendingConfirmId) {
      item.classList.add('is-confirming');
    }

    row.appendChild(deleteBtn);

    const confirm = document.createElement('div');
    confirm.className = 'settings-world-settings-delete-confirm';

    const confirmText = document.createElement('p');
    confirmText.className = 'settings-world-settings-delete-confirm-text';
    confirmText.textContent = `Delete world settings for ${save.saveLabel || 'this world'}?`;

    const confirmActions = document.createElement('div');
    confirmActions.className = 'settings-world-settings-delete-confirm-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'settings-world-settings-confirm-btn';
    confirmBtn.textContent = 'Delete';
    confirmBtn.addEventListener('click', async () => {
      if (!window.sonarlink?.deleteWorldSettingsSave) return;
      await window.sonarlink.deleteWorldSettingsSave(save.saveId);
      closeConfirmState();
      refreshWorldSettingsSaveList();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'settings-world-settings-cancel-btn';
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

async function refreshWorldSettingsSaveList() {
  if (!settingsPageActive) return;
  if (confirmingSaveId || confirmingOrphanClean) return;

  if (!window.sonarlink?.listWorldSettingsSaves) {
    renderWorldSettingsSaveList({ saves: [], orphanCount: 0, active: null });
    return;
  }

  try {
    const payload = await window.sonarlink.listWorldSettingsSaves();
    renderWorldSettingsSaveList(payload);
  } catch {
    renderWorldSettingsSaveList({ saves: [], orphanCount: 0, active: null });
  }
}

function stopWorldSettingsSaveRefresh() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

function startWorldSettingsSaveRefresh() {
  stopWorldSettingsSaveRefresh();
  if (!settingsPageActive) return;

  refreshWorldSettingsSaveList();
  refreshTimer = setInterval(refreshWorldSettingsSaveList, REFRESH_MS);
}

function setSettingsWorldSettingsPageActive(isActive) {
  settingsPageActive = Boolean(isActive);
  if (settingsPageActive) {
    startWorldSettingsSaveRefresh();
    return;
  }
  stopWorldSettingsSaveRefresh();
}

function initSettingsWorldSettingsPage() {
  const settingsPanel = document.querySelector('.page-panel[data-page="settings"]');
  setSettingsWorldSettingsPageActive(settingsPanel?.classList.contains('visible') ?? false);

  if (!window.sonarlink?.onWorldSettingsSavesChanged) return;

  if (worldSettingsSaveUnsubscribe) {
    worldSettingsSaveUnsubscribe();
  }

  worldSettingsSaveUnsubscribe = window.sonarlink.onWorldSettingsSavesChanged(() => {
    if (!settingsPageActive) return;
    refreshWorldSettingsSaveList();
  });
}

window.SonarSettingsWorldSettings = {
  init: initSettingsWorldSettingsPage,
  refresh: refreshWorldSettingsSaveList,
  setActive: setSettingsWorldSettingsPageActive,
};
})();
