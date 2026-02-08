/* ── Reports Module — Post-Flight Report, Charts & AI Assessment ── */
import { state } from '../state.js';
import { RptIcons } from '../utils/icons.js';
import { callGemini, getGeminiApiKey } from '../services/gemini.js';

// ── Injected callback (set via init) ──
let _navigate = null;

export const Reports = {
  _dom: null,
  _aiResult: null,
  _charts: [],

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
    this._render();
  },

  onLeave() {
    this._destroyCharts();
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

    if (!fd) {
      d.container.innerHTML = `
        <div class="rpt-no-data">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>
          </svg>
          <h2 class="rpt-no-data-title">No Flight Data</h2>
          <p class="rpt-no-data-text">Complete a drone simulation to generate a report with telemetry, charts, and AI assessment.</p>
          <button class="rpt-no-data-btn" id="rptGoToDrone">
            ${RptIcons.drone} Go to Drone View
          </button>
        </div>`;
      d.container.querySelector('#rptGoToDrone')?.addEventListener('click', () => {
        if (_navigate) _navigate('droneview');
      });
      return;
    }

    const startDate = new Date(fd.missionStart);
    const endDate = new Date(fd.missionEnd);
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const startTime = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const batteryUsed = fd.batteryStart - fd.batteryEnd;
    const efficiencyPct = Math.max(60, Math.min(98, Math.round(100 - batteryUsed * 0.4 + fd.waypointsVisited)));
    const gpsAccuracy = (1.2 + Math.random() * 0.6).toFixed(1);

    const logRows = fd.flightLog.map(l => {
      const t = new Date(l.time);
      const ts = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const cls = l.event === 'launch' ? 'launch' : l.event === 'land' ? 'land' : l.event === 'warning' ? 'warning' : 'waypoint';
      const lbl = l.event === 'launch' ? 'Launch' : l.event === 'land' ? 'Landing' : l.event === 'warning' ? 'Warning' : 'Waypoint';
      return `<tr><td class="rpt-log-time">${ts}</td><td><span class="rpt-log-event-badge ${cls}">${lbl}</span></td><td class="rpt-log-detail">${l.detail}</td></tr>`;
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
          <span class="rpt-header-badge rpt-badge-complete"><span class="rpt-badge-dot"></span> Complete</span>
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
        <div class="rpt-stat-card"><div class="rpt-stat-icon">${RptIcons.pin}</div><span class="rpt-stat-value">${fd.waypointsVisited}</span><span class="rpt-stat-label">Waypoints</span><span class="rpt-stat-sub">All visited</span></div>
      </div>

      <!-- Charts -->
      <div class="rpt-charts-grid">
        <div class="rpt-chart-card wide"><div class="rpt-chart-header"><span class="rpt-chart-title">Altitude Profile</span><span class="rpt-chart-value">Max ${fd.maxAltitude}m</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartAltitude"></canvas></div></div>
        <div class="rpt-chart-card"><div class="rpt-chart-header"><span class="rpt-chart-title">Speed Over Time</span><span class="rpt-chart-value">Avg ${fd.avgSpeed} km/h</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartSpeed"></canvas></div></div>
        <div class="rpt-chart-card"><div class="rpt-chart-header"><span class="rpt-chart-title">Battery Drain</span><span class="rpt-chart-value">${fd.batteryStart}% \u2192 ${fd.batteryEnd}%</span></div><div class="rpt-chart-canvas-wrap"><canvas id="chartBattery"></canvas></div></div>
      </div>

      <!-- Performance + Log -->
      <div class="rpt-two-col">
        <div class="rpt-section">
          <div class="rpt-section-header">${RptIcons.perf}<span class="rpt-section-title">Performance</span></div>
          <div class="rpt-section-body">
            <div class="rpt-perf-grid">
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.gauge} Flight Efficiency</span><span class="rpt-perf-value">${efficiencyPct}%</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill" style="width:${efficiencyPct}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.battery} Battery Efficiency</span><span class="rpt-perf-value">${fd.batteryEnd}% left</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill" style="width:${fd.batteryEnd}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.sat} GPS Accuracy</span><span class="rpt-perf-value">${gpsAccuracy}m CEP</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill muted" style="width:${Math.max(20, 100 - parseFloat(gpsAccuracy) * 30)}%"></div></div></div>
              <div class="rpt-perf-row"><div class="rpt-perf-label-row"><span class="rpt-perf-label">${RptIcons.signal} Signal Strength</span><span class="rpt-perf-value">${fd.satellites} sats</span></div><div class="rpt-perf-bar-track"><div class="rpt-perf-bar-fill muted" style="width:${Math.min(100, fd.satellites * 7)}%"></div></div></div>
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
      </div>`;

    // Wire events
    d.container.querySelector('#btnExportPdf')?.addEventListener('click', () => this._exportPdf());
    d.container.querySelector('#btnGenerateAssessment')?.addEventListener('click', () => this._generateAssessment());

    requestAnimationFrame(() => this._buildCharts(fd));

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

    const labels = ['Launch', ...fd.waypoints.map((_, i) => `WP ${i + 1}`), 'Landing'];

    const altitudes = [0];
    fd.waypoints.forEach(w => altitudes.push(w.alt || Math.round(40 + Math.random() * 60)));
    altitudes.push(0);

    const speeds = [0];
    for (let i = 0; i < fd.waypoints.length; i++) {
      speeds.push(Math.round(fd.avgSpeed * (0.7 + Math.random() * 0.6)));
    }
    speeds.push(0);

    const batteryVals = [fd.batteryStart];
    const step = (fd.batteryStart - fd.batteryEnd) / fd.waypoints.length;
    for (let i = 0; i < fd.waypoints.length; i++) {
      batteryVals.push(Math.round(fd.batteryStart - step * (i + 1) + (Math.random() - 0.5) * 3));
    }
    batteryVals.push(fd.batteryEnd);

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
            pointRadius: 3,
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
            pointRadius: 2.5,
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
            pointRadius: 2.5,
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

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      this._showAssessmentError('Gemini API key not available.');
      if (btn) btn.classList.remove('loading');
      return;
    }

    const prompt = `You are a senior eVTOL drone flight operations officer. Provide a comprehensive post-flight assessment.

FLIGHT DATA:
- Drone: ${fd.droneModel} (ID: ${fd.droneId})
- Duration: ${fd.durationStr}
- Distance: ${fd.distanceStr}
- Battery: ${fd.batteryStart}% to ${fd.batteryEnd}% (${fd.batteryStart - fd.batteryEnd}% used)
- Avg Speed: ${fd.avgSpeed} km/h, Max: ${fd.maxSpeed} km/h
- Max Altitude: ${fd.maxAltitude}m
- Waypoints: ${fd.waypointsVisited} visited
- Satellites: ${fd.satellites}
- Weather: ${fd.weatherSummary}

FLIGHT LOG:
${fd.flightLog.map(l => `[${l.event.toUpperCase()}] ${l.detail}`).join('\n')}

Return JSON only (no markdown, no fences):
{
  "grade": "<A+|A|A-|B+|B|B-|C+|C|D|F>",
  "gradeTitle": "<short title>",
  "gradeDescription": "<1 sentence>",
  "overallSummary": "<3-4 sentence assessment>",
  "strengths": ["<str1>", "<str2>", "<str3>"],
  "areasForImprovement": ["<imp1>", "<imp2>"],
  "safetyEvaluation": { "rating": "<excellent|good|acceptable|concerning|poor>", "notes": ["<n1>", "<n2>"] },
  "recommendations": ["<rec1>", "<rec2>", "<rec3>"],
  "missionEfficiency": "<e.g. 94%>",
  "riskEvents": <number>,
  "complianceStatus": "<compliant|minor-issues|non-compliant>"
}`;

    try {
      const result = await callGemini(apiKey, prompt);
      this._aiResult = result;
      const aiBody = d.container.querySelector('#rptAiBody');
      if (aiBody) aiBody.innerHTML = this._renderAiAssessment(result);
    } catch (err) {
      if (btn) btn.classList.remove('loading');
      this._showAssessmentError(err.message);
    }
  },

  _renderAiAssessment(data) {
    return `
      <div class="rpt-ai-assessment">
        <div class="rpt-ai-grade-row">
          <span class="rpt-ai-grade">${data.grade || 'B'}</span>
          <div class="rpt-ai-grade-info">
            <span class="rpt-ai-grade-title">${data.gradeTitle || 'Good Performance'}</span>
            <span class="rpt-ai-grade-desc">${data.gradeDescription || ''}</span>
          </div>
        </div>
        <p class="rpt-ai-summary">${data.overallSummary || ''}</p>
        <div class="rpt-ai-meta">
          <span class="rpt-ai-meta-tag">Efficiency: ${data.missionEfficiency || '\u2014'}</span>
          <span class="rpt-ai-meta-tag">Compliance: ${data.complianceStatus || '\u2014'}</span>
          <span class="rpt-ai-meta-tag">Safety: ${(data.safetyEvaluation?.rating || '\u2014')}</span>
          <span class="rpt-ai-meta-tag">Risk Events: ${data.riskEvents ?? 0}</span>
        </div>
        ${(data.strengths || []).length ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.check} Strengths</h4><ul class="rpt-ai-list">${data.strengths.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
        ${(data.areasForImprovement || []).length ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.warn} Areas for Improvement</h4><ul class="rpt-ai-list">${data.areasForImprovement.map(a => `<li>${a}</li>`).join('')}</ul></div>` : ''}
        ${(data.safetyEvaluation?.notes || []).length ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.shield} Safety Evaluation</h4><ul class="rpt-ai-list">${data.safetyEvaluation.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''}
        ${(data.recommendations || []).length ? `<div class="rpt-ai-block"><h4 class="rpt-ai-block-title">${RptIcons.bulb} Recommendations</h4><ul class="rpt-ai-list">${data.recommendations.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}
      </div>`;
  },

  _showAssessmentError(message) {
    const aiBody = this._getDom().container.querySelector('#rptAiBody');
    if (!aiBody) return;
    const el = document.createElement('div');
    el.style.cssText = 'padding:10px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);color:var(--text-tertiary);font-size:12px;margin-top:8px;';
    el.textContent = message;
    aiBody.appendChild(el);
  }
};
