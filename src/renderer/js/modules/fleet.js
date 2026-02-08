/* ── Fleet Module ── */
import { state } from '../state.js';

let _navigate = null;
let _drones = [];
let _editingId = null;
let _connectionVerified = false;

/* ── Icon SVGs ── */
const icons = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 5v14m-7-7h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>',
  ping: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.788m13.788 0c3.808 3.808 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>',
  drone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M6 18L18 6M6 6l12 12"/></svg>',
  fleet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>'
};

/* ── Status config ── */
const statusConfig = {
  online:       { label: 'Online',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  offline:      { label: 'Offline',      color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  maintenance:  { label: 'Maintenance',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'in-flight':  { label: 'In Flight',    color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  error:        { label: 'Error',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
};

const droneTypes = [
  { value: 'quadcopter', label: 'Quadcopter' },
  { value: 'hexacopter', label: 'Hexacopter' },
  { value: 'octocopter', label: 'Octocopter' },
  { value: 'fixed-wing', label: 'Fixed Wing' },
  { value: 'vtol', label: 'VTOL Hybrid' },
  { value: 'evtol', label: 'eVTOL' }
];

export const Fleet = {
  init({ navigate }) {
    _navigate = navigate;
    this._bindEvents();
  },

  _bindEvents() {
    // Add drone button
    document.getElementById('btnAddDrone')?.addEventListener('click', () => this._showForm());
    // Refresh button
    document.getElementById('btnRefreshFleet')?.addEventListener('click', () => this._loadDrones());
    // Form cancel
    document.getElementById('btnCancelDrone')?.addEventListener('click', () => this._hideForm());
    // Form submit
    document.getElementById('droneForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveDrone();
    });
    // Modal backdrop click
    document.getElementById('fleetFormOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this._hideForm();
    });
    // Test connection button
    document.getElementById('btnTestConnection')?.addEventListener('click', () => this._testConnection());
    // Reset connection state when hostname changes
    document.getElementById('droneHostname')?.addEventListener('input', () => this._resetConnectionState());
  },

  async onEnter() {
    await this._loadDrones();
  },

  onLeave() {
    this._hideForm();
  },

  /* ── Data ── */
  async _loadDrones() {
    try {
      _drones = await window.helios.fleetGetAll();
      this._renderList();
    } catch (err) {
      console.error('Failed to load drones:', err);
      _drones = [];
      this._renderList();
    }
  },

  /* ── Rendering ── */
  _renderList() {
    const container = document.getElementById('fleetDroneList');
    const emptyState = document.getElementById('fleetEmptyState');
    const countEl = document.getElementById('fleetDroneCount');
    if (!container) return;

    if (countEl) countEl.textContent = _drones.length;

    if (_drones.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = '';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = _drones.map(drone => {
      const st = statusConfig[drone.status] || statusConfig.offline;
      const lastPing = drone.last_ping ? new Date(drone.last_ping + 'Z').toLocaleString() : 'Never';
      return `
        <div class="fleet-drone-card" data-drone-id="${drone.id}">
          <div class="fleet-drone-header">
            <div class="fleet-drone-info">
              <div class="fleet-drone-icon">${icons.drone}</div>
              <div class="fleet-drone-meta">
                <span class="fleet-drone-name">${this._esc(drone.name)}</span>
                <span class="fleet-drone-host">${this._esc(drone.hostname)}</span>
              </div>
            </div>
            <span class="fleet-status-badge" style="color:${st.color};background:${st.bg}">
              <span class="fleet-status-dot" style="background:${st.color}"></span>
              ${st.label}
            </span>
          </div>
          <div class="fleet-drone-details">
            <div class="fleet-detail-item">
              <span class="fleet-detail-label">Type</span>
              <span class="fleet-detail-value">${this._esc(this._typeLabel(drone.drone_type))}</span>
            </div>
            <div class="fleet-detail-item">
              <span class="fleet-detail-label">Model</span>
              <span class="fleet-detail-value">${this._esc(drone.model || '—')}</span>
            </div>
            <div class="fleet-detail-item">
              <span class="fleet-detail-label">Serial</span>
              <span class="fleet-detail-value">${this._esc(drone.serial_number || '—')}</span>
            </div>
            <div class="fleet-detail-item">
              <span class="fleet-detail-label">Last Ping</span>
              <span class="fleet-detail-value">${lastPing}</span>
            </div>
          </div>
          <div class="fleet-drone-actions">
            <button class="fleet-action-btn fleet-btn-ping" data-action="ping" data-id="${drone.id}" title="Ping drone">
              ${icons.ping}
              <span>Ping</span>
            </button>
            <button class="fleet-action-btn fleet-btn-edit" data-action="edit" data-id="${drone.id}" title="Edit drone">
              ${icons.edit}
              <span>Edit</span>
            </button>
            <button class="fleet-action-btn fleet-btn-delete" data-action="delete" data-id="${drone.id}" title="Delete drone">
              ${icons.trash}
              <span>Delete</span>
            </button>
          </div>
          <div class="fleet-ping-result" id="pingResult-${drone.id}"></div>
        </div>
      `;
    }).join('');

    // Bind card action buttons
    container.querySelectorAll('.fleet-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === 'ping') this._pingDrone(id, btn);
        else if (action === 'edit') this._editDrone(id);
        else if (action === 'delete') this._deleteDrone(id);
      });
    });
  },

  /* ── Actions ── */
  async _pingDrone(id, btn) {
    const drone = _drones.find(d => d.id === id);
    if (!drone) return;

    btn.classList.add('pinging');
    const resultEl = document.getElementById(`pingResult-${id}`);

    // Show loading state in result area
    if (resultEl) {
      resultEl.innerHTML = `<div class="fleet-ping-loading"><div class="fleet-btn-spinner" style="display:inline-block"></div><span>Contacting ${this._esc(drone.hostname)}:5000...</span></div>`;
      resultEl.classList.add('visible');
    }

    try {
      const result = await window.helios.fleetTestConnection(drone.hostname);

      // Update last_ping timestamp in DB
      await window.helios.fleetPing(id);

      if (result.success) {
        const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        if (resultEl) {
          resultEl.innerHTML = this._renderPingResult(body, drone.hostname);
          resultEl.classList.add('visible', 'success');
          resultEl.classList.remove('error');
        }
      } else {
        const errMsg = result.error || `HTTP ${result.statusCode}`;
        if (resultEl) {
          resultEl.innerHTML = this._renderPingError(errMsg);
          resultEl.classList.add('visible', 'error');
          resultEl.classList.remove('success');
        }
      }

      // Refresh data for last_ping update
      _drones = await window.helios.fleetGetAll();
      // Update the Last Ping value on card without full re-render
      const card = document.querySelector(`.fleet-drone-card[data-drone-id="${id}"]`);
      if (card) {
        const updatedDrone = _drones.find(d => d.id === id);
        if (updatedDrone) {
          const detailItems = card.querySelectorAll('.fleet-detail-item');
          detailItems.forEach(item => {
            const label = item.querySelector('.fleet-detail-label');
            if (label && label.textContent === 'Last Ping') {
              const val = item.querySelector('.fleet-detail-value');
              if (val) val.textContent = new Date(updatedDrone.last_ping + 'Z').toLocaleString();
            }
          });
        }
      }
    } catch (err) {
      console.error('Ping failed:', err);
      if (resultEl) {
        resultEl.innerHTML = this._renderPingError(err.message);
        resultEl.classList.add('visible', 'error');
        resultEl.classList.remove('success');
      }
    }

    setTimeout(() => btn.classList.remove('pinging'), 600);
  },

  _renderPingResult(data, hostname) {
    const connected = data.connected ? 'Connected' : 'Disconnected';
    const connClass = data.connected ? 'online' : 'offline';
    const droneAddr = data.drone_address || '—';
    const wsRate = data.ws_rate_hz != null ? `${data.ws_rate_hz} Hz` : '—';
    const startedAt = data.started_at ? new Date(data.started_at).toLocaleString() : '—';
    const lastUpdated = data.last_updated ? new Date(data.last_updated).toLocaleString() : '—';

    return `
      <div class="fleet-ping-header">
        <div class="fleet-ping-status ${connClass}">
          <span class="fleet-ping-dot"></span>
          ${connected}
        </div>
        <button class="fleet-ping-close" onclick="this.closest('.fleet-ping-result').classList.remove('visible','success','error');this.closest('.fleet-ping-result').innerHTML='';" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="fleet-ping-grid">
        <div class="fleet-ping-item">
          <span class="fleet-ping-label">Drone Address</span>
          <span class="fleet-ping-value">${this._esc(droneAddr)}</span>
        </div>
        <div class="fleet-ping-item">
          <span class="fleet-ping-label">WS Rate</span>
          <span class="fleet-ping-value">${this._esc(wsRate)}</span>
        </div>
        <div class="fleet-ping-item">
          <span class="fleet-ping-label">Started At</span>
          <span class="fleet-ping-value">${this._esc(startedAt)}</span>
        </div>
        <div class="fleet-ping-item">
          <span class="fleet-ping-label">Last Updated</span>
          <span class="fleet-ping-value">${this._esc(lastUpdated)}</span>
        </div>
      </div>
    `;
  },

  _renderPingError(errMsg) {
    return `
      <div class="fleet-ping-header">
        <div class="fleet-ping-status offline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
          Connection Failed
        </div>
        <button class="fleet-ping-close" onclick="this.closest('.fleet-ping-result').classList.remove('visible','success','error');this.closest('.fleet-ping-result').innerHTML='';" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="fleet-ping-error-msg">${this._esc(errMsg)}</p>
    `;
  },

  _editDrone(id) {
    const drone = _drones.find(d => d.id === id);
    if (!drone) return;
    _editingId = id;
    this._showForm(drone);
  },

  async _deleteDrone(id) {
    const drone = _drones.find(d => d.id === id);
    if (!drone) return;
    // Simple confirmation
    const card = document.querySelector(`.fleet-drone-card[data-drone-id="${id}"]`);
    if (card) {
      card.classList.add('fleet-card-deleting');
      await new Promise(r => setTimeout(r, 300));
    }
    try {
      await window.helios.fleetDelete(id);
      await this._loadDrones();
    } catch (err) {
      console.error('Delete failed:', err);
      if (card) card.classList.remove('fleet-card-deleting');
    }
  },

  /* ── Form ── */
  _showForm(drone = null) {
    const overlay = document.getElementById('fleetFormOverlay');
    const title = document.getElementById('fleetFormTitle');
    const submitLabel = document.getElementById('fleetFormSubmitLabel');
    const sbcNotice = document.getElementById('fleetSbcNotice');
    const submitBtn = document.getElementById('btnSubmitDrone');
    const testBtn = document.getElementById('btnTestConnection');
    const connResult = document.getElementById('fleetConnResult');
    if (!overlay) return;

    _editingId = drone ? drone.id : null;
    _connectionVerified = false;

    if (title) title.textContent = drone ? 'Edit Drone' : 'Add New Drone';
    if (submitLabel) submitLabel.textContent = drone ? 'Save Changes' : 'Add Drone';

    // Show SBC notice & test button only for new drones
    const isNew = !drone;
    if (sbcNotice) sbcNotice.style.display = isNew ? '' : 'none';
    if (testBtn) testBtn.style.display = isNew ? '' : 'none';
    if (connResult) { connResult.innerHTML = ''; connResult.className = 'fleet-conn-result'; }

    // For edit mode show submit immediately, for add mode require test first
    if (submitBtn) {
      if (isNew) {
        submitBtn.classList.add('fleet-form-btn-hidden');
      } else {
        submitBtn.classList.remove('fleet-form-btn-hidden');
      }
    }

    // Fill form
    document.getElementById('droneName').value = drone?.name || '';
    document.getElementById('droneHostname').value = drone?.hostname || '';
    document.getElementById('droneStatus').value = drone?.status || 'offline';
    document.getElementById('droneType').value = drone?.drone_type || 'quadcopter';
    document.getElementById('fleetDroneModel').value = drone?.model || '';
    document.getElementById('droneSerial').value = drone?.serial_number || '';
    document.getElementById('droneNotes').value = drone?.notes || '';

    overlay.classList.add('visible');
    setTimeout(() => document.getElementById('droneName')?.focus(), 100);
  },

  _hideForm() {
    const overlay = document.getElementById('fleetFormOverlay');
    if (overlay) overlay.classList.remove('visible');
    _editingId = null;
    _connectionVerified = false;
    document.getElementById('droneForm')?.reset();
    const connResult = document.getElementById('fleetConnResult');
    if (connResult) { connResult.innerHTML = ''; connResult.className = 'fleet-conn-result'; }
  },

  _resetConnectionState() {
    if (_editingId) return; // skip for edit mode
    _connectionVerified = false;
    const submitBtn = document.getElementById('btnSubmitDrone');
    const connResult = document.getElementById('fleetConnResult');
    if (submitBtn) submitBtn.classList.add('fleet-form-btn-hidden');
    if (connResult) { connResult.innerHTML = ''; connResult.className = 'fleet-conn-result'; }
  },

  async _testConnection() {
    const hostname = document.getElementById('droneHostname')?.value.trim();
    const testBtn = document.getElementById('btnTestConnection');
    const spinner = document.getElementById('btnTestSpinner');
    const label = document.getElementById('btnTestConnectionLabel');
    const connResult = document.getElementById('fleetConnResult');
    const submitBtn = document.getElementById('btnSubmitDrone');

    if (!hostname) {
      document.getElementById('droneHostname')?.focus();
      return;
    }

    // Show loading state
    if (testBtn) testBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';
    if (label) label.textContent = 'Testing...';
    if (connResult) { connResult.innerHTML = ''; connResult.className = 'fleet-conn-result'; }

    try {
      const result = await window.helios.fleetTestConnection(hostname);

      if (result.success) {
        _connectionVerified = true;
        if (connResult) {
          connResult.className = 'fleet-conn-result fleet-conn-success';
          connResult.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>Connection successful — Helios SBC Service is running on <strong>${this._esc(hostname)}:5000</strong></span>
          `;
        }
        if (submitBtn) submitBtn.classList.remove('fleet-form-btn-hidden');
      } else {
        _connectionVerified = false;
        const errMsg = result.error || `HTTP ${result.statusCode}`;
        if (connResult) {
          connResult.className = 'fleet-conn-result fleet-conn-error';
          connResult.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
            <span>Connection failed: ${this._esc(errMsg)}. Make sure the <strong>Helios SBC Service</strong> is running on the drone.</span>
          `;
        }
        if (submitBtn) submitBtn.classList.add('fleet-form-btn-hidden');
      }
    } catch (err) {
      _connectionVerified = false;
      if (connResult) {
        connResult.className = 'fleet-conn-result fleet-conn-error';
        connResult.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
          <span>Connection failed: ${this._esc(err.message)}</span>
        `;
      }
      if (submitBtn) submitBtn.classList.add('fleet-form-btn-hidden');
    } finally {
      if (testBtn) testBtn.disabled = false;
      if (spinner) spinner.style.display = 'none';
      if (label) label.textContent = 'Test Connection';
    }
  },

  async _saveDrone() {
    const data = {
      name: document.getElementById('droneName').value.trim(),
      hostname: document.getElementById('droneHostname').value.trim(),
      status: document.getElementById('droneStatus').value,
      drone_type: document.getElementById('droneType').value,
      model: document.getElementById('fleetDroneModel').value.trim(),
      serial_number: document.getElementById('droneSerial').value.trim(),
      notes: document.getElementById('droneNotes').value.trim()
    };

    if (!data.name || !data.hostname) return;

    try {
      if (_editingId) {
        await window.helios.fleetUpdate(_editingId, data);
      } else {
        await window.helios.fleetAdd(data);
      }
      this._hideForm();
      await this._loadDrones();
    } catch (err) {
      console.error('Save failed:', err);
    }
  },

  /* ── Helpers ── */
  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  _typeLabel(type) {
    const t = droneTypes.find(d => d.value === type);
    return t ? t.label : type;
  }
};
