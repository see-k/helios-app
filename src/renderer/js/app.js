/* ============================================
   HELIOS APP — Modular Entry Point
   ============================================ */

import { Theme } from './modules/theme.js';
import { Navigation } from './modules/navigation.js';
import { Dashboard } from './modules/dashboard.js';
import { Missions } from './modules/missions.js';
import { DroneView } from './modules/droneview.js';
import { Reports } from './modules/reports.js';
import { Fleet } from './modules/fleet.js';

// ── DOM References ──
const dom = {
  themeToggle: document.getElementById('themeToggle'),
  navItems: document.querySelectorAll('.nav-item'),
  pillCards: document.querySelectorAll('.pill-card'),
  modelBackground: document.getElementById('modelBackground'),
  mainContent: document.getElementById('mainContent'),
  pageMissions: document.getElementById('pageMissions'),
  pageDroneView: document.getElementById('pageDroneView'),
  pageFleet: document.getElementById('pageFleet'),
  pageReports: document.getElementById('pageReports')
};

// ── Cross-module callback: navigate ──
const navigate = (page) => Navigation.setActive(page);

// ── Page registry (wires lifecycle hooks without circular imports) ──
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
  fleet: {
    el: () => dom.pageFleet,
    showModel: false,
    onEnter: () => Fleet.onEnter(),
    onLeave: () => Fleet.onLeave()
  },
  reports: {
    el: () => dom.pageReports,
    showModel: false,
    onEnter: () => Reports.onEnter(),
    onLeave: () => Reports.onLeave()
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
  // Theme (with cross-module style update callback)
  await Theme.init({
    onThemeChange: () => {
      Missions.updateMapStyles();
      DroneView.updateMapStyles();
    }
  });

  // Navigation (page registry, no direct module imports)
  Navigation.init(dom.navItems, dom.modelBackground, pages);

  // Dashboard pill cards
  Dashboard.init(dom.pillCards, { navigate });

  // Missions (callbacks for cross-module actions)
  Missions.init({
    navigate,
    setDroneViewWaypoints: (wps) => DroneView.setMissionWaypoints(wps)
  });

  // Drone View
  DroneView.init({ navigate });

  // Reports
  Reports.init({ navigate });

  // Fleet
  Fleet.init({ navigate });

  // Global events
  bindEvents();

  document.body.classList.add('app-loaded');
}

init();
