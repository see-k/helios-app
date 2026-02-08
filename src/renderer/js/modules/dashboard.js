/* ── Dashboard Module ── */

let _navigate = null;

export const Dashboard = {
  init(pillCards, { navigate } = {}) {
    _navigate = navigate;
    pillCards.forEach(card => {
      card.addEventListener('click', () => {
        this._handleAction(card.dataset.action);
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

  _handleAction(action) {
    switch (action) {
      case 'support':
        console.log('Opening support...');
        break;
      case 'documentation':
        console.log('Opening documentation...');
        break;
      case 'fleet':
        if (_navigate) _navigate('fleet');
        break;
      case 'join':
        console.log('Opening join flow...');
        break;
    }
  }
};
