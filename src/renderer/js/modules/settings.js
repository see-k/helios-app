/* ── Settings Module ── */
import { getAIConfig, setAIConfig, PROVIDERS, GEMINI_MODELS } from '../services/ai.js';

let _navigate = null;
let _toastTimer = null;

// ── SVG icons used within the settings page ──
const ICONS = {
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M4.5 12.75l6 6 9-13.5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`,
  saved: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M4.5 12.75l6 6 9-13.5"/></svg>`
};

export const Settings = {
  init({ navigate } = {}) {
    _navigate = navigate;
  },

  onEnter() {
    this._render();
  },

  onLeave() {},

  // ══════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════

  _render() {
    const container = document.getElementById('settingsContent');
    if (!container) return;

    const config = getAIConfig();

    container.innerHTML = `
      <div class="settings-page">

        <!-- Page Header -->
        <div class="settings-header">
          <div class="settings-header-icon">${ICONS.settings}</div>
          <div class="settings-header-text">
            <h2>Settings</h2>
            <p>Configure your Helios workspace preferences</p>
          </div>
        </div>

        <!-- AI Configuration Section -->
        <div class="settings-section">
          <div class="settings-section-label">
            ${ICONS.ai}
            <span>AI Configuration</span>
          </div>
          <p class="settings-section-desc">
            Select the AI provider used for flight analysis, alternative routes, and post-flight reports.
          </p>

          <!-- Provider Selector -->
          <div class="settings-card">
            <div class="settings-card-title">Provider</div>
            <div class="settings-provider-tabs" id="settingsProviderTabs">
              ${PROVIDERS.map(p => `
                <button class="settings-provider-tab ${config.provider === p.id ? 'active' : ''}" data-provider="${p.id}">
                  <span class="spt-label">${p.label}</span>
                  <span class="spt-subtitle">${p.subtitle}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- ── Gemini Card ── -->
          <div class="settings-card ${config.provider !== 'gemini' ? 'settings-card-hidden' : ''}" id="settingsGeminiCard">
            <div class="settings-card-title">Gemini Settings</div>

            <div class="settings-form-group">
              <label class="settings-label" for="settingsGeminiKey">API Key</label>
              <div class="settings-input-row">
                <input
                  type="password"
                  class="settings-input"
                  id="settingsGeminiKey"
                  placeholder="Paste your Gemini API key here"
                  value="${_escapeAttr(config.gemini.apiKey || '')}"
                  autocomplete="off"
                  spellcheck="false"
                >
                <button class="settings-icon-btn" id="btnToggleKeyVis" title="Show / hide key">
                  ${ICONS.eye}
                </button>
              </div>
              <p class="settings-hint">
                Get a free key at <strong>aistudio.google.com</strong> &rarr; Get API key.
                If you have set <code>GEMINI_API_KEY</code> in your <code>.env</code> file it is used as a fallback.
              </p>
            </div>

            <div class="settings-form-group">
              <label class="settings-label" for="settingsGeminiModel">Model</label>
              <div class="settings-select-wrap">
                <select class="settings-select" id="settingsGeminiModel">
                  ${GEMINI_MODELS.map(m => `
                    <option value="${m.id}" ${config.gemini.model === m.id ? 'selected' : ''}>${m.label}</option>
                  `).join('')}
                </select>
                <svg class="settings-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>

            <div class="settings-card-footer">
              <button class="settings-btn settings-btn-secondary" id="btnTestGemini">Test Connection</button>
              <span class="settings-status" id="settingsGeminiStatus"></span>
            </div>
          </div>

          <!-- ── Ollama Card ── -->
          <div class="settings-card ${config.provider !== 'ollama' ? 'settings-card-hidden' : ''}" id="settingsOllamaCard">
            <div class="settings-card-title">Ollama Settings</div>

            <div class="settings-form-group">
              <label class="settings-label" for="settingsOllamaUrl">Base URL</label>
              <input
                type="text"
                class="settings-input"
                id="settingsOllamaUrl"
                placeholder="http://localhost:11434"
                value="${_escapeAttr(config.ollama.baseUrl || 'http://localhost:11434')}"
                spellcheck="false"
              >
              <p class="settings-hint">
                Default: <code>http://localhost:11434</code>. Must be a localhost address.
                Download Ollama at <strong>ollama.com</strong>.
              </p>
            </div>

            <div class="settings-form-group">
              <label class="settings-label" for="settingsOllamaModel">Model</label>
              <div class="settings-model-row">
                <div class="settings-select-wrap" style="flex:1;">
                  <select class="settings-select" id="settingsOllamaModel">
                    <option value="">-- Click Refresh to load installed models --</option>
                  </select>
                  <svg class="settings-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
                </div>
                <button class="settings-btn settings-btn-icon" id="btnRefreshOllamaModels" title="Refresh model list">
                  ${ICONS.refresh}
                  <span>Refresh</span>
                </button>
              </div>
              <p class="settings-hint">
                Pull a model with: <code>ollama pull llama3.2</code>
              </p>
            </div>

            <div class="settings-card-footer">
              <span class="settings-status" id="settingsOllamaStatus"></span>
            </div>
          </div>

        </div><!-- /settings-section -->

        <!-- Save toast -->
        <div class="settings-save-toast" id="settingsSaveToast">
          ${ICONS.saved} Saved
        </div>

      </div><!-- /settings-page -->
    `;

    this._bindEvents(config);

    // Auto-load Ollama models if that provider is active
    if (config.provider === 'ollama') {
      this._loadOllamaModels(config.ollama.baseUrl, config.ollama.model);
    }
  },

  // ══════════════════════════════════════════
  //  EVENT BINDING
  // ══════════════════════════════════════════

  _bindEvents(initialConfig) {
    // ── Provider tab switching ──
    document.getElementById('settingsProviderTabs')?.querySelectorAll('.settings-provider-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const provider = btn.dataset.provider;
        document.querySelectorAll('.settings-provider-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.getElementById('settingsGeminiCard')?.classList.toggle('settings-card-hidden', provider !== 'gemini');
        document.getElementById('settingsOllamaCard')?.classList.toggle('settings-card-hidden', provider !== 'ollama');

        this._savePartial({ provider });

        if (provider === 'ollama') {
          const currentModel = document.getElementById('settingsOllamaModel')?.value;
          if (!currentModel) {
            const url = document.getElementById('settingsOllamaUrl')?.value || initialConfig.ollama.baseUrl;
            this._loadOllamaModels(url, initialConfig.ollama.model);
          }
        }
      });
    });

    // ── Gemini: show / hide API key ──
    const keyInput  = document.getElementById('settingsGeminiKey');
    const toggleBtn = document.getElementById('btnToggleKeyVis');
    if (keyInput && toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isHidden = keyInput.type === 'password';
        keyInput.type = isHidden ? 'text' : 'password';
        toggleBtn.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
      });
    }

    // ── Gemini: key change ──
    keyInput?.addEventListener('change', () => {
      this._savePartial({ gemini: { apiKey: keyInput.value } });
    });

    // ── Gemini: model change ──
    document.getElementById('settingsGeminiModel')?.addEventListener('change', e => {
      this._savePartial({ gemini: { model: e.target.value } });
    });

    // ── Gemini: test connection ──
    document.getElementById('btnTestGemini')?.addEventListener('click', () => {
      this._testGemini();
    });

    // ── Ollama: base URL change (save on blur) ──
    document.getElementById('settingsOllamaUrl')?.addEventListener('change', e => {
      this._savePartial({ ollama: { baseUrl: e.target.value } });
    });

    // ── Ollama: refresh models ──
    document.getElementById('btnRefreshOllamaModels')?.addEventListener('click', () => {
      const url = document.getElementById('settingsOllamaUrl')?.value || 'http://localhost:11434';
      this._loadOllamaModels(url, null);
    });

    // ── Ollama: model change ──
    document.getElementById('settingsOllamaModel')?.addEventListener('change', e => {
      this._savePartial({ ollama: { model: e.target.value } });
    });
  },

  // ══════════════════════════════════════════
  //  SAVE HELPERS
  // ══════════════════════════════════════════

  /** Deep-merge a partial config object and persist it. */
  _savePartial(partial) {
    const current = getAIConfig();
    const updated = {
      ...current,
      ...partial,
      gemini: { ...current.gemini, ...(partial.gemini || {}) },
      ollama: { ...current.ollama, ...(partial.ollama || {}) }
    };
    setAIConfig(updated);
    this._showSaveToast();
  },

  _showSaveToast() {
    const toast = document.getElementById('settingsSaveToast');
    if (!toast) return;
    toast.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
  },

  // ══════════════════════════════════════════
  //  GEMINI TEST
  // ══════════════════════════════════════════

  async _testGemini() {
    const btn    = document.getElementById('btnTestGemini');
    const status = document.getElementById('settingsGeminiStatus');
    const keyEl  = document.getElementById('settingsGeminiKey');
    const modelEl = document.getElementById('settingsGeminiModel');

    if (!btn || !status) return;

    let apiKey = keyEl?.value?.trim() || '';
    if (!apiKey && window.helios?.getEnv) {
      apiKey = await window.helios.getEnv('GEMINI_API_KEY');
    }

    if (!apiKey) {
      status.innerHTML = `<span class="settings-status-error">No API key provided.</span>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Testing\u2026';
    status.innerHTML = '';

    const model = modelEl?.value || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }]
        })
      });

      if (res.ok) {
        this._savePartial({ gemini: { apiKey: keyEl?.value?.trim() || '' } });
        status.innerHTML = `<span class="settings-status-ok">${ICONS.check} Connected successfully</span>`;
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error?.message || `HTTP ${res.status}`;
        status.innerHTML = `<span class="settings-status-error">Error: ${msg}</span>`;
      }
    } catch (err) {
      status.innerHTML = `<span class="settings-status-error">${err.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  },

  // ══════════════════════════════════════════
  //  OLLAMA MODEL LOADING
  // ══════════════════════════════════════════

  async _loadOllamaModels(baseUrl, selectedModel) {
    const select     = document.getElementById('settingsOllamaModel');
    const status     = document.getElementById('settingsOllamaStatus');
    const refreshBtn = document.getElementById('btnRefreshOllamaModels');

    if (!select) return;

    if (refreshBtn) refreshBtn.disabled = true;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading\u2026</option>';
    if (status) status.innerHTML = '';

    if (!window.helios?.ollamaListModels) {
      select.innerHTML = '<option value="">Ollama IPC not available</option>';
      select.disabled = false;
      if (refreshBtn) refreshBtn.disabled = false;
      return;
    }

    const result = await window.helios.ollamaListModels(baseUrl);

    if (refreshBtn) refreshBtn.disabled = false;
    select.disabled = false;

    if (!result.success || !result.models?.length) {
      const errMsg = result.error || 'No models found. Is Ollama running?';
      select.innerHTML = '<option value="">-- No models found --</option>';
      if (status) status.innerHTML = `<span class="settings-status-error">${errMsg}</span>`;
      return;
    }

    const models = result.models;
    const currentSaved = selectedModel || getAIConfig().ollama.model;

    select.innerHTML =
      '<option value="">-- Select a model --</option>' +
      models.map(m => `<option value="${m}" ${m === currentSaved ? 'selected' : ''}>${m}</option>`).join('');

    if (status) {
      status.innerHTML = `<span class="settings-status-ok">${ICONS.check} ${models.length} model${models.length !== 1 ? 's' : ''} available</span>`;
    }

    // Auto-select and save
    if (currentSaved && models.includes(currentSaved)) {
      select.value = currentSaved;
    } else if (models.length > 0) {
      select.value = models[0];
      this._savePartial({ ollama: { model: models[0] } });
    }
  }
};

// ── Utilities ──────────────────────────────────────────────────────────────

function _escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
