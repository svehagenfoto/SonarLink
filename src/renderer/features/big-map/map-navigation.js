/**
 * Big map zoom and pan controls.
 */

const ZOOM_MIN_VISIBLE_WIDTH = 900;
const ZOOM_MAX_VISIBLE_WIDTH = 14000;
const DRAG_THRESHOLD_PX = 12;
const DOUBLE_CLICK_MS = 700;
const DOUBLE_CLICK_PX = 40;

function clampVisibleWidth(value) {
  return Math.max(ZOOM_MIN_VISIBLE_WIDTH, Math.min(ZOOM_MAX_VISIBLE_WIDTH, value));
}

function getMapPixelSize(viewport, view) {
  const vpW = viewport.clientWidth;
  if (!vpW || !view?.visibleWidth) return null;
  const scale = vpW / view.visibleWidth;
  return {
    width: view.imageWidth * scale,
    height: view.imageHeight * scale,
  };
}

function createMapNavigation(options) {
  const {
    viewport,
    image,
    fogController,
    getView,
    setView,
    onViewChange,
    onSingleClick,
    onDoubleClick,
  } = options;

  let pending = null;
  let dragging = false;
  let significantDrag = false;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  function updateView(nextView) {
    setView(nextView);
    window.SonarMapView.applyMapViewportRect(image, viewport, nextView);
    fogController?.onViewUpdate(nextView);
    onViewChange?.(nextView);
  }

  function onMouseDown(event) {
    if (event.button !== 0) return;
    const view = getView();
    if (!view) return;

    // Do not preventDefault on down — keeps click counting intact.
    // Pan starts only after the cursor moves past DRAG_THRESHOLD_PX.
    pending = {
      x: event.clientX,
      y: event.clientY,
      centerU: view.centerU,
      centerV: view.centerV,
    };
    dragging = false;
    significantDrag = false;
  }

  function onMouseMove(event) {
    if (!pending) return;

    const moveX = event.clientX - pending.x;
    const moveY = event.clientY - pending.y;

    if (!dragging) {
      if (
        Math.abs(moveX) <= DRAG_THRESHOLD_PX &&
        Math.abs(moveY) <= DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging = true;
      significantDrag = true;
      viewport.classList.add('is-dragging');
    }

    event.preventDefault();

    const view = getView();
    const mapSize = getMapPixelSize(viewport, view);
    if (!view || !mapSize?.width || !mapSize?.height) return;

    const deltaU = -moveX / mapSize.width;
    const deltaV = -moveY / mapSize.height;

    updateView({
      ...view,
      centerU: pending.centerU + deltaU,
      centerV: pending.centerV + deltaV,
    });
  }

  function clearPending() {
    pending = null;
    dragging = false;
    viewport.classList.remove('is-dragging');
  }

  function onMouseUp(event) {
    if (event.button !== 0) {
      clearPending();
      return;
    }

    const hadPending = Boolean(pending);
    const wasDrag = significantDrag;
    const tapX = event.clientX;
    const tapY = event.clientY;
    clearPending();
    significantDrag = false;

    if (!hadPending || wasDrag) {
      lastTapAt = 0;
      return;
    }

    const now = Date.now();
    const dt = now - lastTapAt;
    const dist = Math.hypot(tapX - lastTapX, tapY - lastTapY);
    const isDouble =
      lastTapAt > 0 &&
      dt <= DOUBLE_CLICK_MS &&
      dist <= DOUBLE_CLICK_PX;

    if (isDouble) {
      lastTapAt = 0;
      onDoubleClick?.({ clientX: tapX, clientY: tapY });
      return;
    }

    lastTapAt = now;
    lastTapX = tapX;
    lastTapY = tapY;
    onSingleClick?.({ clientX: tapX, clientY: tapY });
  }

  function onBlur() {
    clearPending();
    significantDrag = false;
    // Keep lastTapAt — a brief focus blip must not cancel double click.
  }

  function consumeSignificantDrag() {
    const value = significantDrag;
    significantDrag = false;
    return value;
  }

  function onWheel(event) {
    const view = getView();
    if (!view) return;

    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    updateView({
      ...view,
      visibleWidth: clampVisibleWidth(view.visibleWidth * factor),
    });
  }

  viewport.addEventListener('mousedown', onMouseDown);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);

  function destroy() {
    viewport.removeEventListener('mousedown', onMouseDown);
    viewport.removeEventListener('wheel', onWheel);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('blur', onBlur);
    clearPending();
  }

  return {
    updateView,
    consumeSignificantDrag,
    destroy,
  };
}

window.SonarMapNavigation = {
  createMapNavigation,
  clampVisibleWidth,
};
