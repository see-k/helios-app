/* ── Missions Module — Google Maps + Waypoint System + AI Route Planning ── */
import { state } from '../state.js';
import { getMapStyles, createMarkerIcon, createAiMarkerIcon, haversine } from '../utils/maps.js';
import { callGemini, getGeminiApiKey } from '../services/gemini.js';
import { fetchWeather, weatherCodeToInfo, windDirToCompass } from '../services/weather.js';
import { loadGoogleMaps } from '../services/maps-loader.js';

// ── Injected callbacks (set via init) ──
let _navigate = null;
let _setDroneViewWaypoints = null;

export const Missions = {
  _map: null,
  _loadAttempted: false,
  _markers: [],
  _polyline: null,
  _unit: 'kg',
  _waypointIdSeq: 0,
  _aiMarkers: [],
  _aiPolyline: null,
  _lastAiResult: null,

  // DOM cache
  _dom: null,
  _getDom() {
    if (this._dom) return this._dom;
    this._dom = {
      mapEl: document.getElementById('missionMap'),
      waypointList: document.getElementById('waypointList'),
      waypointCount: document.getElementById('waypointCount'),
      routeDistance: document.getElementById('routeDistance'),
      routeWaypoints: document.getElementById('routeWaypoints'),
      btnClear: document.getElementById('btnClearWaypoints'),
      btnUndo: document.getElementById('btnUndoWaypoint'),
      unitToggle: document.getElementById('unitToggle'),
      form: document.getElementById('missionForm'),
      btnSubmit: document.getElementById('btnStartMission'),
      btnSimulate: document.getElementById('btnSimulateMission'),
      formPanel: document.getElementById('missionFormPanel'),
      btnCollapse: document.getElementById('btnCollapseForm'),
      btnExpand: document.getElementById('btnExpandForm'),
      // AI panels
      aiLoadingOverlay: document.getElementById('aiLoadingOverlay'),
      aiControlBar: document.getElementById('aiControlBar'),
      aiWeatherPanel: document.getElementById('aiWeatherPanel'),
      aiWeatherBody: document.getElementById('aiWeatherBody'),
      aiBriefingPanel: document.getElementById('aiBriefingPanel'),
      aiBriefingBody: document.getElementById('aiBriefingBody'),
      aiBriefingRisk: document.getElementById('aiBriefingRisk'),
      btnDismissAi: document.getElementById('btnDismissAi'),
      btnReplanAi: document.getElementById('btnReplanAi'),
      btnAcceptAi: document.getElementById('btnAcceptAi'),
      btnCloseWeather: document.getElementById('btnCloseWeather'),
      btnCloseBriefing: document.getElementById('btnCloseBriefing')
    };
    return this._dom;
  },

  // ── Lifecycle ──
  init({ navigate, setDroneViewWaypoints } = {}) {
    _navigate = navigate;
    _setDroneViewWaypoints = setDroneViewWaypoints;

    const d = this._getDom();
    d.btnClear.addEventListener('click', () => this.clearWaypoints());
    d.btnUndo.addEventListener('click', () => this.undoWaypoint());
    d.unitToggle.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._setUnit(btn.dataset.unit));
    });
    d.btnCollapse.addEventListener('click', () => this._toggleFormPanel(false));
    d.btnExpand.addEventListener('click', () => this._toggleFormPanel(true));
    d.form.addEventListener('submit', (e) => { e.preventDefault(); this._submitMission(); });
    d.btnSimulate.addEventListener('click', () => this._simulateMission());
    d.btnDismissAi.addEventListener('click', () => this._dismissAiRoute());
    d.btnReplanAi.addEventListener('click', () => this._replanMission());
    d.btnAcceptAi.addEventListener('click', () => this._acceptAiRoute());
    d.btnCloseWeather.addEventListener('click', () => d.aiWeatherPanel.classList.remove('visible'));
    d.btnCloseBriefing.addEventListener('click', () => d.aiBriefingPanel.classList.remove('visible'));
  },

  async onEnter() {
    if (!this._loadAttempted) {
      this._loadAttempted = true;
      const loaded = await loadGoogleMaps();
      if (loaded) {
        this._initMap();
      } else {
        this._showMapFallback();
      }
    } else if (this._map) {
      google.maps.event.trigger(this._map, 'resize');
    }
  },

  onLeave() { /* no cleanup needed */ },

  /** Called by Theme when theme changes. */
  updateMapStyles() {
    if (this._map) {
      this._map.setOptions({ styles: getMapStyles() });
    }
  },

  // ── Map Initialization ──
  _showMapFallback() {
    const d = this._getDom();
    d.mapEl.innerHTML = `
      <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-secondary);color:var(--text-secondary);gap:12px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:0.4;">
          <path d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"/>
        </svg>
        <span style="font-size:14px;font-weight:600;">Google Maps API Key Required</span>
        <span style="font-size:12px;max-width:320px;text-align:center;line-height:1.5;">Add your API key to the <code>.env</code> file as <code>GOOGLE_MAPS_API_KEY</code> and restart the app.</span>
      </div>`;
  },

  _initMap() {
    const d = this._getDom();
    this._map = new google.maps.Map(d.mapEl, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 13,
      styles: getMapStyles(),
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.LEFT_TOP },
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
      clickableIcons: false
    });

    this._polyline = new google.maps.Polyline({
      map: this._map,
      path: [],
      strokeColor: '#3b82f6',
      strokeOpacity: 0.85,
      strokeWeight: 3,
      geodesic: true
    });

    this._map.addListener('click', (e) => {
      this._addWaypoint(e.latLng.lat(), e.latLng.lng());
    });
  },

  // ── Waypoint Management ──
  _addWaypoint(lat, lng, alt = null) {
    const id = ++this._waypointIdSeq;
    const count = this._markers.length;
    let type, label;
    if (count === 0) { type = 'takeoff'; label = 'T'; }
    else { type = 'waypoint'; label = String(count); }

    const marker = new google.maps.Marker({
      position: { lat, lng },
      map: this._map,
      icon: {
        url: createMarkerIcon(label, type),
        scaledSize: new google.maps.Size(32, 42),
        anchor: new google.maps.Point(16, 42)
      },
      draggable: true,
      title: this._waypointLabel(type, count),
      zIndex: 100 + count
    });

    marker._wpId = id;
    marker._wpType = type;
    marker._wpIndex = count;
    marker._wpAlt = Number.isFinite(alt) ? Math.round(alt) : null;
    marker.addListener('dragend', () => this._refreshRoute());

    this._markers.push(marker);
    this._relabelMarkers();
    this._refreshRoute();
    this._renderWaypointList();
  },

  _relabelMarkers() {
    const len = this._markers.length;
    this._markers.forEach((m, i) => {
      let type, label;
      if (i === 0) { type = 'takeoff'; label = 'T'; }
      else if (len > 1 && i === len - 1) { type = 'rtl'; label = 'R'; }
      else { type = 'waypoint'; label = String(i); }
      m._wpType = type;
      m._wpIndex = i;
      m.setIcon({
        url: createMarkerIcon(label, type),
        scaledSize: new google.maps.Size(32, 42),
        anchor: new google.maps.Point(16, 42)
      });
      m.setTitle(this._waypointLabel(type, i));
    });
  },

  _waypointLabel(type, index) {
    if (type === 'takeoff') return 'Take Off';
    if (type === 'rtl') return 'Return to Launch';
    return `Waypoint ${index}`;
  },

  _removeWaypointAt(index) {
    if (index < 0 || index >= this._markers.length) return;
    const m = this._markers.splice(index, 1)[0];
    m.setMap(null);
    this._relabelMarkers();
    this._refreshRoute();
    this._renderWaypointList();
  },

  clearWaypoints() {
    this._markers.forEach(m => m.setMap(null));
    this._markers = [];
    if (this._polyline) this._polyline.setPath([]);
    this._refreshRoute();
    this._renderWaypointList();
  },

  undoWaypoint() {
    if (this._markers.length === 0) return;
    this._removeWaypointAt(this._markers.length - 1);
  },

  // ── Route Drawing & Distance ──
  _refreshRoute() {
    const path = this._markers.map(m => m.getPosition());
    if (this._polyline) this._polyline.setPath(path);
    this._updateRouteSummary();
  },

  _computeDistance() {
    let total = 0;
    for (let i = 1; i < this._markers.length; i++) {
      const a = this._markers[i - 1].getPosition();
      const b = this._markers[i].getPosition();
      total += google.maps.geometry
        ? google.maps.geometry.spherical.computeDistanceBetween(a, b)
        : haversine(a.lat(), a.lng(), b.lat(), b.lng());
    }
    return total;
  },

  _updateRouteSummary() {
    const d = this._getDom();
    const count = this._markers.length;
    d.waypointCount.textContent = count;
    d.routeWaypoints.textContent = count;
    if (count < 2) { d.routeDistance.textContent = '—'; return; }
    const meters = this._computeDistance();
    d.routeDistance.textContent = meters >= 1000
      ? (meters / 1000).toFixed(2) + ' km'
      : Math.round(meters) + ' m';
  },

  // ── Waypoint List Rendering ──
  _renderWaypointList() {
    const d = this._getDom();
    if (this._markers.length === 0) {
      d.waypointList.innerHTML = '<div class="waypoint-empty">Click on the map to add waypoints</div>';
      return;
    }
    d.waypointList.innerHTML = this._markers.map((m, i) => {
      const type = m._wpType;
      const pos = m.getPosition();
      const lat = pos.lat().toFixed(5);
      const lng = pos.lng().toFixed(5);
      const label = m.getTitle();
      const markerChar = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
      return `
        <div class="waypoint-item" data-index="${i}">
          <div class="waypoint-marker type-${type}">${markerChar}</div>
          <div class="waypoint-info">
            <div class="waypoint-label">${label}</div>
            <div class="waypoint-coords">${lat}, ${lng}</div>
          </div>
          <button class="waypoint-delete" data-index="${i}" title="Remove waypoint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    d.waypointList.querySelectorAll('.waypoint-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeWaypointAt(parseInt(btn.dataset.index));
      });
    });
    d.waypointList.querySelectorAll('.waypoint-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        const marker = this._markers[idx];
        if (marker && this._map) this._map.panTo(marker.getPosition());
      });
    });
  },

  // ── Unit Toggle ──
  _setUnit(unit) {
    this._unit = unit;
    const d = this._getDom();
    d.unitToggle.querySelectorAll('.unit-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.unit === unit);
    });
  },

  // ── Collapse / Expand ──
  _toggleFormPanel(show) {
    const d = this._getDom();
    if (show) {
      d.formPanel.classList.remove('collapsed');
      d.btnExpand.classList.remove('visible');
    } else {
      d.formPanel.classList.add('collapsed');
      d.btnExpand.classList.add('visible');
    }
    if (this._map) {
      setTimeout(() => google.maps.event.trigger(this._map, 'resize'), 360);
    }
  },

  _buildSimulationWaypoints() {
    return this._markers.map((m, i) => {
      const p = m.getPosition();
      const type = m._wpType;
      const defaultAlt = (type === 'takeoff' || type === 'rtl') ? 0 : 80;
      return {
        lat: p.lat(), lng: p.lng(), type,
        label: m.getTitle(),
        alt: Number.isFinite(m._wpAlt) ? Math.max(0, Math.round(m._wpAlt)) : defaultAlt
      };
    });
  },

  _simulateMission() {
    if (this._markers.length < 2) {
      alert('Add at least 2 waypoints to simulate a mission.');
      return;
    }
    const missionWaypoints = this._buildSimulationWaypoints();
    if (_setDroneViewWaypoints) _setDroneViewWaypoints(missionWaypoints);
    if (_navigate) _navigate('droneview');
  },

  // ── Form Submit → AI + Weather ──
  async _submitMission() {
    const d = this._getDom();
    if (this._markers.length < 2) {
      alert('Add at least 2 waypoints to plan a mission.');
      return;
    }

    const droneModel = document.getElementById('droneModel').value;
    const takeoffDate = document.getElementById('takeoffDate').value;
    const loadWeight = document.getElementById('loadWeight').value;
    const missionDescription = document.getElementById('missionDescription').value;
    const waypoints = this._markers.map(m => {
      const p = m.getPosition();
      return { lat: p.lat(), lng: p.lng(), type: m._wpType, label: m.getTitle() };
    });

    const mission = {
      droneModel, takeoffDate,
      loadWeight: parseFloat(loadWeight),
      weightUnit: this._unit,
      missionDescription, waypoints,
      totalDistance: this._computeDistance()
    };

    this._clearAiRoute();
    this._hideAiPanels();

    d.btnSubmit.classList.add('loading');
    d.aiLoadingOverlay.classList.add('visible');

    try {
      const takeoffWp = waypoints[0];
      const dateStr = takeoffDate ? takeoffDate.split('T')[0] : '';

      const [weatherData, aiResult] = await Promise.allSettled([
        fetchWeather(takeoffWp.lat, takeoffWp.lng, { dateStr }),
        this._callGeminiAI(mission)
      ]);

      d.aiLoadingOverlay.classList.remove('visible');

      if (weatherData.status === 'fulfilled' && weatherData.value) {
        this._showWeatherPanel(weatherData.value);
      }
      if (aiResult.status === 'fulfilled' && aiResult.value) {
        this._lastAiResult = aiResult.value;
        if (aiResult.value.optimizedWaypoints) {
          this._showAiRoute(aiResult.value.optimizedWaypoints);
        }
        if (aiResult.value.pilotBriefing) {
          this._showBriefingPanel(aiResult.value.pilotBriefing);
        }
        d.aiControlBar.classList.add('visible');
      } else {
        const errMsg = aiResult.reason?.message || 'Failed to get AI analysis. Check your GEMINI_API_KEY.';
        this._showErrorToast(errMsg);
      }
    } catch (err) {
      d.aiLoadingOverlay.classList.remove('visible');
      this._showErrorToast(err.message);
    } finally {
      d.btnSubmit.classList.remove('loading');
    }
  },

  // ── Gemini AI (mission-specific prompt) ──
  async _callGeminiAI(mission) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error('Gemini API key not configured. Add your GEMINI_API_KEY to the .env file and restart the app.');
    }

    const droneSpecs = {
      'helios-x1': { name: 'Helios X1 Recon', maxAltitude: 120, maxSpeed: 65, maxFlightTime: 35, maxPayload: 2.5 },
      'helios-h4': { name: 'Helios H4 Heavy Lift', maxAltitude: 100, maxSpeed: 45, maxFlightTime: 25, maxPayload: 15 },
      'helios-s2': { name: 'Helios S2 Survey', maxAltitude: 150, maxSpeed: 55, maxFlightTime: 40, maxPayload: 5 }
    };
    const drone = droneSpecs[mission.droneModel] || droneSpecs['helios-x1'];

    const prompt = `You are an expert eVTOL drone mission planner. Analyze this mission and provide an optimized flight plan.

MISSION DATA:
- Drone: ${drone.name} (max altitude: ${drone.maxAltitude}m, max speed: ${drone.maxSpeed}km/h, max flight time: ${drone.maxFlightTime}min, max payload: ${drone.maxPayload}kg)
- Scheduled takeoff: ${mission.takeoffDate || 'Not specified'}
- Payload weight: ${mission.loadWeight} ${mission.weightUnit}
- Mission description: ${mission.missionDescription || 'General mission'}
- Total route distance: ${(mission.totalDistance / 1000).toFixed(2)} km

WAYPOINTS (user-defined):
${mission.waypoints.map((wp, i) => `  ${i + 1}. [${wp.type}] ${wp.label} — lat: ${wp.lat.toFixed(6)}, lng: ${wp.lng.toFixed(6)}`).join('\n')}

INSTRUCTIONS:
Return a JSON response with EXACTLY this structure (no markdown, no code fences, just raw JSON):
{
  "optimizedWaypoints": [
    { "lat": <number>, "lng": <number>, "altitude_m": <recommended altitude in meters>, "label": "<descriptive label>", "type": "<takeoff|waypoint|rtl>" }
  ],
  "pilotBriefing": {
    "summary": "<2-3 sentence mission overview>",
    "safetyConsiderations": ["<safety item 1>", "<safety item 2>"],
    "recommendations": ["<recommendation 1>", "<recommendation 2>"],
    "estimatedFlightTime": "<e.g. 12 min>",
    "maxAltitude": "<e.g. 80m>",
    "riskLevel": "<low|medium|high>"
  }
}

RULES:
- Keep the same number of waypoints as the user provided
- Optimize altitudes based on the drone specs, terrain, and mission type
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Altitudes should be between 30m and the drone's max altitude
- Provide practical safety considerations and recommendations
- Consider payload weight impact on flight time and performance
- Be concise but thorough in the briefing`;

    return callGemini(apiKey, prompt);
  },

  // ── AI Route Display on Map ──
  _showAiRoute(waypoints) {
    this._clearAiRoute();
    if (!waypoints || !waypoints.length || !this._map) return;

    const path = [];
    waypoints.forEach((wp, i) => {
      const pos = { lat: wp.lat, lng: wp.lng };
      path.push(pos);
      let label, type;
      if (i === 0) { type = 'takeoff'; label = 'T'; }
      else if (i === waypoints.length - 1) { type = 'rtl'; label = 'R'; }
      else { type = 'waypoint'; label = String(i); }

      const marker = new google.maps.Marker({
        position: pos,
        map: this._map,
        icon: {
          url: createAiMarkerIcon(label, type),
          scaledSize: new google.maps.Size(32, 32),
          anchor: new google.maps.Point(16, 30)
        },
        title: `AI: ${wp.label || this._waypointLabel(type, i)}` + (wp.altitude_m ? ` (${wp.altitude_m}m)` : ''),
        zIndex: 200 + i
      });
      this._aiMarkers.push(marker);
    });

    this._aiPolyline = new google.maps.Polyline({
      map: this._map, path,
      strokeColor: '#a855f7', strokeOpacity: 0, strokeWeight: 3, geodesic: true,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#a855f7', scale: 3 },
        offset: '0', repeat: '16px'
      }]
    });
  },

  _clearAiRoute() {
    this._aiMarkers.forEach(m => m.setMap(null));
    this._aiMarkers = [];
    if (this._aiPolyline) { this._aiPolyline.setMap(null); this._aiPolyline = null; }
  },

  // ── Weather Panel ──
  _showWeatherPanel(w) {
    const d = this._getDom();
    const info = weatherCodeToInfo(w.weatherCode);
    const compass = windDirToCompass(w.windDirection || 0);
    const visKm = w.visibility != null ? (w.visibility / 1000).toFixed(1) : '—';

    const svgThermo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M12 9a4 4 0 00-2 7.465V18a2 2 0 104 0v-1.535A4.001 4.001 0 0012 9z"/><path d="M12 3v6" stroke-linecap="round"/></svg>';
    const svgWind = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M3 8h12a3 3 0 100-3M3 16h10a3 3 0 110 3M3 12h16a3 3 0 100-3" stroke-linecap="round"/></svg>';
    const svgCloudRain = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/><path d="M8 19v2m4-2v2m4-2v2" stroke-linecap="round"/></svg>';
    const svgEye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5s8.577 3.01 9.963 7.178a1.014 1.014 0 010 .639C20.577 16.49 16.64 19.5 12 19.5s-8.577-3.01-9.963-7.178z"/><circle cx="12" cy="12" r="3"/></svg>';

    d.aiWeatherBody.innerHTML = `
      <div class="weather-card weather-card-wide">
        <span class="weather-card-icon">${info.icon}</span>
        <span class="weather-card-value">${info.label}</span>
        <span class="weather-card-label">Conditions</span>
      </div>
      <div class="weather-card">
        <span class="weather-card-icon">${svgThermo}</span>
        <span class="weather-card-value">${w.temperature != null ? w.temperature + '°C' : '—'}</span>
        <span class="weather-card-label">Temp</span>
      </div>
      <div class="weather-card">
        <span class="weather-card-icon">${svgWind}</span>
        <span class="weather-card-value">${w.windSpeed != null ? w.windSpeed + ' km/h' : '—'}</span>
        <span class="weather-card-label">Wind ${compass}</span>
      </div>
      <div class="weather-card">
        <span class="weather-card-icon">${svgCloudRain}</span>
        <span class="weather-card-value">${w.precipitationProb != null ? w.precipitationProb + '%' : '—'}</span>
        <span class="weather-card-label">Rain</span>
      </div>
      <div class="weather-card">
        <span class="weather-card-icon">${svgEye}</span>
        <span class="weather-card-value">${visKm} km</span>
        <span class="weather-card-label">Visibility</span>
      </div>`;
    d.aiWeatherPanel.classList.add('visible');
  },

  // ── Briefing Panel ──
  _showBriefingPanel(briefing) {
    if (!briefing) return;
    const d = this._getDom();
    const risk = (briefing.riskLevel || 'medium').toLowerCase();
    d.aiBriefingRisk.textContent = risk.toUpperCase();
    d.aiBriefingRisk.className = `ai-risk-badge risk-${risk}`;

    const safetyItems = (briefing.safetyConsiderations || []).map(s => `<li>${s}</li>`).join('');
    const recoItems = (briefing.recommendations || []).map(r => `<li>${r}</li>`).join('');

    d.aiBriefingBody.innerHTML = `
      <p class="briefing-summary">${briefing.summary || ''}</p>
      <div class="briefing-stat-row">
        <div class="briefing-stat"><span class="briefing-stat-value">${briefing.estimatedFlightTime || '—'}</span><span class="briefing-stat-label">Flight Time</span></div>
        <div class="briefing-stat"><span class="briefing-stat-value">${briefing.maxAltitude || '—'}</span><span class="briefing-stat-label">Max Alt</span></div>
        <div class="briefing-stat"><span class="briefing-stat-value">${risk.charAt(0).toUpperCase() + risk.slice(1)}</span><span class="briefing-stat-label">Risk</span></div>
      </div>
      ${safetyItems ? `<div class="briefing-block"><div class="briefing-block-title"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" width="13" height="13"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg> Safety</div><ul class="briefing-list">${safetyItems}</ul></div>` : ''}
      ${recoItems ? `<div class="briefing-block"><div class="briefing-block-title"><svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" width="13" height="13"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Recommendations</div><ul class="briefing-list">${recoItems}</ul></div>` : ''}`;
    d.aiBriefingPanel.classList.add('visible');
  },

  _hideAiPanels() {
    const d = this._getDom();
    d.aiLoadingOverlay.classList.remove('visible');
    d.aiControlBar.classList.remove('visible');
    d.aiWeatherPanel.classList.remove('visible');
    d.aiBriefingPanel.classList.remove('visible');
    const toast = d.mapEl.parentElement.querySelector('.ai-error-toast');
    if (toast) toast.remove();
  },

  _dismissAiRoute() {
    this._clearAiRoute();
    this._hideAiPanels();
    this._lastAiResult = null;
  },

  _acceptAiRoute() {
    if (!this._lastAiResult?.optimizedWaypoints) { this._dismissAiRoute(); return; }
    this._markers.forEach(m => m.setMap(null));
    this._markers = [];
    this._clearAiRoute();
    this._hideAiPanels();
    for (const wp of this._lastAiResult.optimizedWaypoints) {
      this._addWaypoint(wp.lat, wp.lng, wp.altitude_m);
    }
    this._lastAiResult = null;
  },

  _replanMission() {
    this._clearAiRoute();
    this._hideAiPanels();
    this._lastAiResult = null;
    this._submitMission();
  },

  _showErrorToast(message) {
    const d = this._getDom();
    const existing = d.mapEl.parentElement.querySelector('.ai-error-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'ai-error-toast';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
        <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
      </svg>
      <span>${message}</span>`;
    d.mapEl.parentElement.appendChild(toast);
    requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('visible')); });
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 400); }, 8000);
  }
};
