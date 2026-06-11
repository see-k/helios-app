/* ── Reports Module — Post-Flight Report, Charts & AI Assessment ── */
import { state } from '../state.js';
import { RptIcons } from '../utils/icons.js';
import { callAI } from '../services/ai.js';
import { loadGoogleMaps, isMapsLoaded } from '../services/maps-loader.js';
import { createDroneModelOverlay } from '../utils/drone-model-overlay.js';

// ── Injected callback (set via init) ──
let _navigate = null;

export const Reports = {
  _dom: null,
  _aiResult: null,
  _lastFlightDataId: null,
  _charts: [],
  _flights: [],
  _replay: null,

  _getDom() {
    if (this._dom) return this._dom;
    this._dom = {
      container: document.getElementById('reportsContent')
    };
    return this._dom;
  },

  // ── Lifecycle ──
  init({ navigate } = {}) {
    _navigate = navigate;
  },

  onEnter() {
    // Clear cached AI result when flight data changes (different drone/session)
    const fd = state.flightData;
    const currentId = fd ? `${fd.droneId}_${fd.missionStart}` : null;
    if (currentId !== this._lastFlightDataId) {
      this._aiResult = null;
      this._lastFlightDataId = currentId;
    }
    this._render();
    this._loadHistory();
  },

  onLeave() {
    this._destroyCharts();
    this._stopReplay();
  },

  // ── Flight history ──
  async _loadHistory() {
    try {
      if (window.helios?.flightGetAll) {
        this._flights = await window.helios.flightGetAll() || [];
      }
    } catch (err) {
      console.error('[Reports] Failed to load flight history:', err);
      this._flights = [];
    }
    this._renderHistory();
  },

  _destroyCharts() {
    this._charts.forEach(c => c.destroy());
    this._charts = [];
  },

  // ══════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════

  _render() {
    const d = this._getDom();
    const fd = state.flightData;
    this._destroyCharts();
    this._stopReplay();

    if (!fd) {
      d.container.innerHTML = `
        <div class="rpt-sidebar"><div id="rptHistoryPanel"></div></div>
        <div class="rpt-main">
        <div class="rpt-no-data">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>
          </svg>
          <h2 class="rpt-no-data-title">No Flight Data</h2>
          <p class="rpt-no-data-text">Launch a drone view and generate a report at any time — during the flight or after mission completion. Past flights are saved below.</p>
          <button class="rpt-no-data-btn" id="rptGoToDrone">
            ${RptIcons.drone} Go to Drone View
          </button>
        </div>
        </div>`;
      d.container.querySelector('#rptGoToDrone')?.addEventListener('click', () => {
        if (_navigate) _navigate('droneview');
      });
      this._renderHistory();
      return;
    }

    const startDate = new Date(fd.missionStart);
    const endDate = new Date(fd.missionEnd);
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const startTime = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const batteryUsed = fd.batteryStart - fd.batteryEnd;
    const efficiencyPct = Math.max(60, Math.min(98, Math.round(100 - batteryUsed * 0.4 + (fd.waypointsVisited || 0))));
    const gpsAccuracy = (1.2 + Math.random() * 0.6).toFixed(1);
    const isInProgress = fd.missionStatus && fd.missionStatus !== 'complete';
    const statusBadge = isInProgress
      ? `<span class="rpt-header-badge rpt-badge-progress"><span class="rpt-badge-dot progress"></span> In Progress</span>`
      : `<span class="rpt-header-badge rpt-badge-complete"><span class="rpt-badge-dot"></span> Complete</span>`;
    const wpLabel = fd.waypointsTotal
      ? `${fd.waypointsVisited || 0} / ${fd.waypointsTotal}`
      : `${fd.waypointsVisited || 0}`;
    const wpSub = isInProgress ? 'Visited so far' : 'All visited';

    const logRows = fd.flightLog.map(l => {
      const t = new Date(l.time);
      const ts = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const cls = l.event === 'launch' ? 'launch' : l.event === 'land' ? 'land' : l.event === 'warning' ? 'warning' : 'waypoint';
      const lbl = l.event === 'launch' ? 'Launch' : l.event === 'land' ? 'Landing' : l.event === 'warning' ? 'Warning' : 'Waypoint';
      return `<tr><td class="rpt-log-time">${ts}</td><td><span class="rpt-log-event-badge ${cls}">${lbl}</span></td><td class="rpt-log-detail">${l.detail}</td></tr>`;
    }).join('');

    const hasTrack = Array.isArray(fd.track) && fd.track.length > 1;

    d.container.innerHTML = `
      <div class="rpt-sidebar"><div id="rptHistoryPanel"></div></div>
      <div class="rpt-main">

      <!-- Header -->
      <div class="rpt-header">
        <div class="rpt-header-left">
          <h1 class="rpt-page-title">Flight Report</h1>
          <p class="rpt-page-subtitle">${fd.droneModel} \u2022 ${fd.droneId} \u2022 ${dateStr}</p>
        </div>
        <div class="rpt-header-actions">
          <span class="rpt-header-badge rpt-badge-demo">Simulated</span>
          ${statusBadge}
          <button class="rpt-export-btn" id="btnExportPdf">${RptIcons.pdf} Export PDF</button>
        </div>
      </div>

      <!-- Mission Bar -->
      <div class="rpt-mission-bar">
        <div class="rpt-mission-item">
          <div class="rpt-mission-icon">${RptIcons.drone}</div>
          <div class="rpt-mission-info"><span class="rpt-mission-label">Drone</span><span class="rpt-mission-value">${fd.droneModel}</span></div>
        </div>
        <div class="rpt-mission-divider"></div>
        <div class="rpt-mission-item">
          <div class="rpt-mission-icon">${RptIcons.calendar}</div>
          <div class="rpt-mission-info"><span class="rpt-mission-label">Date</span><span class="rpt-mission-value">${dateStr}</span></div>
        </div>
        <div class="rpt-mission-divider"></div>
        <div class="rpt-mission-item">
          <div class="rpt-mission-icon">${RptIcons.time}</div>
          <div class="rpt-mission-info"><span class="rpt-mission-label">Window</span><span class="rpt-mission-value">${startTime} \u2014 ${endTime}</span></div>
        </div>
        <div class="rpt-mission-divider"></div>
        <div class="rpt-mission-item">
          <div class="rpt-mission-icon">${RptIcons.cloud}</div>
          <div class="rpt-mission-info"><span class="rpt-mission-label">Weather</span><span class="rpt-mission-value">${fd.weatherSummary}</span></div>
        </div>
      </div>

      <!-- Stats -->
      <div class="rpt-stats-grid">
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.clock}</div><span class="rpt-stat-value">${fd.durationStr}</span><span class="rpt-stat-label">Duration</span></div>
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.route}</div><span class="rpt-stat-value">${fd.distanceStr}</span><span class="rpt-stat-label">Distance</span></div>
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.speed}</div><span class="rpt-stat-value">${fd.avgSpeed}</span><span class="rpt-stat-label">Avg km/h</span></div>
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.altitude}</div><span class="rpt-stat-value">${fd.maxAltitude}m</span><span class="rpt-stat-label">Max Alt</span></div>
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.battery}</div><span class="rpt-stat-value">${batteryUsed}%</span><span class="rpt-stat-label">Battery Used</span><span class="rpt-stat-sub">${fd.batteryEnd}% remaining</span></div>
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.pin}</div><span class="rpt-stat-value">${wpLabel}</span><span class="rpt-stat-label">Waypoints</span><span class="rpt-stat-sub">${wpSub}</span></div>
      </div>

      <!-- Charts -->
      <div class="rpt-charts-grid">
        <div class="rpt-chart-card wide"><div class="rpt-chart-header"><span class="rpt-chart-title">Altitude Profile</span><span class="rpt-chart-value">Max ${fd.maxAltitude}m</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartAltitude"></canvas></div></div>
        <div class="rpt-chart-card"><div class="rpt-chart-header"><span class="rpt-chart-title">Speed Over Time</span><span class="rpt-chart-value">Avg ${fd.avgSpeed} km/h</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartSpeed"></canvas></div></div>
        <div class="rpt-chart-card"><div class="rpt-chart-header"><span class="rpt-chart-title">Battery Drain</span><span class="rpt-chart-value">${fd.batteryStart}% \u2192 ${fd.batteryEnd}%</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartBattery"></canvas></div></div>
      </div>

      ${hasTrack ? `
      <!-- Flight Replay -->
      <div class="rpt-section rpt-replay-section" id="rptReplaySection">
        <div class="rpt-section-header">
          ${RptIcons.route}
          <span class="rpt-section-title">Flight Replay</span>
          <span class="rpt-section-badge">${fd.track.length} samples</span>
          <button class="rpt-replay-max-btn" id="rptReplayMaximize" type="button" title="Maximize replay" aria-label="Maximize replay" aria-expanded="false">${this._maximizeIcon()}</button>
        </div>
        <div class="rpt-section-body">
          <div class="rpt-replay-map" id="rptReplayMap"></div>
          <div class="rpt-replay-telemetry" id="rptReplayTelemetry">
            <div class="rpt-replay-tel"><span class="rpt-replay-tel-label">Time</span><span class="rpt-replay-tel-value" data-tel="time">00:00</span></div>
            <div class="rpt-replay-tel"><span class="rpt-replay-tel-label">Altitude</span><span class="rpt-replay-tel-value" data-tel="alt">0 m</span></div>
            <div class="rpt-replay-tel"><span class="rpt-replay-tel-label">Speed</span><span class="rpt-replay-tel-value" data-tel="speed">0 km/h</span></div>
            <div class="rpt-replay-tel"><span class="rpt-replay-tel-label">Heading</span><span class="rpt-replay-tel-value" data-tel="heading">0&deg;</span></div>
            <div class="rpt-replay-tel"><span class="rpt-replay-tel-label">Battery</span><span class="rpt-replay-tel-value" data-tel="battery">0%</span></div>
          </div>
          <div class="rpt-replay-controls">
            <button class="rpt-replay-btn" id="rptReplayPlay" title="Play / Pause">${this._playIcon()}</button>
            <span class="rpt-replay-time" id="rptReplayClock">00:00 / 00:00</span>
            <input type="range" class="rpt-replay-slider" id="rptReplaySlider" min="0" max="${fd.track.length - 1}" value="0" step="1">
            <select class="rpt-replay-speed" id="rptReplaySpeed">
              <option value="1">1&times;</option>
              <option value="2">2&times;</option>
              <option value="4" selected>4&times;</option>
              <option value="8">8&times;</option>
            </select>
          </div>
        </div>
      </div>` : ''}

      <!-- Performance + Log -->
      <div class="rpt-two-col">
        <div class="rpt-section">
          <div class="rpt-section-header">${RptIcons.perf}<span class="rpt-section-title">Performance</span></div>
          <div class="rpt-section-body">
            <div class="rpt-perf-grid">
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.gauge} Flight Efficiency</span><span class="rpt-perf-value">${efficiencyPct}%</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill" style="width:${efficiencyPct}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.battery} Battery Efficiency</span><span class="rpt-perf-value">${fd.batteryEnd}% left</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill" style="width:${fd.batteryEnd}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.sat} GPS Accuracy</span><span class="rpt-perf-value">${gpsAccuracy}m CEP</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill muted" style="width:${Math.max(20, 100 - parseFloat(gpsAccuracy) * 30)}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.target} Route Adherence</span><span class="rpt-perf-value">100%</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill" style="width:100%"></div></div></div>
            </div>
          </div>
        </div>
        <div class="rpt-section">
          <div class="rpt-section-header">${RptIcons.log}<span class="rpt-section-title">Flight Log</span><span class="rpt-section-badge">${fd.flightLog.length} events</span></div>
          <div class="rpt-section-body" style="padding:12px 0;"><table class="rpt-log-table"><thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead><tbody>${logRows}</tbody></table></div>
        </div>
      </div>

      <!-- AI Assessment -->
      <div class="rpt-section rpt-ai-section">
        <div class="rpt-section-header">${RptIcons.ai}<span class="rpt-section-title">AI Flight Assessment</span><span class="rpt-section-badge">Gemini</span></div>
        <div class="rpt-section-body"><div class="rpt-ai-body" id="rptAiBody">
          ${this._aiResult ? this._renderAiAssessment(this._aiResult) : `
          <div class="rpt-ai-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
            <p class="rpt-ai-empty-text">Generate an AI-powered post-flight assessment with grading, safety evaluation, and recommendations.</p>
          </div>
          <button class="rpt-ai-generate-btn" id="btnGenerateAssessment">
            ${RptIcons.ai}
            <span class="rpt-ai-btn-text">Generate AI Assessment</span>
            <div class="rpt-ai-btn-spinner"></div>
          </button>`}
        </div></div>
      </div>
      </div>`;

    // Wire events
    d.container.querySelector('#btnExportPdf')?.addEventListener('click', () => this._exportPdf());
    d.container.querySelector('#btnGenerateAssessment')?.addEventListener('click', () => this._generateAssessment());

    requestAnimationFrame(() => this._buildCharts(fd));

    this._stopReplay();
    if (hasTrack) {
      requestAnimationFrame(() => this._initReplay(fd));
    }

    this._renderHistory();

    if (!this._aiResult) {
      setTimeout(() => this._generateAssessment(), 500);
    }
  },

  // ══════════════════════════════════════════
  //  CHARTS (Chart.js UMD global)
  // ══════════════════════════════════════════

  _buildCharts(fd) {
    if (typeof Chart === 'undefined') return;

    const gridColor = 'rgba(255,255,255,0.04)';
    const tickColor = 'rgba(255,255,255,0.25)';
    const accentBlue = 'rgba(59,130,246,0.8)';
    const accentBlueFill = 'rgba(59,130,246,0.08)';
    const mutedGray = 'rgba(255,255,255,0.4)';
    const mutedGrayFill = 'rgba(255,255,255,0.03)';

    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 10;
    Chart.defaults.color = tickColor;

    let labels, altitudes, speeds, batteryVals;

    if (Array.isArray(fd.track) && fd.track.length > 1) {
      // Real recorded telemetry track (downsample to ~60 points for legibility)
      const track = fd.track;
      const maxPoints = 60;
      const stride = Math.max(1, Math.ceil(track.length / maxPoints));
      const sampled = track.filter((_, i) => i % stride === 0);
      if (sampled[sampled.length - 1] !== track[track.length - 1]) sampled.push(track[track.length - 1]);

      labels = sampled.map(p => this._fmtElapsed(p.t));
      altitudes = sampled.map(p => Math.round(p.alt || 0));
      speeds = sampled.map(p => Math.round(p.speed || 0));
      batteryVals = sampled.map(p => Math.round(p.battery ?? 0));
    } else {
      // Fallback: synthesize from discrete waypoints
      labels = ['Launch', ...fd.waypoints.map((_, i) => `WP ${i + 1}`), 'Landing'];

      altitudes = [0];
      fd.waypoints.forEach(w => altitudes.push(w.alt || Math.round(40 + Math.random() * 60)));
      altitudes.push(0);

      speeds = [0];
      for (let i = 0; i < fd.waypoints.length; i++) {
        speeds.push(Math.round(fd.avgSpeed * (0.7 + Math.random() * 0.6)));
      }
      speeds.push(0);

      batteryVals = [fd.batteryStart];
      const step = (fd.batteryStart - fd.batteryEnd) / fd.waypoints.length;
      for (let i = 0; i < fd.waypoints.length; i++) {
        batteryVals.push(Math.round(fd.batteryStart - step * (i + 1) + (Math.random() - 0.5) * 3));
      }
      batteryVals.push(fd.batteryEnd);
    }

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,15,20,0.9)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleFont: { size: 11, weight: '600' },
          bodyFont: { size: 11 },
          padding: 10,
          cornerRadius: 6
        }
      },
      scales: {
        x: { grid: { color: gridColor, drawBorder: false }, ticks: { maxRotation: 0, font: { size: 9 } } },
        y: { grid: { color: gridColor, drawBorder: false }, ticks: { font: { size: 9 } } }
      }
    };

    const ctr = this._getDom().container;
    const pr = labels.length > 30 ? 0 : 3;
    const prSmall = labels.length > 30 ? 0 : 2.5;

    const altCtx = ctr.querySelector('#chartAltitude');
    if (altCtx) {
      this._charts.push(new Chart(altCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: altitudes,
            borderColor: accentBlue,
            backgroundColor: accentBlueFill,
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: pr,
            pointBackgroundColor: accentBlue,
            pointBorderWidth: 0
          }]
        },
        options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, title: { display: true, text: 'Altitude (m)', font: { size: 9 }, color: tickColor } } } }
      }));
    }

    const speedCtx = ctr.querySelector('#chartSpeed');
    if (speedCtx) {
      this._charts.push(new Chart(speedCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: speeds,
            borderColor: mutedGray,
            backgroundColor: mutedGrayFill,
            fill: true,
            tension: 0.35,
            borderWidth: 1.5,
            pointRadius: prSmall,
            pointBackgroundColor: mutedGray,
            pointBorderWidth: 0
          }]
        },
        options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, title: { display: true, text: 'km/h', font: { size: 9 }, color: tickColor } } } }
      }));
    }

    const batCtx = ctr.querySelector('#chartBattery');
    if (batCtx) {
      this._charts.push(new Chart(batCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: batteryVals,
            borderColor: accentBlue,
            backgroundColor: accentBlueFill,
            fill: true,
            tension: 0.25,
            borderWidth: 1.5,
            pointRadius: prSmall,
            pointBackgroundColor: accentBlue,
            pointBorderWidth: 0
          }]
        },
        options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, min: 0, max: 100, title: { display: true, text: '%', font: { size: 9 }, color: tickColor } } } }
      }));
    }
  },

  // ══════════════════════════════════════════
  //  PDF EXPORT
  // ══════════════════════════════════════════

  async _exportPdf() {
    const btn = this._getDom().container.querySelector('#btnExportPdf');
    if (btn) { btn.disabled = true; btn.innerHTML = RptIcons.pdf + ' Exporting\u2026'; }

    try {
      if (window.helios?.exportPdf) {
        const result = await window.helios.exportPdf();
        if (result.success) {
          if (btn) btn.innerHTML = RptIcons.pdf + ' Exported';
          setTimeout(() => { if (btn) { btn.innerHTML = RptIcons.pdf + ' Export PDF'; btn.disabled = false; } }, 2000);
        } else if (result.reason !== 'cancelled') {
          throw new Error(result.reason);
        } else {
          if (btn) { btn.innerHTML = RptIcons.pdf + ' Export PDF'; btn.disabled = false; }
        }
      } else {
        window.print();
        if (btn) { btn.innerHTML = RptIcons.pdf + ' Export PDF'; btn.disabled = false; }
      }
    } catch (err) {
      console.error('PDF export error:', err);
      if (btn) { btn.innerHTML = RptIcons.pdf + ' Export Failed'; btn.disabled = false; }
      setTimeout(() => { if (btn) btn.innerHTML = RptIcons.pdf + ' Export PDF'; }, 2500);
    }
  },

  // ══════════════════════════════════════════
  //  AI ASSESSMENT (Gemini)
  // ══════════════════════════════════════════

  async _generateAssessment() {
    const d = this._getDom();
    const fd = state.flightData;
    if (!fd) return;

    const btn = d.container.querySelector('#btnGenerateAssessment');
    if (btn) btn.classList.add('loading');

    const prompt = `You are a senior eVTOL drone flight operations officer. Provide a comprehensive post-flight assessment.

FLIGHT DATA:
- Drone: ${fd.droneModel} (ID: ${fd.droneId})
- Duration: ${fd.durationStr}
- Distance: ${fd.distanceStr}
- Battery: ${fd.batteryStart}% to ${fd.batteryEnd}% (${fd.batteryStart - fd.batteryEnd}% used)
- Avg Speed: ${fd.avgSpeed} km/h, Max: ${fd.maxSpeed} km/h
- Max Altitude: ${fd.maxAltitude}m
- Waypoints: ${fd.waypointsVisited} visited
- Weather: ${fd.weatherSummary}

FLIGHT LOG:
${fd.flightLog.map(l => `[${l.event.toUpperCase()}] ${l.detail}`).join('\n')}

Return JSON only (no markdown, no fences):
{
  "grade": "<A+|A|A-|B+|B|B-|C+|C|D|F>",
  "gradeTitle": "<short title>",
  "gradeDescription": "<1 sentence>",
  "overallSummary": "<3-4 sentence assessment>",
  "reportSummaryInWords": "<120-180 word plain-language summary of the full report>",
  "strengths": ["<str1>", "<str2>", "<str3>"],
  "areasForImprovement": ["<imp1>", "<imp2>"],
  "safetyEvaluation": { "rating": "<excellent|good|acceptable|concerning|poor>", "notes": ["<n1>", "<n2>"] },
  "recommendations": ["<rec1>", "<rec2>", "<rec3>"],
  "missionEfficiency": "<e.g. 94%>",
  "riskEvents": <number>,
  "complianceStatus": "<compliant|minor-issues|non-compliant>"
}`;

    try {
      const result = await callAI(prompt);
      this._aiResult = result;
      const aiBody = d.container.querySelector('#rptAiBody');
      if (aiBody) aiBody.innerHTML = this._renderAiAssessment(result);
      if (btn) btn.classList.remove('loading');
    } catch (err) {
      if (btn) btn.classList.remove('loading');
      this._showAssessmentError(err.message);
    }
  },

  _normalizeAssessment(data) {
    const safe = data && typeof data === 'object' ? data : {};
    console.log('Raw AI assessment result:', safe);
    const safety = (safe.safetyEvaluation && typeof safe.safetyEvaluation === 'object') ? safe.safetyEvaluation : {};
    return {
      ...safe,
      overallSummary: safe.overallSummary || safe.summary || safe.assessmentSummary || '',
      reportSummaryInWords: safe.reportSummaryInWords || safe.summaryInWords || safe.reportSummary || safe.fullSummary || '',
      strengths: Array.isArray(safe.strengths) ? safe.strengths : [],
      areasForImprovement: Array.isArray(safe.areasForImprovement) ? safe.areasForImprovement : [],
      recommendations: Array.isArray(safe.recommendations) ? safe.recommendations : [],
      safetyEvaluation: {
        ...safety,
        notes: Array.isArray(safety.notes) ? safety.notes : []
      }
    };
  },

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _renderAiAssessment(data) {
    const normalized = this._normalizeAssessment(data);
    const esc = (value) => this._escapeHtml(value);
    const overallSummary = normalized.overallSummary || '';
    const reportSummary = normalized.reportSummaryInWords || overallSummary;
    const strengths = (normalized.strengths || []).map(s => `<li>${esc(s)}</li>`).join('');
    const improvements = (normalized.areasForImprovement || []).map(a => `<li>${esc(a)}</li>`).join('');
    const safetyNotes = (normalized.safetyEvaluation?.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
    const recommendations = (normalized.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('');
    return `
      <div class="rpt-ai-assessment">
        <div class="rpt-ai-grade-row">
          <span class="rpt-ai-grade">${esc(normalized.grade || 'B')}</span>
          <div class="rpt-ai-grade-info">
            <span class="rpt-ai-grade-title">${esc(normalized.gradeTitle || 'Good Performance')}</span>
            <span class="rpt-ai-grade-desc">${esc(normalized.gradeDescription || '')}</span>
          </div>
        </div>
        ${overallSummary ? `<p class="rpt-ai-summary">${esc(overallSummary)}</p>` : ''}
        ${reportSummary ? `
          <div class="rpt-ai-block">
            <h4 class="rpt-ai-block-title">${RptIcons.log} Report Summary</h4>
            <p class="rpt-ai-summary">${esc(reportSummary)}</p>
          </div>
        ` : ''}
        <div class="rpt-ai-meta">
          <span class="rpt-ai-meta-tag">Efficiency: ${esc(normalized.missionEfficiency || '\u2014')}</span>
          <span class="rpt-ai-meta-tag">Compliance: ${esc(normalized.complianceStatus || '\u2014')}</span>
          <span class="rpt-ai-meta-tag">Safety: ${esc(normalized.safetyEvaluation?.rating || '\u2014')}</span>
          <span class="rpt-ai-meta-tag">Risk Events: ${esc(normalized.riskEvents ?? 0)}</span>
        </div>
        ${strengths ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.check} Strengths</h4><ul class="rpt-ai-list">${strengths}</ul></div>` : ''}
        ${improvements ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.warn} Areas for Improvement</h4><ul class="rpt-ai-list">${improvements}</ul></div>` : ''}
        ${safetyNotes ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.shield} Safety Evaluation</h4><ul class="rpt-ai-list">${safetyNotes}</ul></div>` : ''}
        ${recommendations ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.bulb} Recommendations</h4><ul class="rpt-ai-list">${recommendations}</ul></div>` : ''}
      </div>`;
  },

  _showAssessmentError(message) {
    const aiBody = this._getDom().container.querySelector('#rptAiBody');
    if (!aiBody) return;
    const el = document.createElement('div');
    el.style.cssText = 'padding:10px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);color:var(--text-tertiary);font-size:12px;margin-top:8px;';
    el.textContent = message;
    aiBody.appendChild(el);
  },

  // ══════════════════════════════════════════
  //  FLIGHT HISTORY LIST
  // ══════════════════════════════════════════

  _renderHistory() {
    const panel = this._getDom().container.querySelector('#rptHistoryPanel');
    if (!panel) return;

    const flights = this._flights || [];
    const activeId = state.flightData?._flightId ?? null;

    const rows = flights.map(f => {
      const when = this._fmtDate(f.created_at || f.mission_start);
      const dur = this._fmtDuration(f.duration_ms);
      const dist = this._fmtDistance(f.distance_m);
      const batt = (f.battery_used != null) ? `${Math.round(f.battery_used)}%` : '\u2014';
      const statusClass = (f.mission_status || '').toLowerCase().includes('complete') ? 'ok' : 'warn';
      const isActive = activeId === f.id ? ' active' : '';
      return `
        <div class="rpt-hist-row${isActive}" data-flight-id="${f.id}">
          <div class="rpt-hist-main">
            <span class="rpt-hist-drone">${RptIcons.drone} ${this._escapeHtml(f.drone_name || 'Drone')}</span>
            <span class="rpt-hist-date">${this._escapeHtml(when)}</span>
          </div>
          <div class="rpt-hist-meta">
            <span class="rpt-hist-tag">${RptIcons.time} ${dur}</span>
            <span class="rpt-hist-tag">${RptIcons.route} ${dist}</span>
            <span class="rpt-hist-tag">${RptIcons.battery} ${batt}</span>
            <span class="rpt-hist-status ${statusClass}">${this._escapeHtml(f.mission_status || 'Unknown')}</span>
          </div>
          <div class="rpt-hist-actions">
            <button class="rpt-hist-open" data-open="${f.id}">Open</button>
            <button class="rpt-hist-del" data-del="${f.id}" title="Delete">${RptIcons.trash || '\u2715'}</button>
          </div>
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="rpt-section rpt-hist-section">
        <div class="rpt-section-header">${RptIcons.log}<span class="rpt-section-title">Flight History</span><span class="rpt-section-badge">${flights.length}</span></div>
        <div class="rpt-section-body">
          ${flights.length ? `<div class="rpt-hist-list">${rows}</div>`
            : `<p class="rpt-hist-empty">No saved flights yet. Completed missions are recorded automatically.</p>`}
        </div>
      </div>`;

    panel.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openFlight(Number(btn.getAttribute('data-open')));
      });
    });
    panel.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteFlight(Number(btn.getAttribute('data-del')));
      });
    });
    panel.querySelectorAll('.rpt-hist-row').forEach(row => {
      row.addEventListener('click', () => {
        this._openFlight(Number(row.getAttribute('data-flight-id')));
      });
    });
  },

  async _openFlight(id) {
    try {
      if (!window.helios?.flightGet) return;
      const record = await window.helios.flightGet(id);
      if (!record || !record.data) return;
      const fd = { ...record.data, _flightId: id };
      state.flightData = fd;
      this._aiResult = null;
      this._lastFlightDataId = `${fd.droneId}_${fd.missionStart}`;
      this._render();
    } catch (err) {
      console.error('[Reports] Failed to open flight:', err);
    }
  },

  async _deleteFlight(id) {
    try {
      if (!window.helios?.flightDelete) return;
      await window.helios.flightDelete(id);
      this._flights = (this._flights || []).filter(f => f.id !== id);
      if (state.flightData?._flightId === id) {
        state.flightData = null;
        this._render();
      } else {
        this._renderHistory();
      }
    } catch (err) {
      console.error('[Reports] Failed to delete flight:', err);
    }
  },

  // ══════════════════════════════════════════
  //  FLIGHT REPLAY (track scrubber + map)
  // ══════════════════════════════════════════

  async _initReplay(fd) {
    const ctr = this._getDom().container;
    const section = ctr.querySelector('#rptReplaySection');
    const mapEl = ctr.querySelector('#rptReplayMap');
    const slider = ctr.querySelector('#rptReplaySlider');
    const playBtn = ctr.querySelector('#rptReplayPlay');
    const speedSel = ctr.querySelector('#rptReplaySpeed');
    const maxBtn = ctr.querySelector('#rptReplayMaximize');
    if (!slider || !playBtn) return;

    const track = fd.track;
    const r = {
      track,
      index: 0,
      playing: false,
      speed: 4,
      rafId: null,
      lastTs: 0,
      map: null,
      marker: null,
      polyline: null,
      max: null,
      el: { mapEl, slider, playBtn, speedSel, maxBtn, section, ctr: section || ctr }
    };
    this._replay = r;

    // Try to render a Google map with the flight path
    try {
      const ok = await loadGoogleMaps();
      if (ok && isMapsLoaded() && mapEl && this._replay === r) {
        const path = track.map(p => ({ lat: p.lat, lng: p.lng })).filter(p => p.lat && p.lng);
        const center = path[Math.floor(path.length / 2)] || path[0] || { lat: 0, lng: 0 };
        r.map = new google.maps.Map(mapEl, {
          center,
          zoom: 16,
          mapTypeId: 'satellite',
          disableDefaultUI: true,
          gestureHandling: 'greedy'
        });
        r.polyline = new google.maps.Polyline({
          path,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.9,
          strokeWeight: 3,
          map: r.map
        });
        try {
          r.marker = createDroneModelOverlay({
            position: path[0] || center,
            color: '#3b82f6',
            title: fd.droneModel || 'Replay drone',
            size: 72
          });
          r.marker.setMap(r.map);
          r.marker.setHeading(track[0]?.heading || 0);
        } catch (_) {
          r.marker = new google.maps.Marker({
            position: path[0] || center,
            map: r.map,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 5,
              fillColor: '#3b82f6',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 1.5,
              rotation: track[0]?.heading || 0
            }
          });
        }
        if (path.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          path.forEach(p => bounds.extend(p));
          r.map.fitBounds(bounds, 40);
        }
      } else if (mapEl) {
        mapEl.innerHTML = `<div class="rpt-replay-nomap">Map unavailable \u2014 scrub the timeline to review telemetry.</div>`;
      }
    } catch (_) {
      if (mapEl) mapEl.innerHTML = `<div class="rpt-replay-nomap">Map unavailable \u2014 scrub the timeline to review telemetry.</div>`;
    }

    slider.addEventListener('input', () => {
      this._pauseReplay();
      this._seekReplay(Number(slider.value));
    });
    playBtn.addEventListener('click', () => this._toggleReplay());
    if (speedSel) speedSel.addEventListener('change', () => { r.speed = Number(speedSel.value) || 1; });
    if (maxBtn) maxBtn.addEventListener('click', () => this._toggleReplayMaximized());

    this._seekReplay(0);
  },

  _toggleReplayMaximized() {
    const r = this._replay;
    if (!r) return;
    if (r.max) {
      this._closeReplayMaximized();
    } else {
      this._openReplayMaximized();
    }
  },

  _openReplayMaximized() {
    const r = this._replay;
    const section = r?.el?.section;
    if (!r || !section || r.max || !section.parentNode) return;

    const placeholder = document.createComment('rpt-replay-restore');
    section.parentNode.insertBefore(placeholder, section);

    const overlay = document.createElement('div');
    overlay.className = 'rpt-replay-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Maximized flight replay');

    const shell = document.createElement('div');
    shell.className = 'rpt-replay-modal-shell';
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    shell.appendChild(section);
    section.classList.add('rpt-replay-maximized');
    document.body.classList.add('rpt-replay-modal-open');

    const onOverlayClick = (event) => {
      if (event.target === overlay) this._closeReplayMaximized();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') this._closeReplayMaximized();
    };

    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
    r.max = { overlay, placeholder, onOverlayClick, onKeyDown };

    this._setReplayMaxButton(true);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    this._refreshReplayMap();
  },

  _closeReplayMaximized() {
    const r = this._replay;
    const max = r?.max;
    if (!r || !max) return;

    const section = r.el.section;
    document.removeEventListener('keydown', max.onKeyDown);
    max.overlay.removeEventListener('click', max.onOverlayClick);
    document.body.classList.remove('rpt-replay-modal-open');

    if (section) {
      section.classList.remove('rpt-replay-maximized');
      if (max.placeholder?.parentNode) {
        max.placeholder.parentNode.insertBefore(section, max.placeholder);
        max.placeholder.remove();
      }
    }

    max.overlay.remove();
    r.max = null;
    this._setReplayMaxButton(false);
    this._refreshReplayMap();
  },

  _setReplayMaxButton(isMaximized) {
    const btn = this._replay?.el?.maxBtn;
    if (!btn) return;
    btn.innerHTML = isMaximized ? this._minimizeIcon() : this._maximizeIcon();
    btn.title = isMaximized ? 'Restore replay' : 'Maximize replay';
    btn.setAttribute('aria-label', isMaximized ? 'Restore replay' : 'Maximize replay');
    btn.setAttribute('aria-expanded', String(isMaximized));
  },

  _refreshReplayMap() {
    const r = this._replay;
    if (!r?.map) return;

    const refresh = () => {
      const center = r.marker?.getPosition?.() || r.map.getCenter?.();
      if (window.google?.maps?.event) {
        google.maps.event.trigger(r.map, 'resize');
      }
      if (center) r.map.setCenter(center);
    };

    requestAnimationFrame(refresh);
    setTimeout(refresh, 260);
  },

  _toggleReplay() {
    const r = this._replay;
    if (!r) return;
    if (r.playing) { this._pauseReplay(); return; }
    // Restart if at the end
    if (r.index >= r.track.length - 1) this._seekReplay(0);
    r.virtualT = r.track[r.index]?.t ?? 0;
    r.playing = true;
    r.lastTs = 0;
    if (r.el.playBtn) r.el.playBtn.innerHTML = this._pauseIcon();
    r.rafId = requestAnimationFrame((ts) => this._replayStep(ts));
  },

  _pauseReplay() {
    const r = this._replay;
    if (!r) return;
    r.playing = false;
    if (r.rafId) { cancelAnimationFrame(r.rafId); r.rafId = null; }
    if (r.el.playBtn) r.el.playBtn.innerHTML = this._playIcon();
  },

  _replayStep(ts) {
    const r = this._replay;
    if (!r || !r.playing) return;
    if (!r.lastTs) { r.lastTs = ts; r.rafId = requestAnimationFrame((t) => this._replayStep(t)); return; }
    const deltaMs = (ts - r.lastTs) * r.speed;
    r.lastTs = ts;
    r.virtualT = (r.virtualT ?? r.track[r.index]?.t ?? 0) + deltaMs;

    const track = r.track;
    let idx = r.index;
    while (idx < track.length - 1 && (track[idx + 1]?.t ?? 0) <= r.virtualT) idx++;

    this._seekReplay(idx, false);

    if (idx >= track.length - 1) {
      this._pauseReplay();
      return;
    }
    r.rafId = requestAnimationFrame((t) => this._replayStep(t));
  },

  _seekReplay(index, updateSlider = true) {
    const r = this._replay;
    if (!r) return;
    const track = r.track;
    index = Math.max(0, Math.min(index, track.length - 1));
    r.index = index;
    if (updateSlider) {
      r.virtualT = track[index]?.t ?? 0;
    }
    const p = track[index];
    if (!p) return;

    if (updateSlider && r.el.slider) r.el.slider.value = String(index);

    // Update map marker
    if (r.marker && p.lat && p.lng) {
      const pos = { lat: p.lat, lng: p.lng };
      r.marker.setPosition(pos);
      if (typeof p.heading === 'number') {
        if (typeof r.marker.setHeading === 'function') {
          r.marker.setHeading(p.heading);
        } else if (typeof r.marker.getIcon === 'function' && typeof r.marker.setIcon === 'function') {
          const icon = r.marker.getIcon();
          if (icon && typeof icon === 'object') { icon.rotation = p.heading; r.marker.setIcon(icon); }
        }
      }
    }

    // Update telemetry readout
    const ctr = r.el.ctr;
    const setTel = (key, val) => {
      const el = ctr.querySelector(`[data-tel="${key}"]`);
      if (el) el.textContent = val;
    };
    setTel('time', this._fmtElapsed(p.t));
    setTel('alt', `${Math.round(p.alt || 0)} m`);
    setTel('speed', `${Math.round(p.speed || 0)} km/h`);
    setTel('heading', `${Math.round(p.heading || 0)}\u00b0`);
    setTel('battery', `${Math.round(p.battery ?? 0)}%`);

    const clock = ctr.querySelector('#rptReplayClock');
    if (clock) clock.textContent = `${this._fmtElapsed(p.t)} / ${this._fmtElapsed(track[track.length - 1].t)}`;
  },

  _stopReplay() {
    const r = this._replay;
    if (r) {
      this._closeReplayMaximized();
      if (r.rafId) cancelAnimationFrame(r.rafId);
      if (r.marker) r.marker.setMap(null);
      if (r.polyline) r.polyline.setMap(null);
    }
    this._replay = null;
  },

  _playIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>';
  },

  _pauseIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  },

  _maximizeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3"/></svg>';
  },

  _minimizeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M9 3v4a2 2 0 01-2 2H3M15 3v4a2 2 0 002 2h4M21 15h-4a2 2 0 00-2 2v4M3 15h4a2 2 0 012 2v4"/></svg>';
  },

  // ── Formatters ──
  _fmtElapsed(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  _fmtDuration(ms) {
    if (!ms) return '\u2014';
    return this._fmtElapsed(ms);
  },

  _fmtDistance(m) {
    if (m == null) return '\u2014';
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  },

  _fmtDate(value) {
    if (!value) return '\u2014';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
};
