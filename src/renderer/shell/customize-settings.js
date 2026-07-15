/**
 * Applies Customize profile state to shell controls without notifying main process.
 */

function setKeybindValue(keybind, bindKey) {
  if (!keybind?.keybindKnapp) return;

  if (bindKey) {
    keybind.keybindKnapp.boundKey = bindKey;
    keybind.keybindKnapp.setState('bound', { silent: true });
    return;
  }

  keybind.keybindKnapp.boundKey = null;
  keybind.keybindKnapp.setState('unbound', { silent: true });
}

function setKeybindThirdPersonActive(keybind, active) {
  if (!keybind) return;
  keybind.classList.toggle('is-third-person-active', Boolean(active));
}

function setKeybindControlEnabled(keybind, enabled) {
  if (!keybind) return;
  keybind.classList.toggle('is-control-disabled', !enabled);
  keybind.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  if (!enabled && keybind.keybindKnapp?.state === 'listening') {
    keybind.keybindKnapp.stopListening();
    keybind.keybindKnapp.setState(keybind.keybindKnapp.boundKey ? 'bound' : 'unbound');
  }
}

function syncThirdPersonPanel(settings) {
  const panel = document.getElementById('thirdPersonPanel');
  if (!panel) return;

  const toggleInput = panel.querySelector('.feature-panel-enable');
  const keybind = panel.querySelector('.feature-panel-keybind');
  const distanceSlider = panel.querySelector('.feature-panel-distance');
  const thirdPerson = settings?.thirdPerson || {};

  if (toggleInput) {
    toggleInput.checked = Boolean(thirdPerson.featureEnabled);
    panel.classList.toggle('is-expanded', toggleInput.checked);
  }

  setKeybindThirdPersonActive(keybind, Boolean(thirdPerson.cameraActive));
  setKeybindValue(keybind, thirdPerson.bindKey || null);

  if (distanceSlider?.sliderKnapp && thirdPerson.cameraDistance != null) {
    distanceSlider.sliderKnapp.setValue(thirdPerson.cameraDistance, false);
  }
}

function syncMinimapPanel(settings) {
  const panel = document.getElementById('toggleMapPanel');
  if (!panel) return;

  const toggleInput = panel.querySelector('.feature-panel-enable');
  const keybind = panel.querySelector('.feature-panel-keybind');
  const sizeSlider = panel.querySelector('.feature-panel-size');
  const minimap = settings?.minimap || {};
  const enabled = minimap.enabled !== false;

  if (toggleInput) {
    toggleInput.checked = enabled;
    panel.classList.toggle('is-expanded', enabled);
  }

  setKeybindControlEnabled(keybind, enabled);
  setKeybindValue(keybind, enabled ? (minimap.mapBindKey || null) : null);

  if (sizeSlider?.sliderKnapp && minimap.mapSizePercent != null) {
    sizeSlider.sliderKnapp.setValue(minimap.mapSizePercent, false);
  }
}

function applyProfile(profile) {
  if (!profile?.settings) return;
  syncThirdPersonPanel(profile.settings);
  syncMinimapPanel(profile.settings);
}

function initCustomizeSettings() {
  if (!window.sonarlink?.getCustomizeProfile) return;

  const refreshProfile = () => {
    window.sonarlink.getCustomizeProfile().then((profile) => {
      if (profile) {
        applyProfile(profile);
      }
    });
  };

  if (window.sonarlink.onCustomizeProfileChanged) {
    window.sonarlink.onCustomizeProfileChanged((profile) => {
      applyProfile(profile);
    });
  }

  refreshProfile();
}

window.SonarCustomizeSettings = {
  init: initCustomizeSettings,
  applyProfile,
  refreshProfile: () => {
    if (!window.sonarlink?.getCustomizeProfile) return;
    window.sonarlink.getCustomizeProfile().then((profile) => {
      if (profile) {
        applyProfile(profile);
      }
    });
  },
};
