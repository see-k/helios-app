/* ── Custom Google Maps OverlayView that renders a <model-viewer> at a lat/lng ── */

const MODEL_URL = '../utils/models/helios.glb';

/**
 * Create a drone model overlay. Must be called AFTER google.maps is loaded
 * because it extends google.maps.OverlayView.
 *
 * The returned object exposes a marker-like API:
 *   setMap(map)        — add/remove from the map (pass null to remove)
 *   setPosition({lat,lng})
 *   getPosition()
 *   setHeading(deg)    — rotate the model around its vertical axis
 *   addListener('click', fn)
 */
export function createDroneModelOverlay({ position, color = '#22c55e', title = '', size = 72 }) {
  class DroneModelOverlay extends google.maps.OverlayView {
    constructor() {
      super();
      this._position = position;
      this._heading = 0;
      this._clickListeners = [];
      this._div = null;
      this._modelViewer = null;
    }

    onAdd() {
      const div = document.createElement('div');
      div.className = 'dv-model-marker';
      div.style.position = 'absolute';
      div.style.width = size + 'px';
      div.style.height = size + 'px';
      div.style.transform = 'translate(-50%, -50%)';
      div.style.cursor = 'pointer';
      div.style.filter = `drop-shadow(0 0 6px ${color}cc) drop-shadow(0 2px 4px rgba(0,0,0,0.45))`;
      div.title = title;
      div.style.zIndex = '1000';

      const mv = document.createElement('model-viewer');
      mv.setAttribute('src', MODEL_URL);
      mv.setAttribute('alt', title || 'Drone');
      mv.setAttribute('disable-zoom', '');
      mv.setAttribute('disable-tap', '');
      mv.setAttribute('disable-pan', '');
      mv.setAttribute('interaction-prompt', 'none');
      mv.setAttribute('shadow-intensity', '0');
      mv.setAttribute('exposure', '1');
      // Top-down-ish aerial view; phi (first value) is azimuth and is updated by setHeading
      mv.setAttribute('camera-orbit', '0deg 25deg auto');
      mv.setAttribute('field-of-view', '30deg');
      mv.style.width = '100%';
      mv.style.height = '100%';
      mv.style.background = 'transparent';
      mv.style.pointerEvents = 'none';
      div.appendChild(mv);
      this._modelViewer = mv;

      div.addEventListener('click', (e) => {
        e.stopPropagation();
        this._clickListeners.forEach(fn => fn());
      });

      this._div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
      this._applyHeading();
    }

    draw() {
      if (!this._div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this._position.lat, this._position.lng)
      );
      if (!point) return;
      this._div.style.left = point.x + 'px';
      this._div.style.top = point.y + 'px';
    }

    onRemove() {
      if (this._div && this._div.parentNode) {
        this._div.parentNode.removeChild(this._div);
      }
      this._div = null;
      this._modelViewer = null;
    }

    setPosition(latLng) {
      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
      this._position = { lat, lng };
      this.draw();
    }

    getPosition() {
      return this._position;
    }

    setHeading(deg) {
      this._heading = ((deg || 0) % 360 + 360) % 360;
      this._applyHeading();
    }

    _applyHeading() {
      if (!this._modelViewer) return;
      // camera-orbit "<phi> <theta> <radius>" — phi rotates view around the model's Y axis
      this._modelViewer.setAttribute('camera-orbit', `${this._heading}deg 25deg auto`);
    }

    addListener(event, fn) {
      if (event === 'click' && typeof fn === 'function') {
        this._clickListeners.push(fn);
      }
      return { remove: () => {
        if (event === 'click') {
          this._clickListeners = this._clickListeners.filter(l => l !== fn);
        }
      }};
    }
  }

  return new DroneModelOverlay();
}
