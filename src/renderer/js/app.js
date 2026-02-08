/* ============================================
   HELIOS APP - Main application logic
   ============================================ */

(function () {
  'use strict';

  // ── State ──
  const state = {
    theme: 'dark',
    activePage: 'dashboard'
  };

  // ── DOM References ──
  const dom = {
    html: document.documentElement,
    themeToggle: document.getElementById('themeToggle'),
    navItems: document.querySelectorAll('.nav-item'),
    pillCards: document.querySelectorAll('.pill-card'),
    modelBackground: document.getElementById('modelBackground'),
    // Pages
    mainContent: document.getElementById('mainContent'),
    pageMissions: document.getElementById('pageMissions')
  };

  // ── Page registry ──
  const pages = {
    dashboard: {
      el: () => dom.mainContent,
      showModel: true,
      onEnter: null,
      onLeave: null
    },
    missions: {
      el: () => dom.pageMissions,
      showModel: false,
      onEnter: () => Missions.onEnter(),
      onLeave: () => Missions.onLeave()
    }
  };

  // ── Theme Management ──
  const Theme = {
    async init() {
      const saved = localStorage.getItem('helios-theme');
      if (saved) {
        this.set(saved);
      } else if (window.helios?.getTheme) {
        const systemTheme = await window.helios.getTheme();
        this.set(systemTheme);
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.set(prefersDark ? 'dark' : 'light');
      }
    },

    set(theme) {
      state.theme = theme;
      dom.html.setAttribute('data-theme', theme);
      localStorage.setItem('helios-theme', theme);
      if (window.helios?.toggleTheme) {
        window.helios.toggleTheme(theme);
      }
      // Update map style if map is live
      if (Missions._map) {
        Missions._map.setOptions({ styles: Missions._getMapStyles() });
      }
    },

    toggle() {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      this.set(newTheme);
    }
  };

  // ── Navigation ──
  const Navigation = {
    init() {
      dom.navItems.forEach(item => {
        item.addEventListener('click', () => {
          const page = item.dataset.page;
          this.setActive(page);
        });
      });
    },

    setActive(page) {
      const prev = state.activePage;
      if (prev === page) return;

      // Leave previous page
      const prevDef = pages[prev];
      if (prevDef) {
        if (prevDef.onLeave) prevDef.onLeave();
        const prevEl = prevDef.el();
        if (prevEl) prevEl.style.display = 'none';
      }

      // Enter new page
      state.activePage = page;
      dom.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
      });

      const nextDef = pages[page];
      if (nextDef) {
        const nextEl = nextDef.el();
        if (nextEl) nextEl.style.display = '';
        // Show/hide 3D model background
        if (dom.modelBackground) {
          dom.modelBackground.style.display = nextDef.showModel ? '' : 'none';
        }
        if (nextDef.onEnter) nextDef.onEnter();
      }
    }
  };

  // ── Dashboard Pills ──
  const Dashboard = {
    init() {
      dom.pillCards.forEach(card => {
        card.addEventListener('click', () => {
          const action = card.dataset.action;
          this.handleAction(action);
        });

        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          card.style.setProperty('--mouse-x', `${x}%`);
          card.style.setProperty('--mouse-y', `${y}%`);
        });

        card.addEventListener('mouseleave', () => {
          card.style.removeProperty('--mouse-x');
          card.style.removeProperty('--mouse-y');
        });
      });
    },

    handleAction(action) {
      switch (action) {
        case 'support':
          console.log('Opening support...');
          break;
        case 'documentation':
          console.log('Opening documentation...');
          break;
        case 'connect':
          console.log('Opening drone connection...');
          break;
        case 'join':
          console.log('Opening join flow...');
          break;
      }
    }
  };

  // ════════════════════════════════════════════
  //  MISSIONS - Google Maps + Waypoint System
  // ════════════════════════════════════════════
  const Missions = {
    _map: null,
    _mapsLoaded: false,
    _markers: [],
    _polyline: null,
    _unit: 'kg',       // 'kg' | 'lbs'
    _waypointIdSeq: 0,
    _aiMarkers: [],
    _aiPolyline: null,

    // DOM shortcuts (cached on first use)
    _dom: null,
    _lastAiResult: null,
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
    init() {
      const d = this._getDom();
      // Waypoint bar buttons
      d.btnClear.addEventListener('click', () => this.clearWaypoints());
      d.btnUndo.addEventListener('click', () => this.undoWaypoint());
      // Unit toggle
      d.unitToggle.querySelectorAll('.unit-btn').forEach(btn => {
        btn.addEventListener('click', () => this._setUnit(btn.dataset.unit));
      });
      // Collapse / Expand
      d.btnCollapse.addEventListener('click', () => this._toggleFormPanel(false));
      d.btnExpand.addEventListener('click', () => this._toggleFormPanel(true));
      // Form submit
      d.form.addEventListener('submit', (e) => {
        e.preventDefault();
        this._submitMission();
      });
      // AI panel controls
      d.btnDismissAi.addEventListener('click', () => this._dismissAiRoute());
      d.btnReplanAi.addEventListener('click', () => this._replanMission());
      d.btnAcceptAi.addEventListener('click', () => this._acceptAiRoute());
      d.btnCloseWeather.addEventListener('click', () => d.aiWeatherPanel.classList.remove('visible'));
      d.btnCloseBriefing.addEventListener('click', () => d.aiBriefingPanel.classList.remove('visible'));
    },

    onEnter() {
      if (!this._mapsLoaded) {
        this._loadGoogleMaps();
      } else if (this._map) {
        // Trigger resize so tiles fill the area
        google.maps.event.trigger(this._map, 'resize');
      }
    },

    onLeave() {
      // No cleanup needed
    },

    // ── Google Maps Loading ──
    async _loadGoogleMaps() {
      if (this._mapsLoaded) return;
      this._mapsLoaded = true; // prevent double-load

      let apiKey = '';
      try {
        if (window.helios?.getEnv) {
          apiKey = await window.helios.getEnv('GOOGLE_MAPS_API_KEY');
        }
      } catch (_) { /* ignore */ }

      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        this._showMapFallback();
        return;
      }

      // Inject the script tag
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__heliosMapInit`;
      script.async = true;
      script.defer = true;

      // Global callback
      window.__heliosMapInit = () => {
        delete window.__heliosMapInit;
        this._initMap();
      };

      script.onerror = () => {
        this._mapsLoaded = false;
        this._showMapFallback();
      };

      document.head.appendChild(script);
    },

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

    // ── Map Initialization ──
    _initMap() {
      const d = this._getDom();
      this._map = new google.maps.Map(d.mapEl, {
        center: { lat: 37.7749, lng: -122.4194 }, // San Francisco
        zoom: 13,
        styles: this._getMapStyles(),
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.LEFT_TOP
        },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
        clickableIcons: false
      });

      // Polyline for route
      this._polyline = new google.maps.Polyline({
        map: this._map,
        path: [],
        strokeColor: '#3b82f6',
        strokeOpacity: 0.85,
        strokeWeight: 3,
        geodesic: true
      });

      // Map click → add waypoint
      this._map.addListener('click', (e) => {
        this._addWaypoint(e.latLng.lat(), e.latLng.lng());
      });
    },

    // ── Premium Map Styles ──
    _getMapStyles() {
      const isDark = state.theme === 'dark';
      if (!isDark) {
        // Clean light theme
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
      // Premium dark theme
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
    },

    // ── Custom Marker Creator ──
    _createMarkerIcon(label, type) {
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
    },

    // ── Waypoint Management ──
    _addWaypoint(lat, lng) {
      const id = ++this._waypointIdSeq;
      const count = this._markers.length;

      // Determine type
      let type, label;
      if (count === 0) {
        type = 'takeoff';
        label = 'T';
      } else {
        type = 'waypoint';
        label = String(count);
      }

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: this._map,
        icon: {
          url: this._createMarkerIcon(label, type),
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

      // Drag updates
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
        if (i === 0) {
          type = 'takeoff'; label = 'T';
        } else if (len > 1 && i === len - 1) {
          type = 'rtl'; label = 'R';
        } else {
          type = 'waypoint'; label = String(i);
        }
        m._wpType = type;
        m._wpIndex = i;
        m.setIcon({
          url: this._createMarkerIcon(label, type),
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
      // Total distance in meters
      let total = 0;
      for (let i = 1; i < this._markers.length; i++) {
        const a = this._markers[i - 1].getPosition();
        const b = this._markers[i].getPosition();
        total += google.maps.geometry
          ? google.maps.geometry.spherical.computeDistanceBetween(a, b)
          : this._haversine(a.lat(), a.lng(), b.lat(), b.lng());
      }
      return total;
    },

    _haversine(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    _updateRouteSummary() {
      const d = this._getDom();
      const count = this._markers.length;
      d.waypointCount.textContent = count;
      d.routeWaypoints.textContent = count;

      if (count < 2) {
        d.routeDistance.textContent = '—';
        return;
      }
      const meters = this._computeDistance();
      if (meters >= 1000) {
        d.routeDistance.textContent = (meters / 1000).toFixed(2) + ' km';
      } else {
        d.routeDistance.textContent = Math.round(meters) + ' m';
      }
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

      // Bind delete buttons
      d.waypointList.querySelectorAll('.waypoint-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._removeWaypointAt(parseInt(btn.dataset.index));
        });
      });

      // Click item → pan to waypoint
      d.waypointList.querySelectorAll('.waypoint-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.index);
          const marker = this._markers[idx];
          if (marker && this._map) {
            this._map.panTo(marker.getPosition());
          }
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

    // ── Collapse / Expand Form Panel ──
    _toggleFormPanel(show) {
      const d = this._getDom();
      if (show) {
        d.formPanel.classList.remove('collapsed');
        d.btnExpand.classList.remove('visible');
      } else {
        d.formPanel.classList.add('collapsed');
        d.btnExpand.classList.add('visible');
      }
      // Let Google Maps reclaim the space
      if (this._map) {
        setTimeout(() => google.maps.event.trigger(this._map, 'resize'), 360);
      }
    },

    // ── Form Submit ──
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
        droneModel,
        takeoffDate,
        loadWeight: parseFloat(loadWeight),
        weightUnit: this._unit,
        missionDescription,
        waypoints,
        totalDistance: this._computeDistance()
      };

      // Clear any previous AI results
      this._clearAiRoute();
      this._hideAiPanels();

      // Show loading
      d.btnSubmit.classList.add('loading');
      d.aiLoadingOverlay.classList.add('visible');

      // Fetch weather + AI in parallel
      try {
        const takeoffWp = waypoints[0];
        const dateStr = takeoffDate ? takeoffDate.split('T')[0] : '';

        const [weatherData, aiResult] = await Promise.allSettled([
          this._fetchWeather(takeoffWp.lat, takeoffWp.lng, dateStr),
          this._callGeminiAI(mission)
        ]);

        d.aiLoadingOverlay.classList.remove('visible');

        // Render weather panel
        if (weatherData.status === 'fulfilled' && weatherData.value) {
          this._showWeatherPanel(weatherData.value);
        }

        // Render AI route on map + briefing panel
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

    // ═══════════════════════════════════════════
    //  GEMINI AI INTEGRATION
    // ═══════════════════════════════════════════

    async _callGeminiAI(mission) {
      let apiKey = '';
      try {
        if (window.helios?.getEnv) {
          apiKey = await window.helios.getEnv('GEMINI_API_KEY');
        }
      } catch (_) { /* ignore */ }

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
    {
      "lat": <number>,
      "lng": <number>,
      "altitude_m": <recommended altitude in meters>,
      "label": "<descriptive label>",
      "type": "<takeoff|waypoint|rtl>"
    }
  ],
  "pilotBriefing": {
    "summary": "<2-3 sentence mission overview>",
    "safetyConsiderations": ["<safety item 1>", "<safety item 2>", ...],
    "recommendations": ["<recommendation 1>", "<recommendation 2>", ...],
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

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048
          }
        })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody?.error?.message || `Gemini API error (${response.status})`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON from response (strip markdown fences if present)
      const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        console.error('Gemini response parse error:', text);
        throw new Error('Failed to parse AI response. Please try again.');
      }
    },

    // ═══════════════════════════════════════════
    //  OPEN-METEO WEATHER (Free, no API key)
    // ═══════════════════════════════════════════

    async _fetchWeather(lat, lng, dateStr) {
      if (!lat || !lng) return null;

      // If no date or date is in the past, use today
      const today = new Date().toISOString().split('T')[0];
      const targetDate = dateStr && dateStr >= today ? dateStr : today;

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,visibility,weathercode`
        + `&start_date=${targetDate}&end_date=${targetDate}`
        + `&timezone=auto`;

      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.hourly || !data.hourly.time) return null;

      // Pick midday hour (12:00) or closest available
      const hours = data.hourly.time;
      let bestIdx = 0;
      for (let i = 0; i < hours.length; i++) {
        if (hours[i].includes('T12:00')) { bestIdx = i; break; }
        if (hours[i].includes('T13:00') || hours[i].includes('T11:00')) bestIdx = i;
      }

      return {
        temperature: data.hourly.temperature_2m?.[bestIdx],
        windSpeed: data.hourly.windspeed_10m?.[bestIdx],
        windDirection: data.hourly.winddirection_10m?.[bestIdx],
        precipitationProb: data.hourly.precipitation_probability?.[bestIdx],
        visibility: data.hourly.visibility?.[bestIdx],
        weatherCode: data.hourly.weathercode?.[bestIdx],
        date: targetDate
      };
    },

    _weatherCodeToInfo(code) {
      // WMO Weather interpretation codes
      const map = {
        0: { icon: '☀️', label: 'Clear Sky' },
        1: { icon: '🌤️', label: 'Mainly Clear' },
        2: { icon: '⛅', label: 'Partly Cloudy' },
        3: { icon: '☁️', label: 'Overcast' },
        45: { icon: '🌫️', label: 'Fog' },
        48: { icon: '🌫️', label: 'Rime Fog' },
        51: { icon: '🌦️', label: 'Light Drizzle' },
        53: { icon: '🌦️', label: 'Drizzle' },
        55: { icon: '🌧️', label: 'Heavy Drizzle' },
        61: { icon: '🌧️', label: 'Light Rain' },
        63: { icon: '🌧️', label: 'Rain' },
        65: { icon: '🌧️', label: 'Heavy Rain' },
        71: { icon: '🌨️', label: 'Light Snow' },
        73: { icon: '🌨️', label: 'Snow' },
        75: { icon: '❄️', label: 'Heavy Snow' },
        80: { icon: '🌦️', label: 'Rain Showers' },
        81: { icon: '🌧️', label: 'Moderate Showers' },
        82: { icon: '⛈️', label: 'Violent Showers' },
        95: { icon: '⛈️', label: 'Thunderstorm' },
        96: { icon: '⛈️', label: 'T-Storm w/ Hail' },
        99: { icon: '⛈️', label: 'Severe T-Storm' }
      };
      return map[code] || { icon: '🌡️', label: 'Unknown' };
    },

    _windDirToCompass(deg) {
      const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      return dirs[Math.round(deg / 22.5) % 16];
    },

    // ═══════════════════════════════════════════
    //  AI ROUTE DISPLAY ON MAP
    // ═══════════════════════════════════════════

    _createAiMarkerIcon(label, type) {
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
    },

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
            url: this._createAiMarkerIcon(label, type),
            scaledSize: new google.maps.Size(32, 32),
            anchor: new google.maps.Point(16, 30)
          },
          title: `AI: ${wp.label || this._waypointLabel(type, i)}` + (wp.altitude_m ? ` (${wp.altitude_m}m)` : ''),
          zIndex: 200 + i
        });
        this._aiMarkers.push(marker);
      });

      // Dashed polyline for AI route
      this._aiPolyline = new google.maps.Polyline({
        map: this._map,
        path: path,
        strokeColor: '#a855f7',
        strokeOpacity: 0,
        strokeWeight: 3,
        geodesic: true,
        icons: [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 0.8,
            strokeColor: '#a855f7',
            scale: 3
          },
          offset: '0',
          repeat: '16px'
        }]
      });
    },

    _clearAiRoute() {
      this._aiMarkers.forEach(m => m.setMap(null));
      this._aiMarkers = [];
      if (this._aiPolyline) {
        this._aiPolyline.setMap(null);
        this._aiPolyline = null;
      }
    },

    // ═══════════════════════════════════════════
    //  FLOATING PANEL RENDERERS
    // ═══════════════════════════════════════════

    _showWeatherPanel(w) {
      const d = this._getDom();
      const info = this._weatherCodeToInfo(w.weatherCode);
      const compass = this._windDirToCompass(w.windDirection || 0);
      const visKm = w.visibility != null ? (w.visibility / 1000).toFixed(1) : '—';

      d.aiWeatherBody.innerHTML = `
        <div class="weather-card weather-card-wide">
          <span class="weather-card-icon">${info.icon}</span>
          <span class="weather-card-value">${info.label}</span>
          <span class="weather-card-label">Conditions</span>
        </div>
        <div class="weather-card">
          <span class="weather-card-icon">🌡️</span>
          <span class="weather-card-value">${w.temperature != null ? w.temperature + '°C' : '—'}</span>
          <span class="weather-card-label">Temp</span>
        </div>
        <div class="weather-card">
          <span class="weather-card-icon">💨</span>
          <span class="weather-card-value">${w.windSpeed != null ? w.windSpeed + ' km/h' : '—'}</span>
          <span class="weather-card-label">Wind ${compass}</span>
        </div>
        <div class="weather-card">
          <span class="weather-card-icon">🌧️</span>
          <span class="weather-card-value">${w.precipitationProb != null ? w.precipitationProb + '%' : '—'}</span>
          <span class="weather-card-label">Rain</span>
        </div>
        <div class="weather-card">
          <span class="weather-card-icon">👁️</span>
          <span class="weather-card-value">${visKm} km</span>
          <span class="weather-card-label">Visibility</span>
        </div>`;

      d.aiWeatherPanel.classList.add('visible');
    },

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
          <div class="briefing-stat">
            <span class="briefing-stat-value">${briefing.estimatedFlightTime || '—'}</span>
            <span class="briefing-stat-label">Flight Time</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-value">${briefing.maxAltitude || '—'}</span>
            <span class="briefing-stat-label">Max Alt</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-value">${risk.charAt(0).toUpperCase() + risk.slice(1)}</span>
            <span class="briefing-stat-label">Risk</span>
          </div>
        </div>

        ${safetyItems ? `
        <div class="briefing-block">
          <div class="briefing-block-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" width="13" height="13">
              <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
            </svg>
            Safety
          </div>
          <ul class="briefing-list">${safetyItems}</ul>
        </div>` : ''}

        ${recoItems ? `
        <div class="briefing-block">
          <div class="briefing-block-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" width="13" height="13">
              <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Recommendations
          </div>
          <ul class="briefing-list">${recoItems}</ul>
        </div>` : ''}`;

      d.aiBriefingPanel.classList.add('visible');
    },

    _hideAiPanels() {
      const d = this._getDom();
      d.aiLoadingOverlay.classList.remove('visible');
      d.aiControlBar.classList.remove('visible');
      d.aiWeatherPanel.classList.remove('visible');
      d.aiBriefingPanel.classList.remove('visible');
      // Remove error toast if any
      const toast = d.mapEl.parentElement.querySelector('.ai-error-toast');
      if (toast) toast.remove();
    },

    _dismissAiRoute() {
      this._clearAiRoute();
      this._hideAiPanels();
      this._lastAiResult = null;
    },

    _acceptAiRoute() {
      if (!this._lastAiResult?.optimizedWaypoints) {
        this._dismissAiRoute();
        return;
      }

      // Clear user markers and AI overlay
      this._markers.forEach(m => m.setMap(null));
      this._markers = [];
      this._clearAiRoute();
      this._hideAiPanels();

      // Re-add waypoints from AI result
      for (const wp of this._lastAiResult.optimizedWaypoints) {
        this._addWaypoint(wp.lat, wp.lng);
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
      // Remove any existing toast
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

      requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
      });

      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
      }, 8000);
    }
  };

  // ── Event Listeners ──
  function bindEvents() {
    dom.themeToggle.addEventListener('click', () => Theme.toggle());

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        Theme.toggle();
      }
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('helios-theme')) {
        Theme.set(e.matches ? 'dark' : 'light');
      }
    });
  }

  // ── Initialize ──
  async function init() {
    await Theme.init();
    Navigation.init();
    Dashboard.init();
    Missions.init();
    bindEvents();

    document.body.classList.add('app-loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
