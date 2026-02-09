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
  _currentMapType: 'roadmap',
  _is3DMode: false,
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
      btnCloseBriefing: document.getElementById('btnCloseBriefing'),
      // Flight plan modal
      btnGenerateFp: document.getElementById('btnGenerateFlightPlan'),
      fpOverlay: document.getElementById('fpModalOverlay'),
      btnCloseFp: document.getElementById('btnCloseFpModal'),
      fpFormatCards: document.getElementById('fpFormatCards'),
      fpOutput: document.getElementById('fpOutput'),
      fpOutputTitle: document.getElementById('fpOutputTitle'),
      fpOutputCode: document.getElementById('fpOutputCode'),
      btnFpBack: document.getElementById('btnFpBack'),
      btnFpCopy: document.getElementById('btnFpCopy'),
      btnFpDownload: document.getElementById('btnFpDownload'),
      fpCopyLabel: document.getElementById('fpCopyLabel'),
      // Load waypoints
      btnLoadWaypoints: document.getElementById('btnLoadWaypoints'),
      // Map controls
      mapTypeSelector: document.getElementById('mapTypeSelector'),
      btn3DToggle: document.getElementById('btn3DToggle')
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

    // Flight plan modal
    d.btnGenerateFp.addEventListener('click', () => this._openFlightPlanModal());
    d.btnCloseFp.addEventListener('click', () => this._closeFlightPlanModal());
    d.fpOverlay.addEventListener('click', (e) => { if (e.target === e.currentTarget) this._closeFlightPlanModal(); });
    d.btnFpBack.addEventListener('click', () => this._fpShowFormatSelection());
    d.btnFpCopy.addEventListener('click', () => this._fpCopyToClipboard());
    d.btnFpDownload.addEventListener('click', () => this._fpDownloadFile());
    d.fpFormatCards.querySelectorAll('.fp-format-card').forEach(card => {
      card.addEventListener('click', () => this._fpSelectFormat(card.dataset.format));
    });

    // Load waypoints from file
    d.btnLoadWaypoints.addEventListener('click', () => this._loadWaypointsFromFile());

    // Map visualization controls
    d.mapTypeSelector?.querySelectorAll('.map-type-btn').forEach(btn => {
      btn.addEventListener('click', () => this._setMapType(btn.dataset.mapType));
    });
    d.btn3DToggle?.addEventListener('click', () => this._toggle3DView());
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
    // Populate drone model dropdown from fleet database
    await this._populateDroneSelect();
  },

  onLeave() { /* no cleanup needed */ },

  async _populateDroneSelect() {
    const select = document.getElementById('droneModel');
    if (!select) return;
    const currentVal = select.value;
    // Keep placeholder, remove old dynamic options
    const placeholder = select.querySelector('option[disabled]');
    select.innerHTML = '';
    if (placeholder) select.appendChild(placeholder);
    try {
      const drones = await window.helios.fleetGetAll();
      if (drones.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.textContent = 'No drones — add one in Fleet';
        select.appendChild(opt);
      } else {
        drones.forEach(d => {
          const opt = document.createElement('option');
          opt.value = String(d.id);
          opt.textContent = `${d.name}${d.model ? ' — ' + d.model : ''}`;
          opt.dataset.hostname = d.hostname;
          opt.dataset.droneType = d.drone_type || '';
          opt.dataset.droneName = d.name;
          opt.dataset.droneModel = d.model || '';
          select.appendChild(opt);
        });
      }
      // Restore selection if still valid
      if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
      }
    } catch (err) {
      console.error('Failed to load fleet drones for mission select:', err);
    }
  },

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

    // Set initial map type
    this._setMapType('roadmap');
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

    const droneSelect = document.getElementById('droneModel');
    const selectedOption = droneSelect.options[droneSelect.selectedIndex];
    const droneId = droneSelect.value;
    const droneName = selectedOption?.dataset?.droneName || 'Unknown';
    const droneType = selectedOption?.dataset?.droneType || 'quadcopter';
    const droneModelName = selectedOption?.dataset?.droneModel || '';
    const takeoffDate = document.getElementById('takeoffDate').value;
    const loadWeight = document.getElementById('loadWeight').value;
    const missionDescription = document.getElementById('missionDescription').value;
    const optimizationMode = document.getElementById('optimizationMode')?.value || 'standard';
    const waypoints = this._markers.map(m => {
      const p = m.getPosition();
      return { lat: p.lat(), lng: p.lng(), type: m._wpType, label: m.getTitle() };
    });

    const mission = {
      droneId, droneName, droneType, droneModelName,
      takeoffDate,
      loadWeight: parseFloat(loadWeight),
      weightUnit: this._unit,
      missionDescription, waypoints,
      totalDistance: this._computeDistance(),
      optimizationMode
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
        // Switch to terrain view to show elevation after planning
        this._setMapType('terrain');
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

    const typeDefaults = {
      'quadcopter':  { maxAltitude: 120, maxSpeed: 55, maxFlightTime: 30, maxPayload: 5 },
      'hexacopter':  { maxAltitude: 120, maxSpeed: 50, maxFlightTime: 28, maxPayload: 8 },
      'octocopter':  { maxAltitude: 100, maxSpeed: 45, maxFlightTime: 25, maxPayload: 15 },
      'fixed-wing':  { maxAltitude: 200, maxSpeed: 90, maxFlightTime: 60, maxPayload: 3 },
      'vtol':        { maxAltitude: 150, maxSpeed: 70, maxFlightTime: 40, maxPayload: 6 },
      'evtol':       { maxAltitude: 150, maxSpeed: 80, maxFlightTime: 45, maxPayload: 10 }
    };
    const specs = typeDefaults[mission.droneType] || typeDefaults['quadcopter'];
    const droneLine = `${mission.droneName}${mission.droneModelName ? ' (' + mission.droneModelName + ')' : ''} [${mission.droneType}]`;

    // Build optimization-specific instructions
    const optimizationModes = {
      standard: {
        title: 'Balanced Route Optimization',
        rules: `- Keep the same number of waypoints as the user provided
- Optimize altitudes based on the drone specs, terrain, and mission type
- Balance between flight time, safety, and energy efficiency
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Altitudes should be between 30m and the drone's max altitude`
      },
      shortest: {
        title: 'Shortest Path Optimization',
        rules: `- PRIORITIZE minimizing total flight distance and time
- You must reduce waypoint count especially if intermediate points are unnecessary for direct routing
- Optimize for straight-line paths where safe and practical
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Altitudes should favor efficiency (higher altitudes for longer segments to reduce drag)
- Avoid unnecessary altitude changes that would increase flight time`
      },
      safest: {
        title: 'Safest Route Optimization',
        rules: `- PRIORITIZE safety and risk mitigation above all else
- Keep the same or more waypoints to ensure controlled flight path
- Recommend lower altitudes (40-60m) for better control and emergency landing options
- Avoid high-risk areas (dense urban zones, water bodies, steep terrain)
- Add buffer waypoints near potential hazards
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Emphasize conservative flight parameters`
      },
      energy: {
        title: 'Energy Efficient Route Optimization',
        rules: `- PRIORITIZE minimizing battery consumption and extending flight time
- Optimize altitudes to minimize energy use (generally 60-80m for best efficiency)
- Minimize altitude changes and aggressive maneuvers
- Consider wind direction for energy savings (tailwind on longer segments)
- Keep the same number of waypoints but optimize their positions for smooth, efficient flight
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Recommend lower cruise speeds for energy conservation`
      },
      scenic: {
        title: 'Scenic Route Optimization',
        rules: `- PRIORITIZE interesting viewpoints and varied perspectives
- Add waypoints to capture unique angles and terrain features
- Vary altitudes (40m-100m) for diverse camera perspectives
- Consider landmarks, natural features, and scenic overlooks
- The first waypoint must be type "takeoff" and the last must be type "rtl"
- Balance scenic interest with reasonable flight time
- Note optimal camera angles and points of interest in waypoint labels`
      }
    };

    const modeConfig = optimizationModes[mission.optimizationMode] || optimizationModes.standard;

    const prompt = `You are an expert eVTOL drone mission planner. Analyze this mission and provide an optimized flight plan using ${modeConfig.title}.

MISSION DATA:
- Drone: ${droneLine} (est. max altitude: ${specs.maxAltitude}m, max speed: ${specs.maxSpeed}km/h, max flight time: ${specs.maxFlightTime}min, max payload: ${specs.maxPayload}kg)
- Scheduled takeoff: ${mission.takeoffDate || 'Not specified'}
- Payload weight: ${mission.loadWeight} ${mission.weightUnit}
- Mission description: ${mission.missionDescription || 'General mission'}
- Total route distance: ${(mission.totalDistance / 1000).toFixed(2)} km
- Optimization Mode: ${modeConfig.title}

WAYPOINTS (user-defined):
${mission.waypoints.map((wp, i) => `  ${i + 1}. [${wp.type}] ${wp.label} — lat: ${wp.lat.toFixed(6)}, lng: ${wp.lng.toFixed(6)}`).join('\n')}

INSTRUCTIONS:
Return a JSON response with EXACTLY this structure (no markdown, no code fences, just raw JSON):
{
  "optimizedWaypoints": [
    { "lat": <number>, "lng": <number>, "altitude_m": <recommended altitude in meters>, "label": "<descriptive label>", "type": "<takeoff|waypoint|rtl>" }
  ],
  "pilotBriefing": {
    "summary": "<2-3 sentence mission overview focusing on ${mission.optimizationMode} optimization>",
    "safetyConsiderations": ["<safety item 1>", "<safety item 2>"],
    "recommendations": ["<recommendation 1>", "<recommendation 2>"],
    "estimatedFlightTime": "<e.g. 12 min>",
    "maxAltitude": "<e.g. 80m>",
    "riskLevel": "<low|medium|high>"
  }
}

OPTIMIZATION RULES (${modeConfig.title}):
${modeConfig.rules}
- Provide practical safety considerations and recommendations
- Consider payload weight impact on flight time and performance
- Be concise but thorough in the briefing
- Explain how your route achieves the ${mission.optimizationMode} optimization goal`;

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

  // ── Map Visualization Controls ──
  _setMapType(type) {
    if (!this._map) return;
    this._currentMapType = type;
    this._map.setMapTypeId(google.maps.MapTypeId[type.toUpperCase()]);
    
    // Update button states
    const d = this._getDom();
    d.mapTypeSelector?.querySelectorAll('.map-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mapType === type);
    });
  },

  _toggle3DView() {
    if (!this._map) return;
    const d = this._getDom();
    this._is3DMode = !this._is3DMode;
    
    if (this._is3DMode) {
      // Enable tilt/3D view
      this._map.setTilt(45);
      this._map.setZoom(Math.min(this._map.getZoom() + 1, 20));
      d.btn3DToggle?.classList.add('active');
    } else {
      // Disable tilt, return to 2D
      this._map.setTilt(0);
      d.btn3DToggle?.classList.remove('active');
    }
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
  },

  // ── Flight Plan Export ──
  _fpCurrentFormat: null,
  _fpCurrentContent: '',
  _fpCurrentFilename: '',

  _openFlightPlanModal() {
    if (this._markers.length < 2) {
      this._showErrorToast('Add at least 2 waypoints to generate a flight plan.');
      return;
    }
    const d = this._getDom();
    this._fpShowFormatSelection();
    d.fpOverlay.classList.add('visible');
  },

  _closeFlightPlanModal() {
    const d = this._getDom();
    d.fpOverlay.classList.remove('visible');
    this._fpCurrentFormat = null;
    this._fpCurrentContent = '';
  },

  _fpShowFormatSelection() {
    const d = this._getDom();
    d.fpFormatCards.style.display = '';
    d.fpOutput.style.display = 'none';
  },

  _fpSelectFormat(format) {
    this._fpCurrentFormat = format;
    const d = this._getDom();

    let content, title, filename;
    if (format === 'ardupilot') {
      content = this._generateArduPilotWaypoints();
      title = 'ArduPilot Waypoint File';
      filename = `helios-mission-${new Date().toISOString().slice(0, 10)}.waypoints`;
    } else {
      content = this._generateGeneralCSV();
      title = 'General Waypoints (CSV)';
      filename = `helios-mission-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    this._fpCurrentContent = content;
    this._fpCurrentFilename = filename;

    d.fpFormatCards.style.display = 'none';
    d.fpOutput.style.display = '';
    d.fpOutputTitle.textContent = title;
    d.fpOutputCode.textContent = content;
    d.fpCopyLabel.textContent = 'Copy to Clipboard';
  },

  _generateArduPilotWaypoints() {
    // QGC WPL 110 format
    // seq  current  frame  command  p1 p2 p3 p4  lat  lng  alt  autocontinue
    // Commands: 16=NAV_WAYPOINT, 22=NAV_TAKEOFF, 20=NAV_RETURN_TO_LAUNCH
    const lines = ['QGC WPL 110'];

    // Line 0: Home position (first marker, ground level)
    const home = this._markers[0].getPosition();
    const homeAlt = this._markers[0]._wpAlt || 0;
    lines.push(`0\t1\t0\t16\t0\t0\t0\t0\t${home.lat().toFixed(7)}\t${home.lng().toFixed(7)}\t${homeAlt.toFixed(6)}\t1`);

    // Line 1: Takeoff command
    const takeoffAlt = this._markers.length > 1 && this._markers[1]._wpAlt ? this._markers[1]._wpAlt : 20;
    lines.push(`1\t0\t3\t22\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t${takeoffAlt.toFixed(6)}\t1`);

    // Lines 2..N-1: Waypoints (skip first marker which is home/takeoff, skip last if it's RTL)
    let seq = 2;
    const lastIdx = this._markers.length - 1;
    for (let i = 1; i < this._markers.length; i++) {
      const m = this._markers[i];
      // If last marker is RTL type, we'll add the RTL command instead
      if (i === lastIdx && m._wpType === 'rtl') continue;
      const pos = m.getPosition();
      const alt = m._wpAlt || 22;
      lines.push(`${seq}\t0\t3\t16\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t${pos.lat().toFixed(8)}\t${pos.lng().toFixed(8)}\t${alt.toFixed(6)}\t1`);
      seq++;
    }

    // Final line: RTL command
    lines.push(`${seq}\t0\t0\t20\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t0.00000000\t0.000000\t1`);

    return lines.join('\n');
  },

  _generateGeneralCSV() {
    // Standard CSV with headers — importable by most GCS software
    const headers = 'seq,type,latitude,longitude,altitude_m,label';
    const rows = this._markers.map((m, i) => {
      const pos = m.getPosition();
      const alt = m._wpAlt || (m._wpType === 'takeoff' || m._wpType === 'rtl' ? 0 : 22);
      const label = m.getTitle().replace(/,/g, ';');
      return `${i},${m._wpType},${pos.lat().toFixed(8)},${pos.lng().toFixed(8)},${alt},${label}`;
    });

    // Add summary comment block at the top
    const dist = this._computeDistance();
    const distStr = dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m';
    const meta = [
      `# Helios Flight Plan — Generated ${new Date().toISOString()}`,
      `# Waypoints: ${this._markers.length}`,
      `# Total Distance: ${distStr}`,
      '#'
    ];

    return [...meta, headers, ...rows].join('\n');
  },

  async _fpCopyToClipboard() {
    const d = this._getDom();
    try {
      await navigator.clipboard.writeText(this._fpCurrentContent);
      d.fpCopyLabel.textContent = 'Copied!';
      setTimeout(() => { d.fpCopyLabel.textContent = 'Copy to Clipboard'; }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  },

  async _fpDownloadFile() {
    const ext = this._fpCurrentFormat === 'ardupilot' ? 'waypoints' : 'csv';
    const filterName = this._fpCurrentFormat === 'ardupilot' ? 'Waypoint Files' : 'CSV Files';
    try {
      const result = await window.helios.saveFile({
        content: this._fpCurrentContent,
        defaultName: this._fpCurrentFilename,
        filters: [{ name: filterName, extensions: [ext] }, { name: 'All Files', extensions: ['*'] }]
      });
      if (result.success) {
        this._closeFlightPlanModal();
      }
    } catch (err) {
      console.error('Download failed:', err);
    }
  },

  // ── Load Waypoints from File ──
  async _loadWaypointsFromFile() {
    try {
      const result = await window.helios.openFile({
        title: 'Load Waypoints',
        filters: [
          { name: 'Waypoint Files', extensions: ['waypoints'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (!result.success) return;
      const waypoints = this._parseWaypointFile(result.content);
      if (!waypoints || waypoints.length === 0) {
        this._showErrorToast('No valid waypoints found in the file.');
        return;
      }
      // Clear existing waypoints and add parsed ones
      this.clearWaypoints();
      for (const wp of waypoints) {
        this._addWaypoint(wp.lat, wp.lng, wp.alt);
      }
      // Pan map to first waypoint
      if (this._map && waypoints.length > 0) {
        this._map.panTo({ lat: waypoints[0].lat, lng: waypoints[0].lng });
        if (waypoints.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          waypoints.forEach(wp => bounds.extend({ lat: wp.lat, lng: wp.lng }));
          this._map.fitBounds(bounds, 80);
        }
      }
    } catch (err) {
      console.error('Load waypoints failed:', err);
      this._showErrorToast('Failed to load waypoint file.');
    }
  },

  _parseWaypointFile(content) {
    // Parse QGC WPL 110 format
    const lines = content.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return null;

    // Verify header
    const header = lines[0].trim();
    if (!header.startsWith('QGC WPL')) {
      this._showErrorToast('Invalid file: expected QGC WPL format header.');
      return null;
    }

    const waypoints = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\t+/);
      if (parts.length < 12) continue;

      const cmd = parseInt(parts[3]);
      const lat = parseFloat(parts[8]);
      const lng = parseFloat(parts[9]);
      const alt = parseFloat(parts[10]);

      // cmd 16 = NAV_WAYPOINT, 22 = NAV_TAKEOFF, 20 = NAV_RETURN_TO_LAUNCH
      if (cmd === 20) {
        // RTL — use home position coordinates if lat/lng are zero
        if (lat === 0 && lng === 0 && waypoints.length > 0) {
          waypoints.push({ lat: waypoints[0].lat, lng: waypoints[0].lng, alt: alt || 0 });
        } else if (lat !== 0 || lng !== 0) {
          waypoints.push({ lat, lng, alt: alt || 0 });
        }
        continue;
      }

      if (cmd === 22) {
        // Takeoff — skip if lat/lng are 0 (altitude-only command)
        if (lat === 0 && lng === 0) continue;
        waypoints.push({ lat, lng, alt });
        continue;
      }

      if (cmd === 16) {
        // NAV_WAYPOINT — skip if lat/lng are both 0 (placeholder home)
        if (lat === 0 && lng === 0) continue;
        waypoints.push({ lat, lng, alt });
      }
    }

    return waypoints;
  }
};
