/* ── Shared Google Maps Loader ── */

let _loadPromise = null;

/**
 * Check if Google Maps API is available.
 */
export function isMapsLoaded() {
  return typeof google !== 'undefined' && google.maps;
}

/**
 * Load the Google Maps JS API (deduplicated — safe to call from multiple modules).
 * @returns {Promise<boolean>} true if maps loaded successfully
 */
export async function loadGoogleMaps() {
  if (isMapsLoaded()) return true;
  if (_loadPromise) return _loadPromise;

  _loadPromise = _doLoad();
  return _loadPromise;
}

async function _doLoad() {
  let apiKey = '';
  try {
    if (window.helios?.getEnv) {
      apiKey = await window.helios.getEnv('GOOGLE_MAPS_API_KEY');
    }
  } catch (_) { /* ignore */ }

  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    _loadPromise = null;
    return false;
  }

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=alpha&callback=__heliosMapInit`;
    script.async = true;
    script.defer = true;

    window.__heliosMapInit = () => {
      delete window.__heliosMapInit;
      resolve(true);
    };

    script.onerror = () => {
      _loadPromise = null; // allow retry
      resolve(false);
    };

    document.head.appendChild(script);
  });
}
