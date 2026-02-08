/* ── DroneView Module — Live Tracking, Simulation & AI Analysis ── */
import { state } from '../state.js';
import { getMapStyles, createMarkerIcon, createAiMarkerIcon, createDroneIcon, haversine, bearing } from '../utils/maps.js';
import { callGemini, getGeminiApiKey } from '../services/gemini.js';
import { weatherCodeToInfo, windDirToCompass } from '../services/weather.js';
import { loadGoogleMaps } from '../services/maps-loader.js';

// ── Injected callback (set via init) ──
let _navigate = null;

export const DroneView = {
  _map: null,
  _loadAttempted: false,
  _mapsReady: false,
  _droneMarker: null,
  _routePolyline: null,
  _trailPolyline: null,
  _waypointMarkers: [],
  _altRoutePolylines: [],
  _altRouteMarkers: [],
  _simInterval: null,
  _weatherInterval: null,
  _simIndex: 0,
  _simFraction: 0,
  _missionStartTime: null,
  _missionComplete: false,
  _flightLog: [],
  _lastAltRoutes: null,
  _dom: null,

  // Simulated mission waypoints (San Francisco default)
  _missionWaypoints: [
    { lat: 37.7749, lng: -122.4194, label: 'Take Off', type: 'takeoff', alt: 0 },
    { lat: 37.7820, lng: -122.4060, label: 'WP 1 — Financial District', type: 'waypoint', alt: 85 },
    { lat: 37.7900, lng: -122.3950, label: 'WP 2 — Embarcadero', type: 'waypoint', alt: 110 },
    { lat: 37.8025, lng: -122.4058, label: 'WP 3 — Fisherman\'s Wharf', type: 'waypoint', alt: 95 },
    { lat: 37.8080, lng: -122.4177, label: 'WP 4 — Ghirardelli Square', type: 'waypoint', alt: 75 },
    { lat: 37.7990, lng: -122.4310, label: 'WP 5 — Marina', type: 'waypoint', alt: 60 },
    { lat: 37.7749, lng: -122.4194, label: 'Return to Launch', type: 'rtl', alt: 0 }
  ],

  _telemetry: {
    altitude: 0,
    speed: 0,
    heading: 0,
    battery: 100,
    satellites: 14,
    lat: 37.7749,
    lng: -122.4194
  },

  // ── DOM Cache ──
  _getDom() {
    if (this._dom) return this._dom;
    this._dom = {
      mapEl: document.getElementById('droneviewMap'),
      // Telemetry
      altitude: document.getElementById('dvAltitude'),
      speed: document.getElementById('dvSpeed'),
      heading: document.getElementById('dvHeading'),
      satellites: document.getElementById('dvSatellites'),
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
      btnRestartMission: document.getElementById('btnRestartMission')
    };
    return this._dom;
  },

  // ── Lifecycle ──
  init({ navigate } = {}) {
    _navigate = navigate;
    const d = this._getDom();

    d.btnFlightAnalysis.addEventListener('click', () => this._requestFlightAnalysis());
    d.btnAltRoutes.addEventListener('click', () => this._requestAltRoutes());
    d.btnCloseAnalysis.addEventListener('click', () => d.analysisPanel.classList.remove('visible'));
    d.btnDismissRoutes.addEventListener('click', () => this._dismissAltRoutes());
    d.btnAcceptRoute.addEventListener('click', () => this._acceptAltRoute());
    d.btnCollapse.addEventListener('click', () => this._togglePanel(false));
    d.btnExpand.addEventListener('click', () => this._togglePanel(true));

    d.btnViewReport.addEventListener('click', () => {
      d.missionCompleteOverlay.classList.remove('visible');
      if (_navigate) _navigate('reports');
    });
    d.btnRestartMission.addEventListener('click', () => {
      d.missionCompleteOverlay.classList.remove('visible');
      this._missionComplete = false;
      this._startSimulation();
    });
  },

  async onEnter() {
    if (!this._loadAttempted) {
      this._loadAttempted = true;
      const loaded = await loadGoogleMaps();
      if (loaded) {
        this._mapsReady = true;
        this._initMap();
      }
    } else if (this._map) {
      google.maps.event.trigger(this._map, 'resize');
      if (!this._missionComplete) this._startSimulation();
    }
  },

  onLeave() {
    this._stopSimulation();
  },

  /** Called by Theme when theme changes. */
  updateMapStyles() {
    if (this._map) {
      this._map.setOptions({ styles: getMapStyles() });
    }
  },

  // ── External API ──
  setMissionWaypoints(waypoints) {
    const normalized = this._normalizeMissionWaypoints(waypoints);
    if (normalized.length < 2) return;
    this._missionWaypoints = normalized;
    this._resetTelemetryToMissionStart();

    if (this._mapsReady && this._map) {
      const shouldRestart = state.activePage === 'droneview';
      this._applyMissionWaypointsToMap({ restartSimulation: shouldRestart });
    }
  },

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

  _resetTelemetryToMissionStart() {
    const launch = this._missionWaypoints[0];
    if (!launch) return;
    this._telemetry = {
      ...this._telemetry,
      altitude: Math.round(launch.alt || 0),
      speed: 0,
      heading: 0,
      battery: 100,
      lat: launch.lat,
      lng: launch.lng
    };
  },

  // ── Map Initialization ──
  _initMap() {
    const d = this._getDom();
    this._map = new google.maps.Map(d.mapEl, {
      center: { lat: 37.7900, lng: -122.4100 },
      zoom: 14,
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

    this._routePolyline = new google.maps.Polyline({
      map: this._map,
      path: this._missionWaypoints.map(w => ({ lat: w.lat, lng: w.lng })),
      strokeColor: '#3b82f6',
      strokeOpacity: 0.4,
      strokeWeight: 3,
      geodesic: true
    });

    this._trailPolyline = new google.maps.Polyline({
      map: this._map,
      path: [],
      strokeColor: '#22c55e',
      strokeOpacity: 0.8,
      strokeWeight: 3,
      geodesic: true
    });

    this._rebuildWaypointMarkers();

    const launch = this._missionWaypoints[0] || { lat: 37.7749, lng: -122.4194 };
    this._droneMarker = new google.maps.Marker({
      position: { lat: launch.lat, lng: launch.lng },
      map: this._map,
      icon: {
        url: createDroneIcon(),
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 20)
      },
      title: 'Helios X1 — HLX-0042',
      zIndex: 1000
    });

    this._resetTelemetryToMissionStart();
    this._renderWaypointList();
    this._updateTelemetryUI();
    this._startSimulation();
    this._fetchLiveWeather();
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

  _rebuildWaypointMarkers() {
    this._waypointMarkers.forEach(m => m.setMap(null));
    this._waypointMarkers = [];

    this._missionWaypoints.forEach((wp, i) => {
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
        title: wp.label,
        zIndex: 50 + i
      });
      this._waypointMarkers.push(marker);
    });
  },

  _applyMissionWaypointsToMap({ restartSimulation = false } = {}) {
    if (!this._map || this._missionWaypoints.length < 2) return;

    if (this._simInterval) {
      clearInterval(this._simInterval);
      this._simInterval = null;
    }

    this._missionComplete = false;
    this._simIndex = 0;
    this._simFraction = 0;
    this._resetTelemetryToMissionStart();

    if (this._routePolyline) {
      this._routePolyline.setPath(this._missionWaypoints.map(w => ({ lat: w.lat, lng: w.lng })));
    }
    if (this._trailPolyline) {
      this._trailPolyline.setPath([]);
    }

    this._rebuildWaypointMarkers();

    const launch = this._missionWaypoints[0];
    if (this._droneMarker && launch) {
      this._droneMarker.setPosition({ lat: launch.lat, lng: launch.lng });
    }
    if (this._map && launch) {
      this._map.panTo({ lat: launch.lat, lng: launch.lng });
    }

    const d = this._getDom();
    d.missionCompleteOverlay.classList.remove('visible');
    this._renderWaypointList();
    this._updateTelemetryUI();
    this._updateProgress();
    this._updateWaypointStatuses();
    this._fetchLiveWeather();

    if (restartSimulation) {
      this._startSimulation();
    }
  },

  // ══════════════════════════════════════════
  //  SIMULATION ENGINE
  // ══════════════════════════════════════════

  _startSimulation() {
    if (this._simInterval) return;

    this._simIndex = 0;
    this._simFraction = 0;
    this._telemetry.battery = 100;
    this._missionComplete = false;
    this._missionStartTime = Date.now();
    this._flightLog = [
      { time: new Date().toISOString(), event: 'launch', detail: 'Drone powered up and launched from base' }
    ];
    if (this._trailPolyline) this._trailPolyline.setPath([]);
    this._getDom().missionCompleteOverlay.classList.remove('visible');

    const stepsPerSegment = 600;
    const intervalMs = 100;

    this._simInterval = setInterval(() => {
      const wps = this._missionWaypoints;
      if (this._simIndex >= wps.length - 1) {
        this._completeMission();
        return;
      }

      this._simFraction += 1 / stepsPerSegment;
      if (this._simFraction >= 1) {
        this._simFraction = 0;
        this._simIndex++;
        if (this._simIndex < wps.length) {
          const reachedWp = wps[this._simIndex];
          this._flightLog.push({
            time: new Date().toISOString(),
            event: reachedWp.type === 'rtl' ? 'land' : 'waypoint',
            detail: `${reachedWp.label} reached at altitude ${reachedWp.alt}m`
          });
        }
        if (this._simIndex >= wps.length - 1) return;
      }

      const from = wps[this._simIndex];
      const to = wps[this._simIndex + 1];
      const t = this._simFraction;

      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      const alt = from.alt + (to.alt - from.alt) * t;
      const hdg = bearing(from.lat, from.lng, to.lat, to.lng);
      const baseSpeed = 42 + Math.sin(Date.now() / 2000) * 8;

      const totalSteps = (wps.length - 1) * stepsPerSegment;
      const currentStep = this._simIndex * stepsPerSegment + this._simFraction * stepsPerSegment;
      const batt = Math.max(8, 100 - (currentStep / totalSteps) * 85);

      const sats = 12 + Math.round(Math.sin(Date.now() / 5000) * 3);

      this._telemetry = {
        altitude: Math.round(alt),
        speed: baseSpeed.toFixed(1),
        heading: Math.round(hdg),
        battery: Math.round(batt),
        satellites: sats,
        lat, lng
      };

      const pos = { lat, lng };
      if (this._droneMarker) this._droneMarker.setPosition(pos);
      if (this._trailPolyline) {
        const path = this._trailPolyline.getPath();
        path.push(new google.maps.LatLng(lat, lng));
      }
      if (Math.round(this._simFraction * stepsPerSegment) % 20 === 0 && this._map) {
        this._map.panTo(pos);
      }

      this._updateTelemetryUI();
      this._updateProgress();
      this._updateWaypointStatuses();
    }, intervalMs);
  },

  _stopSimulation() {
    if (this._simInterval) {
      clearInterval(this._simInterval);
      this._simInterval = null;
    }
    if (this._weatherInterval) {
      clearInterval(this._weatherInterval);
      this._weatherInterval = null;
    }
  },

  _completeMission() {
    this._stopSimulation();
    this._missionComplete = true;

    const d = this._getDom();
    const wps = this._missionWaypoints;
    const elapsed = Date.now() - this._missionStartTime;
    const durationMin = Math.round(elapsed / 60000);
    const durationStr = durationMin < 1 ? '<1 min' : durationMin + ' min';

    let totalDist = 0;
    for (let i = 1; i < wps.length; i++) {
      totalDist += haversine(wps[i - 1].lat, wps[i - 1].lng, wps[i].lat, wps[i].lng);
    }
    const distStr = totalDist >= 1000 ? (totalDist / 1000).toFixed(1) + ' km' : Math.round(totalDist) + ' m';
    const batteryLeft = Math.round(this._telemetry.battery) + '%';

    this._flightLog.push({ time: new Date().toISOString(), event: 'land', detail: 'Drone landed safely at launch site' });

    d.mcDuration.textContent = durationStr;
    d.mcDistance.textContent = distStr;
    d.mcBattery.textContent = batteryLeft;
    d.missionCompleteOverlay.classList.add('visible');

    this._updateProgress();
    this._updateWaypointStatuses();

    // Store in shared state for Reports
    state.flightData = {
      droneModel: 'Helios X1 — Recon',
      droneId: 'HLX-0042',
      missionStart: new Date(this._missionStartTime).toISOString(),
      missionEnd: new Date().toISOString(),
      durationMs: elapsed,
      durationStr,
      totalDistanceM: totalDist,
      distanceStr,
      batteryStart: 100,
      batteryEnd: Math.round(this._telemetry.battery),
      waypointsVisited: wps.length,
      maxAltitude: Math.max(...wps.map(w => w.alt)),
      avgSpeed: +(42 + Math.random() * 6).toFixed(1),
      maxSpeed: +(48 + Math.random() * 8).toFixed(1),
      satellites: this._telemetry.satellites,
      weatherSummary: d.weatherCondition.textContent || 'Unknown',
      flightLog: [...this._flightLog],
      waypoints: wps.map(w => ({ ...w })),
      telemetrySnapshot: { ...this._telemetry }
    };
  },

  // ── Telemetry UI ──
  _updateTelemetryUI() {
    const d = this._getDom();
    const t = this._telemetry;
    d.altitude.textContent = t.altitude;
    d.speed.textContent = t.speed;
    d.heading.textContent = Math.round(t.heading) + '°';
    d.satellites.textContent = t.satellites;
    d.battery.textContent = Math.round(t.battery) + '%';
    d.lat.textContent = t.lat.toFixed(5);
    d.lng.textContent = t.lng.toFixed(5);

    const bPct = Math.round(t.battery);
    d.batteryFill.style.width = bPct + '%';
    d.batteryFill.className = 'dv-battery-fill ' + (bPct > 50 ? 'high' : bPct > 20 ? 'medium' : 'low');
  },

  _updateProgress() {
    const d = this._getDom();
    const wps = this._missionWaypoints;
    const totalSegments = wps.length - 1;
    const pct = Math.min(100, ((this._simIndex + this._simFraction) / totalSegments) * 100);
    d.progressPct.textContent = Math.round(pct) + '%';
    d.progressFill.style.width = pct + '%';
  },

  // ── Waypoint List ──
  _renderWaypointList() {
    const d = this._getDom();
    d.waypointList.innerHTML = this._missionWaypoints.map((wp, i) => {
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

  _updateWaypointStatuses() {
    const wps = this._missionWaypoints;
    wps.forEach((wp, i) => {
      const el = document.getElementById(`dvWpStatus${i}`);
      if (!el) return;
      if (i < this._simIndex) {
        el.textContent = 'Reached';
        el.className = 'dv-wp-status reached';
        el.closest('.dv-wp-item').classList.add('completed');
        el.closest('.dv-wp-item').classList.remove('active');
      } else if (i === this._simIndex) {
        el.textContent = 'Active';
        el.className = 'dv-wp-status next';
        el.closest('.dv-wp-item').classList.remove('completed');
        el.closest('.dv-wp-item').classList.add('active');
      } else {
        el.textContent = 'Pending';
        el.className = 'dv-wp-status pending';
        el.closest('.dv-wp-item').classList.remove('completed', 'active');
      }
    });
  },

  // ── Live Weather ──
  async _fetchLiveWeather() {
    try {
      const wp = this._missionWaypoints[0];
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
    const d = this._getDom();
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      this._showError('Gemini API key not configured. Add GEMINI_API_KEY to .env and restart.');
      return;
    }

    d.btnFlightAnalysis.classList.add('loading');
    d.loadingOverlay.classList.add('visible');

    try {
      const t = this._telemetry;
      const wps = this._missionWaypoints;
      const completedPct = Math.round(((this._simIndex + this._simFraction) / (wps.length - 1)) * 100);

      const prompt = `You are an expert eVTOL drone flight analyst. Analyze this LIVE in-progress flight and provide a real-time assessment.

LIVE TELEMETRY:
- Drone: Helios X1 Recon (HLX-0042)
- Current Position: lat ${t.lat.toFixed(6)}, lng ${t.lng.toFixed(6)}
- Altitude: ${t.altitude}m
- Ground Speed: ${t.speed} km/h
- Heading: ${t.heading}°
- Battery: ${Math.round(t.battery)}%
- GPS Satellites: ${t.satellites}
- Mission Progress: ${completedPct}%
- Current Waypoint Index: ${this._simIndex + 1} of ${wps.length}

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
  "observations": ["<observation 1>", "<observation 2>", ...],
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...],
  "alerts": ["<any urgent alerts, or empty array>"]
}`;

      const result = await callGemini(apiKey, prompt);
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
    const d = this._getDom();
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      this._showError('Gemini API key not configured. Add GEMINI_API_KEY to .env and restart.');
      return;
    }

    d.btnAltRoutes.classList.add('loading');
    d.loadingOverlay.classList.add('visible');

    try {
      const t = this._telemetry;
      const wps = this._missionWaypoints;
      const remainingWps = wps.slice(this._simIndex);

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
- Keep waypoints within 5km of the original route corridor (San Francisco area)
- Recommend practical alternatives (shorter, wind-optimized, safer altitude, etc.)
- 3-5 waypoints per alternative route
- Altitudes between 30-120m`;

      const result = await callGemini(apiKey, prompt);
      d.loadingOverlay.classList.remove('visible');
      d.btnAltRoutes.classList.remove('loading');
      if (result.alternatives && result.alternatives.length > 0) {
        this._lastAltRoutes = result.alternatives;
        this._showAltRoutes(result.alternatives);
      } else {
        this._showError('No alternative routes returned. Try again.');
      }
    } catch (err) {
      d.loadingOverlay.classList.remove('visible');
      d.btnAltRoutes.classList.remove('loading');
      this._showError(err.message);
    }
  },

  _showAltRoutes(alternatives) {
    this._clearAltRoutes();
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
      this._altRoutePolylines.push(polyline);

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
        this._altRouteMarkers.push(marker);
      });
    });

    d.routeBar.classList.add('visible');
  },

  _clearAltRoutes() {
    this._altRoutePolylines.forEach(p => p.setMap(null));
    this._altRoutePolylines = [];
    this._altRouteMarkers.forEach(m => m.setMap(null));
    this._altRouteMarkers = [];
  },

  _dismissAltRoutes() {
    this._clearAltRoutes();
    this._getDom().routeBar.classList.remove('visible');
    this._lastAltRoutes = null;
  },

  _acceptAltRoute() {
    if (this._lastAltRoutes && this._lastAltRoutes[0]) {
      const alt = this._lastAltRoutes[0];
      const current = {
        lat: this._telemetry.lat,
        lng: this._telemetry.lng,
        label: 'Current Position',
        type: 'waypoint',
        alt: this._telemetry.altitude
      };
      const newWps = [current, ...alt.waypoints];
      const completed = this._missionWaypoints.slice(0, this._simIndex + 1);
      this._missionWaypoints.length = 0;
      this._missionWaypoints.push(...completed, ...newWps);

      if (this._routePolyline) {
        this._routePolyline.setPath(this._missionWaypoints.map(w => ({ lat: w.lat, lng: w.lng })));
      }
      this._rebuildWaypointMarkers();
      this._renderWaypointList();
    }
    this._dismissAltRoutes();
  },

  // ── Error Toast ──
  _showError(message) {
    const d = this._getDom();
    const existing = d.mapEl.parentElement.querySelector('.dv-error-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'dv-error-toast';
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
