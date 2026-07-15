/**
 * Big map zoom and pan controls.
 */

const ZOOM_MIN_VISIBLE_WIDTH = 900;
const ZOOM_MAX_VISIBLE_WIDTH = 14000;

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
  } = options;

  let dragging = false;
  let dragStart = null;

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

    dragging = true;
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      centerU: view.centerU,
      centerV: view.centerV,
    };
    viewport.classList.add('is-dragging');
    event.preventDefault();
  }

  function onMouseMove(event) {
    if (!dragging || !dragStart) return;

    const view = getView();
    const mapSize = getMapPixelSize(viewport, view);
    if (!view || !mapSize?.width || !mapSize?.height) return;

    const deltaU = -(event.clientX - dragStart.x) / mapSize.width;
    const deltaV = -(event.clientY - dragStart.y) / mapSize.height;

    updateView({
      ...view,
      centerU: dragStart.centerU + deltaU,
      centerV: dragStart.centerV + deltaV,
    });
  }

  function stopDragging() {
    if (!dragging) return;
    dragging = false;
    dragStart = null;
    viewport.classList.remove('is-dragging');
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
  window.addEventListener('mouseup', stopDragging);
  window.addEventListener('blur', stopDragging);

  function destroy() {
    viewport.removeEventListener('mousedown', onMouseDown);
    viewport.removeEventListener('wheel', onWheel);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDragging);
    window.removeEventListener('blur', stopDragging);
    stopDragging();
  }

  return {
    updateView,
    destroy,
  };
}

window.SonarMapNavigation = {
  createMapNavigation,
  clampVisibleWidth,
};
