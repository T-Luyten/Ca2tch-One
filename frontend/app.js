'use strict';

// Hide splash screen after animation completes
document.addEventListener('DOMContentLoaded', () => {
  const splashScreen = document.getElementById('splash-screen');
  setTimeout(() => {
    splashScreen.style.animation = 'splash-fade-out 0.6s ease-out forwards';
    setTimeout(() => {
      splashScreen.classList.add('hidden');
    }, 600);
  }, 2000);
});

// ── Config ────────────────────────────────────────────────────────────────────
const API = '';   // same origin (FastAPI serves the frontend)

// ── Authentication ──────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('ca2_token');
}

function saveToken(token) {
  localStorage.setItem('ca2_token', token);
}

function clearToken() {
  localStorage.removeItem('ca2_token');
}

function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

function isTokenValid(token) {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) return false;
  return payload.exp * 1000 > Date.now();
}

function hasValidToken() {
  const token = getToken();
  return token && isTokenValid(token);
}

async function attemptLogin(username, password) {
  const formData = new FormData();
  formData.append('username', username);
  formData.append('password', password);

  const res = await fetch(API + '/api/token', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || 'Login failed');
  }

  const data = await res.json();
  saveToken(data.access_token);
  return data.access_token;
}

function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  overlay.classList.remove('hidden');
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  overlay.classList.add('hidden');
}

async function autoLogin() {
  try {
    await attemptLogin('admin', 'changeme');
    init();
  } catch (err) {
    // If auto-login fails, show login form
    showLoginOverlay();
    setupLoginForm();
  }
}

function setupLoginForm() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    errorEl.textContent = '';
    form.querySelector('button').disabled = true;

    try {
      await attemptLogin(username, password);
      // Re-initialize the app with authentication
      init();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      form.querySelector('button').disabled = false;
    }
  });
}

const ROI_COLORS = [
  '#f87171','#fb923c','#facc15','#4ade80','#34d399',
  '#22d3ee','#60a5fa','#a78bfa','#f472b6','#94a3b8',
  '#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b',
  '#cc5de8','#20c997','#74c0fc','#f783ac','#a9e34b',
];

function createDatasetState(role) {
  return {
    role,
    fileId: null,
    fileName: null,
    metadata: null,
    frame: 0,
    channel: 0,
    displayMode: 'channel',
    displayChannel: 0,
    cmin: 0,
    cmax: 65535,
    rois: [],
    scale: 1,
    autoColormap: true,
  };
}

function findFuraRatioChannels(channelNames = []) {
  let ch340 = -1;
  let ch380 = -1;
  channelNames.forEach((name, i) => {
    const label = String(name || '').toLowerCase();
    if (ch340 < 0 && /(^|[^0-9])340([^0-9]|$)/.test(label)) ch340 = i;
    if (ch380 < 0 && /(^|[^0-9])380([^0-9]|$)/.test(label)) ch380 = i;
  });
  return ch340 >= 0 && ch380 >= 0 ? { num: ch340, den: ch380 } : null;
}

function inferColormapFromChannelName(name) {
  const label = String(name || '').trim().toLowerCase();
  if (!label) return 'green';

  if (
    /(brightfield|bf|transmitted|transmission|phase|dic|tl brightfield)/.test(label)
  ) return 'gray';

  if (
    /(dapi|hoechst|pacific blue|cascade blue|blue)/.test(label) ||
    /(^|[^0-9])405([^0-9]|$)/.test(label)
  ) return 'blue';

  if (
    /(cfp|cyan)/.test(label) ||
    /(fura[- ]?2.*340|340.*fura[- ]?2|fluo[- ]?3|indo[- ]?1)/.test(label) ||
    /(^|[^0-9])340([^0-9]|$)/.test(label)
  ) return 'cyan';

  if (
    /(yfp|venus|magenta)/.test(label) ||
    /(fura[- ]?2.*380|380.*fura[- ]?2)/.test(label) ||
    /(^|[^0-9])380([^0-9]|$)/.test(label)
  ) return 'magenta';

  if (
    /(tdtomato|td-tomato|dsred|tritc|texas red|orange)/.test(label)
  ) return 'orange';

  if (
    /(mcherry|rfp|scarlet|red|cy5|cy3|alexa ?594|alexa ?568)/.test(label) ||
    /(^|[^0-9])561([^0-9]|$)/.test(label)
  ) return 'red';

  if (
    /(gfp|egfp|fitc|fluo[- ]?4|cal[- ]?520|ogb|oregon green|green)/.test(label) ||
    /(^|[^0-9])488([^0-9]|$)/.test(label)
  ) return 'green';

  return 'green';
}

function inferColormapForFile(file) {
  if (file?.displayMode === 'ratio') return 'rainbow';
  const channelIndex = file?.displayChannel ?? file?.channel ?? 0;
  const channelName = file?.metadata?.channel_names?.[channelIndex];
  return inferColormapFromChannelName(channelName);
}

function getDisplayParams(file) {
  if (file?.displayMode === 'ratio') {
    const pair = findFuraRatioChannels(file?.metadata?.channel_names || []);
    if (pair) {
      return {
        mode: 'ratio',
        ratioChNum: pair.num,
        ratioChDen: pair.den,
      };
    }
  }
  return {
    mode: 'channel',
    channel: file?.displayChannel ?? file?.channel ?? 0,
  };
}

function applyAutoColormap(role, { force = false } = {}) {
  const file = currentFile(role);
  if (!file.metadata) return;
  if (!force && file.autoColormap === false) return;

  const colormap = inferColormapForFile(file);
  S.colormap[role] = colormap;
  const select = role === 'source' ? D.sourceColormapSel : D.measureColormapSel;
  select.value = colormap;
}

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  activeRole:   'source',
  colormap:     { source: 'green', measure: 'green' },
  files: {
    source: createDatasetState('source'),
    measure: createDatasetState('measure'),
  },
  selected:     new Set(),
  sourceEditSelected: new Set(),
  hovered:      null,
  traces:       null,     // {"1": [f], "2": [f], ...}
  deltaF:       null,
  timeAxis:     null,
  bgTrace:      null,     // background trace (for display)
  scale:        1,        // canvas display scale

  // Background drawing
  bgMode:       'auto',   // 'none' | 'auto' | 'manual'
  bgPercentile: 50,
  bgDrawing:    false,    // currently placing polygon points
  bgPoints:     [],       // [[x,y], ...] in-progress polygon (image coords)
  bgPolygon:    null,     // completed polygon [[x,y], ...] (image coords)
  bgMousePos:   null,     // current mouse position during drawing
  roiDrawing:   null,     // { role, points:[[x,y], ...], mousePos:[x,y] | null }

  // Fura-2 ratiometric
  analysisMode: 'single', // 'single' | 'ratio'
  ratioCh340:   0,        // numerator channel index (340 nm)
  ratioCh380:   1,        // denominator channel index (380 nm)
  photobleachMode: 'none',

  // Summary metrics returned by the backend for the current analysis settings
  peaks:        null,     // {roi_id: float}
  aucs:         null,     // {roi_id: float}
  durations:    null,     // {roi_id: float}
  frequencies:  null,     // {roi_id: float}
  latencies:    null,     // {roi_id: float}
  decays:       null,     // {roi_id: float}
  riseRates:    null,     // {roi_id: float}
  eventTimes:   null,     // {roi_id: [time_s, ...]}
  tgPeaks:      null,     // {roi_id: float}
  tgSlopes:     null,     // {roi_id: float}
  tgAucs:       null,     // {roi_id: float}
  addbackPeaks: null,     // {roi_id: float}
  addbackSlopes:null,     // {roi_id: float}
  addbackAucs:  null,     // {roi_id: float}
  addbackLatencies: null, // {roi_id: float}
  aucStart:     0,        // frame index (inclusive)
  aucEnd:       0,        // frame index (exclusive); 0 = use all frames
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const D = {
  sourceFileInput:$('source-file-input'),
  measureFileInput:$('measure-file-input'),
  fileInfo:       $('file-info'),
  statusBar:      $('status-bar'),
  sourceColormapSel:  $('source-colormap-select'),
  measureColormapSel: $('measure-colormap-select'),

  projType:      $('proj-type'),
  minSize:       $('min-size'),
  maxSize:       $('max-size'),
  threshAdj:     $('thresh-adj'),
  threshAdjVal:  $('thresh-adj-val'),
  smoothSigma:   $('smooth-sigma'),
  smoothSigmaVal:$('smooth-sigma-val'),
  bgRadius:      $('bg-radius'),
  seedSigma:     $('seed-sigma'),
  seedSigmaVal:  $('seed-sigma-val'),
  allowEdgeRois: $('allow-edge-rois'),
  detectBtn:     $('detect-btn'),
  detectStatus:  $('detect-status'),
  transferBtn:   $('transfer-rois-btn'),
  transferStatus:$('transfer-status'),

  bgMode:        $('bg-mode'),
  bgAutoOpts:    $('bg-auto-opts'),
  bgManualOpts:  $('bg-manual-opts'),
  bgPercentile:  $('bg-percentile'),
  bgPercentileV: $('bg-percentile-val'),
  bgDrawBtn:     $('bg-draw-btn'),
  bgClearBtn:    $('bg-clear-btn'),
  bgDrawHint:    $('bg-draw-hint'),

  analysisModeEl: $('analysis-mode'),
  ratioOpts:      $('ratio-opts'),
  ratioCh340El:   $('ratio-ch-num'),
  ratioCh380El:   $('ratio-ch-den'),
  photobleachMode:$('photobleach-mode'),

  baselineStart: $('baseline-start'),
  baselineEnd:   $('baseline-end'),
  aucStart:      $('auc-start'),
  aucEnd:        $('auc-end'),
  tgFrame:       $('tg-frame'),
  tgEndFrame:    $('tg-end-frame'),
  tgBaselineFrames:$('tg-baseline-frames'),
  tgSlopeFrames: $('tg-slope-frames'),
  tgAssayHint:   $('tg-assay-hint'),
  addbackFrame:  $('addback-frame'),
  addbackEndFrame:$('addback-end-frame'),
  addbackBaselineFrames:$('addback-baseline-frames'),
  addbackSlopeFrames:$('addback-slope-frames'),
  addbackAssayHint:$('addback-assay-hint'),
  analyzeBtn:    $('analyze-btn'),
  exportRow:     $('export-row'),
  exportRawBtn:  $('export-raw-btn'),
  exportWorkbookBtn:$('export-workbook-btn'),
  exportOverlayBtn:$('export-overlay-btn'),
  exportProjectionOverlayBtn:$('export-projection-overlay-btn'),

  roiCount:      $('roi-count'),
  roiList:       $('roi-list'),
  roiListContext:$('roi-list-context'),
  roiAddBtn:     $('roi-add-btn'),
  roiMergeBtn:   $('roi-merge-btn'),
  roiDeleteBtn:  $('roi-delete-btn'),
  roiCancelBtn:  $('roi-cancel-btn'),
  roiDrawHint:   $('roi-draw-hint'),
  selAllBtn:     $('sel-all-btn'),
  selNoneBtn:    $('sel-none-btn'),

  plotsSection:  $('plots-section'),
  plotRaw:       $('plot-raw'),
  plotDelta:     $('plot-delta'),
  plotSummary:   $('plot-summary'),
  plotRise:      $('plot-rise'),
  plotPeak:      $('plot-peak'),
  plotAuc:       $('plot-auc'),
  plotDuration:  $('plot-duration'),
  plotFrequency: $('plot-frequency'),
  plotFrequencyChart: $('plot-frequency-chart'),
  rasterSort:    $('raster-sort'),
  plotLatency:   $('plot-latency'),
  plotDecay:     $('plot-decay'),
  plotTg:        $('plot-tg'),
  plotTgPeak:    $('plot-tg-peak'),
  plotTgSlope:   $('plot-tg-slope'),
  plotTgAuc:     $('plot-tg-auc'),
  plotAddback:   $('plot-addback'),
  plotAddbackPeak:$('plot-addback-peak'),
  plotAddbackSlope:$('plot-addback-slope'),
  plotAddbackAuc:$('plot-addback-auc'),
  plotAddbackLatency:$('plot-addback-latency'),
  tabBtns:       document.querySelectorAll('.tab-btn'),
  tabRaw:        $('tab-raw'),
  tabDelta:      $('tab-delta'),
  tabSummary:    $('tab-summary'),
  tabDuration:   $('tab-duration'),
  tabFrequency:  $('tab-frequency'),
  tabLatency:    $('tab-latency'),
  tabDecay:      $('tab-decay'),
  tabRise:       $('tab-rise'),
  tabTg:         $('tab-tg'),
  tabAddback:    $('tab-addback'),
};

D.viewers = {
  source: {
    role: 'source',
    pane: $('viewer-source-pane'),
    container: $('source-canvas-container'),
    imgCanvas: $('source-image-canvas'),
    roiCanvas: $('source-roi-canvas'),
    viewStatus: $('source-view-status'),
    frameSlider: $('source-frame-slider'),
    frameLabel: $('source-frame-label'),
    timeLabel: $('source-time-label'),
    channelSel: $('source-channel-select'),
    cmin: $('source-contrast-min'),
    cmax: $('source-contrast-max'),
    autoBtn: $('source-auto-contrast-btn'),
  },
  measure: {
    role: 'measure',
    pane: $('viewer-measure-pane'),
    container: $('measure-canvas-container'),
    imgCanvas: $('measure-image-canvas'),
    roiCanvas: $('measure-roi-canvas'),
    viewStatus: $('measure-view-status'),
    frameSlider: $('measure-frame-slider'),
    frameLabel: $('measure-frame-label'),
    timeLabel: $('measure-time-label'),
    channelSel: $('measure-channel-select'),
    cmin: $('measure-contrast-min'),
    cmax: $('measure-contrast-max'),
    autoBtn: $('measure-auto-contrast-btn'),
  },
};

for (const viewer of Object.values(D.viewers)) {
  viewer.imgCtx = viewer.imgCanvas.getContext('2d');
  viewer.roiCtx = viewer.roiCanvas.getContext('2d');
}

function currentFile(role = S.activeRole) {
  return S.files[role];
}

function sourceFile() {
  return S.files.source;
}

function measureFile() {
  return S.files.measure;
}

function displayRois() {
  return S.files[currentRoiListRole()].rois;
}

function analysisRois() {
  return measureFile().rois.length ? measureFile().rois : sourceFile().rois;
}

function currentRoiListRole() {
  if (S.activeRole === 'measure' && measureFile().rois.length) return 'measure';
  if (S.activeRole === 'source' && sourceFile().rois.length) return 'source';
  if (sourceFile().rois.length) return 'source';
  if (measureFile().rois.length) return 'measure';
  return S.activeRole;
}

function selectedAnalysisRoiIds() {
  return measureFile().rois
    .map(r => r.id)
    .filter(id => S.selected.has(id))
    .sort((a, b) => a - b);
}

function selectedSourceRoiIds() {
  return sourceFile().rois
    .map(r => r.id)
    .filter(id => S.sourceEditSelected.has(id))
    .sort((a, b) => a - b);
}

function activatePlotTab(tab) {
  D.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  D.plotRaw.style.display     = tab === 'raw'     ? 'block' : 'none';
  D.plotDelta.style.display   = tab === 'delta'   ? 'block' : 'none';
  D.plotSummary.style.display = tab === 'summary' ? 'flex'  : 'none';
  D.plotDuration.style.display = tab === 'duration' ? 'block' : 'none';
  D.plotFrequency.style.display = tab === 'frequency' ? 'block' : 'none';
  D.plotLatency.style.display = tab === 'latency' ? 'block' : 'none';
  D.plotDecay.style.display = tab === 'decay' ? 'block' : 'none';
  D.plotRise.style.display    = tab === 'rise'    ? 'block' : 'none';
  D.plotTg.style.display      = tab === 'tg'      ? 'flex'  : 'none';
  D.plotAddback.style.display = tab === 'addback' ? 'flex'  : 'none';
}

function invalidateAnalysis(message = '', { preserveRaw = false } = {}) {
  syncButtons();
  if (!S.traces && !S.deltaF && !S.peaks && !S.aucs && !S.durations && !S.frequencies && !S.latencies && !S.decays && !S.riseRates && !S.tgPeaks && !S.addbackPeaks) return;
  clearAnalysisState({ preserveRaw });
  syncAnalysisUI();
  if (preserveRaw && S.traces && S.timeAxis) {
    activatePlotTab('raw');
    renderPlots();
  }
  if (message) setStatus(message);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // Check authentication
  if (!hasValidToken()) {
    autoLogin();
    return;
  }
  hideLoginOverlay();

  // Read initial mode values from the DOM so that HTML defaults are respected.
  // State must match what the dropdowns actually show before any user interaction.
  S.colormap.source = D.sourceColormapSel.value;
  S.colormap.measure = D.measureColormapSel.value;
  S.analysisMode = D.analysisModeEl.value;
  D.ratioOpts.style.display = S.analysisMode === 'ratio' ? 'block' : 'none';
  S.photobleachMode = D.photobleachMode.value;

  S.bgMode = D.bgMode.value;
  D.bgAutoOpts.style.display   = S.bgMode === 'auto'   ? 'block' : 'none';
  D.bgManualOpts.style.display = S.bgMode === 'manual' ? 'block' : 'none';

  S.bgPercentile = +D.bgPercentile.value;
  D.bgPercentileV.textContent = S.bgPercentile + '%';

  D.sourceFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) uploadFile('source', file);
  });
  D.measureFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) uploadFile('measure', file);
  });

  for (const role of Object.keys(D.viewers)) {
    const viewer = D.viewers[role];
    viewer.frameSlider.addEventListener('input', () => {
      const file = currentFile(role);
      if (!file.metadata) return;
      file.frame = +viewer.frameSlider.value;
      viewer.frameLabel.textContent = `${file.frame + 1} / ${file.metadata.n_frames}`;
      viewer.timeLabel.textContent = `${file.metadata.time_axis[file.frame].toFixed(2)} s`;
      requestFrame(role);
      updatePlotTimeCursor();
    });

    viewer.channelSel.addEventListener('change', () => {
      const file = currentFile(role);
      const value = viewer.channelSel.value;
      if (role === 'measure' && value === 'ratio') {
        file.displayMode = 'ratio';
      } else {
        const channel = +value;
        file.channel = channel;
        file.displayChannel = channel;
        file.displayMode = 'channel';
      }
      applyAutoColormap(role);
      autoContrast(role);
      if (role === 'measure') invalidateAnalysis('', { preserveRaw: true });
    });

    viewer.cmin.addEventListener('change', () => {
      currentFile(role).cmin = +viewer.cmin.value;
      requestFrame(role);
    });

    viewer.cmax.addEventListener('change', () => {
      currentFile(role).cmax = +viewer.cmax.value;
      requestFrame(role);
    });

    viewer.autoBtn.addEventListener('click', () => autoContrast(role));

    viewer.pane.addEventListener('pointerenter', () => {
      S.activeRole = role;
      renderROIList();
      syncButtons();
    });

    viewer.roiCanvas.addEventListener('mousemove', e => onCanvasMove(role, e));
    viewer.roiCanvas.addEventListener('click', e => onCanvasClick(role, e));
    viewer.roiCanvas.addEventListener('dblclick', e => onCanvasDblClick(role, e));
    viewer.roiCanvas.addEventListener('mouseleave', () => onCanvasLeave(role));
  }

  D.sourceColormapSel.addEventListener('change', () => {
    sourceFile().autoColormap = false;
    S.colormap.source = D.sourceColormapSel.value;
    requestFrame('source');
  });
  D.measureColormapSel.addEventListener('change', () => {
    measureFile().autoColormap = false;
    S.colormap.measure = D.measureColormapSel.value;
    requestFrame('measure');
  });

  D.threshAdj.addEventListener('input', () => {
    D.threshAdjVal.textContent = (+D.threshAdj.value).toFixed(2);
  });
  D.smoothSigma.addEventListener('input', () => {
    D.smoothSigmaVal.textContent = (+D.smoothSigma.value).toFixed(1);
  });
  D.seedSigma.addEventListener('input', () => {
    D.seedSigmaVal.textContent = (+D.seedSigma.value).toFixed(1);
  });

  D.detectBtn.addEventListener('click', runDetection);
  D.transferBtn.addEventListener('click', transferROIsToMeasurement);
  D.analyzeBtn.addEventListener('click', runAnalysis);

  D.rasterSort.addEventListener('change', () => renderFrequencies());

  D.exportRawBtn.addEventListener('click', () => exportCSV('raw'));
  D.exportWorkbookBtn.addEventListener('click', exportWorkbook);
  D.exportOverlayBtn.addEventListener('click', exportOverlayImage);
  D.exportProjectionOverlayBtn.addEventListener('click', exportProjectionOverlayImage);

  // Background correction controls
  D.bgMode.addEventListener('change', () => {
    S.bgMode = D.bgMode.value;
    D.bgAutoOpts.style.display   = S.bgMode === 'none'   ? 'none' : 'block';
    D.bgManualOpts.style.display = S.bgMode === 'manual' ? 'block' : 'none';
    if (S.bgMode !== 'manual') cancelBGDraw();
    invalidateAnalysis('', { preserveRaw: true });
  });

  D.bgPercentile.addEventListener('input', () => {
    S.bgPercentile = +D.bgPercentile.value;
    D.bgPercentileV.textContent = S.bgPercentile + '%';
    invalidateAnalysis('', { preserveRaw: true });
  });

  D.bgDrawBtn.addEventListener('click', startBGDraw);
  D.bgClearBtn.addEventListener('click', clearBGPolygon);

  D.aucStart.addEventListener('change', () => {
    S.aucStart = Math.max(0, +D.aucStart.value);
    updatePlotTimeCursor();
    invalidateAnalysis('', { preserveRaw: true });
  });
  D.aucEnd.addEventListener('change', () => {
    S.aucEnd = Math.max(0, +D.aucEnd.value);
    updatePlotTimeCursor();
    invalidateAnalysis('', { preserveRaw: true });
  });

  D.analysisModeEl.addEventListener('change', () => {
    S.analysisMode = D.analysisModeEl.value;
    D.ratioOpts.style.display = S.analysisMode === 'ratio' ? 'block' : 'none';
    invalidateAnalysis('', { preserveRaw: true });
  });
  D.photobleachMode.addEventListener('change', () => {
    S.photobleachMode = D.photobleachMode.value;
    invalidateAnalysis('', { preserveRaw: true });
  });
  D.ratioCh340El.addEventListener('change', () => {
    S.ratioCh340 = +D.ratioCh340El.value;
    invalidateAnalysis('', { preserveRaw: true });
  });
  D.ratioCh380El.addEventListener('change', () => {
    S.ratioCh380 = +D.ratioCh380El.value;
    invalidateAnalysis('', { preserveRaw: true });
  });

  [D.baselineStart, D.baselineEnd].forEach(el => {
    el.addEventListener('input',  () => updatePlotTimeCursor());
    el.addEventListener('change', () => { updatePlotTimeCursor(); invalidateAnalysis('', { preserveRaw: true }); });
  });
  [D.tgFrame, D.tgEndFrame, D.tgBaselineFrames, D.tgSlopeFrames, D.addbackFrame, D.addbackEndFrame, D.addbackBaselineFrames, D.addbackSlopeFrames].forEach(el => {
    el.addEventListener('change', () => {
      updatePlotTimeCursor();
      updateAssayValidationHints();
      invalidateAnalysis('', { preserveRaw: true });
    });
    el.addEventListener('input', updateAssayValidationHints);
  });

  D.selAllBtn.addEventListener('click', () => {
    const listRole = currentRoiListRole();
    if (listRole === 'source') {
      S.sourceEditSelected = new Set(displayRois().map(r => r.id));
    } else {
      S.selected = new Set(displayRois().map(r => r.id));
      invalidateAnalysis('', { preserveRaw: true });
    }
    renderROIList(); drawROIs();
    syncButtons();
  });
  D.selNoneBtn.addEventListener('click', () => {
    const listRole = currentRoiListRole();
    if (listRole === 'source') {
      S.sourceEditSelected.clear();
    } else {
      S.selected.clear();
      invalidateAnalysis('', { preserveRaw: true });
    }
    renderROIList(); drawROIs();
    syncButtons();
  });
  D.roiAddBtn.addEventListener('click', startManualRoiDraw);
  D.roiMergeBtn.addEventListener('click', mergeSelectedSourceRois);
  D.roiDeleteBtn.addEventListener('click', deleteSelectedSourceRois);
  D.roiCancelBtn.addEventListener('click', cancelManualRoiDraw);

  D.tabBtns.forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    activatePlotTab(tab);
    // Plotly needs a nudge after display:none -> block
    requestAnimationFrame(() => {
      if (tab === 'raw'     && D.plotRaw.offsetParent)     Plotly.Plots.resize(D.plotRaw);
      if (tab === 'delta'   && D.plotDelta.offsetParent)   Plotly.Plots.resize(D.plotDelta);
      if (tab === 'summary' && D.plotSummary.offsetParent) {
        Plotly.Plots.resize(D.plotPeak);
        Plotly.Plots.resize(D.plotAuc);
      }
      if (tab === 'duration' && D.plotDuration.offsetParent) Plotly.Plots.resize(D.plotDuration);
      if (tab === 'frequency' && D.plotFrequency.offsetParent) Plotly.Plots.resize(D.plotFrequencyChart);
      if (tab === 'latency' && D.plotLatency.offsetParent) Plotly.Plots.resize(D.plotLatency);
      if (tab === 'decay' && D.plotDecay.offsetParent) Plotly.Plots.resize(D.plotDecay);
      if (tab === 'rise' && D.plotRise.offsetParent) Plotly.Plots.resize(D.plotRise);
      if (tab === 'tg' && D.plotTg.offsetParent) {
        Plotly.Plots.resize(D.plotTgPeak);
        Plotly.Plots.resize(D.plotTgSlope);
        Plotly.Plots.resize(D.plotTgAuc);
      }
      if (tab === 'addback' && D.plotAddback.offsetParent) {
        Plotly.Plots.resize(D.plotAddbackPeak);
        Plotly.Plots.resize(D.plotAddbackSlope);
        Plotly.Plots.resize(D.plotAddbackAuc);
        Plotly.Plots.resize(D.plotAddbackLatency);
      }
    });
  }));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cancelBGDraw();
      cancelManualRoiDraw();
    }
  });

  window.addEventListener('resize', debounce(onResize, 150));
  window.addEventListener('pagehide', () => {
    cleanupFileSession(S.files.source.fileId, { keepalive: true });
    cleanupFileSession(S.files.measure.fileId, { keepalive: true });
  });

  startMemoryPoller();
  setupDragMouseHandlers();
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadFile(role, file) {
  const dataset = S.files[role];
  const previousFileId = dataset.fileId;
  cancelManualRoiDraw();
  setStatus(`Loading ${role === 'source' ? 'ROI source' : 'measurement'}…`);
  D.detectBtn.disabled = true;
  D.transferBtn.disabled = true;
  D.analyzeBtn.disabled = true;
  document.getElementById('upload-bar-fill').classList.add('active');

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
    const { file_id, metadata, initial_contrast } = res;

    dataset.fileId   = file_id;
    dataset.fileName = file.name;
    dataset.metadata = metadata;
    dataset.frame    = 0;
    dataset.channel  = 0;
    dataset.displayMode = 'channel';
    dataset.displayChannel = 0;
    dataset.cmin     = initial_contrast.min;
    dataset.cmax     = initial_contrast.max;
    dataset.rois     = [];
    dataset.autoColormap = true;

    if (role === 'source') {
      S.selected = new Set();
      S.sourceEditSelected = new Set();
      clearAnalysisState();
      syncAnalysisUI();
      clearBGPolygon();
      measureFile().rois = [];
      D.transferStatus.textContent = '';
      D.detectStatus.textContent = '';
    } else {
      S.sourceEditSelected.clear();
      clearAnalysisState();
      syncAnalysisUI();
    }

    if (!currentFile(S.activeRole).metadata) {
      S.activeRole = role;
    }
    syncViewer(role);
    if (role === 'source') drawROIs('measure');
    renderROIList();
    updatePlotTimeCursor();

    if (role === 'measure') {
      D.baselineStart.value = 0;
      D.baselineEnd.value = 0;
      D.aucStart.value = 0;
      D.aucStart.max   = metadata.n_frames - 1;
      D.aucEnd.value   = 0;
      D.aucEnd.max     = metadata.n_frames;
      D.tgFrame.max = metadata.n_frames - 1;
      D.addbackFrame.max = metadata.n_frames - 1;
      D.tgEndFrame.max = metadata.n_frames;
      D.tgBaselineFrames.max = metadata.n_frames;
      D.tgSlopeFrames.max = metadata.n_frames;
      D.addbackEndFrame.max = metadata.n_frames;
      D.addbackBaselineFrames.max = metadata.n_frames;
      D.addbackSlopeFrames.max = metadata.n_frames;
      D.tgFrame.value = 0;
      D.addbackFrame.value = 0;
      D.tgEndFrame.value = 0;
      D.addbackEndFrame.value = 0;
      D.tgBaselineFrames.value = 5;
      D.tgSlopeFrames.value = 5;
      D.addbackBaselineFrames.value = 5;
      D.addbackSlopeFrames.value = 5;
      S.aucStart = 0;
      S.aucEnd   = 0;
      updateAssayValidationHints();
    }

    cleanupFileSession(previousFileId);
    setStatus('');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    document.getElementById('upload-bar-fill').classList.remove('active');
  }
}

function populateChannelSelects(role, metadata, file) {
  const viewer = D.viewers[role];
  viewer.channelSel.innerHTML = '';
  metadata.channel_names.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    if (file.displayMode === 'channel' && i === file.displayChannel) opt.selected = true;
    viewer.channelSel.appendChild(opt);
  });

  if (role === 'measure') {
    const pair = findFuraRatioChannels(metadata.channel_names);
    if (pair) {
      const opt = document.createElement('option');
      opt.value = 'ratio';
      opt.textContent = `Fura-2 ratio (${metadata.channel_names[pair.num]} / ${metadata.channel_names[pair.den]})`;
      if (file.displayMode === 'ratio') opt.selected = true;
      viewer.channelSel.appendChild(opt);
    }
  }

  const analysisMeta = measureFile().metadata || metadata;
  const analysisPair = findFuraRatioChannels(analysisMeta.channel_names);
  D.ratioCh340El.innerHTML = '';
  D.ratioCh380El.innerHTML = '';
  analysisMeta.channel_names.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    D.ratioCh340El.appendChild(opt.cloneNode(true));
    D.ratioCh380El.appendChild(opt.cloneNode(true));
  });
  S.ratioCh340 = analysisPair ? analysisPair.num : 0;
  S.ratioCh380 = analysisPair ? analysisPair.den : Math.min(1, analysisMeta.n_channels - 1);
  D.ratioCh340El.value = String(S.ratioCh340);
  D.ratioCh380El.value = String(S.ratioCh380);
}

function syncDatasetInfo() {
  const source = sourceFile();
  const measure = measureFile();
  const sourceLabel = source.fileName ? `${source.fileName} (${source.metadata.width}×${source.metadata.height})` : 'none';
  const measureLabel = measure.fileName ? `${measure.fileName} (${measure.metadata.width}×${measure.metadata.height})` : 'none';
  D.fileInfo.textContent = `ROI source: ${sourceLabel} | Measurement: ${measureLabel}`;
}

function syncButtons() {
  const sourceSelectedIds = selectedSourceRoiIds();
  D.detectBtn.disabled = !sourceFile().fileId;
  D.transferBtn.disabled = !(sourceFile().fileId && sourceFile().rois.length && measureFile().fileId);
  D.analyzeBtn.disabled = !(measureFile().fileId && selectedAnalysisRoiIds().length);
  D.roiAddBtn.disabled = !sourceFile().fileId || S.bgDrawing || !!S.roiDrawing;
  D.roiMergeBtn.disabled = !sourceFile().fileId || !!S.roiDrawing || sourceSelectedIds.length !== 2;
  D.roiDeleteBtn.disabled = !sourceFile().fileId || !!S.roiDrawing || sourceSelectedIds.length === 0;
  D.roiCancelBtn.style.display = S.roiDrawing ? 'block' : 'none';
  D.roiDrawHint.style.display = S.roiDrawing ? 'block' : 'none';
}

function syncViewer(role) {
  const viewer = D.viewers[role];
  const file = currentFile(role);
  syncDatasetInfo();
  if (!file.metadata) {
    viewer.viewStatus.textContent = role === 'source' ? 'No source' : 'No target';
    viewer.frameLabel.textContent = '— / —';
    viewer.timeLabel.textContent = '';
    viewer.channelSel.innerHTML = '';
    viewer.cmin.value = 0;
    viewer.cmax.value = 65535;
    viewer.imgCtx.clearRect(0, 0, viewer.imgCanvas.width, viewer.imgCanvas.height);
    viewer.roiCtx.clearRect(0, 0, viewer.roiCanvas.width, viewer.roiCanvas.height);
    syncButtons();
    return;
  }

  viewer.viewStatus.textContent = role === 'source' ? 'ROI source loaded' : 'Measurement loaded';
  viewer.frameSlider.max = file.metadata.n_frames - 1;
  viewer.frameSlider.value = file.frame;
  viewer.frameLabel.textContent = `${file.frame + 1} / ${file.metadata.n_frames}`;
  viewer.timeLabel.textContent = `${file.metadata.time_axis[file.frame].toFixed(2)} s`;
  viewer.cmin.value = Math.round(file.cmin);
  viewer.cmax.value = Math.round(file.cmax);
  populateChannelSelects(role, file.metadata, file);
  applyAutoColormap(role);
  setupCanvas(role, file.metadata.width, file.metadata.height);
  drawROIs(role);
  requestFrame(role);
  syncButtons();
}

// ── Canvas setup ──────────────────────────────────────────────────────────────
function setupCanvas(role, w, h) {
  const cont = D.viewers[role].container;
  const cw = cont.clientWidth;
  const ch = cont.clientHeight;
  const scale = Math.min(cw / w, ch / h, 1);

  currentFile(role).scale = scale;
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  [D.viewers[role].imgCanvas, D.viewers[role].roiCanvas].forEach(c => {
    c.width  = dw; c.height = dh;
    c.style.width  = dw + 'px';
    c.style.height = dh + 'px';
  });
}

function onResize() {
  for (const role of Object.keys(D.viewers)) {
    const file = currentFile(role);
    if (!file.metadata) continue;
    setupCanvas(role, file.metadata.width, file.metadata.height);
    requestFrame(role);
    drawROIs(role);
  }
}

// ── Frame display ─────────────────────────────────────────────────────────────
let _frameTimer = null;

function requestFrame(role) {
  const file = currentFile(role);
  if (!file.fileId) return;
  clearTimeout(_frameTimer?.[role]);
  _frameTimer = _frameTimer || {};
  _frameTimer[role] = setTimeout(() => _loadFrame(role), 40);
}

async function _loadFrame(role) {
  const file = currentFile(role);
  const viewer = D.viewers[role];
  if (!file.fileId) return;
  const display = getDisplayParams(file);
  const token = getToken();
  const url = `${API}/api/frame/${file.fileId}` +
    `?t=${file.frame}` +
    (display.mode === 'ratio'
      ? `&mode=ratio&ratio_ch_num=${display.ratioChNum}&ratio_ch_den=${display.ratioChDen}`
      : `&channel=${display.channel}`) +
    `&cmin=${file.cmin}&cmax=${file.cmax}&colormap=${S.colormap[role]}` +
    (token ? `&token=${encodeURIComponent(token)}` : '');

  const img = new Image();
  img.onload = () => {
    viewer.imgCtx.clearRect(0, 0, viewer.imgCanvas.width, viewer.imgCanvas.height);
    viewer.imgCtx.drawImage(img, 0, 0, viewer.imgCanvas.width, viewer.imgCanvas.height);
  };
  img.src = url + `&_=${Date.now()}`;
}

async function autoContrast(role) {
  const file = currentFile(role);
  const viewer = D.viewers[role];
  if (!file.fileId) return;
  try {
    const display = getDisplayParams(file);
    const res = await apiFetch(
      `${API}/api/contrast/${file.fileId}?p_low=1&p_high=99.5` +
      (display.mode === 'ratio'
        ? `&mode=ratio&ratio_ch_num=${display.ratioChNum}&ratio_ch_den=${display.ratioChDen}`
        : `&channel=${display.channel}`)
    );
    file.cmin = res.min; file.cmax = res.max;
    viewer.cmin.value = Math.round(file.cmin);
    viewer.cmax.value = Math.round(file.cmax);
    requestFrame(role);
  } catch (err) { setStatus(`Auto-contrast error: ${err.message}`); }
}

// ── Detection ─────────────────────────────────────────────────────────────────
async function runDetection() {
  const file = sourceFile();
  if (!file.fileId) return;
  cancelManualRoiDraw();
  D.detectBtn.disabled = true;
  D.detectStatus.textContent = 'Detecting cells…';
  D.transferStatus.textContent = '';

  const body = {
    channel:          file.channel,
    projection_type:  D.projType.value,
    min_size:         +D.minSize.value,
    max_size:         +D.maxSize.value,
    threshold_adjust: +D.threshAdj.value,
    smooth_sigma:     +D.smoothSigma.value,
    background_radius:+D.bgRadius.value,
    seed_sigma:       +D.seedSigma.value,
    allow_edge_rois:  D.allowEdgeRois.checked,
  };

  try {
    const res = await apiFetch(`/api/detect/${file.fileId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    file.rois = res.rois.map((r, i) => ({ ...r, color: ROI_COLORS[i % ROI_COLORS.length] }));
    measureFile().rois = [];
    S.sourceEditSelected.clear();
    S.selected.clear();
    clearAnalysisState();

    D.detectStatus.textContent = `${res.n_rois} cells detected on ROI source`;
    D.transferStatus.textContent = measureFile().fileId ? 'Copy these ROIs to the measurement file before analysis.' : 'Load a measurement file to transfer these ROIs.';
    syncAnalysisUI();
    syncButtons();
    renderROIList();
    drawROIs('source');
    drawROIs('measure');
  } catch (err) {
    D.detectStatus.textContent = `Error: ${err.message}`;
  } finally {
    syncButtons();
  }
}

async function transferROIsToMeasurement() {
  const source = sourceFile();
  const measure = measureFile();
  if (!source.fileId || !measure.fileId || !source.rois.length) return;
  cancelManualRoiDraw();

  D.transferBtn.disabled = true;
  D.transferStatus.textContent = 'Copying ROIs to measurement file…';
  try {
    const res = await apiFetch('/api/transfer-rois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_file_id: source.fileId,
        target_file_id: measure.fileId,
      }),
    });

    measure.rois = res.rois.map((r, i) => ({
      ...r,
      color: source.rois[i]?.color || ROI_COLORS[i % ROI_COLORS.length],
    }));
    S.selected = new Set(measure.rois.map(r => r.id));
    S.sourceEditSelected.clear();
    clearAnalysisState();
    D.transferStatus.textContent = `${res.n_rois} ROIs copied to measurement file`;
    S.activeRole = 'measure';
    renderROIList();
    drawROIs('measure');
  } catch (err) {
    D.transferStatus.textContent = `Error: ${err.message}`;
  } finally {
    syncButtons();
  }
}

// ── ROI drawing ───────────────────────────────────────────────────────────────
function drawROIs(role = S.activeRole) {
  const viewer = D.viewers[role];
  const ctx = viewer.roiCtx;
  const sc  = currentFile(role).scale || 1;
  ctx.clearRect(0, 0, viewer.roiCanvas.width, viewer.roiCanvas.height);

  // ── Cell ROIs ──
  for (const roi of currentFile(role).rois) {
    const sel = role === 'source'
      ? S.sourceEditSelected.has(roi.id)
      : S.selected.has(roi.id);
    const hov = S.hovered === roi.id;

    if (roi.contour.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(roi.contour[0][0] * sc, roi.contour[0][1] * sc);
    for (let i = 1; i < roi.contour.length; i++) {
      ctx.lineTo(roi.contour[i][0] * sc, roi.contour[i][1] * sc);
    }
    ctx.closePath();

    if (sel) {
      ctx.fillStyle = hexAlpha(roi.color, hov ? 0.35 : 0.12);
      ctx.fill();
    }

    ctx.strokeStyle = sel ? roi.color : '#555';
    ctx.lineWidth   = hov ? 2.5 : 1.5;
    ctx.stroke();

    if (sel) {
      ctx.fillStyle    = roi.color;
      ctx.font         = `${Math.max(9, Math.round(9 * sc))}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(roi.id), roi.centroid[0] * sc, roi.centroid[1] * sc);
    }
  }

  // ── In-progress manual ROI polygon ──
  if (S.roiDrawing?.role === role && S.roiDrawing.points.length > 0) {
    const pts = S.roiDrawing.mousePos
      ? [...S.roiDrawing.points, S.roiDrawing.mousePos]
      : S.roiDrawing.points;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * sc, pts[0][1] * sc);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0] * sc, pts[i][1] * sc);
    }
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#e5e7eb';
    for (const [px, py] of S.roiDrawing.points) {
      ctx.beginPath();
      ctx.arc(px * sc, py * sc, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Completed BG polygon ──
  if (role === 'measure' && S.bgPolygon && S.bgPolygon.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(S.bgPolygon[0][0] * sc, S.bgPolygon[0][1] * sc);
    for (let i = 1; i < S.bgPolygon.length; i++) {
      ctx.lineTo(S.bgPolygon[i][0] * sc, S.bgPolygon[i][1] * sc);
    }
    ctx.closePath();
    ctx.fillStyle   = 'rgba(251,191,36,0.18)';
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    const cx = S.bgPolygon.reduce((s, p) => s + p[0], 0) / S.bgPolygon.length;
    const cy = S.bgPolygon.reduce((s, p) => s + p[1], 0) / S.bgPolygon.length;
    ctx.fillStyle    = '#fbbf24';
    ctx.font         = `bold ${Math.max(9, Math.round(9 * sc))}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BG', cx * sc, cy * sc);
  }

  // ── In-progress BG polygon ──
  if (role === 'measure' && S.bgDrawing && S.bgPoints.length > 0) {
    const pts = S.bgMousePos ? [...S.bgPoints, S.bgMousePos] : S.bgPoints;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * sc, pts[0][1] * sc);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0] * sc, pts[i][1] * sc);
    }
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dots at each placed point
    ctx.fillStyle = '#fbbf24';
    for (const [px, py] of S.bgPoints) {
      ctx.beginPath();
      ctx.arc(px * sc, py * sc, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── ROI list ──────────────────────────────────────────────────────────────────
function renderROIList() {
  const listRole = currentRoiListRole();
  const rois = displayRois();
  const allowDelete = listRole === 'source';
  const selection = listRole === 'source' ? S.sourceEditSelected : S.selected;
  D.roiListContext.textContent = listRole === 'source'
    ? 'Showing ROI Source cells. Check ROIs here to edit, merge, or delete before transfer.'
    : 'Showing Measurement cells. Check ROIs here to include or exclude them from analysis.';
  D.roiList.innerHTML = '';
  D.roiCount.textContent = `(${rois.length})`;

  for (const roi of rois) {
    const div = document.createElement('div');
    div.className = 'roi-item';
    div.dataset.id = roi.id;

    div.innerHTML = `
      <input type="checkbox" class="roi-checkbox" ${selection.has(roi.id) ? 'checked' : ''}>
      <div class="roi-dot" style="background:${roi.color}"></div>
      <span class="roi-label">ROI ${roi.id}</span>
      <span class="roi-area">${roi.area} px²</span>
      ${allowDelete ? '<button class="roi-del" title="Remove ROI">×</button>' : ''}
    `;

    div.querySelector('.roi-checkbox').addEventListener('change', e => {
      if (listRole === 'source') {
        if (e.target.checked) S.sourceEditSelected.add(roi.id); else S.sourceEditSelected.delete(roi.id);
      } else {
        if (e.target.checked) S.selected.add(roi.id); else S.selected.delete(roi.id);
      }
      div.classList.toggle('selected', e.target.checked);
      if (listRole !== 'source') {
        invalidateAnalysis('', { preserveRaw: true });
      }
      drawROIs();
      syncButtons();
    });

    const deleteBtn = div.querySelector('.roi-del');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteROI(roi.id);
      });
    }

    div.addEventListener('mouseenter', () => {
      S.hovered = roi.id; drawROIs(); syncListHighlight(roi.id);
    });
    div.addEventListener('mouseleave', () => {
      S.hovered = null; drawROIs(); syncListHighlight(null);
    });

    D.roiList.appendChild(div);
  }
}

async function deleteROI(roiId) {
  try {
    const file = sourceFile();
    await apiFetch(`/api/roi/${file.fileId}/${roiId}`, { method: 'DELETE' });
    file.rois = file.rois.filter(r => r.id !== roiId);
    S.sourceEditSelected.delete(roiId);
    if (S.hovered === roiId) S.hovered = null;

    measureFile().rois = [];
    D.transferStatus.textContent = measureFile().fileId
      ? 'ROI source changed. Copy ROIs to the measurement file before analysis.'
      : 'Load a measurement file to transfer these ROIs.';

    clearAnalysisState();
    syncAnalysisUI();
    syncButtons();
    renderROIList();
    drawROIs('source');
    drawROIs('measure');
    setStatus(`ROI ${roiId} removed from ROI source.`);
  } catch (err) { setStatus(`Delete error: ${err.message}`); }
}

function syncListHighlight(roiId) {
  document.querySelectorAll('.roi-item').forEach(el => {
    el.classList.toggle('highlighted', +el.dataset.id === roiId);
  });
}

// ── Canvas interaction ────────────────────────────────────────────────────────
function canvasXY(role, e) {
  const rect = D.viewers[role].roiCanvas.getBoundingClientRect();
  const sc = currentFile(role).scale || 1;
  return {
    x: (e.clientX - rect.left) / sc,
    y: (e.clientY - rect.top)  / sc,
  };
}

function roiAtPoint(role, x, y) {
  const rois = currentFile(role).rois;
  for (let i = rois.length - 1; i >= 0; i--) {
    if (pointInPoly(x, y, rois[i].contour)) return rois[i];
  }
  return null;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function onCanvasMove(role, e) {
  S.activeRole = role;
  const { x, y } = canvasXY(role, e);

  if (S.roiDrawing?.role === role) {
    S.roiDrawing.mousePos = [x, y];
    drawROIs(role);
    return;
  }

  if (role === 'measure' && S.bgDrawing) {
    S.bgMousePos = [x, y];
    drawROIs(role);
    return;
  }

  const roi = roiAtPoint(role, x, y);
  const id  = roi ? roi.id : null;
  if (id !== S.hovered) {
    S.hovered = id;
    drawROIs(role);
    syncListHighlight(id);
    if (id !== null) {
      const el = D.roiList.querySelector(`[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }
}

function onCanvasClick(role, e) {
  S.activeRole = role;
  if (e.detail >= 2) return; // ignore — dblclick handles this

  if (S.roiDrawing?.role === role) {
    const { x, y } = canvasXY(role, e);
    S.roiDrawing.points.push([x, y]);
    drawROIs(role);
    return;
  }

  if (role === 'measure' && S.bgDrawing) {
    const { x, y } = canvasXY(role, e);
    S.bgPoints.push([x, y]);
    drawROIs(role);
    return;
  }

  const { x, y } = canvasXY(role, e);
  const roi = roiAtPoint(role, x, y);
  if (!roi) return;

  if (role === 'source') {
    if (S.sourceEditSelected.has(roi.id)) S.sourceEditSelected.delete(roi.id);
    else S.sourceEditSelected.add(roi.id);
  } else {
    if (S.selected.has(roi.id)) S.selected.delete(roi.id);
    else S.selected.add(roi.id);
    invalidateAnalysis('', { preserveRaw: true });
  }
  renderROIList();
  drawROIs(role);
  syncButtons();
}

async function onCanvasDblClick(role, e) {
  S.activeRole = role;

  if (S.roiDrawing?.role === role) {
    const { x, y } = canvasXY(role, e);
    S.roiDrawing.points.push([x, y]);
    if (S.roiDrawing.points.length >= 3) {
      await commitManualROI(role, S.roiDrawing.points);
    } else {
      setStatus('Manual ROI needs at least 3 points.');
      cancelManualRoiDraw();
    }
    return;
  }

  if (role !== 'measure' || !S.bgDrawing) return;
  const { x, y } = canvasXY(role, e);
  S.bgPoints.push([x, y]);
  if (S.bgPoints.length >= 3) {
    S.bgPolygon = [...S.bgPoints];
  }
  S.bgDrawing  = false;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.viewers.measure.roiCanvas.classList.remove('drawing-bg', 'drawing-bg-active');
  D.bgDrawBtn.textContent  = 'Redraw BG Region';
  D.bgClearBtn.style.display = S.bgPolygon ? 'block' : 'none';
  invalidateAnalysis('Background region changed. Run analysis again.', { preserveRaw: true });
  drawROIs('measure');
}

function onCanvasLeave(role) {
  if (S.roiDrawing?.role === role) {
    S.roiDrawing.mousePos = null;
    drawROIs(role);
    return;
  }
  if (role === 'measure' && S.bgDrawing) {
    S.bgMousePos = null;
    drawROIs(role);
    return;
  }
  if (S.hovered !== null) {
    S.hovered = null;
    drawROIs(role);
    syncListHighlight(null);
  }
}

// ── Manual ROI drawing ───────────────────────────────────────────────────────
function startManualRoiDraw() {
  const file = sourceFile();
  if (!file.fileId) return;
  cancelBGDraw();
  S.activeRole = 'source';
  S.roiDrawing = { role: 'source', points: [], mousePos: null };
  D.viewers.source.roiCanvas.classList.add('drawing-bg');
  D.roiAddBtn.textContent = 'Drawing ROI On Source…';
  renderROIList();
  syncButtons();
  drawROIs('source');
}

function cancelManualRoiDraw() {
  if (!S.roiDrawing) return;
  const { role } = S.roiDrawing;
  D.viewers[role].roiCanvas.classList.remove('drawing-bg');
  S.roiDrawing = null;
  D.roiAddBtn.textContent = 'Add ROI';
  syncButtons();
  drawROIs(role);
}

async function commitManualROI(role, polygon) {
  const file = S.files[role];
  try {
    const res = await apiFetch(`/api/roi/${file.fileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon }),
    });
    file.rois = res.rois.map((roi, i) => ({
      ...roi,
      color: file.rois.find(existing => existing.id === roi.id)?.color || ROI_COLORS[i % ROI_COLORS.length],
    }));
    if (res.roi?.id != null) {
      S.sourceEditSelected.clear();
      S.sourceEditSelected.add(res.roi.id);
    }

    if (role === 'source') {
      measureFile().rois = [];
      D.transferStatus.textContent = measureFile().fileId
        ? 'Manual ROI added on ROI source. Copy ROIs to the measurement file before analysis.'
        : 'Load a measurement file to transfer these ROIs.';
      drawROIs('measure');
    }

    clearAnalysisState();
    syncAnalysisUI();
    renderROIList();
    drawROIs(role);
    setStatus(`Added ROI ${res.roi.id} to ${role === 'source' ? 'ROI source' : 'measurement'}.`);
  } catch (err) {
    setStatus(`Add ROI error: ${err.message}`);
  } finally {
    cancelManualRoiDraw();
  }
}

async function mergeSelectedSourceRois() {
  const roiIds = selectedSourceRoiIds();
  if (roiIds.length !== 2) return;

  try {
    const file = sourceFile();
    const res = await apiFetch(`/api/roi/${file.fileId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roi_ids: roiIds }),
    });

    file.rois = res.rois.map((roi, i) => ({
      ...roi,
      color: file.rois.find(existing => existing.id === roi.id)?.color || ROI_COLORS[i % ROI_COLORS.length],
    }));
    S.sourceEditSelected.delete(roiIds[0]);
    S.sourceEditSelected.delete(roiIds[1]);
    if (res.roi?.id != null) S.sourceEditSelected.add(res.roi.id);

    measureFile().rois = [];
    D.transferStatus.textContent = measureFile().fileId
      ? 'ROI source changed. Copy ROIs to the measurement file before analysis.'
      : 'Load a measurement file to transfer these ROIs.';

    clearAnalysisState();
    syncAnalysisUI();
    renderROIList();
    drawROIs('source');
    drawROIs('measure');
    syncButtons();
    setStatus(`Merged ROI ${roiIds[0]} and ROI ${roiIds[1]} on ROI source.`);
  } catch (err) {
    setStatus(`Merge error: ${err.message}`);
  }
}

async function deleteSelectedSourceRois() {
  const roiIds = selectedSourceRoiIds();
  if (!roiIds.length) return;

  for (const roiId of roiIds) {
    await deleteROI(roiId);
  }
}

// ── BG polygon drawing ────────────────────────────────────────────────────────
function startBGDraw() {
  cancelManualRoiDraw();
  S.activeRole = 'measure';
  S.bgDrawing  = true;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.viewers.measure.roiCanvas.classList.add('drawing-bg');
  D.bgDrawBtn.textContent = 'Drawing… (dbl-click to finish)';
  drawROIs('measure');
}

function cancelBGDraw() {
  if (!S.bgDrawing) return;
  S.bgDrawing  = false;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.viewers.measure.roiCanvas.classList.remove('drawing-bg', 'drawing-bg-active');
  D.bgDrawBtn.textContent = S.bgPolygon ? 'Redraw BG Region' : 'Draw BG Region';
  drawROIs('measure');
}

function clearBGPolygon() {
  S.bgPolygon = null;
  cancelBGDraw();
  D.bgClearBtn.style.display = 'none';
  D.bgDrawBtn.textContent = 'Draw BG Region';
  invalidateAnalysis('', { preserveRaw: true });
  drawROIs('measure');
}

// ── Analysis ──────────────────────────────────────────────────────────────────
function validateAssayWindow({ label, startFrame, endFrame, baselineFrames, slopeFrames, nFrames }) {
  if (endFrame === 0) {
    return '';
  }
  if (startFrame < 0 || startFrame >= nFrames) {
    return `${label} frame must be between 0 and ${nFrames - 1}.`;
  }
  if (endFrame > 0 && endFrame <= startFrame) {
    return `${label} end frame must be greater than ${label} frame.`;
  }
  if (endFrame > nFrames) {
    return `${label} end frame must be at most ${nFrames}.`;
  }
  if (baselineFrames < 1) {
    return `${label} baseline frames must be at least 1.`;
  }
  if (slopeFrames < 2) {
    return `${label} slope frames must be at least 2.`;
  }
  const availableFrames = (endFrame > 0 ? endFrame : nFrames) - startFrame;
  if (availableFrames < 2) {
    return `${label} window must contain at least 2 frames.`;
  }
  if (slopeFrames > availableFrames) {
    return `${label} slope frames cannot exceed the number of frames in the ${label} window.`;
  }
  return '';
}

function updateAssayValidationHints() {
  const file = measureFile();
  if (!file.metadata) {
    D.tgAssayHint.textContent = '';
    D.addbackAssayHint.textContent = '';
    D.tgAssayHint.classList.remove('error');
    D.addbackAssayHint.classList.remove('error');
    return { tgError: '', addbackError: '' };
  }

  const tgError = validateAssayWindow({
    label: 'TG',
    startFrame: +D.tgFrame.value,
    endFrame: +D.tgEndFrame.value,
    baselineFrames: +D.tgBaselineFrames.value,
    slopeFrames: +D.tgSlopeFrames.value,
    nFrames: file.metadata.n_frames,
  });
  const addbackError = validateAssayWindow({
    label: 'Ca add-back',
    startFrame: +D.addbackFrame.value,
    endFrame: +D.addbackEndFrame.value,
    baselineFrames: +D.addbackBaselineFrames.value,
    slopeFrames: +D.addbackSlopeFrames.value,
    nFrames: file.metadata.n_frames,
  });

  D.tgAssayHint.textContent = tgError || (+D.tgEndFrame.value === 0
    ? 'TG metrics are disabled while TG end frame is 0.'
    : 'TG metrics use the frames from TG frame to TG end frame.');
  D.addbackAssayHint.textContent = addbackError || (+D.addbackEndFrame.value === 0
    ? 'Ca add-back metrics are disabled while add-back end frame is 0.'
    : 'Ca add-back metrics use the frames from add-back frame to add-back end frame.');
  D.tgAssayHint.classList.toggle('error', !!tgError);
  D.addbackAssayHint.classList.toggle('error', !!addbackError);
  return { tgError, addbackError };
}

async function runAnalysis() {
  const file = measureFile();
  const roiIds = selectedAnalysisRoiIds();
  if (!file.fileId || roiIds.length === 0) return;
  if (S.bgMode === 'manual' && (!Array.isArray(S.bgPolygon) || S.bgPolygon.length < 3)) {
    setStatus('Manual background mode requires a drawn polygon.');
    return;
  }

  const { tgError: tgValidation, addbackError: addbackValidation } = updateAssayValidationHints();
  if (tgValidation) {
    setStatus(tgValidation);
    return;
  }
  if (addbackValidation) {
    setStatus(addbackValidation);
    return;
  }

  D.analyzeBtn.disabled = true;
  D.analyzeBtn.textContent = 'Analyzing…';
  setStatus('Extracting traces…');

  const body = {
    channel:        file.channel,
    baseline_start: +D.baselineStart.value,
    baseline_end:   +D.baselineEnd.value,
    auc_start:      +D.aucStart.value,
    auc_end:        +D.aucEnd.value,
    roi_ids:        roiIds,
    bg_mode:        S.bgMode,
    bg_percentile:  S.bgPercentile,
    bg_polygon:     (S.bgMode === 'manual' && S.bgPolygon) ? S.bgPolygon : null,
    photobleach_mode: S.photobleachMode,
    analysis_mode:  S.analysisMode,
    ratio_ch_num:   S.ratioCh340,
    ratio_ch_den:   S.ratioCh380,
    tg_frame:       +D.tgFrame.value,
    tg_end_frame:   +D.tgEndFrame.value,
    tg_baseline_frames: +D.tgBaselineFrames.value,
    tg_slope_frames: +D.tgSlopeFrames.value,
    addback_frame:  +D.addbackFrame.value,
    addback_end_frame: +D.addbackEndFrame.value,
    addback_baseline_frames: +D.addbackBaselineFrames.value,
    addback_slope_frames: +D.addbackSlopeFrames.value,
  };

  try {
    const res = await apiFetch(`/api/analyze/${file.fileId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    S.timeAxis = res.time_axis;
    S.traces   = res.traces;
    S.deltaF   = res.delta_f;
    S.bgTrace  = Array.isArray(res.bg_trace) && res.bg_trace.length ? res.bg_trace : null;
    S.peaks    = res.peaks || null;
    S.aucs     = res.aucs || null;
    S.durations = res.durations || null;
    S.frequencies = res.frequencies || null;
    S.latencies = res.latencies || null;
    S.decays = res.decays || null;
    S.riseRates = res.rise_rates || null;
    S.eventTimes = res.event_times || null;
    S.tgPeaks = res.tg_peaks || null;
    S.tgSlopes = res.tg_slopes || null;
    S.tgAucs = res.tg_aucs || null;
    S.addbackPeaks = res.addback_peaks || null;
    S.addbackSlopes = res.addback_slopes || null;
    S.addbackAucs = res.addback_aucs || null;
    S.addbackLatencies = res.addback_latencies || null;
    // S.analysisMode is not overwritten here — it reflects the user's dropdown
    // selection and was already sent to the backend. Overwriting it from the
    // response was causing the dropdown and state to drift out of sync.

    // Update plot tab labels to reflect the active analysis mode
    if (S.analysisMode === 'ratio') {
      const meta = measureFile().metadata;
      const numName = meta.channel_names[S.ratioCh340] || `Ch${S.ratioCh340 + 1}`;
      const denName = meta.channel_names[S.ratioCh380] || `Ch${S.ratioCh380 + 1}`;
      D.tabRaw.textContent   = `Ratio (${numName} / ${denName})`;
      D.tabDelta.textContent = 'ΔR / R₀';
    } else {
      D.tabRaw.textContent   = 'Raw Fluorescence (F)';
      D.tabDelta.textContent = 'ΔF / F₀';
    }

    syncAnalysisUI();
    setStatus('');
    // Let the browser recalculate layout, then resize canvas + plots
    requestAnimationFrame(() => {
      onResize();
      renderPlots();
      renderSummary();
      renderDurations();
      renderFrequencies();
      renderLatencies();
      renderDecays();
      renderRiseRates();
      renderTgMetrics();
      renderAddbackMetrics();
      // Only resize the visible plot pane (the other is display:none)
      if (D.plotRaw.offsetParent)   Plotly.Plots.resize(D.plotRaw);
      if (D.plotDelta.offsetParent) Plotly.Plots.resize(D.plotDelta);
      if (D.plotRise.offsetParent)  Plotly.Plots.resize(D.plotRise);
    });
  } catch (err) {
    setStatus(`Analysis error: ${err.message}`);
  } finally {
    D.analyzeBtn.disabled = false;
    D.analyzeBtn.textContent = 'Extract Traces';
  }
}

// ── Plots ─────────────────────────────────────────────────────────────────────
const PLOTLY_LAYOUT = {
  paper_bgcolor: '#1f2937',
  plot_bgcolor:  '#111827',
  font:  { color: '#f3f4f6', size: 10 },
  height: 218,
  margin: { t: 6, b: 38, l: 58, r: 8 },
  xaxis:  { title: 'Time (s)', gridcolor: '#374151', color: '#9ca3af' },
  yaxis:  { gridcolor: '#374151', color: '#9ca3af' },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 9 }, orientation: 'v', x: 1.01, y: 1 },
  hovermode: 'x unified',
};

const PLOTLY_CONFIG = { responsive: true, displayModeBar: false };

function renderPlots() {
  if (!S.traces || !S.timeAxis) return;
  const { traces, deltaF, timeAxis, selected } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));

  // Build per-ROI traces (same structure for both plots)
  function roiTraces(data) {
    return Object.entries(data)
      .filter(([id]) => selected.has(+id))
      .map(([id, vals]) => ({
        x: timeAxis,
        y: vals,
        name: `ROI ${id}`,
        mode: 'lines',
        line: { color: colorMap[+id] || '#ccc', width: 1.2 },
        hovertemplate: `<b>ROI ${id}</b>  %{y:.1f}<extra></extra>`,
      }));
  }

  const rawTraces   = roiTraces(traces);
  const deltaTraces = deltaF ? roiTraces(deltaF) : [];

  const isRatio = S.analysisMode === 'ratio';
  Plotly.react(
    D.plotRaw,
    rawTraces,
    { ...PLOTLY_LAYOUT, yaxis: { ...PLOTLY_LAYOUT.yaxis, title: isRatio ? 'F₃₄₀/F₃₈₀ (ratio)' : 'F (a.u.)' } },
    PLOTLY_CONFIG,
  );

  Plotly.react(
    D.plotDelta,
    deltaTraces,
    { ...PLOTLY_LAYOUT, yaxis: { ...PLOTLY_LAYOUT.yaxis, title: isRatio ? 'ΔR/R₀' : 'ΔF/F₀' } },
    PLOTLY_CONFIG,
  );

  setupHandleListeners();

  // Click on trace -> toggle ROI selection
  [D.plotRaw, D.plotDelta].forEach(el => {
    el.removeAllListeners?.('plotly_click');
    el.on('plotly_click', data => {
      const name = data.points[0].data.name;
      const roiId = +name.replace('ROI ', '');
      if (S.selected.has(roiId)) S.selected.delete(roiId); else S.selected.add(roiId);
      invalidateAnalysis('ROI selection changed. Run analysis again.', { preserveRaw: true });
      renderROIList(); drawROIs(); syncButtons();
    });
  });

  updatePlotTimeCursor();
}

function currentGraphTime() {
  const file = measureFile().metadata ? measureFile() : currentFile();
  if (!file.metadata || !Array.isArray(file.metadata.time_axis) || file.metadata.time_axis.length === 0) {
    return null;
  }
  const frame = Math.max(0, Math.min(file.frame, file.metadata.time_axis.length - 1));
  return file.metadata.time_axis[frame];
}

function analysisMarkerTime(frameValue) {
  const file = measureFile().metadata ? measureFile() : currentFile();
  if (!file.metadata || !Array.isArray(file.metadata.time_axis) || file.metadata.time_axis.length === 0) {
    return null;
  }
  const frame = Math.max(0, Math.min(+frameValue || 0, file.metadata.time_axis.length - 1));
  return file.metadata.time_axis[frame];
}

function frameRangeBounds(startFrameValue, endFrameValue) {
  const file = measureFile().metadata ? measureFile() : currentFile();
  if (!file.metadata || !Array.isArray(file.metadata.time_axis) || file.metadata.time_axis.length === 0) {
    return null;
  }
  const n = file.metadata.time_axis.length;
  const startFrame = Math.max(0, Math.min(+startFrameValue || 0, n - 1));
  const rawEnd = +endFrameValue || 0;
  if (rawEnd <= 0) return null;
  const endExclusive = Math.max(startFrame + 1, Math.min(n, rawEnd));
  const startTime = file.metadata.time_axis[startFrame];
  const endTime = file.metadata.time_axis[endExclusive - 1];
  return { startTime, endTime };
}

function markerLine(name, x, color, dash) {
  return {
    type: 'line', xref: 'x', yref: 'paper',
    name, x0: x, x1: x, y0: 0, y1: 1,
    line: { color, width: 1.8, dash },
  };
}

function windowShapes(startTime, endTime, fillColor, lineColor, startName, endName) {
  return [
    {
      type: 'rect', xref: 'x', yref: 'paper',
      x0: startTime, x1: endTime, y0: 0, y1: 1,
      fillcolor: fillColor, line: { width: 0 }, layer: 'below',
    },
    markerLine(startName, startTime, lineColor, 'dash'),
    markerLine(endName,   endTime,   lineColor, 'dot'),
  ];
}

function updatePlotTimeCursor() {
  const t = currentGraphTime();
  const plots = [D.plotRaw, D.plotDelta];
  const shapes = [];

  if (t !== null) {
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: { color: '#fbbf24', width: 1.5, dash: 'dot' },
    });
  }

  const baselineWindow = frameRangeBounds(D.baselineStart?.value, D.baselineEnd?.value);
  if (baselineWindow) {
    shapes.push(...windowShapes(
      baselineWindow.startTime, baselineWindow.endTime,
      'rgba(16,185,129,0.10)', '#10b981',
      'baseline-start', 'baseline-end',
    ));
  }

  const aucWindow = frameRangeBounds(D.aucStart?.value, D.aucEnd?.value);
  if (aucWindow) {
    shapes.push(...windowShapes(
      aucWindow.startTime, aucWindow.endTime,
      'rgba(59,130,246,0.08)', '#60a5fa',
      'auc-start', 'auc-end',
    ));
  }

  const tgWindow = frameRangeBounds(D.tgFrame?.value, D.tgEndFrame?.value);
  if (tgWindow) {
    shapes.push(...windowShapes(
      tgWindow.startTime, tgWindow.endTime,
      'rgba(249,115,22,0.10)', '#f97316',
      'tg-start', 'tg-end',
    ));
  }

  const addbackWindow = frameRangeBounds(D.addbackFrame?.value, D.addbackEndFrame?.value);
  if (addbackWindow) {
    shapes.push(...windowShapes(
      addbackWindow.startTime, addbackWindow.endTime,
      'rgba(139,92,246,0.10)', '#8b5cf6',
      'addback-start', 'addback-end',
    ));
  }

  plots.forEach(plot => {
    if (!plot || !plot.data) return;
    Plotly.relayout(plot, { shapes }).catch?.(() => {});
  });
  updateMarkerHandles();
}

// ── Marker drag handles ───────────────────────────────────────────────────────

const MARKER_DEFS = {
  'baseline-start': { getInput: () => D.baselineStart,   color: '#10b981', exclusive: false, label: 'Baseline start'     },
  'baseline-end':   { getInput: () => D.baselineEnd,     color: '#10b981', exclusive: true,  label: 'Baseline end'       },
  'auc-start':      { getInput: () => D.aucStart,        color: '#60a5fa', exclusive: false, label: 'AUC start'          },
  'auc-end':        { getInput: () => D.aucEnd,          color: '#60a5fa', exclusive: true,  label: 'AUC end'            },
  'tg-start':       { getInput: () => D.tgFrame,         color: '#f97316', exclusive: false, label: 'TG start'           },
  'tg-end':         { getInput: () => D.tgEndFrame,      color: '#f97316', exclusive: true,  label: 'TG end'             },
  'addback-start':  { getInput: () => D.addbackFrame,    color: '#8b5cf6', exclusive: false, label: 'Ca add-back start'  },
  'addback-end':    { getInput: () => D.addbackEndFrame, color: '#8b5cf6', exclusive: true,  label: 'Ca add-back end'    },
};

function timeToFrame(t) {
  const file = measureFile().metadata ? measureFile() : currentFile();
  if (!file.metadata || !Array.isArray(file.metadata.time_axis)) return 0;
  const axis = file.metadata.time_axis;
  let best = 0, bestDist = Math.abs(axis[0] - t);
  for (let i = 1; i < axis.length; i++) {
    const d = Math.abs(axis[i] - t);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function timeToPixelX(plot, t) {
  const fl = plot._fullLayout;
  if (!fl) return null;
  const xa = fl.xaxis;
  const [x0, x1] = xa.range;
  return xa._offset + ((t - x0) / (x1 - x0)) * xa._length;
}

function clientXToTime(plot, clientX) {
  const fl = plot._fullLayout;
  if (!fl) return null;
  const xa = fl.xaxis;
  const [x0, x1] = xa.range;
  const rect = plot.getBoundingClientRect();
  return x0 + ((clientX - rect.left - xa._offset) / xa._length) * (x1 - x0);
}

function getOrCreateHandleLayer(plot) {
  let layer = plot.querySelector(':scope > .marker-handle-layer');
  if (!layer) {
    plot.style.position = 'relative';
    layer = document.createElement('div');
    layer.className = 'marker-handle-layer';
    plot.appendChild(layer);
  }
  return layer;
}

function updateMarkerHandles() {
  const plots = [D.plotRaw, D.plotDelta];

  const windows = {
    baseline: frameRangeBounds(D.baselineStart?.value, D.baselineEnd?.value),
    auc:      frameRangeBounds(D.aucStart?.value,      D.aucEnd?.value),
    tg:       frameRangeBounds(D.tgFrame?.value,       D.tgEndFrame?.value),
    addback:  frameRangeBounds(D.addbackFrame?.value,  D.addbackEndFrame?.value),
  };

  const markerTimes = {};
  if (windows.baseline) { markerTimes['baseline-start'] = windows.baseline.startTime; markerTimes['baseline-end'] = windows.baseline.endTime; }
  if (windows.auc)      { markerTimes['auc-start']      = windows.auc.startTime;      markerTimes['auc-end']      = windows.auc.endTime; }
  if (windows.tg)       { markerTimes['tg-start']       = windows.tg.startTime;       markerTimes['tg-end']       = windows.tg.endTime; }
  if (windows.addback)  { markerTimes['addback-start']  = windows.addback.startTime;  markerTimes['addback-end']  = windows.addback.endTime; }

  plots.forEach(plot => {
    if (!plot._fullLayout) return;
    const fl    = plot._fullLayout;
    const layer = getOrCreateHandleLayer(plot);
    const innerL = fl.xaxis._offset;
    const innerR = fl.xaxis._offset + fl.xaxis._length;

    Object.entries(MARKER_DEFS).forEach(([name, def]) => {
      let el = layer.querySelector(`[data-marker="${name}"]`);
      const t = markerTimes[name];

      if (t === undefined) {
        if (el) el.style.display = 'none';
        return;
      }

      const px = timeToPixelX(plot, t);
      if (px === null || px < innerL - 8 || px > innerR + 8) {
        if (el) el.style.display = 'none';
        return;
      }

      if (!el) {
        el = document.createElement('div');
        el.className = 'marker-handle';
        el.dataset.marker = name;
        el.style.color = def.color;
        layer.appendChild(el);
        el.addEventListener('mousedown', onHandleMouseDown);
      }

      el.dataset.label = def.label;
      el.style.display = '';
      el.style.left = px + 'px';
    });
  });
}

let _activeDrag = null;

function onHandleMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const layer = e.currentTarget.closest('.marker-handle-layer');
  _activeDrag = {
    name: e.currentTarget.dataset.marker,
    plot: layer?.parentElement,
    el:   e.currentTarget,
  };
  e.currentTarget.classList.add('dragging');
}

function setupDragMouseHandlers() {
  document.addEventListener('mousemove', e => {
    if (!_activeDrag) return;
    const t = clientXToTime(_activeDrag.plot, e.clientX);
    if (t === null) return;
    const def = MARKER_DEFS[_activeDrag.name];
    if (!def) return;
    const frame = timeToFrame(t);
    def.getInput().value = def.exclusive ? frame + 1 : frame;
    _activeDrag.el.dataset.label = `${def.label} · f${frame} · ${t.toFixed(1)}s`;
    updatePlotTimeCursor();
  });

  document.addEventListener('mouseup', e => {
    if (!_activeDrag) return;
    const t = clientXToTime(_activeDrag.plot, e.clientX);
    const def = MARKER_DEFS[_activeDrag.name];
    if (t !== null && def) {
      const frame = timeToFrame(t);
      def.getInput().value = def.exclusive ? frame + 1 : frame;
      def.getInput().dispatchEvent(new Event('change'));
    }
    _activeDrag.el.dataset.label = MARKER_DEFS[_activeDrag.name].label;
    _activeDrag.el.classList.remove('dragging');
    _activeDrag = null;
  });
}

let _handleListenersReady = false;
function setupHandleListeners() {
  if (_handleListenersReady) return;
  if (!D.plotRaw._fullLayout || !D.plotDelta._fullLayout) return;
  _handleListenersReady = true;
  [D.plotRaw, D.plotDelta].forEach(plot => {
    plot.on('plotly_relayout', updateMarkerHandles);
  });
}

function selectedMetricContext(metricMap) {
  const rois = analysisRois();
  const ids = rois.map(r => r.id).filter(id => S.selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  const colors = ids.map(id => colorMap[id] || '#ccc');
  const values = ids.map(id => metricMap?.[id] ?? null);
  return { ids, labels, colors, values };
}

function boxMetricTrace(values, labels, colors, hoverLabel, lineColor, fillColor) {
  return [{
    type: 'box',
    x: Array(values.length).fill(''),
    y: values,
    text: labels,
    boxpoints: 'all',
    jitter: 0.45,
    pointpos: 0,
    fillcolor: fillColor,
    line: { color: lineColor, width: 1.3 },
    marker: {
      color: colors,
      size: 6,
      opacity: 0.95,
      line: { color: '#1f2937', width: 0.8 },
    },
    hovertemplate: `<b>%{text}</b><br>${hoverLabel}: %{y:.4f}<extra></extra>`,
  }];
}

function metricBoxLayout(title, yTitle) {
  return {
    paper_bgcolor: '#1f2937',
    plot_bgcolor: '#111827',
    font: { color: '#f3f4f6', size: 10 },
    height: 218,
    margin: { t: 28, b: 24, l: 58, r: 8 },
    xaxis: { visible: false },
    yaxis: { gridcolor: '#374151', color: '#9ca3af', title: yTitle },
    showlegend: false,
    title: { text: title, font: { size: 11, color: '#f3f4f6' } },
  };
}

// ── Summary (peak + AUC box plots) ───────────────────────────────────────────
function renderSummary() {
  if (!S.peaks || !S.aucs) return;

  const { selected, peaks, aucs, analysisMode } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));

  // Only show selected ROIs
  const ids = rois.map(r => r.id).filter(id => selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colors = ids.map(id => colorMap[id] || '#ccc');
  const peakVals = ids.map(id => peaks[id] ?? null);

  const isRatio  = analysisMode === 'ratio';
  const deltaLbl = isRatio ? 'ΔR/R₀' : 'ΔF/F₀';

  const baseLayout = {
    paper_bgcolor: '#1f2937',
    plot_bgcolor:  '#111827',
    font:   { color: '#f3f4f6', size: 10 },
    height: 218,
    margin: { t: 28, b: 24, l: 58, r: 8 },
    xaxis:  { visible: false },
    yaxis:  { gridcolor: '#374151', color: '#9ca3af' },
    showlegend: false,
  };

  function boxPointTrace(yVals, yLabel, lineColor, fillColor) {
    return {
      type: 'box',
      name: '',
      x: Array(yVals.length).fill(''),
      y: yVals,
      text: labels,
      boxpoints: 'all',
      jitter: 0.45,
      pointpos: 0,
      fillcolor: fillColor,
      line: { color: lineColor, width: 1.3 },
      marker: {
        color: colors,
        size: 6,
        opacity: 0.95,
        line: { color: '#1f2937', width: 0.8 },
      },
      whiskerwidth: 0.8,
      width: 0.45,
      hovertemplate: `<b>%{text}</b><br>${yLabel}: %{y:.4f}<extra></extra>`,
    };
  }

  Plotly.react(
    D.plotPeak,
    [boxPointTrace(peakVals, `Peak ${deltaLbl}`, '#60a5fa', 'rgba(96,165,250,0.30)')],
    { ...baseLayout,
      title: { text: `Peak ${deltaLbl}`, font: { size: 11, color: '#f3f4f6' } },
      yaxis: { ...baseLayout.yaxis, title: `Peak ${deltaLbl}` },
    },
    PLOTLY_CONFIG,
  );

  const aucEnd   = S.aucEnd > 0 ? Math.min(S.aucEnd, S.timeAxis.length) : 0;
  const aucRange = S.aucEnd > 0 ? `frames ${S.aucStart}–${aucEnd}` : 'disabled';
  Plotly.react(
    D.plotAuc,
    [boxPointTrace(ids.map(id => aucs[id] ?? null), `AUC ${deltaLbl}`, '#60a5fa', 'rgba(96,165,250,0.30)')],
    { ...baseLayout,
      title: { text: `AUC Above Baseline + 2 SD (${aucRange})`, font: { size: 11, color: '#f3f4f6' } },
      yaxis: { ...baseLayout.yaxis, title: `AUC above threshold (${deltaLbl} · s)` },
    },
    PLOTLY_CONFIG,
  );
}

function renderDurations() {
  if (!S.durations) return;
  const { selected, durations } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  const ids = rois.map(r => r.id).filter(id => selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colors = ids.map(id => colorMap[id] || '#ccc');

  Plotly.react(
      D.plotDuration,
      [{
      type: 'box',
      x: Array(ids.length).fill(''),
      y: ids.map(id => durations[id] ?? null),
      text: labels,
      boxpoints: 'all',
      jitter: 0.45,
      pointpos: 0,
      fillcolor: 'rgba(251,191,36,0.28)',
      line: { color: '#fbbf24', width: 1.3 },
      marker: {
        color: colors,
        size: 6,
        opacity: 0.95,
        line: { color: '#1f2937', width: 0.8 },
      },
      hovertemplate: `<b>%{text}</b><br>Event FWHM (s): %{y:.4f}<extra></extra>`,
    }],
    {
      paper_bgcolor: '#1f2937',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', size: 10 },
      height: 218,
      margin: { t: 28, b: 24, l: 58, r: 8 },
      xaxis: { visible: false },
      yaxis: { gridcolor: '#374151', color: '#9ca3af', title: 'FWHM (s)' },
      showlegend: false,
      title: { text: 'Mean Event FWHM', font: { size: 11, color: '#f3f4f6' } },
    },
    PLOTLY_CONFIG,
  );
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

function renderFrequencies() {
  if (!S.eventTimes) return;
  const { selected, eventTimes, peaks } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  let ids = rois.map(r => r.id).filter(id => selected.has(id));

  // Sort order
  const sortBy = D.rasterSort ? D.rasterSort.value : 'id';
  if (sortBy === 'count') {
    ids = [...ids].sort((a, b) => (eventTimes[b]?.length ?? 0) - (eventTimes[a]?.length ?? 0));
  } else if (sortBy === 'first') {
    ids = [...ids].sort((a, b) => {
      const fa = eventTimes[a]?.[0] ?? Infinity;
      const fb = eventTimes[b]?.[0] ?? Infinity;
      return fa - fb;
    });
  } else if (sortBy === 'peak') {
    ids = [...ids].sort((a, b) => (peaks?.[b] ?? 0) - (peaks?.[a] ?? 0));
  }

  // Normalize peak values to [0.3, 1.0] for tick opacity
  const peakVals = ids.map(id => peaks?.[id] ?? 0);
  const maxPeak = Math.max(...peakVals, 1e-9);
  const minPeak = Math.min(...peakVals, 0);
  const peakRange = maxPeak - minPeak || 1;

  // Raster traces
  const rasterTraces = ids.flatMap((id, row) => {
    const times = Array.isArray(eventTimes[id]) ? eventTimes[id] : [];
    const normalizedPeak = ((peaks?.[id] ?? 0) - minPeak) / peakRange;
    const opacity = 0.3 + 0.7 * normalizedPeak;
    const baseColor = colorMap[id] || '#c084fc';
    const tickColor = hexToRgba(baseColor, opacity);
    return times.map((time, idx) => ({
      x: [time, time],
      y: [row - 0.38, row + 0.38],
      type: 'scatter',
      mode: 'lines',
      line: { color: tickColor, width: 2 },
      hovertemplate: `<b>ROI ${id}</b><br>Event ${idx + 1}<br>Peak time: %{x:.3f} s<br>ROI peak ΔF/F₀: ${(peaks?.[id] ?? 0).toFixed(3)}<extra></extra>`,
      showlegend: false,
      xaxis: 'x',
      yaxis: 'y2',
    }));
  });

  // Population histogram — all event times binned
  const allTimes = ids.flatMap(id => Array.isArray(eventTimes[id]) ? eventTimes[id] : []);
  const tAxis = S.timeAxis;
  const xMin = tAxis && tAxis.length ? tAxis[0] : (allTimes.length ? Math.min(...allTimes) : 0);
  const xMax = tAxis && tAxis.length ? tAxis[tAxis.length - 1] : (allTimes.length ? Math.max(...allTimes) : 1);
  const binSize = Math.max((xMax - xMin) / 30, 0.001);

  const histTrace = {
    x: allTimes,
    type: 'histogram',
    xbins: { start: xMin, end: xMax + binSize, size: binSize },
    marker: { color: '#818cf8', opacity: 0.75 },
    hovertemplate: '%{x:.2f} s — %{y} event(s)<extra></extra>',
    showlegend: false,
    xaxis: 'x',
    yaxis: 'y',
  };

  // n= annotations on the right of each raster row
  const annotations = ids.map((id, row) => ({
    x: 1.01,
    y: row,
    xref: 'paper',
    yref: 'y2',
    text: `n=${eventTimes[id]?.length ?? 0}`,
    showarrow: false,
    font: { color: '#9ca3af', size: 9 },
    xanchor: 'left',
  }));

  const tickVals = ids.map((_, row) => row);
  const tickText = ids.map(id => `ROI ${id}`);

  // Layout heights: histogram on top, raster below
  const rasterInner = Math.max(130, ids.length * 22 + 30);
  const histInner = 65;
  const gapInner = 10;
  const innerHeight = rasterInner + histInner + gapInner;
  const totalHeight = innerHeight + 28 + 42; // + margin.t + margin.b

  const rasterTopFrac  = rasterInner / innerHeight;
  const histBottomFrac = (rasterInner + gapInner) / innerHeight;

  Plotly.react(
    D.plotFrequencyChart,
    [histTrace, ...rasterTraces],
    {
      paper_bgcolor: '#1f2937',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', size: 10 },
      height: totalHeight,
      margin: { t: 28, b: 42, l: 74, r: 48 },
      xaxis: {
        gridcolor: '#374151',
        color: '#9ca3af',
        title: 'Time (s)',
      },
      yaxis: {
        domain: [histBottomFrac, 1.0],
        gridcolor: '#374151',
        color: '#9ca3af',
        title: { text: 'Count', font: { size: 9 } },
        nticks: 4,
      },
      yaxis2: {
        domain: [0, rasterTopFrac],
        gridcolor: '#1f2937',
        color: '#9ca3af',
        title: 'ROI',
        tickmode: 'array',
        tickvals: tickVals,
        ticktext: tickText,
        autorange: 'reversed',
        range: ids.length ? [-0.7, ids.length - 0.3] : [-0.5, 0.5],
      },
      showlegend: false,
      title: { text: 'Event Raster', font: { size: 11, color: '#f3f4f6' } },
      annotations,
    },
    PLOTLY_CONFIG,
  );
}

function renderLatencies() {
  if (!S.latencies) return;
  const { selected, latencies } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  const ids = rois.map(r => r.id).filter(id => selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colors = ids.map(id => colorMap[id] || '#ccc');

  Plotly.react(
      D.plotLatency,
      [{
      type: 'box',
      x: Array(ids.length).fill(''),
      y: ids.map(id => latencies[id] ?? null),
      text: labels,
      boxpoints: 'all',
      jitter: 0.45,
      pointpos: 0,
      fillcolor: 'rgba(16,185,129,0.28)',
      line: { color: '#34d399', width: 1.3 },
      marker: {
        color: colors,
        size: 6,
        opacity: 0.95,
        line: { color: '#1f2937', width: 0.8 },
      },
      hovertemplate: `<b>%{text}</b><br>Time to peak (s): %{y:.4f}<extra></extra>`,
    }],
    {
      paper_bgcolor: '#1f2937',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', size: 10 },
      height: 218,
      margin: { t: 28, b: 24, l: 58, r: 8 },
      xaxis: { visible: false },
      yaxis: { gridcolor: '#374151', color: '#9ca3af', title: 'Time to peak (s)' },
      showlegend: false,
      title: { text: 'Mean Time To Peak', font: { size: 11, color: '#f3f4f6' } },
    },
    PLOTLY_CONFIG,
  );
}

function renderDecays() {
  if (!S.decays) return;
  const { selected, decays } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  const ids = rois.map(r => r.id).filter(id => selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colors = ids.map(id => colorMap[id] || '#ccc');

  Plotly.react(
      D.plotDecay,
      [{
      type: 'box',
      x: Array(ids.length).fill(''),
      y: ids.map(id => decays[id] ?? null),
      text: labels,
      boxpoints: 'all',
      jitter: 0.45,
      pointpos: 0,
      fillcolor: 'rgba(244,114,182,0.28)',
      line: { color: '#f472b6', width: 1.3 },
      marker: {
        color: colors,
        size: 6,
        opacity: 0.95,
        line: { color: '#1f2937', width: 0.8 },
      },
      hovertemplate: `<b>%{text}</b><br>Decay t1/2 (s): %{y:.4f}<extra></extra>`,
    }],
    {
      paper_bgcolor: '#1f2937',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', size: 10 },
      height: 218,
      margin: { t: 28, b: 24, l: 58, r: 8 },
      xaxis: { visible: false },
      yaxis: { gridcolor: '#374151', color: '#9ca3af', title: 'Decay t1/2 (s)' },
      showlegend: false,
      title: { text: 'Mean Decay Half-Time', font: { size: 11, color: '#f3f4f6' } },
    },
    PLOTLY_CONFIG,
  );
}

function renderRiseRates() {
  if (!S.riseRates) return;

  const { selected, riseRates, analysisMode } = S;
  const rois = analysisRois();
  const colorMap = Object.fromEntries(rois.map(r => [r.id, r.color]));
  const ids = rois.map(r => r.id).filter(id => selected.has(id));
  const labels = ids.map(id => `ROI ${id}`);
  const colors = ids.map(id => colorMap[id] || '#ccc');
  const riseVals = ids.map(id => riseRates[id] ?? null);
  const isRatio = analysisMode === 'ratio';
  const riseLabel = isRatio ? 'Max d(ΔR/R₀)/dt' : 'Max d(ΔF/F₀)/dt';

  Plotly.react(
      D.plotRise,
      [{
      type: 'box',
      x: Array(riseVals.length).fill(''),
      y: riseVals,
      text: labels,
      boxpoints: 'all',
      jitter: 0.45,
      pointpos: 0,
      fillcolor: 'rgba(34,211,238,0.28)',
      line: { color: '#22d3ee', width: 1.3 },
      marker: {
        color: colors,
        size: 6,
        opacity: 0.95,
        line: { color: '#1f2937', width: 0.8 },
      },
      hovertemplate: `<b>%{text}</b><br>${riseLabel}: %{y:.4f}<extra></extra>`,
    }],
    {
      paper_bgcolor: '#1f2937',
      plot_bgcolor: '#111827',
      font: { color: '#f3f4f6', size: 10 },
      height: 218,
      margin: { t: 28, b: 24, l: 58, r: 8 },
      xaxis: { visible: false },
      yaxis: { gridcolor: '#374151', color: '#9ca3af', title: `${riseLabel} (/s)` },
      showlegend: false,
      title: { text: `${riseLabel} (/s)`, font: { size: 11, color: '#f3f4f6' } },
    },
    PLOTLY_CONFIG,
  );
}

function renderTgMetrics() {
  if (!S.tgPeaks || !S.tgSlopes || !S.tgAucs) return;
  const peakCtx = selectedMetricContext(S.tgPeaks);
  const slopeCtx = selectedMetricContext(S.tgSlopes);
  const aucCtx = selectedMetricContext(S.tgAucs);

  Plotly.react(
    D.plotTgPeak,
    boxMetricTrace(peakCtx.values, peakCtx.labels, peakCtx.colors, 'TG peak (Δ)', '#f97316', 'rgba(249,115,22,0.28)'),
    metricBoxLayout('TG Peak', 'Peak above pre-TG baseline'),
    PLOTLY_CONFIG,
  );
  Plotly.react(
    D.plotTgSlope,
    boxMetricTrace(slopeCtx.values, slopeCtx.labels, slopeCtx.colors, 'TG initial slope', '#eab308', 'rgba(234,179,8,0.28)'),
    metricBoxLayout('TG Initial Slope', 'Initial slope (Δ/s)'),
    PLOTLY_CONFIG,
  );
  Plotly.react(
    D.plotTgAuc,
    boxMetricTrace(aucCtx.values, aucCtx.labels, aucCtx.colors, 'TG AUC', '#fb7185', 'rgba(251,113,133,0.28)'),
    metricBoxLayout('TG AUC', 'AUC above pre-TG baseline'),
    PLOTLY_CONFIG,
  );
}

function renderAddbackMetrics() {
  if (!S.addbackPeaks || !S.addbackSlopes || !S.addbackAucs || !S.addbackLatencies) return;
  const peakCtx = selectedMetricContext(S.addbackPeaks);
  const slopeCtx = selectedMetricContext(S.addbackSlopes);
  const aucCtx = selectedMetricContext(S.addbackAucs);
  const latencyCtx = selectedMetricContext(S.addbackLatencies);

  Plotly.react(
    D.plotAddbackPeak,
    boxMetricTrace(peakCtx.values, peakCtx.labels, peakCtx.colors, 'Add-back peak (Δ)', '#8b5cf6', 'rgba(139,92,246,0.28)'),
    metricBoxLayout('Add-Back Peak', 'Peak above pre-add-back baseline'),
    PLOTLY_CONFIG,
  );
  Plotly.react(
    D.plotAddbackSlope,
    boxMetricTrace(slopeCtx.values, slopeCtx.labels, slopeCtx.colors, 'Add-back initial slope', '#22c55e', 'rgba(34,197,94,0.28)'),
    metricBoxLayout('Add-Back Initial Slope', 'Initial slope (Δ/s)'),
    PLOTLY_CONFIG,
  );
  Plotly.react(
    D.plotAddbackAuc,
    boxMetricTrace(aucCtx.values, aucCtx.labels, aucCtx.colors, 'Add-back AUC', '#ec4899', 'rgba(236,72,153,0.28)'),
    metricBoxLayout('Add-Back AUC', 'AUC above pre-add-back baseline'),
    PLOTLY_CONFIG,
  );
  Plotly.react(
    D.plotAddbackLatency,
    boxMetricTrace(latencyCtx.values, latencyCtx.labels, latencyCtx.colors, 'Add-back time to peak', '#06b6d4', 'rgba(6,182,212,0.28)'),
    metricBoxLayout('Add-Back Time To Peak', 'Time to peak (s)'),
    PLOTLY_CONFIG,
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
function addTokenToUrl(url) {
  const token = getToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return url + separator + 'token=' + encodeURIComponent(token);
}

function exportCSV(type) {
  if (!measureFile().fileId) return;
  const a = document.createElement('a');
  a.href     = addTokenToUrl(`${API}/api/export/${measureFile().fileId}?type=${type}`);
  a.download = `calcium_${type}.csv`;
  a.click();
}

function exportWorkbook() {
  if (!measureFile().fileId) return;
  const a = document.createElement('a');
  a.href = addTokenToUrl(`${API}/api/export-workbook/${measureFile().fileId}`);
  a.download = 'calcium_analysis.xlsx';
  a.click();
}

function exportOverlayImage() {
  const file = measureFile();
  if (!file.fileId) return;
  const display = getDisplayParams(file);
  const params = new URLSearchParams({
    view: 'frame',
    t: String(file.frame),
    cmin: String(file.cmin),
    cmax: String(file.cmax),
    colormap: S.colormap.measure,
  });
  if (display.mode === 'ratio') {
    params.set('mode', 'ratio');
    params.set('ratio_ch_num', String(display.ratioChNum));
    params.set('ratio_ch_den', String(display.ratioChDen));
  } else {
    params.set('channel', String(display.channel));
  }
  const a = document.createElement('a');
  a.href = addTokenToUrl(`${API}/api/export-overlay/${file.fileId}?${params.toString()}`);
  a.download = 'calcium_roi_overlay.png';
  a.click();
}

function exportProjectionOverlayImage() {
  const file = measureFile();
  if (!file.fileId) return;
  const display = getDisplayParams(file);
  const params = new URLSearchParams({
    view: 'projection',
    proj_type: D.projType.value,
    cmin: String(file.cmin),
    cmax: String(file.cmax),
    colormap: S.colormap.measure,
  });
  if (display.mode === 'ratio') {
    params.set('mode', 'ratio');
    params.set('ratio_ch_num', String(display.ratioChNum));
    params.set('ratio_ch_den', String(display.ratioChDen));
  } else {
    params.set('channel', String(display.channel));
  }
  const a = document.createElement('a');
  a.href = addTokenToUrl(`${API}/api/export-overlay/${file.fileId}?${params.toString()}`);
  a.download = 'calcium_projection_roi_overlay.png';
  a.click();
}

function clearAnalysisState({ preserveRaw = false } = {}) {
  if (!preserveRaw) {
    S.traces = null;
    S.timeAxis = null;
  }
  S.deltaF = null;
  S.bgTrace = null;
  S.peaks = null;
  S.aucs = null;
  S.durations = null;
  S.frequencies = null;
  S.latencies = null;
  S.decays = null;
  S.riseRates = null;
  S.eventTimes = null;
  S.tgPeaks = null;
  S.tgSlopes = null;
  S.tgAucs = null;
  S.addbackPeaks = null;
  S.addbackSlopes = null;
  S.addbackAucs = null;
  S.addbackLatencies = null;
}

function syncAnalysisUI() {
  const hasRaw = !!(S.traces && S.timeAxis);
  const hasFull = !!(S.traces && S.deltaF);
  updateAssayValidationHints();
  D.plotsSection.style.display = hasRaw ? 'flex' : 'none';
  D.exportRow.style.display = hasFull ? 'flex' : 'none';
  [D.tabDelta, D.tabSummary, D.tabDuration, D.tabFrequency, D.tabLatency, D.tabDecay, D.tabRise, D.tabTg, D.tabAddback].forEach(btn => {
    btn.style.display = hasFull ? '' : 'none';
  });
  if (!hasFull && hasRaw) activatePlotTab('raw');
}

function cleanupFileSession(fileId, opts = {}) {
  if (!fileId) return;

  const token = getToken();
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  fetch(`${API}/api/file/${fileId}`, {
    method: 'DELETE',
    keepalive: !!opts.keepalive,
    headers,
  }).catch(() => {});
}

// ── Memory readout ────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576)    return (b / 1048576).toFixed(0)    + ' MB';
  return                      (b / 1024).toFixed(0)       + ' KB';
}

async function pollMemory() {
  try {
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const r = await fetch(`${API}/api/memory`, { headers });
    if (!r.ok) return;
    const d = await r.json();

    const textEl = document.getElementById('mem-text');
    const barFill = document.getElementById('mem-bar-fill');
    const barWrap = document.getElementById('mem-bar-wrap');

    if (textEl) {
      textEl.textContent =
        `mem: ${fmtBytes(d.process_rss_bytes)} rss · ${fmtBytes(d.session_data_bytes)} nd2 · ${d.session_count} sess`;
    }

    if (barFill && barWrap) {
      if (d.max_rss_bytes) {
        const pct = Math.min(100, (d.process_rss_bytes / d.max_rss_bytes) * 100);
        barFill.style.width = pct + '%';
        barFill.style.background =
          pct >= 90 ? '#ef4444' :
          pct >= 70 ? '#f97316' :
                      '#10b981';
        barWrap.title = `${fmtBytes(d.process_rss_bytes)} / ${fmtBytes(d.max_rss_bytes)} limit`;
        barWrap.style.display = '';
      } else {
        barWrap.style.display = 'none';
      }
    }
  } catch {}
}

function startMemoryPoller() {
  pollMemory();
  setInterval(pollMemory, 5000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  if (token) {
    if (!opts.headers) opts.headers = {};
    opts.headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function setStatus(msg) {
  D.statusBar.textContent = msg;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
