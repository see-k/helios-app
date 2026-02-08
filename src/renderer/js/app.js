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
    modelBackground: document.getElementById('modelBackground')
  };

  // ── Theme Management ──
  const Theme = {
    async init() {
      // Check for saved preference
      const saved = localStorage.getItem('helios-theme');
      if (saved) {
        this.set(saved);
      } else if (window.helios?.getTheme) {
        // Electron: use system preference
        const systemTheme = await window.helios.getTheme();
        this.set(systemTheme);
      } else {
        // Web: check prefers-color-scheme
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.set(prefersDark ? 'dark' : 'light');
      }
    },

    set(theme) {
      state.theme = theme;
      dom.html.setAttribute('data-theme', theme);
      localStorage.setItem('helios-theme', theme);

      // Notify Electron if available
      if (window.helios?.toggleTheme) {
        window.helios.toggleTheme(theme);
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
      state.activePage = page;
      dom.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
      });
      // Future: handle page routing here
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

        // Add subtle mouse tracking effect for liquid glass feel
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

  // ── Event Listeners ──
  function bindEvents() {
    // Theme toggle
    dom.themeToggle.addEventListener('click', () => Theme.toggle());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + D: Toggle theme
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        Theme.toggle();
      }
    });

    // System theme change listener (web)
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
    bindEvents();

    // Add loaded class for any post-init animations
    document.body.classList.add('app-loaded');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
