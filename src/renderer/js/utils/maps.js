/* ── Shared Map Utilities ── */
import { state } from '../state.js';

/**
 * Get Google Maps style array based on current theme.
 */
export function getMapStyles() {
  const isDark = state.theme === 'dark';
  if (!isDark) {
    return [
      { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e0e0e0' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d1e3' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];
  }
  return [
    { elementType: 'geometry', stylers: [{ color: '#0e1117' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0e1117' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5a6270' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1a1f2b' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#3a4150' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0e1117' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#141821' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#101520' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1f2b' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1f2b' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1f2533' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a1f2b' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080b12' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2a3040' }] }
  ];
}

/**
 * Generate an SVG data-URI for a user waypoint marker.
 */
export function createMarkerIcon(label, type) {
  const colors = {
    takeoff: { bg: '#22c55e', border: '#16a34a' },
    waypoint: { bg: '#3b82f6', border: '#2563eb' },
    rtl: { bg: '#f97316', border: '#ea580c' }
  };
  const c = colors[type] || colors.waypoint;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
      <defs>
        <filter id="s" x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>
      <path d="M16 40 C16 40 3 24 3 14 A13 13 0 1 1 29 14 C29 24 16 40 16 40Z" fill="${c.bg}" stroke="${c.border}" stroke-width="1.5" filter="url(#s)"/>
      <circle cx="16" cy="14" r="7" fill="white" fill-opacity="0.95"/>
      <text x="16" y="17.5" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="700" fill="${c.bg}">${label}</text>
    </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Generate an SVG data-URI for an AI-suggested waypoint marker (diamond).
 */
export function createAiMarkerIcon(label, type) {
  const colors = {
    takeoff: { bg: '#a855f7', border: '#7c3aed' },
    waypoint: { bg: '#8b5cf6', border: '#6d28d9' },
    rtl: { bg: '#d946ef', border: '#c026d3' }
  };
  const c = colors[type] || colors.waypoint;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <defs>
        <filter id="s" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>
      <path d="M16 2 L29 16 L16 30 L3 16 Z" fill="${c.bg}" stroke="${c.border}" stroke-width="1.5" filter="url(#s)"/>
      <circle cx="16" cy="16" r="7" fill="white" fill-opacity="0.95"/>
      <text x="16" y="19.5" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="700" fill="${c.bg}">${label}</text>
    </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Generate an SVG data-URI for the drone icon.
 * @param {string} [color='#22c55e'] - Stroke/fill color for the drone.
 */
export function createDroneIcon(color = '#22c55e') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${color}99"/>
        </filter>
      </defs>
      <circle cx="20" cy="20" r="14" fill="#0a0a0f" stroke="${color}" stroke-width="2.5" filter="url(#glow)"/>
      <circle cx="20" cy="20" r="8" fill="${color}" fill-opacity="0.2"/>
      <polygon points="20,10 24,22 20,19 16,22" fill="${color}"/>
      <circle cx="20" cy="20" r="3" fill="${color}"/>
    </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/**
 * Haversine distance in metres between two lat/lng pairs.
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute bearing from point A to point B.
 */
export function bearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
