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

    // DOM shortcuts (cached on first use)
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
        formPanel: document.getElementById('missionFormPanel'),
        btnCollapse: document.getElementById('btnCollapseForm'),
        btnExpand: document.getElementById('btnExpandForm')
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
    _submitMission() {
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

      console.log('Mission planned:', mission);
      // TODO: send to backend / store locally
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
