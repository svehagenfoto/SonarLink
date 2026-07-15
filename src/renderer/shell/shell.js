const nav = document.getElementById('shellNav');
const pages = document.querySelectorAll('.page-panel');
const navButtons = nav.querySelectorAll('.nav-btn');

function showPage(pageId) {
  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });
  pages.forEach((panel) => {
    panel.classList.toggle('visible', panel.dataset.page === pageId);
  });

  if (window.SonarSettingsFog?.setActive) {
    window.SonarSettingsFog.setActive(pageId === 'settings');
  }

  if (window.SonarSettingsWorldSettings?.setActive) {
    window.SonarSettingsWorldSettings.setActive(pageId === 'settings');
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

window.SonarKeybindKnapp.init();
window.SonarSliderKnapp.init();
window.SonarFeaturePanel.init();
window.SonarCustomizeSettings.init();
window.SonarSettingsFog.init();
window.SonarSettingsWorldSettings?.init?.();

document.getElementById('btnClose').addEventListener('click', () => {
  window.sonarlink.closeWindow();
});

function initCreditsExternalLinks() {
  document.querySelectorAll('[data-external-url]').forEach((element) => {
    const openLink = () => {
      const url = element.getAttribute('data-external-url');
      if (url && window.sonarlink?.openExternalUrl) {
        window.sonarlink.openExternalUrl(url);
      }
    };

    element.addEventListener('click', openLink);

    if (element.getAttribute('role') === 'button') {
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openLink();
        }
      });
    }
  });
}

initCreditsExternalLinks();

const LICENSE_DISCORD_URL = 'https://discord.gg/S2JQyBvwyB';

function layoutCreditsLicenseOverlay() {
  const shellRoot = document.querySelector('.shell-root');
  const shellContent = document.querySelector('.shell-content');
  const docShell = document.getElementById('creditsLicenseDocShell');
  if (!shellRoot || !shellContent || !docShell) return;

  const rootRect = shellRoot.getBoundingClientRect();
  const contentRect = shellContent.getBoundingClientRect();

  docShell.style.top = `${contentRect.top - rootRect.top}px`;
  docShell.style.left = `${contentRect.left - rootRect.left}px`;
  docShell.style.width = `${contentRect.width}px`;
  docShell.style.height = `${contentRect.height}px`;
}

function setCreditsLicenseOverlayOpen(isOpen) {
  const overlay = document.getElementById('creditsLicenseOverlay');
  const paper = document.getElementById('creditsLicenseDocPaper');
  if (!overlay) return;

  if (isOpen) {
    layoutCreditsLicenseOverlay();
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    if (paper) paper.scrollTop = 0;
  } else {
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function initCreditsLicenseOverlay() {
  const openBtn = document.getElementById('btnOpenLicense');
  const closeBtn = document.getElementById('btnCloseLicense');
  const copyBtn = document.getElementById('btnCopyLicenseDiscord');
  const overlay = document.getElementById('creditsLicenseOverlay');

  openBtn?.addEventListener('click', () => setCreditsLicenseOverlayOpen(true));
  closeBtn?.addEventListener('click', () => setCreditsLicenseOverlayOpen(false));

  copyBtn?.addEventListener('click', async () => {
    const defaultLabel = 'Copy';
    try {
      await navigator.clipboard.writeText(LICENSE_DISCORD_URL);
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('is-copied');
      window.setTimeout(() => {
        copyBtn.textContent = defaultLabel;
        copyBtn.classList.remove('is-copied');
      }, 1600);
    } catch {
      copyBtn.textContent = 'Failed';
      window.setTimeout(() => {
        copyBtn.textContent = defaultLabel;
      }, 1600);
    }
  });

  window.addEventListener('resize', () => {
    if (overlay?.classList.contains('is-open')) {
      layoutCreditsLicenseOverlay();
    }
  });
}

initCreditsLicenseOverlay();

window.sonarlink.getAppInfo().then((info) => {
  const devEl = document.getElementById('creditsDev');
  if (devEl) devEl.textContent = info.developer;
});
