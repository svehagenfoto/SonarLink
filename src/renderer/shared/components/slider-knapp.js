/**
 * Slider knapp — value 1-99 shown as percent number in thumb (no % symbol).
 */

const SLIDER_MIN = 1;
const SLIDER_MAX = 99;

function valueToRatio(value) {
  return (value - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);
}

function ratioToValue(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(SLIDER_MIN + clamped * (SLIDER_MAX - SLIDER_MIN));
}

class SliderKnapp {
  constructor(element) {
    this.element = element;
    this.rail = element.querySelector('.sonar-slider-rail');
    this.thumb = element.querySelector('.sonar-slider-thumb');
    this.valueEl = element.querySelector('.sonar-slider-value');
    this.value = Number(element.dataset.value) || 50;
    this.dragging = false;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    this.rail.addEventListener('pointerdown', this.onPointerDown);
    this.thumb.addEventListener('pointerdown', this.onPointerDown);
    this.rail.addEventListener('pointermove', this.onPointerMove);
    this.rail.addEventListener('pointerup', this.onPointerUp);
    this.rail.addEventListener('pointercancel', this.onPointerUp);
    this.rail.addEventListener('keydown', this.onKeyDown);

    this.setValue(this.value, false);
  }

  onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;

    event.preventDefault();
    this.dragging = true;
    this.element.classList.add('is-dragging');
    this.rail.setPointerCapture(event.pointerId);
    this.updateFromPointer(event);
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    event.preventDefault();
    this.updateFromPointer(event);
  }

  onPointerUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.classList.remove('is-dragging');
    if (this.rail.hasPointerCapture(event.pointerId)) {
      this.rail.releasePointerCapture(event.pointerId);
    }
    this.element.dispatchEvent(new CustomEvent('slidercommit', {
      bubbles: true,
      detail: { value: this.value, percent: this.value },
    }));
  }

  onKeyDown(event) {
    let next = this.value;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
    else if (event.key === 'Home') next = SLIDER_MIN;
    else if (event.key === 'End') next = SLIDER_MAX;
    else return;

    event.preventDefault();
    this.setValue(next);
  }

  updateFromPointer(event) {
    const rect = this.rail.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    this.setValue(ratioToValue(ratio), true, 'input');
  }

  setValue(value, emit = true, eventKind = 'commit') {
    this.value = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, value));
    const ratio = valueToRatio(this.value);
    const pct = `${ratio * 100}%`;

    this.element.dataset.value = String(this.value);
    this.element.style.setProperty('--slider-pct', pct);
    this.valueEl.textContent = String(this.value);
    this.rail.setAttribute('aria-valuenow', String(this.value));

    if (emit) {
      const eventName = eventKind === 'input' ? 'sliderinput' : 'slidercommit';
      this.element.dispatchEvent(new CustomEvent(eventName, {
        bubbles: true,
        detail: { value: this.value, percent: this.value },
      }));
    }
  }
}

function initSliderKnapps(root = document) {
  root.querySelectorAll('.slider-knapp').forEach((element) => {
    if (!element.sliderKnapp) {
      element.sliderKnapp = new SliderKnapp(element);
    }
  });
}

window.SonarSliderKnapp = {
  init: initSliderKnapps,
  SliderKnapp,
  SLIDER_MIN,
  SLIDER_MAX,
};
