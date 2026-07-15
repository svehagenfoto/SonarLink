/**
 * Feature panel — expand/collapse wrapper for grouped controls.
 */

function getRevealItems(panel) {
  const inner = panel.querySelector('.feature-panel-expand-inner');
  if (!inner) return [];
  return [...inner.querySelectorAll('.feature-panel-reveal')];
}

function settleReveals(panel) {
  panel.classList.add('reveals-settled');
}

function resetReveals(panel) {
  panel.classList.remove('reveals-settled');
}

function bindRevealAnimationEnd(panel) {
  const reveals = getRevealItems(panel);
  if (!reveals.length) {
    settleReveals(panel);
    return;
  }

  const last = reveals[reveals.length - 1];
  const onEnd = (event) => {
    if (event.target !== last) return;
    settleReveals(panel);
    last.removeEventListener('animationend', onEnd);
  };

  last.addEventListener('animationend', onEnd);
}

function watchPageVisibility(panel) {
  const pagePanel = panel.closest('.page-panel');
  if (!pagePanel) return;

  const observer = new MutationObserver(() => {
    if (!panel.classList.contains('is-expanded')) return;

    if (!pagePanel.classList.contains('visible')) {
      settleReveals(panel);
      return;
    }

    if (panel.classList.contains('reveals-settled')) return;
    bindRevealAnimationEnd(panel);
  });

  observer.observe(pagePanel, { attributes: true, attributeFilter: ['class'] });
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

function initFeaturePanels(root = document) {
  root.querySelectorAll('.feature-panel').forEach((panel) => {
    if (panel.featurePanelInit) return;
    panel.featurePanelInit = true;

    const toggleInput = panel.querySelector('.feature-panel-enable');
    const keybind = panel.querySelector('.feature-panel-keybind');
    const distanceSlider = panel.querySelector('.feature-panel-distance');
    const sizeSlider = panel.querySelector('.feature-panel-size');
    const featureId = panel.dataset.feature;

    if (!toggleInput) return;

    const syncExpanded = ({ notifyBackend = true } = {}) => {
      const expanded = toggleInput.checked;
      panel.classList.toggle('is-expanded', expanded);

      if (featureId === 'third-person' && window.sonarlink?.setThirdPersonEnabled && notifyBackend) {
        window.sonarlink.setThirdPersonEnabled(expanded);
      }

      if (featureId === 'toggle-map') {
        if (notifyBackend && window.sonarlink?.setMinimapEnabled) {
          window.sonarlink.setMinimapEnabled(expanded);
        }
        setKeybindControlEnabled(keybind, expanded);
      }

      if (expanded) {
        bindRevealAnimationEnd(panel);
        return;
      }

      resetReveals(panel);
      if (featureId === 'toggle-map') {
        setKeybindControlEnabled(keybind, false);
      }
    };

    toggleInput.addEventListener('change', syncExpanded);
    watchPageVisibility(panel);

    if (keybind && featureId === 'third-person') {
      keybind.addEventListener('sonar-keybind-change', (event) => {
        const { state, key } = event.detail || {};
        if (!window.sonarlink?.setThirdPersonBind) return;
        if (state === 'bound' && key) {
          window.sonarlink.setThirdPersonBind(key);
          return;
        }
        if (state === 'unbound') {
          window.sonarlink.setThirdPersonBind(null);
        }
      });

      if (distanceSlider) {
        distanceSlider.addEventListener('sliderinput', (event) => {
          const value = event.detail?.value;
          if (value == null || !window.sonarlink?.setThirdPersonDistancePreview) return;
          window.sonarlink.setThirdPersonDistancePreview(value);
        });

        distanceSlider.addEventListener('slidercommit', (event) => {
          const value = event.detail?.value;
          if (value == null || !window.sonarlink?.setThirdPersonDistance) return;
          window.sonarlink.setThirdPersonDistance(value);
        });
      }

      if (window.sonarlink?.onThirdPersonCameraState) {
        window.sonarlink.onThirdPersonCameraState(({ active }) => {
          setKeybindThirdPersonActive(keybind, active);
        });
      }

      if (window.sonarlink?.getCustomizeProfile) {
        syncExpanded({ notifyBackend: false });
        return;
      }

      if (window.sonarlink?.getThirdPersonState) {
        window.sonarlink.getThirdPersonState().then((state) => {
          toggleInput.checked = Boolean(state?.featureEnabled);
          syncExpanded();
          setKeybindThirdPersonActive(keybind, Boolean(state?.cameraActive));
          if (distanceSlider?.sliderKnapp && state?.cameraDistance != null) {
            distanceSlider.sliderKnapp.setValue(state.cameraDistance, false);
          }
        });
      } else {
        syncExpanded();
      }
      return;
    }

    if (featureId === 'toggle-map') {
      if (sizeSlider) {
        sizeSlider.addEventListener('sliderinput', (event) => {
          const value = event.detail?.value;
          if (value == null || !window.sonarlink?.setMinimapSize) return;
          window.sonarlink.setMinimapSize(value, { preview: true });
        });
        sizeSlider.addEventListener('slidercommit', (event) => {
          const value = event.detail?.value;
          if (value == null || !window.sonarlink?.setMinimapSize) return;
          window.sonarlink.setMinimapSize(value, { preview: false });
        });
      }

      if (keybind) {
        keybind.addEventListener('sonar-keybind-change', (event) => {
          if (!toggleInput.checked) return;
          const { state, key } = event.detail || {};
          if (!window.sonarlink?.setMinimapMapBind) return;
          if (state === 'bound' && key) {
            window.sonarlink.setMinimapMapBind(key);
            return;
          }
          if (state === 'unbound') {
            window.sonarlink.setMinimapMapBind(null);
          }
        });
      }

      if (window.sonarlink?.getCustomizeProfile) {
        syncExpanded({ notifyBackend: false });
        return;
      }

      if (window.sonarlink?.getMinimapSettings) {
        window.sonarlink.getMinimapSettings().then((settings) => {
          toggleInput.checked = settings?.enabled !== false;
          syncExpanded({ notifyBackend: false });
          if (sizeSlider?.sliderKnapp && settings?.mapSizePercent != null) {
            sizeSlider.sliderKnapp.setValue(settings.mapSizePercent, false);
          }
          if (settings?.mapBindKey && keybind?.keybindKnapp) {
            keybind.keybindKnapp.boundKey = settings.mapBindKey;
            keybind.keybindKnapp.setState('bound');
          }
        });
      } else {
        syncExpanded({ notifyBackend: false });
      }
      return;
    }

    syncExpanded();
  });
}

window.SonarFeaturePanel = {
  init: initFeaturePanels,
};
