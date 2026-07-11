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

window.sonarlink.getAppInfo().then((info) => {
  const versionEl = document.getElementById('creditsVersion');
  const devEl = document.getElementById('creditsDev');
  if (versionEl) versionEl.textContent = `Version ${info.version}`;
  if (devEl) devEl.textContent = info.developer;
});
