/* ── Theme Module ── */
import { state } from '../state.js';

let _onThemeChange = null;

export const Theme = {
  async init({ onThemeChange } = {}) {
    _onThemeChange = onThemeChange || null;

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
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('helios-theme', theme);
    if (window.helios?.toggleTheme) {
      window.helios.toggleTheme(theme);
    }
    if (_onThemeChange) _onThemeChange();
  },

  toggle() {
    this.set(state.theme === 'dark' ? 'light' : 'dark');
  }
};
