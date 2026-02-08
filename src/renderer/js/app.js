/* ============================================
   HELIOS APP - Main application logic
   ============================================ */

(function () {
  'use strict';

  // ── State ──
  const state = {
    theme: 'dark',
    activePage: 'dashboard',
    flightData: null // Populated when a mission finishes
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
    pageMissions: document.getElementById('pageMissions'),
    pageDroneView: document.getElementById('pageDroneView'),
    pageReports: document.getElementById('pageReports')
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
    },
    droneview: {
      el: () => dom.pageDroneView,
      showModel: false,
      onEnter: () => DroneView.onEnter(),
      onLeave: () => DroneView.onLeave()
    },
    reports: {
      el: () => dom.pageReports,
      showModel: false,
      onEnter: () => Reports.onEnter(),
      onLeave: () => Reports.onLeave()
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

  // ════════════════════════════════════════════
  //  DRONE VIEW - Live Tracking & AI Analysis
  // ════════════════════════════════════════════
  const DroneView = {
    _map: null,
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
    _dom: null,

    // Simulated mission waypoints (San Francisco area)
    _missionWaypoints: [
      { lat: 37.7749, lng: -122.4194, label: 'Take Off', type: 'takeoff', alt: 0 },
      { lat: 37.7820, lng: -122.4060, label: 'WP 1 — Financial District', type: 'waypoint', alt: 85 },
      { lat: 37.7900, lng: -122.3950, label: 'WP 2 — Embarcadero', type: 'waypoint', alt: 110 },
      { lat: 37.8025, lng: -122.4058, label: 'WP 3 — Fisherman\'s Wharf', type: 'waypoint', alt: 95 },
      { lat: 37.8080, lng: -122.4177, label: 'WP 4 — Ghirardelli Square', type: 'waypoint', alt: 75 },
      { lat: 37.7990, lng: -122.4310, label: 'WP 5 — Marina', type: 'waypoint', alt: 60 },
      { lat: 37.7749, lng: -122.4194, label: 'Return to Launch', type: 'rtl', alt: 0 }
    ],

    // Simulated live telemetry
    _telemetry: {
      altitude: 0,
      speed: 0,
      heading: 0,
      battery: 100,
      satellites: 14,
      lat: 37.7749,
      lng: -122.4194
    },

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

    init() {
      const d = this._getDom();
      d.btnFlightAnalysis.addEventListener('click', () => this._requestFlightAnalysis());
      d.btnAltRoutes.addEventListener('click', () => this._requestAltRoutes());
      d.btnCloseAnalysis.addEventListener('click', () => d.analysisPanel.classList.remove('visible'));
      d.btnDismissRoutes.addEventListener('click', () => this._dismissAltRoutes());
      d.btnAcceptRoute.addEventListener('click', () => this._acceptAltRoute());
      // Panel collapse/expand
      d.btnCollapse.addEventListener('click', () => this._togglePanel(false));
      d.btnExpand.addEventListener('click', () => this._togglePanel(true));
      // Mission complete buttons
      d.btnViewReport.addEventListener('click', () => {
        d.missionCompleteOverlay.classList.remove('visible');
        Navigation.setActive('reports');
      });
      d.btnRestartMission.addEventListener('click', () => {
        d.missionCompleteOverlay.classList.remove('visible');
        this._missionComplete = false;
        this._startSimulation();
      });
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
      // Reclaim map space
      if (this._map) {
        setTimeout(() => google.maps.event.trigger(this._map, 'resize'), 360);
      }
    },

    onEnter() {
      if (!this._mapsReady) {
        this._waitForMaps();
      } else if (this._map) {
        google.maps.event.trigger(this._map, 'resize');
        if (!this._missionComplete) this._startSimulation();
      }
    },

    onLeave() {
      this._stopSimulation();
    },

    // Wait for Google Maps to be available (shared with Missions)
    _waitForMaps() {
      if (typeof google !== 'undefined' && google.maps) {
        this._mapsReady = true;
        this._initMap();
        return;
      }
      // If maps not loaded yet, poll
      const poll = setInterval(() => {
        if (typeof google !== 'undefined' && google.maps) {
          clearInterval(poll);
          this._mapsReady = true;
          this._initMap();
        }
      }, 300);
      // Also try triggering mission page to load maps
      if (!Missions._mapsLoaded) {
        Missions._loadGoogleMaps().then(() => {
          // Maps loaded by mission, we can now init
          if (typeof google !== 'undefined' && google.maps && !this._mapsReady) {
            clearInterval(poll);
            this._mapsReady = true;
            this._initMap();
          }
        });
      }
    },

    _initMap() {
      const d = this._getDom();
      this._map = new google.maps.Map(d.mapEl, {
        center: { lat: 37.7900, lng: -122.4100 },
        zoom: 14,
        styles: this._getMapStyles(),
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
        clickableIcons: false
      });

      // Route polyline (planned route)
      this._routePolyline = new google.maps.Polyline({
        map: this._map,
        path: this._missionWaypoints.map(w => ({ lat: w.lat, lng: w.lng })),
        strokeColor: '#3b82f6',
        strokeOpacity: 0.4,
        strokeWeight: 3,
        geodesic: true
      });

      // Trail polyline (where drone has been)
      this._trailPolyline = new google.maps.Polyline({
        map: this._map,
        path: [],
        strokeColor: '#22c55e',
        strokeOpacity: 0.8,
        strokeWeight: 3,
        geodesic: true
      });

      // Waypoint markers
      this._missionWaypoints.forEach((wp, i) => {
        const len = this._missionWaypoints.length;
        let type = wp.type;
        let label = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
        const marker = new google.maps.Marker({
          position: { lat: wp.lat, lng: wp.lng },
          map: this._map,
          icon: {
            url: Missions._createMarkerIcon(label, type),
            scaledSize: new google.maps.Size(28, 37),
            anchor: new google.maps.Point(14, 37)
          },
          title: wp.label,
          zIndex: 50 + i
        });
        this._waypointMarkers.push(marker);
      });

      // Drone marker
      this._droneMarker = new google.maps.Marker({
        position: { lat: this._missionWaypoints[0].lat, lng: this._missionWaypoints[0].lng },
        map: this._map,
        icon: {
          url: this._createDroneIcon(),
          scaledSize: new google.maps.Size(40, 40),
          anchor: new google.maps.Point(20, 20)
        },
        title: 'Helios X1 — HLX-0042',
        zIndex: 1000
      });

      this._renderWaypointList();
      this._startSimulation();
      this._fetchLiveWeather();
    },

    _getMapStyles() {
      // Reuse Missions' map styles
      return Missions._getMapStyles();
    },

    _createDroneIcon() {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <defs>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="rgba(34,197,94,0.6)"/>
            </filter>
          </defs>
          <circle cx="20" cy="20" r="14" fill="#0a0a0f" stroke="#22c55e" stroke-width="2.5" filter="url(#glow)"/>
          <circle cx="20" cy="20" r="8" fill="#22c55e" fill-opacity="0.2"/>
          <polygon points="20,10 24,22 20,19 16,22" fill="#22c55e"/>
          <circle cx="20" cy="20" r="3" fill="#22c55e"/>
        </svg>`;
      return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    },

    // ── Simulation Engine ──
    _startSimulation() {
      if (this._simInterval) return;

      // Reset
      this._simIndex = 0;
      this._simFraction = 0;
      this._telemetry.battery = 100;
      this._missionComplete = false;
      this._missionStartTime = Date.now();
      this._flightLog = [
        { time: new Date().toISOString(), event: 'launch', detail: 'Drone powered up and launched from base' }
      ];
      if (this._trailPolyline) this._trailPolyline.setPath([]);
      // Hide mission complete overlay
      this._getDom().missionCompleteOverlay.classList.remove('visible');

      const stepsPerSegment = 600; // smooth, realistic movement
      const intervalMs = 100; // 10fps

      this._simInterval = setInterval(() => {
        const wps = this._missionWaypoints;
        if (this._simIndex >= wps.length - 1) {
          // Mission complete — stop and show overlay
          this._completeMission();
          return;
        }

        this._simFraction += 1 / stepsPerSegment;
        if (this._simFraction >= 1) {
          this._simFraction = 0;
          this._simIndex++;
          // Log waypoint reached
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

        // Interpolate position
        const lat = from.lat + (to.lat - from.lat) * t;
        const lng = from.lng + (to.lng - from.lng) * t;
        const alt = from.alt + (to.alt - from.alt) * t;

        // Heading
        const heading = this._bearing(from.lat, from.lng, to.lat, to.lng);

        // Speed with minor variation
        const baseSpeed = 42 + Math.sin(Date.now() / 2000) * 8;

        // Battery drain
        const totalSteps = (wps.length - 1) * stepsPerSegment;
        const currentStep = this._simIndex * stepsPerSegment + this._simFraction * stepsPerSegment;
        const battery = Math.max(8, 100 - (currentStep / totalSteps) * 85);

        // Satellites variation
        const sats = 12 + Math.round(Math.sin(Date.now() / 5000) * 3);

        // Update telemetry state
        this._telemetry = { altitude: Math.round(alt), speed: baseSpeed.toFixed(1), heading: Math.round(heading), battery: Math.round(battery), satellites: sats, lat, lng };

        // Update map
        const pos = { lat, lng };
        if (this._droneMarker) {
          this._droneMarker.setPosition(pos);
        }
        // Extend trail
        if (this._trailPolyline) {
          const path = this._trailPolyline.getPath();
          path.push(new google.maps.LatLng(lat, lng));
        }

        // Pan map to follow drone (every nth frame to avoid jitter)
        if (Math.round(this._simFraction * stepsPerSegment) % 20 === 0 && this._map) {
          this._map.panTo(pos);
        }

        // Update UI
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

      // Compute total distance
      let totalDist = 0;
      for (let i = 1; i < wps.length; i++) {
        totalDist += Missions._haversine(wps[i - 1].lat, wps[i - 1].lng, wps[i].lat, wps[i].lng);
      }
      const distStr = totalDist >= 1000 ? (totalDist / 1000).toFixed(1) + ' km' : Math.round(totalDist) + ' m';
      const batteryLeft = Math.round(this._telemetry.battery) + '%';

      // Add landing log
      this._flightLog.push({ time: new Date().toISOString(), event: 'land', detail: 'Drone landed safely at launch site' });

      // Show overlay stats
      d.mcDuration.textContent = durationStr;
      d.mcDistance.textContent = distStr;
      d.mcBattery.textContent = batteryLeft;
      d.missionCompleteOverlay.classList.add('visible');

      // Final update
      this._updateProgress();
      this._updateWaypointStatuses();

      // Store flight data for Reports
      state.flightData = {
        droneModel: 'Helios X1 — Recon',
        droneId: 'HLX-0042',
        missionStart: new Date(this._missionStartTime).toISOString(),
        missionEnd: new Date().toISOString(),
        durationMs: elapsed,
        durationStr,
        totalDistanceM: totalDist,
        distanceStr: distStr,
        batteryStart: 100,
        batteryEnd: Math.round(this._telemetry.battery),
        waypointsVisited: wps.length,
        maxAltitude: Math.max(...wps.map(w => w.alt)),
        avgSpeed: +(42 + Math.random() * 6).toFixed(1),
        maxSpeed: +(48 + Math.random() * 8).toFixed(1),
        satellites: this._telemetry.satellites,
        weatherSummary: this._getDom().weatherCondition.textContent || 'Unknown',
        flightLog: [...this._flightLog],
        waypoints: wps.map(w => ({ ...w })),
        telemetrySnapshot: { ...this._telemetry }
      };
    },

    _bearing(lat1, lng1, lat2, lng2) {
      const toRad = d => d * Math.PI / 180;
      const toDeg = r => r * 180 / Math.PI;
      const dLng = toRad(lng2 - lng1);
      const y = Math.sin(dLng) * Math.cos(toRad(lat2));
      const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    },

    // ── Telemetry UI Update ──
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

      // Battery bar
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

        // Current hour
        const hour = new Date().getHours();
        const idx = Math.min(hour, (data.hourly.time?.length || 1) - 1);

        const weatherCode = data.hourly.weathercode?.[idx];
        const info = Missions._weatherCodeToInfo(weatherCode);
        const compass = Missions._windDirToCompass(data.hourly.winddirection_10m?.[idx] || 0);
        const visKm = data.hourly.visibility?.[idx] != null ? (data.hourly.visibility[idx] / 1000).toFixed(1) : '—';

        const d = this._getDom();
        d.weatherIcon.textContent = info.icon;
        d.weatherCondition.textContent = info.label;
        d.weatherTemp.textContent = data.hourly.temperature_2m?.[idx] != null ? data.hourly.temperature_2m[idx] + '°C' : '—';
        d.weatherWind.textContent = data.hourly.windspeed_10m?.[idx] != null ? data.hourly.windspeed_10m[idx] + ' km/h' : '—';
        d.weatherWindDir.textContent = 'Wind ' + compass;
        d.weatherRain.textContent = data.hourly.precipitation_probability?.[idx] != null ? data.hourly.precipitation_probability[idx] + '%' : '—';
        d.weatherVis.textContent = visKm + ' km';
      } catch (e) {
        console.warn('Weather fetch failed:', e);
      }

      // Refresh every 5 minutes
      if (!this._weatherInterval) {
        this._weatherInterval = setInterval(() => this._fetchLiveWeather(), 300000);
      }
    },

    // ═══════════════════════════════════════════
    //  AI: FLIGHT ANALYSIS (Gemini)
    // ═══════════════════════════════════════════

    async _requestFlightAnalysis() {
      const d = this._getDom();
      let apiKey = '';
      try {
        if (window.helios?.getEnv) apiKey = await window.helios.getEnv('GEMINI_API_KEY');
      } catch (_) {}
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

        const result = await this._callGemini(apiKey, prompt);
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
          <div class="dv-analysis-stat">
            <span class="dv-analysis-stat-value">${data.performance?.efficiency || '—'}</span>
            <span class="dv-analysis-stat-label">Efficiency</span>
          </div>
          <div class="dv-analysis-stat">
            <span class="dv-analysis-stat-value">${data.performance?.estimatedTimeRemaining || '—'}</span>
            <span class="dv-analysis-stat-label">Time Left</span>
          </div>
          <div class="dv-analysis-stat">
            <span class="dv-analysis-stat-value">${data.performance?.estimatedBatteryAtLanding || '—'}</span>
            <span class="dv-analysis-stat-label">Batt @ Land</span>
          </div>
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

    // ═══════════════════════════════════════════
    //  AI: ALTERNATIVE ROUTES (Gemini)
    // ═══════════════════════════════════════════

    async _requestAltRoutes() {
      const d = this._getDom();
      let apiKey = '';
      try {
        if (window.helios?.getEnv) apiKey = await window.helios.getEnv('GEMINI_API_KEY');
      } catch (_) {}
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

        const result = await this._callGemini(apiKey, prompt);
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

        // Polyline
        const path = route.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
        const polyline = new google.maps.Polyline({
          map: this._map,
          path: path,
          strokeColor: color,
          strokeOpacity: 0,
          strokeWeight: 3,
          geodesic: true,
          icons: [{
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.8,
              strokeColor: color,
              scale: 3
            },
            offset: '0',
            repeat: '16px'
          }]
        });
        this._altRoutePolylines.push(polyline);

        // Markers
        route.waypoints.forEach((wp, wIdx) => {
          const isLast = wIdx === route.waypoints.length - 1;
          const label = isLast ? 'R' : String(wIdx + 1);
          const type = isLast ? 'rtl' : 'waypoint';
          const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lng },
            map: this._map,
            icon: {
              url: Missions._createAiMarkerIcon(label, type),
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
      // Accept the first alternative route — update mission waypoints
      if (this._lastAltRoutes && this._lastAltRoutes[0]) {
        const alt = this._lastAltRoutes[0];
        // Rebuild remaining mission from current position
        const current = { lat: this._telemetry.lat, lng: this._telemetry.lng, label: 'Current Position', type: 'waypoint', alt: this._telemetry.altitude };
        const newWps = [current, ...alt.waypoints];

        // Replace remaining portion of mission
        const completed = this._missionWaypoints.slice(0, this._simIndex + 1);
        this._missionWaypoints.length = 0;
        this._missionWaypoints.push(...completed, ...newWps);

        // Rebuild route polyline
        if (this._routePolyline) {
          this._routePolyline.setPath(this._missionWaypoints.map(w => ({ lat: w.lat, lng: w.lng })));
        }
        // Rebuild waypoint markers
        this._waypointMarkers.forEach(m => m.setMap(null));
        this._waypointMarkers = [];
        this._missionWaypoints.forEach((wp, i) => {
          const len = this._missionWaypoints.length;
          let type = wp.type;
          let label = type === 'takeoff' ? 'T' : type === 'rtl' ? 'R' : String(i);
          const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lng },
            map: this._map,
            icon: {
              url: Missions._createMarkerIcon(label, type),
              scaledSize: new google.maps.Size(28, 37),
              anchor: new google.maps.Point(14, 37)
            },
            title: wp.label,
            zIndex: 50 + i
          });
          this._waypointMarkers.push(marker);
        });
        this._renderWaypointList();
      }
      this._dismissAltRoutes();
    },

    // ═══════════════════════════════════════════
    //  GEMINI API CALL (shared)
    // ═══════════════════════════════════════════

    async _callGemini(apiKey, prompt) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
        })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody?.error?.message || `Gemini API error (${response.status})`);
      }
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        console.error('Gemini response parse error:', text);
        throw new Error('Failed to parse AI response. Please try again.');
      }
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

  // ════════════════════════════════════════════
  //  REPORTS - Post-Flight Report & AI Assessment
  // ════════════════════════════════════════════
  const Reports = {
    _dom: null,
    _aiResult: null,

    _getDom() {
      if (this._dom) return this._dom;
      this._dom = {
        container: document.getElementById('reportsContent')
      };
      return this._dom;
    },

    init() {
      // Nothing to wire until page renders
    },

    onEnter() {
      this._render();
    },

    onLeave() {
      // Preserve state
    },

    _render() {
      const d = this._getDom();
      const fd = state.flightData;

      if (!fd) {
        d.container.innerHTML = `
          <div class="rpt-no-data">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="56" height="56">
              <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>
            </svg>
            <h2 class="rpt-no-data-title">No Flight Data</h2>
            <p class="rpt-no-data-text">Complete a drone flight simulation to generate a flight report with logs, performance data, and AI assessment.</p>
            <button class="rpt-no-data-btn" id="rptGoToDrone">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Go to Drone View
            </button>
          </div>`;
        d.container.querySelector('#rptGoToDrone')?.addEventListener('click', () => Navigation.setActive('droneview'));
        return;
      }

      const startDate = new Date(fd.missionStart);
      const endDate = new Date(fd.missionEnd);
      const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const startTime = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const endTime = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const batteryUsed = fd.batteryStart - fd.batteryEnd;
      const efficiencyPct = Math.max(60, Math.min(98, Math.round(100 - batteryUsed * 0.4 + Math.random() * 8)));
      const gpsAccuracy = (1.2 + Math.random() * 0.6).toFixed(1);

      // Build flight log rows
      const logRows = fd.flightLog.map(l => {
        const t = new Date(l.time);
        const timeStr = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const badgeClass = l.event === 'launch' ? 'launch' : l.event === 'land' ? 'land' : l.event === 'warning' ? 'warning' : 'waypoint';
        const label = l.event === 'launch' ? 'Launch' : l.event === 'land' ? 'Landing' : l.event === 'warning' ? 'Warning' : 'Waypoint';
        return `<tr>
          <td class="rpt-log-time">${timeStr}</td>
          <td><span class="rpt-log-event-badge ${badgeClass}">${label}</span></td>
          <td class="rpt-log-detail">${l.detail}</td>
        </tr>`;
      }).join('');

      d.container.innerHTML = `
        <!-- Header -->
        <div class="rpt-header">
          <div class="rpt-header-left">
            <h1 class="rpt-page-title">Flight Report</h1>
            <p class="rpt-page-subtitle">${fd.droneModel} \u2022 ${fd.droneId} \u2022 ${dateStr}</p>
          </div>
          <div class="rpt-header-actions">
            <span class="rpt-header-badge rpt-badge-demo">Simulated</span>
            <span class="rpt-header-badge rpt-badge-complete">Complete</span>
          </div>
        </div>

        <!-- Mission Info Bar -->
        <div class="rpt-mission-bar">
          <div class="rpt-mission-item">
            <span class="rpt-mission-icon">\u2708\uFE0F</span>
            <div class="rpt-mission-info">
              <span class="rpt-mission-label">Drone</span>
              <span class="rpt-mission-value">${fd.droneModel}</span>
            </div>
          </div>
          <div class="rpt-mission-divider"></div>
          <div class="rpt-mission-item">
            <span class="rpt-mission-icon">\u{1F4C5}</span>
            <div class="rpt-mission-info">
              <span class="rpt-mission-label">Date</span>
              <span class="rpt-mission-value">${dateStr}</span>
            </div>
          </div>
          <div class="rpt-mission-divider"></div>
          <div class="rpt-mission-item">
            <span class="rpt-mission-icon">\u{1F551}</span>
            <div class="rpt-mission-info">
              <span class="rpt-mission-label">Window</span>
              <span class="rpt-mission-value">${startTime} \u2014 ${endTime}</span>
            </div>
          </div>
          <div class="rpt-mission-divider"></div>
          <div class="rpt-mission-item">
            <span class="rpt-mission-icon">\u2601\uFE0F</span>
            <div class="rpt-mission-info">
              <span class="rpt-mission-label">Weather</span>
              <span class="rpt-mission-value">${fd.weatherSummary}</span>
            </div>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="rpt-stats-grid">
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u23F1</span>
            <span class="rpt-stat-value">${fd.durationStr}</span>
            <span class="rpt-stat-label">Duration</span>
          </div>
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u{1F4CF}</span>
            <span class="rpt-stat-value">${fd.distanceStr}</span>
            <span class="rpt-stat-label">Distance</span>
          </div>
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u26A1</span>
            <span class="rpt-stat-value">${fd.avgSpeed}</span>
            <span class="rpt-stat-label">Avg Speed (km/h)</span>
          </div>
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u{1F6EB}</span>
            <span class="rpt-stat-value">${fd.maxAltitude}m</span>
            <span class="rpt-stat-label">Max Altitude</span>
          </div>
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u{1F50B}</span>
            <span class="rpt-stat-value">${batteryUsed}%</span>
            <span class="rpt-stat-label">Battery Used</span>
            <span class="rpt-stat-sub">${fd.batteryEnd}% remaining</span>
          </div>
          <div class="rpt-stat-card">
            <span class="rpt-stat-icon">\u{1F4CD}</span>
            <span class="rpt-stat-value">${fd.waypointsVisited}</span>
            <span class="rpt-stat-label">Waypoints</span>
            <span class="rpt-stat-sub">All visited</span>
          </div>
        </div>

        <!-- Two Column: Performance + Flight Log -->
        <div class="rpt-two-col">
          <!-- Performance -->
          <div class="rpt-section">
            <div class="rpt-section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"/></svg>
              <span class="rpt-section-title">Performance</span>
            </div>
            <div class="rpt-section-body">
              <div class="rpt-perf-grid">
                <div class="rpt-perf-row">
                  <div class="rpt-perf-label-row">
                    <span class="rpt-perf-label"><span class="rpt-perf-label-icon">\u26A1</span> Flight Efficiency</span>
                    <span class="rpt-perf-value">${efficiencyPct}%</span>
                  </div>
                  <div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill green" style="width:${efficiencyPct}%"></div></div>
                </div>
                <div class="rpt-perf-row">
                  <div class="rpt-perf-label-row">
                    <span class="rpt-perf-label"><span class="rpt-perf-label-icon">\u{1F50B}</span> Battery Efficiency</span>
                    <span class="rpt-perf-value">${fd.batteryEnd}% left</span>
                  </div>
                  <div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill blue" style="width:${fd.batteryEnd}%"></div></div>
                </div>
                <div class="rpt-perf-row">
                  <div class="rpt-perf-label-row">
                    <span class="rpt-perf-label"><span class="rpt-perf-label-icon">\u{1F4E1}</span> GPS Accuracy</span>
                    <span class="rpt-perf-value">${gpsAccuracy}m CEP</span>
                  </div>
                  <div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill purple" style="width:${Math.max(20, 100 - parseFloat(gpsAccuracy) * 30)}%"></div></div>
                </div>
                <div class="rpt-perf-row">
                  <div class="rpt-perf-label-row">
                    <span class="rpt-perf-label"><span class="rpt-perf-label-icon">\u{1F6E1}\uFE0F</span> Signal Strength</span>
                    <span class="rpt-perf-value">${fd.satellites} sats</span>
                  </div>
                  <div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill amber" style="width:${Math.min(100, fd.satellites * 7)}%"></div></div>
                </div>
                <div class="rpt-perf-row">
                  <div class="rpt-perf-label-row">
                    <span class="rpt-perf-label"><span class="rpt-perf-label-icon">\u{1F3AF}</span> Route Adherence</span>
                    <span class="rpt-perf-value">100%</span>
                  </div>
                  <div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill green" style="width:100%"></div></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Flight Log -->
          <div class="rpt-section">
            <div class="rpt-section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
              <span class="rpt-section-title">Flight Log</span>
              <span class="rpt-section-badge" style="background:rgba(var(--accent-primary-rgb),0.1);color:var(--accent-primary);">${fd.flightLog.length} events</span>
            </div>
            <div class="rpt-section-body" style="padding:12px 0;">
              <table class="rpt-log-table">
                <thead>
                  <tr><th>Time</th><th>Event</th><th>Details</th></tr>
                </thead>
                <tbody>${logRows}</tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- AI Assessment Section -->
        <div class="rpt-section rpt-ai-section">
          <div class="rpt-section-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
            <span class="rpt-section-title">AI Final Assessment</span>
            <span class="rpt-section-badge" style="background:rgba(168,85,247,0.1);color:#a855f7;">Gemini</span>
          </div>
          <div class="rpt-section-body">
            <div class="rpt-ai-body" id="rptAiBody">
              ${this._aiResult ? this._renderAiAssessment(this._aiResult) : `
              <div class="rpt-ai-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
                <p class="rpt-ai-empty-text">Generate a comprehensive AI-powered assessment of this flight, including grading, safety evaluation, and recommendations for future missions.</p>
              </div>
              <button class="rpt-ai-generate-btn" id="btnGenerateAssessment">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
                <span class="rpt-ai-btn-text">Generate AI Assessment</span>
                <div class="rpt-ai-btn-spinner"></div>
              </button>`}
            </div>
          </div>
        </div>`;

      // Wire generate button
      const genBtn = d.container.querySelector('#btnGenerateAssessment');
      if (genBtn) {
        genBtn.addEventListener('click', () => this._generateAssessment());
      }
    },

    async _generateAssessment() {
      const d = this._getDom();
      const fd = state.flightData;
      if (!fd) return;

      const btn = d.container.querySelector('#btnGenerateAssessment');
      if (btn) btn.classList.add('loading');

      let apiKey = '';
      try {
        if (window.helios?.getEnv) apiKey = await window.helios.getEnv('GEMINI_API_KEY');
      } catch (_) {}

      if (!apiKey) {
        this._showAssessmentError('Gemini API key not configured. Add GEMINI_API_KEY to .env and restart.');
        if (btn) btn.classList.remove('loading');
        return;
      }

      const prompt = `You are a senior eVTOL drone flight operations officer. Provide a comprehensive post-flight assessment for the following completed mission.

FLIGHT DATA:
- Drone: ${fd.droneModel} (ID: ${fd.droneId})
- Mission Date: ${fd.missionStart}
- Duration: ${fd.durationStr}
- Total Distance: ${fd.distanceStr}
- Battery: Started at ${fd.batteryStart}%, ended at ${fd.batteryEnd}% (${fd.batteryStart - fd.batteryEnd}% consumed)
- Average Speed: ${fd.avgSpeed} km/h, Max Speed: ${fd.maxSpeed} km/h
- Max Altitude: ${fd.maxAltitude}m
- Waypoints: ${fd.waypointsVisited} (all visited successfully)
- GPS Satellites: ${fd.satellites}
- Weather conditions: ${fd.weatherSummary}

FLIGHT LOG:
${fd.flightLog.map(l => `- [${l.event.toUpperCase()}] ${l.detail}`).join('\n')}

WAYPOINTS VISITED:
${fd.waypoints.map((w, i) => `  ${i + 1}. ${w.label} (lat: ${w.lat.toFixed(5)}, lng: ${w.lng.toFixed(5)}, alt: ${w.alt}m)`).join('\n')}

Return JSON only (no markdown, no code fences):
{
  "grade": "<A+|A|A-|B+|B|B-|C+|C|D|F>",
  "gradeTitle": "<e.g. Excellent Performance>",
  "gradeDescription": "<1 sentence about the grade>",
  "overallSummary": "<3-4 sentence comprehensive assessment>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "areasForImprovement": ["<improvement 1>", "<improvement 2>", ...],
  "safetyEvaluation": {
    "rating": "<excellent|good|acceptable|concerning|poor>",
    "notes": ["<note 1>", "<note 2>", ...]
  },
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...],
  "missionEfficiency": "<percentage string, e.g. 94%>",
  "riskEvents": <number of risk events detected>,
  "complianceStatus": "<compliant|minor-issues|non-compliant>"
}`;

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
          })
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `Gemini API error (${response.status})`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const result = JSON.parse(jsonStr);

        this._aiResult = result;
        // Re-render AI section
        const aiBody = d.container.querySelector('#rptAiBody');
        if (aiBody) {
          aiBody.innerHTML = this._renderAiAssessment(result);
        }
      } catch (err) {
        if (btn) btn.classList.remove('loading');
        this._showAssessmentError(err.message);
      }
    },

    _renderAiAssessment(data) {
      const gradeChar = (data.grade || 'B')[0].toUpperCase();
      const gradeClass = gradeChar === 'A' ? 'grade-a' : gradeChar === 'B' ? 'grade-b' : gradeChar === 'C' ? 'grade-c' : gradeChar === 'D' ? 'grade-d' : 'grade-f';

      const safetyColor = {
        excellent: '#22c55e', good: '#3b82f6', acceptable: '#eab308', concerning: '#f97316', poor: '#ef4444'
      }[data.safetyEvaluation?.rating] || '#3b82f6';

      return `
        <div class="rpt-ai-assessment">
          <div class="rpt-ai-grade-row">
            <span class="rpt-ai-grade ${gradeClass}">${data.grade || 'B'}</span>
            <div class="rpt-ai-grade-info">
              <span class="rpt-ai-grade-title">${data.gradeTitle || 'Good Performance'}</span>
              <span class="rpt-ai-grade-desc">${data.gradeDescription || ''}</span>
            </div>
          </div>

          <p class="rpt-ai-summary">${data.overallSummary || ''}</p>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <span class="rpt-header-badge" style="background:rgba(var(--accent-primary-rgb),0.1);border-color:rgba(var(--accent-primary-rgb),0.25);color:var(--accent-primary);">Efficiency: ${data.missionEfficiency || '—'}</span>
            <span class="rpt-header-badge" style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#22c55e;">Compliance: ${data.complianceStatus || '—'}</span>
            <span class="rpt-header-badge" style="background:rgba(${safetyColor === '#22c55e' ? '34,197,94' : safetyColor === '#3b82f6' ? '59,130,246' : '234,179,8'},0.1);border:1px solid rgba(${safetyColor === '#22c55e' ? '34,197,94' : safetyColor === '#3b82f6' ? '59,130,246' : '234,179,8'},0.25);color:${safetyColor};">Safety: ${data.safetyEvaluation?.rating || '—'}</span>
            <span class="rpt-header-badge" style="background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.25);color:#a855f7;">Risk Events: ${data.riskEvents ?? 0}</span>
          </div>

          ${(data.strengths || []).length ? `
          <div class="rpt-ai-block">
            <h4 class="rpt-ai-block-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" width="14" height="14"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Strengths
            </h4>
            <ul class="rpt-ai-list">${data.strengths.map(s => `<li>${s}</li>`).join('')}</ul>
          </div>` : ''}

          ${(data.areasForImprovement || []).length ? `
          <div class="rpt-ai-block">
            <h4 class="rpt-ai-block-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="1.5" width="14" height="14"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
              Areas for Improvement
            </h4>
            <ul class="rpt-ai-list">${data.areasForImprovement.map(a => `<li>${a}</li>`).join('')}</ul>
          </div>` : ''}

          ${(data.safetyEvaluation?.notes || []).length ? `
          <div class="rpt-ai-block">
            <h4 class="rpt-ai-block-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="${safetyColor}" stroke-width="1.5" width="14" height="14"><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>
              Safety Evaluation — ${(data.safetyEvaluation.rating || '').charAt(0).toUpperCase() + (data.safetyEvaluation.rating || '').slice(1)}
            </h4>
            <ul class="rpt-ai-list">${data.safetyEvaluation.notes.map(n => `<li>${n}</li>`).join('')}</ul>
          </div>` : ''}

          ${(data.recommendations || []).length ? `
          <div class="rpt-ai-block">
            <h4 class="rpt-ai-block-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5" width="14" height="14"><path d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"/></svg>
              Recommendations
            </h4>
            <ul class="rpt-ai-list">${data.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
          </div>` : ''}
        </div>`;
    },

    _showAssessmentError(message) {
      const d = this._getDom();
      const aiBody = d.container.querySelector('#rptAiBody');
      if (!aiBody) return;
      const errEl = document.createElement('div');
      errEl.style.cssText = 'padding:12px 16px;border-radius:12px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#ef4444;font-size:13px;margin-top:8px;';
      errEl.textContent = message;
      aiBody.appendChild(errEl);
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
    DroneView.init();
    Reports.init();
    bindEvents();

    document.body.classList.add('app-loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
