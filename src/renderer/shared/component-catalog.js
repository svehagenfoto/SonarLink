/**
 * SonarLink component album — registry of designed UI controls.
 * Add new entries here when creating button or toggle variants.
 */

function renderToggleKnappHTML({ id = '', label = 'Enable feature', checked = false } = {}) {
  const idAttr = id ? ` id="${id}"` : '';
  const checkedAttr = checked ? ' checked' : '';

  return `<label class="sonar-toggle toggle-knapp">
  <input type="checkbox"${idAttr}${checkedAttr} />
  <span class="sonar-toggle-track">
    <span class="sonar-toggle-icon">
      <span class="sn2-ring-outer" aria-hidden="true"></span>
      <span class="sn2-ring-inner" aria-hidden="true"></span>
      <span class="core" aria-hidden="true"></span>
    </span>
    <span class="sonar-toggle-label">${label}</span>
    <span class="sonar-toggle-switch" aria-hidden="true"></span>
    <span class="sn2-arc" aria-hidden="true"></span>
  </span>
</label>`;
}

function renderKeybindKnappHTML({ id = '', label = 'Enable feature' } = {}) {
  const idAttr = id ? ` id="${id}"` : '';

  return `<div class="sonar-toggle keybind-knapp"${idAttr} role="button" tabindex="0" data-state="unbound">
  <span class="sonar-toggle-track">
    <span class="sonar-toggle-icon">
      <span class="sn2-ring-outer" aria-hidden="true"></span>
      <span class="sn2-ring-inner" aria-hidden="true"></span>
      <span class="core" aria-hidden="true"></span>
    </span>
    <span class="sonar-toggle-label">${label}</span>
    <span class="keybind-slot" aria-live="polite">
      <span class="keybind-slot-text">NONE</span>
    </span>
    <span class="sn2-arc" aria-hidden="true"></span>
  </span>
</div>`;
}

function renderSliderKnappHTML({ id = '', label = 'Adjust level', value = 50 } = {}) {
  const idAttr = id ? ` id="${id}"` : '';
  const ratio = ((value - 1) / 98) * 100;

  return `<div class="sonar-slider slider-knapp"${idAttr} data-value="${value}" style="--slider-pct: ${ratio}%;">
  <div class="sonar-slider-track">
    <span class="sonar-slider-icon" aria-hidden="true">
      <span class="sn2-ring-outer"></span>
      <span class="sn2-ring-inner"></span>
      <span class="core"></span>
    </span>
    <span class="sonar-slider-label">${label}</span>
    <div class="sonar-slider-rail" role="slider" tabindex="0" aria-valuemin="1" aria-valuemax="99" aria-valuenow="${value}" aria-label="${label}">
      <div class="sonar-slider-fill"></div>
      <button type="button" class="sonar-slider-thumb" aria-label="Slider value">
        <span class="sonar-slider-value">${value}</span>
      </button>
    </div>
    <span class="sn2-arc" aria-hidden="true"></span>
  </div>
</div>`;
}

const SONAR_COMPONENT_CATALOG = [
  {
    id: 'toggle-knapp',
    name: 'Toggle knapp',
    type: 'Toggle',
    description: 'SN2 inspired feature toggle with sonar icon, label and switch.',
    cssFile: 'shared/components/toggle-knapp.css',
    cssClasses: 'sonar-toggle toggle-knapp',
    scale: '50%',
    states: ['Off', 'Off hover', 'On', 'On hover'],
    defaultLabel: 'Enable feature',
    renderPreview: (previewId) => renderToggleKnappHTML({
      id: previewId,
      label: 'Enable feature',
    }),
  },
  {
    id: 'keybind-knapp',
    name: 'Keybind knapp',
    type: 'Keybind',
    description: 'Keybind variant based on toggle knapp. Customize in keybind-knapp.css.',
    cssFile: 'shared/components/keybind-knapp.css',
    cssClasses: 'sonar-toggle keybind-knapp',
    scale: '50%',
    states: ['Unbound', 'Listening', 'Bound', 'Bound hover'],
    defaultLabel: 'Enable feature',
    renderPreview: (previewId) => renderKeybindKnappHTML({
      id: previewId,
      label: 'Enable feature',
    }),
  },
  {
    id: 'slider-knapp',
    name: 'Slider knapp',
    type: 'Slider',
    description: 'SN2 inspired slider with percent value shown in thumb (1-99).',
    cssFile: 'shared/components/slider-knapp.css',
    cssClasses: 'sonar-slider slider-knapp',
    scale: '50%',
    states: ['Idle', 'Hover', 'Dragging'],
    defaultLabel: 'Adjust level',
    renderPreview: (previewId) => renderSliderKnappHTML({
      id: previewId,
      label: 'Adjust level',
      value: 50,
    }),
  },
];

function renderComponentCard(component) {
  const previewId = `catalog-preview-${component.id}`;

  const metaRows = [
    ['ID', component.id],
    ['Type', component.type],
    ['CSS file', component.cssFile],
    ['Classes', component.cssClasses],
    ['Scale', component.scale],
    ['Default label', component.defaultLabel],
  ];

  const metaHtml = metaRows.map(([term, value]) => `
    <dt>${term}</dt>
    <dd>${value}</dd>
  `).join('');

  const stateTags = component.states.map((state) => `
    <span class="component-state-tag">${state}</span>
  `).join('');

  return `<article class="component-card" data-component-id="${component.id}">
    <div class="component-card-header">
      <h3 class="component-card-name">${component.name}</h3>
      <span class="component-card-type">${component.type}</span>
    </div>
    <dl class="component-card-meta">${metaHtml}</dl>
    <div class="component-card-states">${stateTags}</div>
    <div class="component-card-preview">
      <span class="component-card-preview-label">Live preview</span>
      ${component.renderPreview(previewId)}
    </div>
  </article>`;
}

function renderComponentAlbum(container) {
  if (!container) return;

  const cardsHtml = SONAR_COMPONENT_CATALOG.map(renderComponentCard).join('');

  container.innerHTML = `
    <div class="component-album-header">
      <h2 class="component-album-title">Component album</h2>
      <p class="component-album-subtitle">Designed controls saved for reuse across pages.</p>
    </div>
    <div class="component-album-grid">${cardsHtml}</div>
  `;
}

window.SonarComponents = {
  catalog: SONAR_COMPONENT_CATALOG,
  renderToggleKnappHTML,
  renderKeybindKnappHTML,
  renderSliderKnappHTML,
  renderComponentAlbum,
};
