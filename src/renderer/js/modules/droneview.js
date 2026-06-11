/* ── DroneView Module — Multi-Drone Live Tracking, Simulation & AI Analysis ── */
import { state } from '../state.js';
import { getMapStyles, createMarkerIcon, createAiMarkerIcon, createDroneIcon, createDroneOrb3D, haversine, bearing } from '../utils/maps.js';
import { createDroneModelOverlay } from '../utils/drone-model-overlay.js';
import { callAI, getAIProviderLabel } from '../services/ai.js';
import { weatherCodeToInfo, windDirToCompass } from '../services/weather.js';
import { loadGoogleMaps } from '../services/maps-loader.js';

// ── Injected callback (set via init) ──
let _navigate = null;

// ── Drone color palette for map markers ──
const DRONE_COLORS = ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

// Default demo waypoint sets (San Francisco area — each demo gets different routes)
const DEMO_ROUTES = [
  [
    { lat: 37.7749, lng: -122.4194, label: 'Take Off', type: 'takeoff', alt: 0 },
    { lat: 37.7820, lng: -122.4060, label: 'WP 1 — Financial District', type: 'waypoint', alt: 85 },
    { lat: 37.7900, lng: -122.3950, label: 'WP 2 — Embarcadero', type: 'waypoint', alt: 110 },
    { lat: 37.8025, lng: -122.4058, label: 'WP 3 — Fisherman\'s Wharf', type: 'waypoint', alt: 95 },
    { lat: 37.8080, lng: -122.4177, label: 'WP 4 — Ghirardelli Square', type: 'waypoint', alt: 75 },
    { lat: 37.7990, lng: -122.4310, label: 'WP 5 — Marina', type: 'waypoint', alt: 60 },
    { lat: 37.7749, lng: -122.4194, label: 'Return to Launch', type: 'rtl', alt: 0 }
  ],
  [
    { lat: 37.7694, lng: -122.4862, label: 'Take Off', type: 'takeoff', alt: 0 },
    { lat: 37.7699, lng: -122.4769, label: 'WP 1 — Golden Gate Park East', type: 'waypoint', alt: 70 },
    { lat: 37.7695, lng: -122.4656, label: 'WP 2 — Conservatory of Flowers', type: 'waypoint', alt: 90 },
    { lat: 37.7677, lng: -122.4530, label: 'WP 3 — Haight-Ashbury', type: 'waypoint', alt: 80 },
    { lat: 37.7619, lng: -122.4350, label: 'WP 4 — Twin Peaks Base', type: 'waypoint', alt: 120 },
    { lat: 37.7694, lng: -122.4862, label: 'Return to Launch', type: 'rtl', alt: 0 }
  ],
  [
    { lat: 37.7850, lng: -122.4093, label: 'Take Off', type: 'takeoff', alt: 0 },
    { lat: 37.7955, lng: -122.3935, label: 'WP 1 — Pier 39', type: 'waypoint', alt: 65 },
    { lat: 37.8070, lng: -122.4100, label: 'WP 2 — Aquatic Park', type: 'waypoint', alt: 85 },
    { lat: 37.8199, lng: -122.4783, label: 'WP 3 — Golden Gate Bridge', type: 'waypoint', alt: 100 },
    { lat: 37.7850, lng: -122.4093, label: 'Return to Launch', type: 'rtl', alt: 0 }
  ]
];

const DEMO_NAMES = ['Demo Alpha', 'Demo Bravo', 'Demo Charlie'];
const DEMO_MODELS = ['Helios X1 — Recon', 'Helios X2 — Surveyor', 'Helios X3 — Scout'];
const MAX_DEMO_DRONES = 3;
const GRAPH_STORAGE_KEY = 'helios.droneview.graphWidgets';
const RAW_STREAM_LOG_LIMIT = 400;
const DEFAULT_GRAPH_WIDGETS = ['altitude', 'speed', 'battery', 'heading'];
const GRAPH_WIDGETS = {
  altitude: { canvasId: 'dvGraphAltitude', label: 'Altitude', unit: 'm', color: '#60a5fa', suggestedMin: 0 },
  speed: { canvasId: 'dvGraphSpeed', label: 'Speed', unit: 'km/h', color: '#22c55e', suggestedMin: 0 },
  battery: { canvasId: 'dvGraphBattery', label: 'Battery', unit: '%', color: '#f59e0b', min: 0, max: 100 },
  heading: { canvasId: 'dvGraphHeading', label: 'Heading', unit: 'deg', color: '#a78bfa', min: 0, max: 360 },
  verticalRate: { canvasId: 'dvGraphVerticalRate', label: 'Vertical Rate', unit: 'm/s', color: '#38bdf8' },
  distance: { canvasId: 'dvGraphDistance', label: 'Distance', unit: 'm', color: '#f472b6', suggestedMin: 0 }
};

export const DroneView = {
  // ── Shared map state ──
  _map: null,
  _loadAttempted: false,
  _mapsReady: false,
  _currentMapType: 'roadmap',
  _is3DMode: false,       // true when any 3D mode is active
  _3dModeType: null,      // null | 'classic' | 'photorealistic'
  _autoFollowDrone: true,
  _dom: null,
  _weatherInterval: null,

  // ── 3D (Map3DElement) state ──
  _map3d: null,
  _map3dReady: false,             // true after gmp-ready fires on Map3DElement
  _3dMarkers: new Map(),          // drone ID → Marker3DElement
  _3dRoutePolylines: new Map(),   // drone ID → Polyline3DElement (route)
  _3dTrailPolylines: new Map(),   // drone ID → Polyline3DElement (trail)
  _3dTrailCoords: new Map(),      // drone ID → [{lat,lng,altitude}] array
  _3dWaypointMarkers: [],         // array of waypoint Marker3DElements

  // ── Drone registry: Map<string, DroneEntry> ──
  // key = "demo-0", "demo-1", "demo-2", or "live-<fleet_id>"
  _drones: new Map(),
  _activeDroneId: null, // key of drone whose data is in the left panel
  _nextDemoIndex: 0,
  _graphCharts: new Map(),
  _visibleGraphWidgets: new Set(DEFAULT_GRAPH_WIDGETS),
  _graphsOpen: false,
  _graphsDrag: null,
  _graphsMode: 'charts',
  _rawLogRenderFrame: null,

  // ══════════════════════════════════════════
  //  DOM CACHE
  // ══════════════════════════════════════════

  _getDom() {
    if (this._dom) return this._dom;
    this._dom = {
      // Interstitial
      interstitial: document.getElementById('dvInterstitial'),
      dvContainer: document.getElementById('dvContainer'),
      dvDroneSelect: document.getElementById('dvDroneSelect'),
      dvWpSection: document.getElementById('dvInterstitialWpSection'),
      dvLoadWpBtn: document.getElementById('dvLoadWaypointsBtn'),
      dvWpFileStatus: document.getElementById('dvWaypointFileStatus'),
      dvLaunchBtn: document.getElementById('dvLaunchBtn'),
      dvAddDroneBtn: document.getElementById('dvAddDroneBtn'),
      dvViewFleetBtn: document.getElementById('dvViewFleetBtn'),
      droneIdLabel: document.getElementById('dvDroneIdLabel'),
      // Drone chips bar
      droneChipsBar: document.getElementById('dvDroneChipsBar'),
      // Map
      mapEl: document.getElementById('droneviewMap'),
      dvMapTypeSelector: document.getElementById('dvMapTypeSelector'),
      dvBtn3DToggle: document.getElementById('dvBtn3DToggle'),
      dv3DSelector: document.getElementById('dv3DSelector'),
      dv3DDropdown: document.getElementById('dv3DDropdown'),
      dvBtnFollowToggle: document.getElementById('dvBtnFollowToggle'),
      btnCompleteMission: document.getElementById('dvCompleteMissionBtn'),
      graphsDrawer: document.getElementById('dvGraphsDrawer'),
      graphsFlap: document.getElementById('dvGraphsFlap'),
      graphsMeta: document.getElementById('dvGraphsMeta'),
      graphsSubtitle: document.getElementById('dvGraphsSubtitle'),
      graphsSampleCount: document.getElementById('dvGraphsSampleCount'),
      graphsWindow: document.getElementById('dvGraphsWindow'),
      graphsActiveCount: document.getElementById('dvGraphsActiveCount'),
      graphsRawBtn: document.getElementById('dvGraphsRawBtn'),
      graphsWidgetBtn: document.getElementById('dvGraphsWidgetBtn'),
      graphsWidgetMenu: document.getElementById('dvGraphsWidgetMenu'),
      graphsGrid: document.getElementById('dvGraphsGrid'),
      rawStreamPanel: document.getElementById('dvRawStreamPanel'),
      rawStreamLog: document.getElementById('dvRawStreamLog'),
      rawStreamMeta: document.getElementById('dvRawStreamMeta'),
      rawStreamClear: document.getElementById('dvRawStreamClear'),
      // Telemetry
      altitude: document.getElementById('dvAltitude'),
      speed: document.getElementById('dvSpeed'),
      heading: document.getElementById('dvHeading'),
      battery: document.getElementById('dvBattery'),
      batteryFill: document.getElementById('dvBatteryFill'),
      lat: document.getElementById('dvLat'),
      lng: document.getElementById('dvLng'),
      // Progress
      progressPct: document.getElementById('dvProgressPct'),
      progressFill: document.getElementById('dvProgressFill'),
      // Weather
      weatherIcon: document.getElementById('dvWeatherIcon'),
      weatherCondition: document.getElementById('dvWeatherCondition'),
      weatherTemp: document.getElementById('dvWeatherTemp'),
      weatherWind: document.getElementById('dvWeatherWind'),
      weatherWindDir: document.getElementById('dvWeatherWindDir'),
      weatherRain: document.getElementById('dvWeatherRain'),
      weatherVis: document.getElementById('dvWeatherVis'),
      // Waypoints
      waypointList: document.getElementById('dvWaypointList'),
      // AI panels
      loadingOverlay: document.getElementById('dvLoadingOverlay'),
      analysisPanel: document.getElementById('dvAnalysisPanel'),
      analysisBody: document.getElementById('dvAnalysisBody'),
      btnCloseAnalysis: document.getElementById('btnCloseAnalysis'),
      routeBar: document.getElementById('dvRouteBar'),
      btnDismissRoutes: document.getElementById('btnDismissRoutes'),
      btnAcceptRoute: document.getElementById('btnAcceptRoute'),
      // AI buttons
      btnFlightAnalysis: document.getElementById('btnFlightAnalysis'),
      btnAltRoutes: document.getElementById('btnAltRoutes'),
      // Collapse / Expand
      telemetryPanel: document.getElementById('dvTelemetryPanel'),
      btnCollapse: document.getElementById('btnCollapseTelemetry'),
      btnExpand: document.getElementById('btnExpandTelemetry'),
      // Mission complete
      missionCompleteOverlay: document.getElementById('dvMissionComplete'),
      mcDuration: document.getElementById('dvMcDuration'),
      mcDistance: document.getElementById('dvMcDistance'),
      mcBattery: document.getElementById('dvMcBattery'),
      btnViewReport: document.getElementById('btnViewReport'),
      btnRestartMission: document.getElementById('btnRestartMission'),
      // Flight report
      btnGenerateReport: document.getElementById('btnGenerateReport')
    };
    return this._dom;
  },

  // ══════════════════════════════════════════
  //  LIFECYCLE
  // ══════════════════════════════════════════

  init({ navigate } = {}) {
    _navigate = navigate;
    const d = this._getDom();

    // Interstitial events
    d.dvDroneSelect.addEventListener('change', () => this._onDroneSelectChange());
    d.dvLoadWpBtn.addEventListener('click', () => this._loadWaypointsFromFileInterstitial());
    d.dvLaunchBtn.addEventListener('click', () => this._launchDroneView());
    d.dvAddDroneBtn?.addEventListener('click', () => this._showInterstitial());
    d.dvViewFleetBtn?.addEventListener('click', () => this._viewEntireFleet());
    // Map visualization controls (3D immersive view)
    d.dvMapTypeSelector?.querySelectorAll('.map-type-btn').forEach(btn => {
      btn.addEventListener('click', () => this._setMapType(btn.dataset.mapType));
    });
    d.dvBtn3DToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._is3DMode) {
        // If already in 3D, clicking the main button exits 3D
        this._set3DMode(null);
        d.dv3DSelector?.classList.remove('open');
      } else {
        // Toggle dropdown open/closed
        d.dv3DSelector?.classList.toggle('open');
      }
    });
    d.dv3DDropdown?.querySelectorAll('.dv-3d-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        d.dv3DSelector?.classList.remove('open');
        this._set3DMode(mode);
      });
    });
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', () => d.dv3DSelector?.classList.remove('open'));
    d.dvBtnFollowToggle?.addEventListener('click', () => this._toggleFollowDrone());
    d.btnCompleteMission?.addEventListener('click', () => this._markMissionCompleteFromControl());
    this._initGraphsDrawer();

    d.btnFlightAnalysis?.addEventListener('click', () => this._requestFlightAnalysis());
    d.btnAltRoutes?.addEventListener('click', () => this._requestAltRoutes());
    d.btnCloseAnalysis?.addEventListener('click', () => d.analysisPanel.classList.remove('visible'));
    d.btnDismissRoutes?.addEventListener('click', () => this._dismissAltRoutes());
    d.btnAcceptRoute?.addEventListener('click', () => this._acceptAltRoute());
    d.btnCollapse?.addEventListener('click', () => this._togglePanel(false));
    d.btnExpand?.addEventListener('click', () => this._togglePanel(true));

    d.btnGenerateReport?.addEventListener('click', () => {
      console.log('[DroneView] Generate Report button clicked, activeDroneId:', this._activeDroneId);
      this._generateReportForActiveDrone();
    });

    d.btnViewReport?.addEventListener('click', () => {
      this._generateReportForActiveDrone();
    });
    d.btnRestartMission?.addEventListener('click', () => {
      this._restartMissionForActiveDrone();
    });
  },

  async onEnter() {
    // Update AI provider badge
    const badge = document.getElementById('dvAiBadge');
    if (badge) badge.textContent = getAIProviderLabel();

    // Restore 3D body class if 3D mode is still active
    if (this._is3DMode) document.body.classList.add('dv-3d-active');

    // If no drones active, show interstitial
    if (this._drones.size === 0) {
      this._showInterstitial();
      await this._populateDroneSelect();
    } else {
      // Return to the view with existing drones
      this._hideInterstitial();
      if (this._map && this._3dModeType !== 'photorealistic') {
        google.maps.event.trigger(this._map, 'resize');
      }
    }
    this._updateMissionCompleteControl(this._getActiveDrone());
    this._updateGraphs(this._getActiveDrone());
  },

  onLeave() {
    // Don't destroy drones — keep simulations/websockets running
    // Stop weather polling though
    if (this._weatherInterval) {
      clearInterval(this._weatherInterval);
      this._weatherInterval = null;
    }
    // Remove 3D body class so nav-bar styling doesn't leak to other pages
    document.body.classList.remove('dv-3d-active');
    // Note: we keep the 3D map alive so it can be restored on re-enter
  },

  /** Called by Theme when theme changes. */
  updateMapStyles() {
    if (this._map) {
      this._map.setOptions({ styles: getMapStyles() });
    }
  },

  // ── External API (from Missions) ──
  setMissionWaypoints(waypoints) {
    const active = this._getActiveDrone();
    if (!active) return;
    const normalized = this._normalizeMissionWaypoints(waypoints);
    if (normalized.length < 2) return;
    active.waypoints = normalized;
    this._resetDroneTelemetry(active);
    if (this._mapsReady && this._map) {
      this._applyDroneWaypointsToMap(active, { restart: state.activePage === 'droneview' && active.mode === 'demo' });
      this._selectDrone(active.id);
    }
  },

  // ══════════════════════════════════════════
  //  DRONE ENTRY FACTORY
  // ══════════════════════════════════════════

  _createDroneEntry({ id, mode, name, model, hostname, fleetId, waypoints, color }) {
    return {
      id,
      mode,         // 'demo' | 'live'
      name,
      model,
      hostname: hostname || null,
      fleetId: fleetId || null,
      color,
      waypoints: waypoints || [],
      telemetry: { altitude: 0, speed: 0, heading: 0, battery: 100, lat: 0, lng: 0 },
      // Simulation state
      simInterval: null,
      simIndex: 0,
      simFraction: 0,
      missionStartTime: null,
      missionComplete: false,
      flightLog: [],
      track: [],            // sampled telemetry for replay: { t, lat, lng, alt, speed, heading, battery }
      trackSampleTime: 0,
      rawStreamLog: [],
      // Map objects
      droneMarker: null,
      routePolyline: null,
      trailPolyline: null,
      waypointMarkers: [],
      // WebSocket (live only)
      ws: null,
      wsReconnectTimer: null,
      lastWsPosition: null,
      lastWsTime: null,
      trailThrottleTime: 0,
      visitedWaypoints: new Set(),
      liveWaypointRadius: 50,
      mapCenteredOnLive: false,
      // AI
      lastAltRoutes: null,
      altRoutePolylines: [],
      altRouteMarkers: []
    };
  },

  _getActiveDrone() {
    return this._activeDroneId ? this._drones.get(this._activeDroneId) : null;
  },

  _getColor(index) {
    return DRONE_COLORS[index % DRONE_COLORS.length];
  },

  // ══════════════════════════════════════════
  //  INTERSTITIAL
  // ══════════════════════════════════════════

  _showInterstitial() {
    const d = this._getDom();
    d.interstitial.style.display = '';
    // Only hide container if no drones yet
    if (this._drones.size === 0) {
      d.dvContainer.style.display = 'none';
    }
    // Reset file status
    this._loadedWaypoints = null;
    d.dvWpFileStatus.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg><span>Load a .waypoints file to display the mission route on the map</span>';
    d.dvWpFileStatus.classList.remove('loaded');
    d.dvLoadWpBtn.classList.remove('loaded');
    d.dvLoadWpBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg> Load Waypoints File';
    // Update launch button text
    d.dvLaunchBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 4.5v15m7.5-7.5h-15"/></svg> Add Drone to View`;
  },

  _hideInterstitial() {
    const d = this._getDom();
    d.interstitial.style.display = 'none';
    d.dvContainer.style.display = '';
  },

  async _populateDroneSelect() {
    const d = this._getDom();
    const select = d.dvDroneSelect;
    // Build options
    let html = '';

    // Demo option (only if under max)
    const demoCount = [...this._drones.values()].filter(e => e.mode === 'demo').length;
    if (demoCount < MAX_DEMO_DRONES) {
      html += `<option value="demo">Demo Drone — ${DEMO_NAMES[this._nextDemoIndex % MAX_DEMO_DRONES]} (Simulated)</option>`;
    }

    try {
      const drones = await window.helios.fleetGetAll();
      if (drones.length > 0) {
        html += `<optgroup label="Your Fleet">`;
        drones.forEach(drone => {
          // Don't show drones already added
          const alreadyAdded = this._drones.has(`live-${drone.id}`);
          const disabled = alreadyAdded ? 'disabled' : '';
          const suffix = alreadyAdded ? ' (already viewing)' : '';
          html += `<option value="${drone.id}" ${disabled}
            data-hostname="${drone.hostname || ''}"
            data-drone-name="${drone.name || ''}"
            data-drone-model="${drone.model || ''}"
            data-drone-type="${drone.drone_type || ''}"
          >${drone.name}${drone.model ? ' — ' + drone.model : ''}${suffix}</option>`;
        });
        html += `</optgroup>`;
      }
    } catch (err) {
      console.warn('Failed to load fleet drones for drone view:', err);
    }

    select.innerHTML = html;
    this._onDroneSelectChange();
  },

  _onDroneSelectChange() {
    const d = this._getDom();
    const isDemo = d.dvDroneSelect.value === 'demo';
    d.dvWpSection.style.display = isDemo ? 'none' : '';
  },

  // ── View Entire Fleet ──
  async _viewEntireFleet() {
    try {
      const drones = await window.helios.fleetGetAll();
      if (!drones || drones.length === 0) {
        this._showError('No drones found in your fleet. Add drones in the Fleet page first.');
        return;
      }

      for (const drone of drones) {
        const key = `live-${drone.id}`;
        if (this._drones.has(key)) continue; // skip already added

        const color = this._getColor(this._drones.size);
        const entry = this._createDroneEntry({
          id: key,
          mode: 'live',
          name: drone.name,
          model: drone.model || '',
          hostname: drone.hostname,
          fleetId: drone.id,
          waypoints: [],
          color
        });
        this._drones.set(key, entry);
      }

      this._hideInterstitial();
      await this._ensureMap();
      // Add all new drones to the map
      for (const [, entry] of this._drones) {
        if (!entry.droneMarker) {
          this._addDroneToMap(entry);
          if (entry.mode === 'live') this._connectWebSocket(entry);
        }
      }
      this._renderDroneChips();
      // Select the first live drone
      const firstLive = [...this._drones.values()].find(e => e.mode === 'live');
      if (firstLive) this._selectDrone(firstLive.id);
    } catch (err) {
      console.error('Failed to view entire fleet:', err);
      this._showError('Failed to load fleet: ' + err.message);
    }
  },

  // ── Waypoint File Loading (Interstitial) ──
  _loadedWaypoints: null,

  async _loadWaypointsFromFileInterstitial() {
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
        this._showInterstitialError('No valid waypoints found in file.');
        return;
      }

      this._loadedWaypoints = waypoints;

      const d = this._getDom();
      d.dvLoadWpBtn.classList.add('loaded');
      d.dvLoadWpBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4.5 12.75l6 6 9-13.5"/></svg> ${waypoints.length} Waypoints Loaded`;
      d.dvWpFileStatus.classList.add('loaded');
      d.dvWpFileStatus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span>Ready — ${waypoints.length} waypoints from ${result.path.split('/').pop()}</span>`;
    } catch (err) {
      console.error('Load waypoints failed:', err);
      this._showInterstitialError('Failed to load waypoint file.');
    }
  },

  _parseWaypointFile(content) {
    const lines = content.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return null;
    const header = lines[0].trim();
    if (!header.startsWith('QGC WPL')) {
      this._showInterstitialError('Invalid file: expected QGC WPL format header.');
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
      if (cmd === 20) {
        if (lat === 0 && lng === 0 && waypoints.length > 0) {
          waypoints.push({ lat: waypoints[0].lat, lng: waypoints[0].lng, alt: alt || 0 });
        } else if (lat !== 0 || lng !== 0) {
          waypoints.push({ lat, lng, alt: alt || 0 });
        }
        continue;
      }
      if (cmd === 22) {
        if (lat === 0 && lng === 0) continue;
        waypoints.push({ lat, lng, alt });
        continue;
      }
      if (cmd === 16) {
        if (lat === 0 && lng === 0) continue;
        waypoints.push({ lat, lng, alt });
      }
    }
    return waypoints;
  },

  _showInterstitialError(msg) {
    const d = this._getDom();
    d.dvWpFileStatus.classList.remove('loaded');
    d.dvWpFileStatus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg><span style="color:#ef4444;">${msg}</span>`;
  },

  // ── Launch / Add Drone ──
  async _launchDroneView() {
    const d = this._getDom();
    const isDemo = d.dvDroneSelect.value === 'demo';
    let entry;

    if (isDemo) {
      const demoIdx = this._nextDemoIndex % MAX_DEMO_DRONES;
      const id = `demo-${demoIdx}`;

      // Block if already exists
      if (this._drones.has(id)) {
        this._showError('This demo drone is already active.');
        return;
      }

      const waypoints = DEMO_ROUTES[demoIdx].map(w => ({ ...w }));
      const color = this._getColor(this._drones.size);
      entry = this._createDroneEntry({
        id,
        mode: 'demo',
        name: DEMO_NAMES[demoIdx],
        model: DEMO_MODELS[demoIdx],
        waypoints,
        color
      });
      // Set initial telemetry at launch point
      entry.telemetry.lat = waypoints[0].lat;
      entry.telemetry.lng = waypoints[0].lng;
      this._nextDemoIndex++;
    } else {
      const droneId = parseInt(d.dvDroneSelect.value, 10);
      const key = `live-${droneId}`;
      if (this._drones.has(key)) {
        this._showError('This drone is already in the view.');
        return;
      }

      const opt = d.dvDroneSelect.options[d.dvDroneSelect.selectedIndex];
      const waypoints = this._loadedWaypoints
        ? this._normalizeMissionWaypoints(this._loadedWaypoints)
        : [];
      const color = this._getColor(this._drones.size);

      entry = this._createDroneEntry({
        id: key,
        mode: 'live',
        name: opt.dataset.droneName || opt.textContent,
        model: opt.dataset.droneModel || '',
        hostname: opt.dataset.hostname,
        fleetId: droneId,
        waypoints,
        color
      });

      if (waypoints.length > 0) {
        entry.telemetry.lat = waypoints[0].lat;
        entry.telemetry.lng = waypoints[0].lng;
      }
    }

    this._drones.set(entry.id, entry);
    this._hideInterstitial();

    await this._ensureMap();
    this._addDroneToMap(entry);

    if (entry.mode === 'demo') {
      this._startSimulation(entry);
    } else {
      this._connectWebSocket(entry);
    }

    this._renderDroneChips();
    this._selectDrone(entry.id);
    this._fitMapToAllDrones();
    this._fetchLiveWeather();
  },

  // ══════════════════════════════════════════
  //  MAP
  // ══════════════════════════════════════════

  async _ensureMap() {
    if (this._mapsReady && this._map) return;
    if (!this._loadAttempted) {
      this._loadAttempted = true;
      const loaded = await loadGoogleMaps();
      if (loaded) {
        this._mapsReady = true;
        this._initMap();
      }
    }
  },

  _initMap() {
    const d = this._getDom();
    this._map = new google.maps.Map(d.mapEl, {
      center: { lat: 37.7900, lng: -122.4100 },
      zoom: 14,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: getMapStyles(),
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
      clickableIcons: false
    });
    // Re-center on drone after zoom completes so follow works at all zoom levels
    this._map.addListener('zoom_changed', () => {
      if (this._autoFollowDrone) {
        // Defer to after zoom animation finishes
        google.maps.event.addListenerOnce(this._map, 'idle', () => {
          this._centerMapOnActiveDrone();
        });
      }
    });
  },

  _setMapType(type) {
    if (!this._map) return;
    this._currentMapType = type;
    this._map.setMapTypeId(google.maps.MapTypeId[type.toUpperCase()]);
    const d = this._getDom();
    d.dvMapTypeSelector?.querySelectorAll('.map-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mapType === type);
    });
  },

  async _set3DMode(mode) {
    if (!this._map) return;
    const d = this._getDom();

    // ── Exit current 3D mode first (if any) ──
    if (this._is3DMode) {
      if (this._3dModeType === 'photorealistic') {
        this._removeAll3DElements();
        if (this._map3d) { this._map3d.remove(); this._map3d = null; }
        this._map3dReady = false;
        d.mapEl.classList.remove('hidden-for-3d');
        google.maps.event.trigger(this._map, 'resize');
      } else if (this._3dModeType === 'classic') {
        this._map.setTilt(0);
        this._map.setHeading(0);
      }
      this._is3DMode = false;
      this._3dModeType = null;
      d.dv3DSelector?.classList.remove('active');
      document.body.classList.remove('dv-3d-active');
      d.dv3DDropdown?.querySelectorAll('.dv-3d-option').forEach(o => o.classList.remove('active'));
    }

    // If mode is null we just wanted to exit — done
    if (!mode) return;

    // ── Enter new 3D mode ──
    if (mode === 'classic') {
      // Classic 3D: tilt the satellite map at 45°
      this._setMapType('satellite');
      this._map.setTilt(45);
      this._map.setZoom(Math.max(this._map.getZoom(), 17));
      this._is3DMode = true;
      this._3dModeType = 'classic';
    } else if (mode === 'photorealistic') {
      // Photorealistic 3D: Map3DElement (Google preview API)
      try {
        await google.maps.importLibrary('maps3d');
      } catch (err) {
        console.warn('[DroneView] Failed to load maps3d library:', err);
        this._showError('Photorealistic 3D not available. Check your API key or try Classic 3D instead.');
        return;
      }

      d.mapEl.classList.add('hidden-for-3d');

      const active = this._getActiveDrone();
      const lat = active?.telemetry?.lat || 37.79;
      const lng = active?.telemetry?.lng || -122.41;
      const alt = active?.telemetry?.altitude || 80;

      const map3d = document.createElement('gmp-map-3d');
      map3d.setAttribute('center', `${lat},${lng},${alt}`);
      map3d.setAttribute('tilt', '67');
      map3d.setAttribute('range', '1500');
      map3d.setAttribute('heading', '0');
      map3d.setAttribute('mode', 'HYBRID');
      d.mapEl.parentElement.appendChild(map3d);
      this._map3d = map3d;
      this._map3dReady = true;

      for (const [, entry] of this._drones) {
        this._addDroneTo3D(entry);
      }

      this._is3DMode = true;
      this._3dModeType = 'photorealistic';
    }

    // Update UI
    d.dv3DSelector?.classList.add('active');
    document.body.classList.add('dv-3d-active');
    const activeOpt = d.dv3DDropdown?.querySelector(`.dv-3d-option[data-mode="${mode}"]`);
    activeOpt?.classList.add('active');
  },

  // ── 3D Helpers ──

  _create3DMarker(position, svgDataUri, altitudeM) {
    const { Marker3DElement } = google.maps.maps3d;
    const marker = new Marker3DElement({
      position: { lat: position.lat, lng: position.lng, altitude: altitudeM || 0 },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      sizePreserved: true,
      collisionBehavior: 'REQUIRED'
    });

    // Parse inline SVG from data URI and embed as real SVG element (per Google docs pattern)
    const template = document.createElement('template');
    try {
      const svgText = decodeURIComponent(svgDataUri.split(',')[1]);
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = svgDoc.documentElement;
      svgEl.style.width = '40px';
      svgEl.style.height = '40px';
      template.content.append(svgEl);
    } catch {
      // Fallback: use img tag with the data URI
      const img = document.createElement('img');
      img.src = svgDataUri;
      img.style.width = '40px';
      img.style.height = '40px';
      template.content.append(img);
    }
    marker.append(template);
    return marker;
  },

  _addDroneTo3D(entry) {
    if (!this._map3d) return;
    const { Polyline3DElement } = google.maps.maps3d;

    const lat = entry.telemetry?.lat || entry.waypoints[0]?.lat || 37.79;
    const lng = entry.telemetry?.lng || entry.waypoints[0]?.lng || -122.41;
    const alt = entry.telemetry?.altitude || entry.waypoints[0]?.alt || 80;

    // Drone marker (glowing orb for 3D view)
    const droneMarker = this._create3DMarker(
      { lat, lng }, createDroneOrb3D(entry.color), alt
    );
    this._map3d.append(droneMarker);
    this._3dMarkers.set(entry.id, droneMarker);

    // Route polyline
    if (entry.waypoints.length > 1) {
      const routePoly = new Polyline3DElement({
        altitudeMode: 'RELATIVE_TO_GROUND',
        strokeColor: entry.color,
        strokeWidth: 4,
        drawsOccludedSegments: true
      });
      routePoly.path = entry.waypoints.map(w => ({ lat: w.lat, lng: w.lng, altitude: w.alt || 0 }));
      this._map3d.append(routePoly);
      this._3dRoutePolylines.set(entry.id, routePoly);
    }

    // Trail polyline
    const trailPoly = new Polyline3DElement({
      altitudeMode: 'RELATIVE_TO_GROUND',
      strokeColor: entry.color,
      strokeWidth: 4,
      drawsOccludedSegments: true
    });
    // Seed trail from 2D trail path if available
    const seedCoords = [];
    if (entry.trailPolyline) {
      const path2d = entry.trailPolyline.getPath();
      for (let i = 0; i < path2d.getLength(); i++) {
        const pt = path2d.getAt(i);
        seedCoords.push({ lat: pt.lat(), lng: pt.lng(), altitude: alt });
      }
    }
    trailPoly.path = seedCoords;
    this._3dTrailCoords.set(entry.id, [...seedCoords]);
    this._map3d.append(trailPoly);
    this._3dTrailPolylines.set(entry.id, trailPoly);

    // Waypoint markers
    entry.waypoints.forEach((wp, i) => {
      const type = wp.type;
      const label = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
      const wpMarker = this._create3DMarker(
        { lat: wp.lat, lng: wp.lng }, createMarkerIcon(label, type), wp.alt || 0
      );
      this._map3d.append(wpMarker);
      this._3dWaypointMarkers.push(wpMarker);
    });
  },

  _removeAll3DElements() {
    for (const [, m] of this._3dMarkers) m.remove();
    this._3dMarkers.clear();
    for (const [, p] of this._3dRoutePolylines) p.remove();
    this._3dRoutePolylines.clear();
    for (const [, p] of this._3dTrailPolylines) p.remove();
    this._3dTrailPolylines.clear();
    this._3dTrailCoords.clear();
    this._3dWaypointMarkers.forEach(m => m.remove());
    this._3dWaypointMarkers = [];
  },

  _update3DTrail(entry, lat, lng, alt) {
    const coords = this._3dTrailCoords.get(entry.id);
    const poly = this._3dTrailPolylines.get(entry.id);
    if (!coords || !poly) return;
    coords.push({ lat, lng, altitude: alt || 0 });
    poly.path = coords;
  },

  _toggleFollowDrone() {
    this._autoFollowDrone = !this._autoFollowDrone;
    const d = this._getDom();
    d.dvBtnFollowToggle?.classList.toggle('active', this._autoFollowDrone);
    if (this._autoFollowDrone) this._centerMapOnActiveDrone();
  },

  _centerMapOnActiveDrone() {
    const entry = this._getActiveDrone();
    if (!entry || !entry.telemetry.lat || !entry.telemetry.lng) return;
    if (this._is3DMode && this._map3d) {
      const alt = entry.telemetry.altitude || 0;
      this._map3d.center = { lat: entry.telemetry.lat, lng: entry.telemetry.lng, altitude: alt };
    } else if (this._map) {
      this._map.setCenter({ lat: entry.telemetry.lat, lng: entry.telemetry.lng });
    }
  },

  _addDroneToMap(entry) {
    if (!this._map) return;

    // Route polyline
    const routePath = entry.waypoints.map(w => ({ lat: w.lat, lng: w.lng }));
    entry.routePolyline = new google.maps.Polyline({
      map: this._map,
      path: routePath,
      strokeColor: entry.color,
      strokeOpacity: 0.35,
      strokeWeight: 3,
      geodesic: true
    });

    // Trail polyline
    entry.trailPolyline = new google.maps.Polyline({
      map: this._map,
      path: [],
      strokeColor: entry.color,
      strokeOpacity: 0.8,
      strokeWeight: 3,
      geodesic: true
    });

    // Waypoint markers
    this._rebuildWaypointMarkers(entry);

    // Drone marker — custom <model-viewer> overlay rendering the helios.glb 3D model
    const launch = entry.waypoints[0] || { lat: entry.telemetry.lat || 37.7749, lng: entry.telemetry.lng || -122.4194 };
    entry.droneMarker = createDroneModelOverlay({
      position: { lat: launch.lat, lng: launch.lng },
      color: entry.color,
      title: `${entry.name}${entry.model ? ' — ' + entry.model : ''}`,
      size: 72
    });
    entry.droneMarker.setMap(this._map);

    // Click on drone marker -> select this drone
    entry.droneMarker.addListener('click', () => {
      this._selectDrone(entry.id);
    });

    // If 3D mode is active and map3d is ready, also add to the 3D map
    if (this._is3DMode && this._map3dReady) {
      this._addDroneTo3D(entry);
    }
  },

  _removeDroneFromMap(entry) {
    // Stop sim / WS
    if (entry.simInterval) {
      clearInterval(entry.simInterval);
      entry.simInterval = null;
    }
    this._disconnectWebSocket(entry);

    // Remove 2D map objects
    if (entry.droneMarker) { entry.droneMarker.setMap(null); entry.droneMarker = null; }
    if (entry.routePolyline) { entry.routePolyline.setMap(null); entry.routePolyline = null; }
    if (entry.trailPolyline) { entry.trailPolyline.setMap(null); entry.trailPolyline = null; }
    entry.waypointMarkers.forEach(m => m.setMap(null));
    entry.waypointMarkers = [];
    entry.altRoutePolylines.forEach(p => p.setMap(null));
    entry.altRoutePolylines = [];
    entry.altRouteMarkers.forEach(m => m.setMap(null));
    entry.altRouteMarkers = [];

    // Remove 3D elements for this drone
    const m3d = this._3dMarkers.get(entry.id);
    if (m3d) { m3d.remove(); this._3dMarkers.delete(entry.id); }
    const rp3d = this._3dRoutePolylines.get(entry.id);
    if (rp3d) { rp3d.remove(); this._3dRoutePolylines.delete(entry.id); }
    const tp3d = this._3dTrailPolylines.get(entry.id);
    if (tp3d) { tp3d.remove(); this._3dTrailPolylines.delete(entry.id); }
    this._3dTrailCoords.delete(entry.id);
  },

  _rebuildWaypointMarkers(entry) {
    // Clear 2D
    entry.waypointMarkers.forEach(m => m.setMap(null));
    entry.waypointMarkers = [];

    entry.waypoints.forEach((wp, i) => {
      const type = wp.type;
      const label = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
      const marker = new google.maps.Marker({
        position: { lat: wp.lat, lng: wp.lng },
        map: this._map,
        icon: {
          url: createMarkerIcon(label, type),
          scaledSize: new google.maps.Size(28, 37),
          anchor: new google.maps.Point(14, 37)
        },
        title: `${entry.name}: ${wp.label}`,
        zIndex: 50 + i
      });
      entry.waypointMarkers.push(marker);
    });

    // Rebuild 3D waypoint markers if in 3D mode
    if (this._is3DMode && this._map3d) {
      this._3dWaypointMarkers.forEach(m => m.remove());
      this._3dWaypointMarkers = [];
      entry.waypoints.forEach((wp, i) => {
        const type = wp.type;
        const label = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
        const wpMarker = this._create3DMarker(
          { lat: wp.lat, lng: wp.lng }, createMarkerIcon(label, type), wp.alt || 0
        );
        this._map3d.append(wpMarker);
        this._3dWaypointMarkers.push(wpMarker);
      });

      // Update 3D route polyline
      const rp3d = this._3dRoutePolylines.get(entry.id);
      if (rp3d) {
        rp3d.path = entry.waypoints.map(w => ({ lat: w.lat, lng: w.lng, altitude: w.alt || 0 }));
      }
    }
  },

  _applyDroneWaypointsToMap(entry, { restart = false } = {}) {
    if (!this._map) return;

    if (entry.simInterval) {
      clearInterval(entry.simInterval);
      entry.simInterval = null;
    }

    entry.missionComplete = false;
    entry.simIndex = 0;
    entry.simFraction = 0;
    this._resetDroneTelemetry(entry);

    if (entry.routePolyline) {
      entry.routePolyline.setPath(entry.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
    }
    if (entry.trailPolyline) {
      entry.trailPolyline.setPath([]);
    }

    this._rebuildWaypointMarkers(entry);

    const launch = entry.waypoints[0];
    if (entry.droneMarker && launch) {
      entry.droneMarker.setPosition({ lat: launch.lat, lng: launch.lng });
    }

    if (restart) {
      this._startSimulation(entry);
    }

    // Update panel if this is active
    if (entry.id === this._activeDroneId) {
      this._renderWaypointList(entry);
      this._updateTelemetryUI(entry);
      this._updateProgress(entry);
      this._updateWaypointStatuses(entry);
    }
    this._fetchLiveWeather();
  },

  _fitMapToAllDrones() {
    if (this._drones.size === 0) return;

    if (this._is3DMode && this._map3d) {
      // Compute center of all points and use flyCameraTo
      let sumLat = 0, sumLng = 0, count = 0, maxAlt = 0;
      for (const [, entry] of this._drones) {
        entry.waypoints.forEach(wp => {
          sumLat += wp.lat; sumLng += wp.lng; count++;
          if (wp.alt > maxAlt) maxAlt = wp.alt;
        });
        if (entry.telemetry.lat && entry.telemetry.lng) {
          sumLat += entry.telemetry.lat; sumLng += entry.telemetry.lng; count++;
        }
      }
      if (count > 0) {
        const centerPos = { lat: sumLat / count, lng: sumLng / count, altitude: maxAlt };
        if (this._map3dReady && typeof this._map3d.flyCameraTo === 'function') {
          this._map3d.flyCameraTo({
            endCamera: {
              center: centerPos,
              tilt: 67,
              range: this._drones.size > 1 ? 3000 : 1500,
              heading: 0
            },
            durationMillis: 1000
          });
        } else {
          this._map3d.center = centerPos;
        }
      }
    } else if (this._map) {
      const bounds = new google.maps.LatLngBounds();
      let hasPoints = false;

      for (const [, entry] of this._drones) {
        entry.waypoints.forEach(wp => {
          bounds.extend({ lat: wp.lat, lng: wp.lng });
          hasPoints = true;
        });
        if (entry.telemetry.lat && entry.telemetry.lng) {
          bounds.extend({ lat: entry.telemetry.lat, lng: entry.telemetry.lng });
          hasPoints = true;
        }
      }

      if (hasPoints) {
        this._map.fitBounds(bounds, 80);
      }
    }
  },

  _togglePanel(show) {
    const d = this._getDom();
    if (show) {
      d.telemetryPanel.classList.remove('collapsed');
      d.btnExpand.classList.remove('visible');
    } else {
      d.telemetryPanel.classList.add('collapsed');
      d.btnExpand.classList.add('visible');
    }
    if (this._map) {
      setTimeout(() => google.maps.event.trigger(this._map, 'resize'), 360);
    }
  },

  _updateMissionCompleteControl(entry = this._getActiveDrone()) {
    const btn = this._getDom().btnCompleteMission;
    if (!btn) return;
    const disabled = !entry || entry.missionComplete;
    btn.disabled = disabled;
    btn.classList.toggle('completed', !!entry?.missionComplete);
    btn.title = entry?.missionComplete ? 'Mission already complete' : 'Mark mission complete';
    btn.setAttribute('aria-label', btn.title);
  },

  _markMissionCompleteFromControl() {
    const entry = this._getActiveDrone();
    if (!entry) {
      this._showError('No active drone selected.');
      return;
    }
    if (entry.missionComplete) {
      this._showMissionCompleteOverlay(entry, this._buildFlightSnapshot(entry, { status: 'complete' }));
      return;
    }
    this._completeMission(entry, { source: 'manual' });
  },

  _restartMissionForActiveDrone() {
    const d = this._getDom();
    d.missionCompleteOverlay?.classList.remove('visible');

    const entry = this._getActiveDrone();
    if (!entry) return;

    entry.missionComplete = false;
    entry._persisted = false;
    entry.flightLog = [];
    entry.track = [];
    entry.trackSampleTime = 0;
    entry.rawStreamLog = [];
    entry.missionStartTime = null;
    entry.visitedWaypoints?.clear?.();
    entry.mapCenteredOnLive = false;

    if (entry.trailPolyline) entry.trailPolyline.setPath([]);
    this._updateMissionCompleteControl(entry);
    this._updateGraphs(entry);

    if (entry.mode === 'demo') {
      this._applyDroneWaypointsToMap(entry, { restart: true });
      return;
    }

    entry.missionStartTime = Date.now();
    entry.flightLog.push({ time: new Date().toISOString(), event: 'launch', detail: 'Live mission tracking restarted' });
    this._connectWebSocket(entry);
    this._updateProgress(entry);
    this._updateWaypointStatuses(entry);
  },

  _initGraphsDrawer() {
    const d = this._getDom();
    if (!d.graphsDrawer || !d.graphsFlap) return;

    this._visibleGraphWidgets = this._loadGraphWidgetPrefs();
    d.graphsWidgetMenu?.querySelectorAll('[data-graph-toggle]').forEach(input => {
      input.checked = this._visibleGraphWidgets.has(input.dataset.graphToggle);
      input.addEventListener('change', () => {
        const id = input.dataset.graphToggle;
        if (input.checked) this._visibleGraphWidgets.add(id);
        else this._visibleGraphWidgets.delete(id);
        if (this._visibleGraphWidgets.size === 0) {
          this._visibleGraphWidgets.add(id);
          input.checked = true;
        }
        this._syncGraphWidgetVisibility();
        this._updateGraphs(this._getActiveDrone());
      });
    });

    d.graphsWidgetBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !d.graphsWidgetMenu.classList.contains('visible');
      d.graphsWidgetMenu.classList.toggle('visible', open);
      d.graphsWidgetBtn.setAttribute('aria-expanded', String(open));
    });
    d.graphsRawBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      this._setGraphsMode(this._graphsMode === 'raw' ? 'charts' : 'raw');
    });
    d.rawStreamClear?.addEventListener('click', () => {
      const entry = this._getActiveDrone();
      if (entry) entry.rawStreamLog = [];
      this._renderRawStreamLog(entry);
    });

    document.addEventListener('click', (event) => {
      if (!d.graphsWidgetMenu?.classList.contains('visible')) return;
      if (event.target.closest('#dvGraphsWidgetMenu') || event.target.closest('#dvGraphsWidgetBtn')) return;
      d.graphsWidgetMenu.classList.remove('visible');
      d.graphsWidgetBtn?.setAttribute('aria-expanded', 'false');
    });

    d.graphsFlap.addEventListener('click', () => {
      if (this._graphsSuppressClick) return;
      this._setGraphsOpen(!this._graphsOpen);
    });
    d.graphsFlap.addEventListener('pointerdown', (event) => this._startGraphsDrag(event));
    window.addEventListener('pointermove', (event) => this._moveGraphsDrag(event));
    window.addEventListener('pointerup', (event) => this._endGraphsDrag(event));

    this._syncGraphWidgetVisibility();
    this._setGraphsMode(this._graphsMode);
  },

  _loadGraphWidgetPrefs() {
    try {
      const raw = window.localStorage?.getItem(GRAPH_STORAGE_KEY);
      const ids = raw ? JSON.parse(raw) : DEFAULT_GRAPH_WIDGETS;
      const valid = ids.filter(id => GRAPH_WIDGETS[id]);
      return new Set(valid.length ? valid : DEFAULT_GRAPH_WIDGETS);
    } catch (_) {
      return new Set(DEFAULT_GRAPH_WIDGETS);
    }
  },

  _saveGraphWidgetPrefs() {
    try {
      window.localStorage?.setItem(GRAPH_STORAGE_KEY, JSON.stringify([...this._visibleGraphWidgets]));
    } catch (_) {}
  },

  _syncGraphWidgetVisibility() {
    const d = this._getDom();
    d.graphsGrid?.querySelectorAll('[data-graph-widget]').forEach(card => {
      card.classList.toggle('hidden', !this._visibleGraphWidgets.has(card.dataset.graphWidget));
    });
    d.graphsWidgetMenu?.querySelectorAll('[data-graph-toggle]').forEach(input => {
      input.checked = this._visibleGraphWidgets.has(input.dataset.graphToggle);
    });
    if (d.graphsActiveCount) d.graphsActiveCount.textContent = String(this._visibleGraphWidgets.size);
    this._saveGraphWidgetPrefs();
  },

  _setGraphsMode(mode) {
    const d = this._getDom();
    this._graphsMode = mode === 'raw' ? 'raw' : 'charts';
    const raw = this._graphsMode === 'raw';
    d.graphsGrid?.classList.toggle('hidden', raw);
    d.rawStreamPanel?.classList.toggle('hidden', !raw);
    d.graphsRawBtn?.classList.toggle('active', raw);
    d.graphsRawBtn?.setAttribute('aria-pressed', String(raw));
    d.graphsWidgetBtn?.classList.toggle('hidden', raw);
    d.graphsWidgetMenu?.classList.remove('visible');
    d.graphsWidgetBtn?.setAttribute('aria-expanded', 'false');

    if (raw) {
      this._renderRawStreamLog(this._getActiveDrone());
    } else {
      this._updateGraphs(this._getActiveDrone());
      requestAnimationFrame(() => this._graphCharts.forEach(chart => chart.resize()));
    }
  },

  _setGraphsOpen(open) {
    const d = this._getDom();
    if (!d.graphsDrawer) return;
    this._graphsOpen = open;
    d.graphsDrawer.classList.toggle('open', open);
    d.graphsFlap?.setAttribute('aria-expanded', String(open));
    d.graphsFlap?.setAttribute('title', open ? 'Hide telemetry graphs' : 'Show telemetry graphs');
    d.graphsDrawer.style.transform = '';
    if (open) {
      this._updateGraphs(this._getActiveDrone());
      if (this._graphsMode === 'raw') this._renderRawStreamLog(this._getActiveDrone());
      requestAnimationFrame(() => {
        this._graphCharts.forEach(chart => chart.resize());
      });
    }
  },

  _getGraphsCollapsedShift() {
    const drawer = this._getDom().graphsDrawer;
    if (!drawer) return 0;
    return Math.max(0, drawer.offsetHeight - 46);
  },

  _startGraphsDrag(event) {
    if (event.button != null && event.button !== 0) return;
    const d = this._getDom();
    if (!d.graphsDrawer) return;
    const collapsedShift = this._getGraphsCollapsedShift();
    this._graphsDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startShift: this._graphsOpen ? 0 : collapsedShift,
      currentShift: this._graphsOpen ? 0 : collapsedShift,
      collapsedShift,
      moved: false
    };
    d.graphsDrawer.classList.add('dragging');
    d.graphsFlap?.setPointerCapture?.(event.pointerId);
  },

  _moveGraphsDrag(event) {
    const drag = this._graphsDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = this._getDom();
    const delta = event.clientY - drag.startY;
    const shift = Math.max(0, Math.min(drag.collapsedShift, drag.startShift + delta));
    drag.currentShift = shift;
    if (Math.abs(delta) > 3) drag.moved = true;
    d.graphsDrawer.style.transform = `translateY(${shift}px)`;
    event.preventDefault();
  },

  _endGraphsDrag(event) {
    const drag = this._graphsDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = this._getDom();
    d.graphsDrawer?.classList.remove('dragging');
    d.graphsFlap?.releasePointerCapture?.(event.pointerId);
    this._graphsDrag = null;
    if (drag.moved) {
      this._graphsSuppressClick = true;
      setTimeout(() => { this._graphsSuppressClick = false; }, 0);
      this._setGraphsOpen(drag.currentShift < drag.collapsedShift * 0.58);
    }
  },

  _fmtElapsed(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  },

  _appendRawStreamLog(entry, channel, payload) {
    if (!entry) return;
    if (!Array.isArray(entry.rawStreamLog)) entry.rawStreamLog = [];
    entry.rawStreamLog.push({
      time: Date.now(),
      channel,
      payload
    });
    if (entry.rawStreamLog.length > RAW_STREAM_LOG_LIMIT) {
      entry.rawStreamLog.splice(0, entry.rawStreamLog.length - RAW_STREAM_LOG_LIMIT);
    }
    if (entry.id === this._activeDroneId) this._scheduleRawStreamRender();
  },

  _formatRawPayloadValue(value) {
    if (value == null) return String(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return String(value);
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(Math.abs(value) < 1 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '');
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  },

  _flattenRawPayload(value, prefix = '', out = []) {
    if (out.length >= 36 || value == null) return out;
    if (typeof value !== 'object' || Array.isArray(value)) {
      out.push([prefix || 'value', this._formatRawPayloadValue(value)]);
      return out;
    }

    Object.entries(value).forEach(([key, child]) => {
      if (out.length >= 36) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        this._flattenRawPayload(child, path, out);
      } else {
        out.push([path, this._formatRawPayloadValue(child)]);
      }
    });
    return out;
  },

  _getRawStreamPresentation(item) {
    const payload = item.payload || {};
    const metrics = [];
    const addMetric = (label, value) => {
      if (value == null || value === '' || Number.isNaN(value)) return;
      metrics.push([label, value]);
    };

    if (item.channel === 'demo.telemetry') {
      addMetric('Alt', `${Math.round(payload.altitude || 0)} m`);
      addMetric('Speed', `${Number(payload.speed || 0).toFixed(1)} km/h`);
      addMetric('Battery', `${Math.round(payload.battery ?? 0)}%`);
      addMetric('Heading', `${Math.round(payload.heading || 0)}°`);
      addMetric('Lat', this._formatRawPayloadValue(payload.lat));
      addMetric('Lng', this._formatRawPayloadValue(payload.lng));
      return { title: 'Demo telemetry sample', metrics };
    }

    if (item.channel === 'ws.message') {
      const position = payload.position || {};
      const attitude = payload.attitude || {};
      const battery = payload.battery || {};
      addMetric('Alt', position.relative_altitude_m != null ? `${Math.round(position.relative_altitude_m)} m` : null);
      addMetric('Lat', position.latitude_deg != null ? this._formatRawPayloadValue(position.latitude_deg) : null);
      addMetric('Lng', position.longitude_deg != null ? this._formatRawPayloadValue(position.longitude_deg) : null);
      addMetric('Yaw', attitude.yaw_deg != null ? `${Math.round(attitude.yaw_deg)}°` : null);
      if (battery.remaining_percent != null) {
        const pct = battery.remaining_percent > 1 ? battery.remaining_percent : battery.remaining_percent * 100;
        addMetric('Battery', `${Math.round(pct)}%`);
      }
      return { title: 'WebSocket telemetry packet', metrics };
    }

    const titles = {
      'demo.launch': 'Demo stream started',
      'ws.open': 'WebSocket connected',
      'ws.close': 'WebSocket closed',
      'ws.error': 'WebSocket error',
      'ws.parse_error': 'Message parse error',
      'mission.complete': 'Mission completed'
    };
    return { title: titles[item.channel] || 'Stream event', metrics };
  },

  _renderRawStreamEntry(item) {
    const stamp = new Date(item.time).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const presentation = this._getRawStreamPresentation(item);
    const entry = document.createElement('div');
    entry.className = `dv-raw-entry type-${item.channel.replace(/[^a-z0-9_-]/gi, '-')}`;

    const head = document.createElement('div');
    head.className = 'dv-raw-entry-head';
    const title = document.createElement('div');
    title.className = 'dv-raw-entry-title';
    const channel = document.createElement('span');
    channel.textContent = item.channel;
    const label = document.createElement('strong');
    label.textContent = presentation.title;
    title.append(channel, label);
    const time = document.createElement('time');
    time.textContent = stamp;
    head.append(title, time);
    entry.append(head);

    if (presentation.metrics.length) {
      const metrics = document.createElement('div');
      metrics.className = 'dv-raw-entry-metrics';
      presentation.metrics.forEach(([key, value]) => {
        const metric = document.createElement('span');
        const k = document.createElement('small');
        k.textContent = key;
        const v = document.createElement('b');
        v.textContent = value;
        metric.append(k, v);
        metrics.append(metric);
      });
      entry.append(metrics);
    }

    const fields = this._flattenRawPayload(item.payload);
    if (fields.length) {
      const table = document.createElement('div');
      table.className = 'dv-raw-entry-fields';
      fields.forEach(([key, value]) => {
        const row = document.createElement('div');
        const k = document.createElement('span');
        k.textContent = key;
        const v = document.createElement('code');
        v.textContent = value;
        row.append(k, v);
        table.append(row);
      });
      entry.append(table);
    }
    return entry;
  },

  _scheduleRawStreamRender() {
    if (this._graphsMode !== 'raw') return;
    if (this._rawLogRenderFrame) return;
    this._rawLogRenderFrame = requestAnimationFrame(() => {
      this._rawLogRenderFrame = null;
      this._renderRawStreamLog(this._getActiveDrone());
    });
  },

  _renderRawStreamLog(entry = this._getActiveDrone()) {
    const d = this._getDom();
    if (!d.rawStreamLog) return;
    const logs = entry?.rawStreamLog || [];
    const count = logs.length;
    if (d.rawStreamMeta) {
      d.rawStreamMeta.textContent = `${count} entr${count === 1 ? 'y' : 'ies'}${count >= RAW_STREAM_LOG_LIMIT ? ' (capped)' : ''}`;
    }
    d.rawStreamLog.textContent = '';
    if (count) {
      const fragment = document.createDocumentFragment();
      logs.forEach(item => fragment.append(this._renderRawStreamEntry(item)));
      d.rawStreamLog.append(fragment);
    } else {
      d.rawStreamLog.textContent = 'No stream logs captured yet.';
    }
    d.rawStreamLog.scrollTop = d.rawStreamLog.scrollHeight;
  },

  _initGraphCharts() {
    if (this._graphCharts.size || typeof Chart === 'undefined') return;
    const gridColor = 'rgba(255,255,255,0.06)';
    const tickColor = 'rgba(255,255,255,0.35)';

    Object.entries(GRAPH_WIDGETS).forEach(([id, def]) => {
      const canvas = document.getElementById(def.canvasId);
      if (!canvas) return;
      const yScale = {
        grid: { color: gridColor, drawBorder: false },
        border: { display: false },
        ticks: { color: tickColor, maxTicksLimit: 4, font: { size: 9 } }
      };
      if (Number.isFinite(def.min)) yScale.min = def.min;
      if (Number.isFinite(def.max)) yScale.max = def.max;
      if (Number.isFinite(def.suggestedMin)) yScale.suggestedMin = def.suggestedMin;

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: def.label,
            data: [],
            borderColor: def.color,
            backgroundColor: (ctx) => {
              const { chart } = ctx;
              const area = chart.chartArea;
              if (!area) return `${def.color}18`;
              const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              gradient.addColorStop(0, `${def.color}2e`);
              gradient.addColorStop(0.72, `${def.color}08`);
              gradient.addColorStop(1, `${def.color}00`);
              return gradient;
            },
            borderWidth: 2.2,
            cubicInterpolationMode: 'monotone',
            pointRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 2.5 : 0,
            pointHoverRadius: 4,
            pointBackgroundColor: def.color,
            pointBorderColor: 'rgba(8, 12, 20, 0.95)',
            pointBorderWidth: 1.5,
            tension: 0.34,
            fill: 'origin'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          normalized: true,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(12, 15, 24, 0.92)',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              displayColors: false,
              titleFont: { size: 11, weight: '600' },
              bodyFont: { size: 11 },
              padding: 9,
              cornerRadius: 8,
              callbacks: {
                label: (ctx) => `${ctx.parsed.y} ${def.unit}`
              }
            }
          },
          scales: {
            x: {
              border: { display: false },
              grid: { display: false },
              ticks: { color: tickColor, maxTicksLimit: 5, font: { size: 9 } }
            },
            y: yScale
          }
        }
      });
      this._graphCharts.set(id, chart);
    });
  },

  _updateGraphs(entry) {
    const d = this._getDom();
    if (!d.graphsDrawer) return;
    const samples = this._getGraphSource(entry);
    const sampleText = `${samples.length} sample${samples.length === 1 ? '' : 's'}`;
    if (d.graphsMeta) d.graphsMeta.textContent = sampleText;
    if (d.graphsSampleCount) d.graphsSampleCount.textContent = String(samples.length);
    if (d.graphsActiveCount) d.graphsActiveCount.textContent = String(this._visibleGraphWidgets.size);
    if (d.graphsWindow) {
      const first = samples[0]?.t || 0;
      const last = samples[samples.length - 1]?.t || 0;
      d.graphsWindow.textContent = samples.length > 1 ? this._fmtElapsed(Math.max(0, last - first)) : '00:00';
    }
    if (d.graphsSubtitle) {
      d.graphsSubtitle.textContent = entry
        ? `${entry.name}${entry.model ? ' — ' + entry.model : ''}`
        : 'Select a drone to populate realtime widgets';
    }
    if (!this._graphsOpen && this._graphCharts.size === 0) {
      this._updateGraphCurrentValues(entry);
      return;
    }

    this._initGraphCharts();
    Object.keys(GRAPH_WIDGETS).forEach(id => {
      const chart = this._graphCharts.get(id);
      if (!chart) return;
      const series = this._getGraphSeries(entry, id);
      chart.data.labels = series.labels;
      chart.data.datasets[0].data = series.values;
      chart.update('none');
    });
    this._updateGraphCurrentValues(entry);
  },

  _getGraphSource(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.track) && entry.track.length) return entry.track;
    const t = entry.telemetry || {};
    if (typeof t.lat !== 'number' || typeof t.lng !== 'number') return [];
    return [{
      t: entry.missionStartTime ? Date.now() - entry.missionStartTime : 0,
      lat: t.lat,
      lng: t.lng,
      alt: Math.round(t.altitude || 0),
      speed: Number.parseFloat(t.speed) || 0,
      heading: Math.round(t.heading || 0),
      battery: Math.round(t.battery ?? 100)
    }];
  },

  _getGraphSeries(entry, id) {
    const source = this._getGraphSource(entry);
    const labels = [];
    let values = [];

    if (id === 'distance') {
      let cumulative = 0;
      values = source.map((point, i) => {
        if (i > 0) {
          const prev = source[i - 1];
          cumulative += this._computeTrackDistance([prev, point]);
        }
        return Math.round(cumulative);
      });
    } else if (id === 'verticalRate') {
      values = source.map((point, i) => {
        if (i === 0) return 0;
        const prev = source[i - 1];
        const dt = Math.max(1, ((point.t || 0) - (prev.t || 0)) / 1000);
        return +(((point.alt || 0) - (prev.alt || 0)) / dt).toFixed(1);
      });
    } else {
      const key = id === 'altitude' ? 'alt' : id;
      values = source.map(point => {
        const value = Number(point[key]);
        return Number.isFinite(value) ? value : 0;
      });
    }

    const maxPoints = 160;
    const start = Math.max(0, source.length - maxPoints);
    source.slice(start).forEach(point => labels.push(this._fmtElapsed(point.t || 0)));
    return { labels, values: values.slice(start) };
  },

  _formatGraphDelta(id, delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) {
      return { text: 'No change', className: 'neutral' };
    }
    const abs = Math.abs(delta);
    const sign = delta > 0 ? '+' : '-';
    let value;
    let unit = GRAPH_WIDGETS[id]?.unit || '';

    if (id === 'battery') {
      value = Math.round(abs);
      unit = '%';
      return { text: `${sign}${value}${unit}`, className: delta > 0 ? 'positive' : 'negative' };
    }
    if (id === 'heading') {
      value = Math.round(abs);
      return { text: `${sign}${value}°`, className: delta > 0 ? 'positive' : 'negative' };
    }
    if (id === 'distance' && abs >= 1000) {
      value = (abs / 1000).toFixed(2);
      unit = 'km';
    } else if (id === 'altitude' || id === 'distance') {
      value = Math.round(abs);
    } else {
      value = abs.toFixed(1);
    }

    return { text: `${sign}${value} ${unit}`.trim(), className: delta > 0 ? 'positive' : 'negative' };
  },

  _updateGraphCurrentValues(entry) {
    const d = this._getDom();
    if (!d.graphsGrid) return;
    const source = this._getGraphSource(entry);
    const last = source[source.length - 1] || null;
    const valueFor = {
      altitude: last ? `${Math.round(last.alt || 0)} m` : '-- m',
      speed: last ? `${Number(last.speed || 0).toFixed(1)} km/h` : '-- km/h',
      battery: last ? `${Math.round(last.battery ?? 0)}%` : '--%',
      heading: last ? `${Math.round(last.heading || 0)}°` : '--°',
      verticalRate: '-- m/s',
      distance: '-- m'
    };
    const deltaFor = Object.fromEntries(Object.keys(GRAPH_WIDGETS).map(id => [id, { text: 'No change', className: 'neutral' }]));
    if (last && source.length > 1) {
      const vertical = this._getGraphSeries(entry, 'verticalRate').values.at(-1);
      const distance = this._getGraphSeries(entry, 'distance').values.at(-1);
      valueFor.verticalRate = `${Number(vertical || 0).toFixed(1)} m/s`;
      valueFor.distance = distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${Math.round(distance || 0)} m`;
      Object.keys(GRAPH_WIDGETS).forEach(id => {
        const values = this._getGraphSeries(entry, id).values;
        const current = values.at(-1);
        const previous = values.at(-2);
        deltaFor[id] = this._formatGraphDelta(id, Number(current) - Number(previous));
      });
    }
    d.graphsGrid.querySelectorAll('[data-graph-value]').forEach(el => {
      const id = el.dataset.graphValue;
      el.textContent = valueFor[id] || '--';
    });
    d.graphsGrid.querySelectorAll('[data-graph-delta]').forEach(el => {
      const delta = deltaFor[el.dataset.graphDelta] || { text: 'No change', className: 'neutral' };
      el.textContent = delta.text;
      el.classList.toggle('positive', delta.className === 'positive');
      el.classList.toggle('negative', delta.className === 'negative');
    });
  },

  // ══════════════════════════════════════════
  //  DRONE SELECTION & CHIPS
  // ══════════════════════════════════════════

  _selectDrone(droneId) {
    const entry = this._drones.get(droneId);
    if (!entry) return;

    this._activeDroneId = droneId;
    const d = this._getDom();

    // Update live badge label
    d.droneIdLabel.textContent = entry.mode === 'demo'
      ? `${entry.name} — ${entry.model}`
      : `${entry.name}${entry.model ? ' — ' + entry.model : ''}`;

    // Update panel title
    d.telemetryPanel.querySelector('.dv-panel-collapse-title h2').textContent = entry.name;
    d.telemetryPanel.querySelector('.dv-panel-collapse-title p').textContent =
      entry.mode === 'demo' ? 'Simulated telemetry' : 'Live telemetry feed';

    // Update all panel data
    this._updateTelemetryUI(entry);
    this._updateProgress(entry);
    this._renderWaypointList(entry);
    this._updateWaypointStatuses(entry);
    this._updateMissionCompleteControl(entry);
    this._updateGraphs(entry);
    if (this._graphsMode === 'raw') this._renderRawStreamLog(entry);

    // Highlight chip
    this._highlightChip(droneId);

    // Pan map to this drone
    if (entry.telemetry.lat && entry.telemetry.lng) {
      if (this._is3DMode && this._map3d) {
        const alt = entry.telemetry.altitude || 0;
        if (this._map3dReady && typeof this._map3d.flyCameraTo === 'function') {
          this._map3d.flyCameraTo({
            endCamera: {
              center: { lat: entry.telemetry.lat, lng: entry.telemetry.lng, altitude: alt },
              tilt: 67,
              range: 1500,
              heading: this._map3d.heading || 0
            },
            durationMillis: 800
          });
        } else {
          this._map3d.center = { lat: entry.telemetry.lat, lng: entry.telemetry.lng, altitude: alt };
        }
      } else if (this._map) {
        this._map.panTo({ lat: entry.telemetry.lat, lng: entry.telemetry.lng });
      }
    }
  },

  _renderDroneChips() {
    const d = this._getDom();
    if (!d.droneChipsBar) return;

    let html = '';
    for (const [id, entry] of this._drones) {
      const active = id === this._activeDroneId ? 'active' : '';
      html += `
        <div class="dv-drone-chip ${active}" data-drone-id="${id}">
          <span class="dv-drone-chip-dot" style="background:${entry.color};box-shadow:0 0 6px ${entry.color}80;"></span>
          <span class="dv-drone-chip-name">${entry.name}</span>
          <button class="dv-drone-chip-close" data-remove-id="${id}" title="Remove drone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>`;
    }
    d.droneChipsBar.innerHTML = html;

    // Bind click events
    d.droneChipsBar.querySelectorAll('.dv-drone-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.dv-drone-chip-close')) return;
        this._selectDrone(chip.dataset.droneId);
      });
    });

    d.droneChipsBar.querySelectorAll('.dv-drone-chip-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeDrone(btn.dataset.removeId);
      });
    });
  },

  _highlightChip(droneId) {
    const d = this._getDom();
    if (!d.droneChipsBar) return;
    d.droneChipsBar.querySelectorAll('.dv-drone-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.droneId === droneId);
    });
  },

  _removeDrone(droneId) {
    const entry = this._drones.get(droneId);
    if (!entry) return;

    this._removeDroneFromMap(entry);
    this._drones.delete(droneId);

    // If that was the active drone, switch to another
    if (this._activeDroneId === droneId) {
      const remaining = [...this._drones.keys()];
      if (remaining.length > 0) {
        this._selectDrone(remaining[0]);
      } else {
        this._activeDroneId = null;
        this._updateMissionCompleteControl(null);
        this._updateGraphs(null);
        if (this._graphsMode === 'raw') this._renderRawStreamLog(null);
        // Show interstitial again
        this._showInterstitial();
        this._populateDroneSelect();
      }
    }

    this._renderDroneChips();
  },

  // ══════════════════════════════════════════
  //  SIMULATION ENGINE (per-drone)
  // ══════════════════════════════════════════

  _startSimulation(entry) {
    if (entry.simInterval) return;
    if (entry.waypoints.length < 2) return;

    entry.simIndex = 0;
    entry.simFraction = 0;
    entry.telemetry.battery = 100;
    entry.missionComplete = false;
    entry.missionStartTime = Date.now();
    entry.flightLog = [
      { time: new Date().toISOString(), event: 'launch', detail: 'Drone powered up and launched from base' }
    ];
    entry.track = [];
    entry.trackSampleTime = 0;
    entry.rawStreamLog = [];
    entry._persisted = false;
    if (entry.trailPolyline) entry.trailPolyline.setPath([]);
    this._appendRawStreamLog(entry, 'demo.launch', { droneId: entry.id, waypoints: entry.waypoints.length });

    const stepsPerSegment = 600;
    const intervalMs = 100;

    entry.simInterval = setInterval(() => {
      const wps = entry.waypoints;
      if (entry.simIndex >= wps.length - 1) {
        this._completeMission(entry);
        return;
      }

      entry.simFraction += 1 / stepsPerSegment;
      if (entry.simFraction >= 1) {
        entry.simFraction = 0;
        entry.simIndex++;
        if (entry.simIndex < wps.length) {
          const reachedWp = wps[entry.simIndex];
          entry.flightLog.push({
            time: new Date().toISOString(),
            event: reachedWp.type === 'rtl' ? 'land' : 'waypoint',
            detail: `${reachedWp.label} reached at altitude ${reachedWp.alt}m`
          });
        }
        if (entry.simIndex >= wps.length - 1) return;
      }

      const from = wps[entry.simIndex];
      const to = wps[entry.simIndex + 1];
      const t = entry.simFraction;

      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      const alt = from.alt + (to.alt - from.alt) * t;
      const hdg = bearing(from.lat, from.lng, to.lat, to.lng);
      const baseSpeed = 42 + Math.sin(Date.now() / 2000) * 8;

      const totalSteps = (wps.length - 1) * stepsPerSegment;
      const currentStep = entry.simIndex * stepsPerSegment + entry.simFraction * stepsPerSegment;
      const batt = Math.max(8, 100 - (currentStep / totalSteps) * 85);

      entry.telemetry = {
        altitude: Math.round(alt),
        speed: baseSpeed.toFixed(1),
        heading: Math.round(hdg),
        battery: Math.round(batt),
        lat, lng
      };

      this._recordTrackSample(entry, { lat, lng, alt, speed: +baseSpeed.toFixed(1), heading: hdg, battery: batt });
      this._appendRawStreamLog(entry, 'demo.telemetry', {
        altitude: Math.round(alt),
        speed: +baseSpeed.toFixed(1),
        heading: Math.round(hdg),
        battery: Math.round(batt),
        lat,
        lng,
        segment: entry.simIndex,
        fraction: +entry.simFraction.toFixed(4)
      });

      const pos = { lat, lng };
      if (entry.droneMarker) {
        entry.droneMarker.setPosition(pos);
        entry.droneMarker.setHeading?.(hdg);
      }
      if (entry.trailPolyline) {
        const path = entry.trailPolyline.getPath();
        path.push(new google.maps.LatLng(lat, lng));
      }

      // 3D updates (photorealistic only — classic uses the same 2D map)
      if (this._3dModeType === 'photorealistic') {
        const marker3d = this._3dMarkers.get(entry.id);
        if (marker3d) marker3d.position = { lat, lng, altitude: alt };
        this._update3DTrail(entry, lat, lng, alt);
      }

      // Only update panel if this is the active drone
      if (entry.id === this._activeDroneId) {
        if (this._autoFollowDrone) {
          if (this._3dModeType === 'photorealistic' && this._map3d) {
            this._map3d.center = { lat, lng, altitude: alt };
          } else if (this._map) {
            this._map.setCenter(pos);
          }
        }
        this._updateTelemetryUI(entry);
        this._updateProgress(entry);
        this._updateWaypointStatuses(entry);
      }
    }, intervalMs);
  },

  _stopSimulation(entry) {
    if (entry.simInterval) {
      clearInterval(entry.simInterval);
      entry.simInterval = null;
    }
  },

  // Record a sampled telemetry point for replay (throttled to ~1/sec).
  _recordTrackSample(entry, { lat, lng, alt, speed, heading, battery }) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    const now = Date.now();
    if (entry.trackSampleTime && now - entry.trackSampleTime < 1000) return;
    entry.trackSampleTime = now;
    if (!entry.track) entry.track = [];
    entry.track.push({
      t: entry.missionStartTime ? now - entry.missionStartTime : 0,
      lat,
      lng,
      alt: Math.round(alt || 0),
      speed: +(+speed || 0).toFixed(1),
      heading: Math.round(heading || 0),
      battery: Math.round(battery ?? 100)
    });
    // Safety cap so very long flights don't grow unbounded (~2h at 1Hz).
    if (entry.track.length > 7200) entry.track.shift();
  },

  // Persist a completed/snapshot flight to the local database for history & replay.
  async _persistFlight(flightData) {
    try {
      if (window.helios?.flightSave) {
        await window.helios.flightSave(flightData);
      }
    } catch (err) {
      console.error('[DroneView] Failed to persist flight:', err);
    }
  },

  _formatMissionDuration(ms) {
    if (!ms || ms < 60000) return '<1 min';
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  },

  _formatMissionDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
  },

  _computeRouteDistance(wps) {
    let totalDist = 0;
    for (let i = 1; i < wps.length; i++) {
      totalDist += haversine(wps[i - 1].lat, wps[i - 1].lng, wps[i].lat, wps[i].lng);
    }
    return totalDist;
  },

  _computeTrackDistance(track) {
    if (!Array.isArray(track) || track.length < 2) return 0;
    let totalDist = 0;
    for (let i = 1; i < track.length; i++) {
      const prev = track[i - 1];
      const cur = track[i];
      if (typeof prev.lat === 'number' && typeof prev.lng === 'number' && typeof cur.lat === 'number' && typeof cur.lng === 'number') {
        totalDist += haversine(prev.lat, prev.lng, cur.lat, cur.lng);
      }
    }
    return totalDist;
  },

  _getVisitedWaypointCount(entry, status = null) {
    const total = entry.waypoints?.length || 0;
    if (status === 'complete' || entry.missionComplete) return total;
    if (entry.mode === 'live') return entry.visitedWaypoints?.size || 0;
    return total ? Math.min(total, (entry.simIndex || 0) + 1) : 0;
  },

  _buildFlightSnapshot(entry, { status = null, endTime = Date.now() } = {}) {
    const t = entry.telemetry || {};
    const wps = entry.waypoints || [];
    const track = entry.track || [];
    const missionStatus = status || (entry.missionComplete ? 'complete' : 'in-progress');
    const elapsed = entry.missionStartTime ? Math.max(0, endTime - entry.missionStartTime) : 0;
    const routeDist = this._computeRouteDistance(wps);
    const trackDist = this._computeTrackDistance(track);
    const totalDist = trackDist > 0 ? trackDist : routeDist;
    const speedSamples = track.map(p => Number(p.speed)).filter(v => Number.isFinite(v) && v > 0);
    const currentSpeed = Number.parseFloat(t.speed) || 0;
    const avgSpeed = speedSamples.length
      ? +(speedSamples.reduce((sum, v) => sum + v, 0) / speedSamples.length).toFixed(1)
      : +(currentSpeed * 0.85).toFixed(1);
    const maxSpeed = speedSamples.length ? +Math.max(...speedSamples).toFixed(1) : +(currentSpeed * 1.15).toFixed(1);
    const altitudeValues = [
      ...wps.map(w => Number(w.alt)).filter(Number.isFinite),
      ...track.map(p => Number(p.alt)).filter(Number.isFinite),
      Number(t.altitude)
    ].filter(Number.isFinite);

    return {
      droneModel: `${entry.name}${entry.model ? ' \u2014 ' + entry.model : ''}`,
      droneId: entry.fleetId ? `ID-${entry.fleetId}` : entry.id,
      missionStart: entry.missionStartTime ? new Date(entry.missionStartTime).toISOString() : new Date(endTime).toISOString(),
      missionEnd: new Date(endTime).toISOString(),
      missionStatus,
      durationMs: elapsed,
      durationStr: this._formatMissionDuration(elapsed),
      totalDistanceM: totalDist,
      distanceStr: this._formatMissionDistance(totalDist),
      batteryStart: 100,
      batteryEnd: Math.round(t.battery ?? 100),
      waypointsVisited: this._getVisitedWaypointCount(entry, missionStatus),
      waypointsTotal: wps.length,
      maxAltitude: altitudeValues.length ? Math.max(...altitudeValues) : 0,
      avgSpeed,
      maxSpeed,
      weatherSummary: this._getDom().weatherCondition?.textContent || 'Unknown',
      flightLog: [...(entry.flightLog || [])],
      waypoints: wps.map(w => ({ ...w })),
      telemetrySnapshot: { ...t },
      track: track.map(p => ({ ...p }))
    };
  },

  _showMissionCompleteOverlay(entry, flightData) {
    if (entry.id !== this._activeDroneId) return;
    const d = this._getDom();
    d.mcDuration.textContent = flightData.durationStr;
    d.mcDistance.textContent = flightData.distanceStr;
    d.mcBattery.textContent = `${flightData.batteryEnd}%`;
    d.missionCompleteOverlay.classList.add('visible');
    this._updateProgress(entry);
    this._updateWaypointStatuses(entry);
  },

  _completeMission(entry, { source = 'auto' } = {}) {
    if (!entry) return;
    if (entry.missionComplete) {
      this._showMissionCompleteOverlay(entry, this._buildFlightSnapshot(entry, { status: 'complete' }));
      return;
    }

    const endTime = Date.now();
    if (!entry.missionStartTime) entry.missionStartTime = endTime;
    if (!entry.flightLog?.length) {
      entry.flightLog = [{ time: new Date(entry.missionStartTime).toISOString(), event: 'launch', detail: 'Mission tracking started' }];
    }

    this._stopSimulation(entry);
    entry.missionComplete = true;

    if (entry.mode === 'live') {
      entry.waypoints.forEach((_, i) => entry.visitedWaypoints.add(i));
      this._disconnectWebSocket(entry);
    }

    const detail = source === 'manual'
      ? 'Mission marked complete by operator'
      : 'Drone landed safely at launch site';
    const lastEvent = entry.flightLog?.[entry.flightLog.length - 1]?.event;
    if (lastEvent !== 'land') {
      entry.flightLog.push({ time: new Date(endTime).toISOString(), event: 'land', detail });
    }
    this._appendRawStreamLog(entry, 'mission.complete', { source, status: 'complete' });

    const flightData = this._buildFlightSnapshot(entry, { status: 'complete', endTime });

    // Store in shared state for Reports
    state.flightData = flightData;
    this._showMissionCompleteOverlay(entry, flightData);
    this._updateMissionCompleteControl(entry);
    this._updateGraphs(entry);

    if (!entry._persisted) {
      entry._persisted = true;
      this._persistFlight(flightData);
    }
  },

  // ══════════════════════════════════════════
  //  LIVE TELEMETRY (WebSocket, per-drone)
  // ══════════════════════════════════════════

  _connectWebSocket(entry) {
    if (!entry.hostname) return;
    this._disconnectWebSocket(entry);

    const url = `ws://${entry.hostname}:5000/ws/telemetry`;
    console.log(`[DroneView] Connecting to ${url} for ${entry.name}...`);

    try {
      entry.ws = new WebSocket(url);

      entry.ws.onopen = () => {
        console.log(`[DroneView] WebSocket connected for ${entry.name}`);
        entry.ws.send(JSON.stringify({ subscribe: ['all'] }));
        entry.lastWsPosition = null;
        entry.lastWsTime = null;
        entry.visitedWaypoints = new Set();
        entry.missionStartTime = Date.now();
        entry.flightLog = [
          { time: new Date().toISOString(), event: 'launch', detail: 'Live telemetry stream started' }
        ];
        entry.track = [];
        entry.trackSampleTime = 0;
        entry.rawStreamLog = [];
        entry._persisted = false;
        if (entry.trailPolyline) entry.trailPolyline.setPath([]);
        this._appendRawStreamLog(entry, 'ws.open', { url, subscribe: ['all'] });
      };

      entry.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._onWsMessage(entry, data);
        } catch (e) {
          this._appendRawStreamLog(entry, 'ws.parse_error', { raw: event.data, error: e.message });
          console.warn(`[DroneView] Failed to parse WS message for ${entry.name}:`, e);
        }
      };

      entry.ws.onclose = (event) => {
        console.log(`[DroneView] WebSocket closed for ${entry.name}:`, event.code, event.reason);
        this._appendRawStreamLog(entry, 'ws.close', { code: event.code, reason: event.reason || null });
        entry.ws = null;
        if (entry.mode === 'live' && !entry.missionComplete && this._drones.has(entry.id) && state.activePage === 'droneview') {
          entry.wsReconnectTimer = setTimeout(() => this._connectWebSocket(entry), 3000);
        }
      };

      entry.ws.onerror = (error) => {
        console.error(`[DroneView] WebSocket error for ${entry.name}:`, error);
        this._appendRawStreamLog(entry, 'ws.error', { message: error?.message || 'WebSocket error' });
        if (entry.id === this._activeDroneId) {
          this._showError(`WebSocket to ${entry.hostname}:5000 failed. Is the Helios SBC Service running?`);
        }
      };
    } catch (err) {
      console.error(`[DroneView] Failed to create WebSocket for ${entry.name}:`, err);
    }
  },

  _disconnectWebSocket(entry) {
    if (entry.wsReconnectTimer) {
      clearTimeout(entry.wsReconnectTimer);
      entry.wsReconnectTimer = null;
    }
    if (entry.ws) {
      entry.ws.onclose = null;
      entry.ws.close();
      entry.ws = null;
    }
  },

  _onWsMessage(entry, data) {
    const now = Date.now();
    this._appendRawStreamLog(entry, 'ws.message', data);

    if (data.position) {
      const lat = data.position.latitude_deg;
      const lng = data.position.longitude_deg;
      const alt = Math.round(data.position.relative_altitude_m || 0);

      let speed = 0;
      if (entry.lastWsPosition && entry.lastWsTime) {
        const dt = (now - entry.lastWsTime) / 1000;
        if (dt > 0) {
          const dist = haversine(entry.lastWsPosition.lat, entry.lastWsPosition.lng, lat, lng);
          speed = (dist / dt) * 3.6;
          if (speed > 200) speed = parseFloat(entry.telemetry.speed) || 0;
        }
      }

      entry.telemetry.lat = lat;
      entry.telemetry.lng = lng;
      entry.telemetry.altitude = alt;
      entry.telemetry.speed = speed.toFixed(1);

      entry.lastWsPosition = { lat, lng };
      entry.lastWsTime = now;

      if (entry.droneMarker) {
        entry.droneMarker.setPosition({ lat, lng });
        const hdg = (data.attitude && typeof data.attitude.yaw_deg === 'number')
          ? data.attitude.yaw_deg
          : entry.telemetry.heading;
        entry.droneMarker.setHeading?.(hdg);
      }

      if (entry.trailPolyline && now - entry.trailThrottleTime > 1000) {
        const path = entry.trailPolyline.getPath();
        path.push(new google.maps.LatLng(lat, lng));
        entry.trailThrottleTime = now;
      }

      // 3D updates (photorealistic only)
      if (this._3dModeType === 'photorealistic') {
        const marker3d = this._3dMarkers.get(entry.id);
        if (marker3d) marker3d.position = { lat, lng, altitude: alt };
        if (now - entry.trailThrottleTime <= 1000) {
          this._update3DTrail(entry, lat, lng, alt);
        }
      }

      if (!entry.mapCenteredOnLive) {
        if (this._3dModeType === 'photorealistic' && this._map3d) {
          this._map3d.center = { lat, lng, altitude: alt };
          entry.mapCenteredOnLive = true;
        } else if (this._map) {
          this._map.setCenter({ lat, lng });
          if (entry.waypoints.length === 0) this._map.setZoom(16);
          entry.mapCenteredOnLive = true;
        }
      }

      this._checkWaypointProximity(entry, lat, lng);
    }

    if (data.attitude) {
      entry.telemetry.heading = Math.round(data.attitude.yaw_deg || 0);
    }

    if (data.battery) {
      const pct = data.battery.remaining_percent;
      entry.telemetry.battery = pct > 1 ? Math.round(pct) : Math.round(pct * 100);
    }

    this._recordTrackSample(entry, {
      lat: entry.telemetry.lat,
      lng: entry.telemetry.lng,
      alt: entry.telemetry.altitude,
      speed: entry.telemetry.speed,
      heading: entry.telemetry.heading,
      battery: entry.telemetry.battery
    });

    // Only update panel if active
    if (entry.id === this._activeDroneId) {
      this._updateTelemetryUI(entry);
      this._updateProgress(entry);
      this._updateWaypointStatuses(entry);
      if (this._autoFollowDrone) {
        if (this._is3DMode && this._map3d) {
          this._map3d.center = { lat: entry.telemetry.lat, lng: entry.telemetry.lng, altitude: entry.telemetry.altitude || 0 };
        } else if (this._map) {
          this._map.setCenter({ lat: entry.telemetry.lat, lng: entry.telemetry.lng });
        }
      }
    }
  },

  _checkWaypointProximity(entry, lat, lng) {
    entry.waypoints.forEach((wp, i) => {
      if (entry.visitedWaypoints.has(i)) return;
      const dist = haversine(lat, lng, wp.lat, wp.lng);
      if (dist <= entry.liveWaypointRadius) {
        entry.visitedWaypoints.add(i);
        entry.flightLog.push({
          time: new Date().toISOString(),
          event: wp.type === 'rtl' ? 'land' : 'waypoint',
          detail: `${wp.label} reached (live)`
        });
      }
    });
  },

  // ══════════════════════════════════════════
  //  TELEMETRY UI
  // ══════════════════════════════════════════

  _resetDroneTelemetry(entry) {
    const launch = entry.waypoints[0];
    if (!launch) return;
    entry.telemetry = {
      ...entry.telemetry,
      altitude: Math.round(launch.alt || 0),
      speed: 0,
      heading: 0,
      battery: 100,
      lat: launch.lat,
      lng: launch.lng
    };
  },

  _updateTelemetryUI(entry) {
    const d = this._getDom();
    const t = entry.telemetry;
    d.altitude.textContent = t.altitude;
    d.speed.textContent = t.speed;
    d.heading.textContent = Math.round(t.heading) + '°';
    d.battery.textContent = Math.round(t.battery) + '%';
    d.lat.textContent = typeof t.lat === 'number' ? t.lat.toFixed(5) : '—';
    d.lng.textContent = typeof t.lng === 'number' ? t.lng.toFixed(5) : '—';

    const bPct = Math.round(t.battery);
    d.batteryFill.style.width = bPct + '%';
    d.batteryFill.className = 'dv-battery-fill ' + (bPct > 50 ? 'high' : bPct > 20 ? 'medium' : 'low');
    this._updateMissionCompleteControl(entry);
    this._updateGraphs(entry);
  },

  _updateProgress(entry) {
    const d = this._getDom();
    const wps = entry.waypoints;
    if (wps.length < 2) {
      d.progressPct.textContent = '—';
      d.progressFill.style.width = '0%';
      return;
    }
    let pct;
    if (entry.mode === 'live') {
      pct = Math.min(100, (entry.visitedWaypoints.size / wps.length) * 100);
    } else {
      const totalSegments = wps.length - 1;
      pct = Math.min(100, ((entry.simIndex + entry.simFraction) / totalSegments) * 100);
    }
    d.progressPct.textContent = Math.round(pct) + '%';
    d.progressFill.style.width = pct + '%';
  },

  _renderWaypointList(entry) {
    const d = this._getDom();
    if (!entry || entry.waypoints.length === 0) {
      d.waypointList.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-tertiary);text-align:center;">No waypoints loaded</div>';
      return;
    }
    d.waypointList.innerHTML = entry.waypoints.map((wp, i) => {
      const mkrChar = wp.type === 'takeoff' ? 'T' : wp.type === 'rtl' ? 'R' : String(i);
      return `
        <div class="dv-wp-item" data-index="${i}">
          <div class="dv-wp-marker type-${wp.type}">${mkrChar}</div>
          <div class="dv-wp-info">
            <div class="dv-wp-name">${wp.label}</div>
            <div class="dv-wp-eta">Alt: ${wp.alt}m</div>
          </div>
          <span class="dv-wp-status pending" id="dvWpStatus${i}">Pending</span>
        </div>`;
    }).join('');
  },

  _updateWaypointStatuses(entry) {
    const wps = entry.waypoints;
    wps.forEach((wp, i) => {
      const el = document.getElementById(`dvWpStatus${i}`);
      if (!el) return;
      if (entry.mode === 'live') {
        if (entry.visitedWaypoints.has(i)) {
          el.textContent = 'Reached';
          el.className = 'dv-wp-status reached';
          el.closest('.dv-wp-item')?.classList.add('completed');
          el.closest('.dv-wp-item')?.classList.remove('active');
        } else {
          el.textContent = 'Pending';
          el.className = 'dv-wp-status pending';
          el.closest('.dv-wp-item')?.classList.remove('completed', 'active');
        }
      } else {
        if (i < entry.simIndex) {
          el.textContent = 'Reached';
          el.className = 'dv-wp-status reached';
          el.closest('.dv-wp-item')?.classList.add('completed');
          el.closest('.dv-wp-item')?.classList.remove('active');
        } else if (i === entry.simIndex) {
          el.textContent = 'Active';
          el.className = 'dv-wp-status next';
          el.closest('.dv-wp-item')?.classList.remove('completed');
          el.closest('.dv-wp-item')?.classList.add('active');
        } else {
          el.textContent = 'Pending';
          el.className = 'dv-wp-status pending';
          el.closest('.dv-wp-item')?.classList.remove('completed', 'active');
        }
      }
    });
  },

  // ── Waypoint normalizer ──
  _normalizeMissionWaypoints(waypoints) {
    if (!Array.isArray(waypoints)) return [];
    return waypoints.map((wp, i, arr) => {
      const lat = Number(wp.lat);
      const lng = Number(wp.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const type = i === 0 ? 'takeoff' : (i === arr.length - 1 ? 'rtl' : 'waypoint');
      const fallbackLabel = type === 'takeoff' ? 'Take Off' : type === 'rtl' ? 'Return to Launch' : `Waypoint ${i}`;
      const rawAlt = Number(wp.alt);
      const defaultAlt = (type === 'takeoff' || type === 'rtl') ? 0 : 80;
      return {
        lat, lng, type,
        label: (typeof wp.label === 'string' && wp.label.trim()) ? wp.label.trim() : fallbackLabel,
        alt: Number.isFinite(rawAlt) ? Math.max(0, Math.round(rawAlt)) : defaultAlt
      };
    }).filter(Boolean);
  },

  // ── Live Weather ──
  async _fetchLiveWeather() {
    try {
      const active = this._getActiveDrone();
      const wp = active?.waypoints[0] || (active ? { lat: active.telemetry.lat, lng: active.telemetry.lng } : null);
      if (!wp || !wp.lat || !wp.lng) return;

      const today = new Date().toISOString().split('T')[0];
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lng}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,visibility,weathercode`
        + `&start_date=${today}&end_date=${today}&timezone=auto`;

      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      if (!data.hourly) return;

      const hour = new Date().getHours();
      const idx = Math.min(hour, (data.hourly.time?.length || 1) - 1);

      const weatherCode = data.hourly.weathercode?.[idx];
      const info = weatherCodeToInfo(weatherCode);
      const compass = windDirToCompass(data.hourly.winddirection_10m?.[idx] || 0);
      const visKm = data.hourly.visibility?.[idx] != null ? (data.hourly.visibility[idx] / 1000).toFixed(1) : '—';

      const d = this._getDom();
      d.weatherIcon.innerHTML = info.icon;
      d.weatherCondition.textContent = info.label;
      d.weatherTemp.textContent = data.hourly.temperature_2m?.[idx] != null ? data.hourly.temperature_2m[idx] + '°C' : '—';
      d.weatherWind.textContent = data.hourly.windspeed_10m?.[idx] != null ? data.hourly.windspeed_10m[idx] + ' km/h' : '—';
      d.weatherWindDir.textContent = 'Wind ' + compass;
      d.weatherRain.textContent = data.hourly.precipitation_probability?.[idx] != null ? data.hourly.precipitation_probability[idx] + '%' : '—';
      d.weatherVis.textContent = visKm + ' km';
    } catch (e) {
      console.warn('Weather fetch failed:', e);
    }

    if (!this._weatherInterval) {
      this._weatherInterval = setInterval(() => this._fetchLiveWeather(), 300000);
    }
  },

  // ══════════════════════════════════════════
  //  AI: FLIGHT ANALYSIS (Gemini)
  // ══════════════════════════════════════════

  async _requestFlightAnalysis() {
    const entry = this._getActiveDrone();
    if (!entry) return;

    const d = this._getDom();
    d.btnFlightAnalysis.classList.add('loading');
    d.loadingOverlay.classList.add('visible');

    try {
      const t = entry.telemetry;
      const wps = entry.waypoints;
      const completedPct = entry.mode === 'live'
        ? Math.round((entry.visitedWaypoints.size / Math.max(wps.length, 1)) * 100)
        : Math.round(((entry.simIndex + entry.simFraction) / Math.max(wps.length - 1, 1)) * 100);

      const prompt = `You are an expert eVTOL drone flight analyst. Analyze this LIVE in-progress flight and provide a real-time assessment.

LIVE TELEMETRY:
- Drone: ${entry.name}${entry.model ? ' (' + entry.model + ')' : ''}
- Current Position: lat ${t.lat.toFixed(6)}, lng ${t.lng.toFixed(6)}
- Altitude: ${t.altitude}m
- Ground Speed: ${t.speed} km/h
- Heading: ${t.heading}°
- Battery: ${Math.round(t.battery)}%
- Mission Progress: ${completedPct}%
${entry.mode === 'demo' ? `- Current Waypoint Index: ${entry.simIndex + 1} of ${wps.length}` : ''}

FLIGHT PLAN:
${wps.map((wp, i) => `  ${i + 1}. [${wp.type}] ${wp.label} — lat: ${wp.lat.toFixed(6)}, lng: ${wp.lng.toFixed(6)}, alt: ${wp.alt}m`).join('\n')}

Provide a JSON response with EXACTLY this structure (no markdown, no code fences, raw JSON only):
{
  "flightStatus": "<nominal|caution|warning|critical>",
  "summary": "<2-3 sentence real-time assessment>",
  "performance": {
    "efficiency": "<percentage as string, e.g. 92%>",
    "estimatedTimeRemaining": "<e.g. 8 min>",
    "estimatedBatteryAtLanding": "<e.g. 22%>",
    "distanceRemaining": "<e.g. 3.2 km>"
  },
  "observations": ["<observation 1>", "<observation 2>"],
  "recommendations": ["<recommendation 1>", "<recommendation 2>"],
  "alerts": ["<any urgent alerts, or empty array>"]
}`;

      const result = await callAI(prompt);
      d.loadingOverlay.classList.remove('visible');
      d.btnFlightAnalysis.classList.remove('loading');
      this._showAnalysisPanel(result);
    } catch (err) {
      d.loadingOverlay.classList.remove('visible');
      d.btnFlightAnalysis.classList.remove('loading');
      this._showError(err.message);
    }
  },

  _showAnalysisPanel(data) {
    const d = this._getDom();
    const statusColors = { nominal: '#22c55e', caution: '#eab308', warning: '#f97316', critical: '#ef4444' };
    const statusColor = statusColors[data.flightStatus] || statusColors.nominal;

    const alertsHtml = (data.alerts || []).length > 0
      ? `<div style="padding:8px 12px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);margin-bottom:4px;">
          <h3><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" width="13" height="13"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg> Alerts</h3>
          <ul>${data.alerts.map(a => `<li>${a}</li>`).join('')}</ul>
        </div>`
      : '';

    d.analysisBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;flex-shrink:0;"></span>
        <span style="font-size:12px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.5px;">${data.flightStatus || 'Nominal'}</span>
      </div>
      <p style="font-size:13px;line-height:1.6;color:var(--text-primary);">${data.summary || ''}</p>
      ${alertsHtml}
      <div class="dv-analysis-stat-row">
        <div class="dv-analysis-stat"><span class="dv-analysis-stat-value">${data.performance?.efficiency || '—'}</span><span class="dv-analysis-stat-label">Efficiency</span></div>
        <div class="dv-analysis-stat"><span class="dv-analysis-stat-value">${data.performance?.estimatedTimeRemaining || '—'}</span><span class="dv-analysis-stat-label">Time Left</span></div>
        <div class="dv-analysis-stat"><span class="dv-analysis-stat-value">${data.performance?.estimatedBatteryAtLanding || '—'}</span><span class="dv-analysis-stat-label">Batt @ Land</span></div>
      </div>
      ${(data.observations || []).length ? `
      <div>
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" width="13" height="13"><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg> Observations</h3>
        <ul>${data.observations.map(o => `<li>${o}</li>`).join('')}</ul>
      </div>` : ''}
      ${(data.recommendations || []).length ? `
      <div>
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" width="13" height="13"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Recommendations</h3>
        <ul>${data.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>` : ''}`;

    d.analysisPanel.classList.add('visible');
  },

  // ══════════════════════════════════════════
  //  AI: ALTERNATIVE ROUTES (Gemini)
  // ══════════════════════════════════════════

  async _requestAltRoutes() {
    const entry = this._getActiveDrone();
    if (!entry) return;

    const d = this._getDom();
    d.btnAltRoutes.classList.add('loading');
    d.loadingOverlay.classList.add('visible');

    try {
      const t = entry.telemetry;
      const wps = entry.waypoints;
      const remainingWps = entry.mode === 'demo' ? wps.slice(entry.simIndex) : wps;

      const prompt = `You are an expert eVTOL drone route optimizer. The drone is currently in-flight and needs alternative route suggestions for the REMAINING portion of its mission.

CURRENT POSITION:
- lat: ${t.lat.toFixed(6)}, lng: ${t.lng.toFixed(6)}, altitude: ${t.altitude}m
- Battery: ${Math.round(t.battery)}%, Speed: ${t.speed} km/h
- Heading: ${t.heading}°

REMAINING WAYPOINTS:
${remainingWps.map((wp, i) => `  ${i + 1}. [${wp.type}] ${wp.label} — lat: ${wp.lat.toFixed(6)}, lng: ${wp.lng.toFixed(6)}, alt: ${wp.alt}m`).join('\n')}

DESTINATION (must be reached): lat ${wps[wps.length - 1].lat.toFixed(6)}, lng ${wps[wps.length - 1].lng.toFixed(6)}

Suggest 2 alternative routes. Return JSON only (no markdown, no code fences):
{
  "alternatives": [
    {
      "name": "<route name, e.g. 'Wind-Optimized Route'>",
      "description": "<1 sentence description>",
      "estimatedTimeSaved": "<e.g. 2 min>",
      "estimatedBatterySaved": "<e.g. 5%>",
      "waypoints": [
        { "lat": <number>, "lng": <number>, "alt": <number>, "label": "<label>", "type": "<waypoint|rtl>" }
      ]
    }
  ]
}

RULES:
- Each route MUST start near the drone's current position
- Each route MUST end at the destination coordinates
- Keep waypoints within 5km of the original route corridor
- Recommend practical alternatives (shorter, wind-optimized, safer altitude, etc.)
- 3-5 waypoints per alternative route
- Altitudes between 30-120m`;

      const result = await callAI(prompt);
      d.loadingOverlay.classList.remove('visible');
      d.btnAltRoutes.classList.remove('loading');
      if (result.alternatives && result.alternatives.length > 0) {
        entry.lastAltRoutes = result.alternatives;
        this._showAltRoutes(entry, result.alternatives);
      } else {
        this._showError('No alternative routes returned. Try again.');
      }
    } catch (err) {
      d.loadingOverlay.classList.remove('visible');
      d.btnAltRoutes.classList.remove('loading');
      this._showError(err.message);
    }
  },

  _showAltRoutes(entry, alternatives) {
    this._clearAltRoutes(entry);
    const d = this._getDom();
    const colors = ['#a855f7', '#ec4899'];

    alternatives.forEach((route, rIdx) => {
      const color = colors[rIdx % colors.length];
      if (!route.waypoints || !route.waypoints.length) return;

      const path = route.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
      const polyline = new google.maps.Polyline({
        map: this._map, path,
        strokeColor: color, strokeOpacity: 0, strokeWeight: 3, geodesic: true,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: color, scale: 3 },
          offset: '0', repeat: '16px'
        }]
      });
      entry.altRoutePolylines.push(polyline);

      route.waypoints.forEach((wp, wIdx) => {
        const isLast = wIdx === route.waypoints.length - 1;
        const label = isLast ? 'R' : String(wIdx + 1);
        const type = isLast ? 'rtl' : 'waypoint';
        const marker = new google.maps.Marker({
          position: { lat: wp.lat, lng: wp.lng },
          map: this._map,
          icon: {
            url: createAiMarkerIcon(label, type),
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 26)
          },
          title: `${route.name}: ${wp.label}` + (wp.alt ? ` (${wp.alt}m)` : ''),
          zIndex: 200 + rIdx * 10 + wIdx
        });
        entry.altRouteMarkers.push(marker);
      });
    });

    d.routeBar.classList.add('visible');
  },

  _clearAltRoutes(entry) {
    entry.altRoutePolylines.forEach(p => p.setMap(null));
    entry.altRoutePolylines = [];
    entry.altRouteMarkers.forEach(m => m.setMap(null));
    entry.altRouteMarkers = [];
  },

  _dismissAltRoutes() {
    const entry = this._getActiveDrone();
    if (entry) this._clearAltRoutes(entry);
    this._getDom().routeBar.classList.remove('visible');
  },

  _acceptAltRoute() {
    const entry = this._getActiveDrone();
    if (!entry || !entry.lastAltRoutes || !entry.lastAltRoutes[0]) {
      this._dismissAltRoutes();
      return;
    }
    const alt = entry.lastAltRoutes[0];
    const current = {
      lat: entry.telemetry.lat,
      lng: entry.telemetry.lng,
      label: 'Current Position',
      type: 'waypoint',
      alt: entry.telemetry.altitude
    };
    const newWps = [current, ...alt.waypoints];
    const completed = entry.mode === 'demo' ? entry.waypoints.slice(0, entry.simIndex + 1) : [];
    entry.waypoints = [...completed, ...newWps];

    if (entry.routePolyline) {
      entry.routePolyline.setPath(entry.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
    }
    this._rebuildWaypointMarkers(entry);
    this._renderWaypointList(entry);
    this._dismissAltRoutes();
  },

  // ══════════════════════════════════════════
  //  FLIGHT REPORT SNAPSHOT
  // ══════════════════════════════════════════

  _generateReportForActiveDrone() {
    try {
      const entry = this._getActiveDrone();
      if (!entry) {
        this._showError('No active drone selected.');
        return;
      }

      const wps = entry.waypoints || [];

      // Determine mission status
      let missionStatus;
      if (entry.missionComplete) {
        missionStatus = 'complete';
      } else if (entry.mode === 'demo') {
        const pct = wps.length > 1 ? Math.round(((entry.simIndex + entry.simFraction) / (wps.length - 1)) * 100) : 0;
        missionStatus = `in-progress (${pct}%)`;
      } else {
        const pct = wps.length > 0 ? Math.round((entry.visitedWaypoints.size / wps.length) * 100) : 0;
        missionStatus = `in-progress (${pct}%)`;
      }

      const d = this._getDom();

      // Hide the mission-complete overlay if it's showing
      if (d.missionCompleteOverlay) {
        d.missionCompleteOverlay.classList.remove('visible');
      }

      state.flightData = this._buildFlightSnapshot(entry, { status: missionStatus });

      // Only persist a completed mission once (in-progress reports stay ephemeral).
      if (entry.missionComplete && !entry._persisted) {
        entry._persisted = true;
        this._persistFlight(state.flightData);
      }

      if (_navigate) {
        _navigate('reports');
      }
    } catch (err) {
      console.error('[DroneView] Report generation error:', err);
      this._showError('Failed to generate report: ' + err.message);
    }
  },

  // ── Error Toast ──
  _showError(message) {
    const d = this._getDom();
    const existing = d.mapEl?.parentElement?.querySelector('.dv-error-toast');
    if (existing) existing.remove();
    const container = d.mapEl?.parentElement || document.body;
    const toast = document.createElement('div');
    toast.className = 'dv-error-toast';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
        <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
      </svg>
      <span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('visible')); });
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 400); }, 8000);
  },

  // ── Mission Complete Overlay ──
  _missionCompleteOverlay: null
};
