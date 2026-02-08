/* ── Navigation Module ── */
import { state } from '../state.js';

let _pages = {};
let _navItems = [];
let _modelBackground = null;

export const Navigation = {
  /**
   * @param {NodeList|Array} navItems - nav button elements with data-page
   * @param {HTMLElement} modelBackground - 3D model background element
   * @param {object} pages - page registry { pageName: { el, showModel, onEnter, onLeave } }
   */
  init(navItems, modelBackground, pages) {
    _pages = pages;
    _navItems = Array.from(navItems);
    _modelBackground = modelBackground;

    _navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.setActive(item.dataset.page);
      });
    });
  },

  setActive(page) {
    const prev = state.activePage;
    if (prev === page) return;

    // Leave previous page
    const prevDef = _pages[prev];
    if (prevDef) {
      if (prevDef.onLeave) prevDef.onLeave();
      const prevEl = prevDef.el();
      if (prevEl) prevEl.style.display = 'none';
    }

    // Enter new page
    state.activePage = page;
    _navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    const nextDef = _pages[page];
    if (nextDef) {
      const nextEl = nextDef.el();
      if (nextEl) nextEl.style.display = '';
      if (_modelBackground) {
        _modelBackground.style.display = nextDef.showModel ? '' : 'none';
      }
      if (nextDef.onEnter) nextDef.onEnter();
    }
  }
};
