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
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

window.SonarKeybindKnapp.init();
window.SonarSliderKnapp.init();
window.SonarFeaturePanel.init();

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

window.sonarlink.getAppInfo().then((info) => {
  const devEl = document.getElementById('creditsDev');
  if (devEl) devEl.textContent = info.developer;
});
