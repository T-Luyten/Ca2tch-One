'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const API = '';   // same origin (FastAPI serves the frontend)

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
    cmin: 0,
    cmax: 65535,
    rois: [],
    scale: 1,
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  activeRole:   'source',
  colormap:     'green',
  files: {
    source: createDatasetState('source'),
    measure: createDatasetState('measure'),
  },
  selected:     new Set(),
  hovered:      null,
  traces:       null,     // {"1": [f], "2": [f], ...}
  deltaF:       null,
  timeAxis:     null,
  bgTrace:      null,     // background trace (for display)
  scale:        1,        // canvas display scale

  // Background drawing
  bgMode:       'none',   // 'none' | 'auto' | 'manual'
  bgPercentile: 10,
  bgDrawing:    false,    // currently placing polygon points
  bgPoints:     [],       // [[x,y], ...] in-progress polygon (image coords)
  bgPolygon:    null,     // completed polygon [[x,y], ...] (image coords)
  bgMousePos:   null,     // current mouse position during drawing

  // Fura-2 ratiometric
  analysisMode: 'single', // 'single' | 'ratio'
  ratioCh340:   0,        // numerator channel index (340 nm)
  ratioCh380:   1,        // denominator channel index (380 nm)

  // Summary metrics (computed on ΔF/F₀ or ΔR/R₀)
  peaks:        null,     // {roi_id: float}
  aucs:         null,     // {roi_id: float}
  riseRates:    null,     // {roi_id: float}
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

  imgCanvas:     $('image-canvas'),
  roiCanvas:     $('roi-canvas'),

  activeView:    $('active-view'),
  viewStatus:    $('view-status'),

  frameSlider:   $('frame-slider'),
  frameLabel:    $('frame-label'),
  timeLabel:     $('time-label'),

  channelSel:    $('channel-select'),
  colormapSel:   $('colormap-select'),

  cmin:          $('contrast-min'),
  cmax:          $('contrast-max'),
  autoBtn:       $('auto-contrast-btn'),

  projType:      $('proj-type'),
  minSize:       $('min-size'),
  maxSize:       $('max-size'),
  threshAdj:     $('thresh-adj'),
  threshAdjVal:  $('thresh-adj-val'),
  smoothSigma:   $('smooth-sigma'),
  smoothSigmaVal:$('smooth-sigma-val'),
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

  baselineStart: $('baseline-start'),
  baselineEnd:   $('baseline-end'),
  aucStart:      $('auc-start'),
  aucEnd:        $('auc-end'),
  analyzeBtn:    $('analyze-btn'),
  exportRow:     $('export-row'),
  exportRawBtn:  $('export-raw-btn'),
  exportDfBtn:   $('export-df-btn'),

  roiCount:      $('roi-count'),
  roiList:       $('roi-list'),
  selAllBtn:     $('sel-all-btn'),
  selNoneBtn:    $('sel-none-btn'),

  plotsSection:  $('plots-section'),
  plotRaw:       $('plot-raw'),
  plotDelta:     $('plot-delta'),
  plotSummary:   $('plot-summary'),
  plotRise:      $('plot-rise'),
  plotPeak:      $('plot-peak'),
  plotAuc:       $('plot-auc'),
  tabBtns:       document.querySelectorAll('.tab-btn'),
  tabRaw:        $('tab-raw'),
  tabDelta:      $('tab-delta'),
  tabSummary:    $('tab-summary'),
  tabRise:       $('tab-rise'),
};

const imgCtx = D.imgCanvas.getContext('2d');
const roiCtx = D.roiCanvas.getContext('2d');

function currentFile() {
  return S.files[S.activeRole];
}

function sourceFile() {
  return S.files.source;
}

function measureFile() {
  return S.files.measure;
}

function displayRois() {
  return currentFile().rois;
}

function analysisRois() {
  return measureFile().rois.length ? measureFile().rois : sourceFile().rois;
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
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

  D.activeView.addEventListener('change', () => {
    S.activeRole = D.activeView.value;
    syncViewerFromActiveFile();
  });

  D.frameSlider.addEventListener('input', () => {
    const file = currentFile();
    if (!file.metadata) return;
    file.frame = +D.frameSlider.value;
    D.frameLabel.textContent = `${file.frame + 1} / ${file.metadata.n_frames}`;
    D.timeLabel.textContent = `${file.metadata.time_axis[file.frame].toFixed(2)} s`;
    requestFrame();
    updatePlotTimeCursor();
  });

  D.channelSel.addEventListener('change', () => {
    const file = currentFile();
    file.channel = +D.channelSel.value;
    requestFrame();
  });

  D.colormapSel.addEventListener('change', () => {
    S.colormap = D.colormapSel.value;
    requestFrame();
  });

  D.cmin.addEventListener('change', () => { currentFile().cmin = +D.cmin.value; requestFrame(); });
  D.cmax.addEventListener('change', () => { currentFile().cmax = +D.cmax.value; requestFrame(); });
  D.autoBtn.addEventListener('click', autoContrast);

  D.threshAdj.addEventListener('input', () => {
    D.threshAdjVal.textContent = (+D.threshAdj.value).toFixed(2);
  });
  D.smoothSigma.addEventListener('input', () => {
    D.smoothSigmaVal.textContent = (+D.smoothSigma.value).toFixed(1);
  });

  D.detectBtn.addEventListener('click', runDetection);
  D.transferBtn.addEventListener('click', transferROIsToMeasurement);
  D.analyzeBtn.addEventListener('click', runAnalysis);

  D.exportRawBtn.addEventListener('click', () => exportCSV('raw'));
  D.exportDfBtn.addEventListener('click',  () => exportCSV('delta'));

  // Background correction controls
  D.bgMode.addEventListener('change', () => {
    S.bgMode = D.bgMode.value;
    D.bgAutoOpts.style.display   = S.bgMode === 'auto'   ? 'block' : 'none';
    D.bgManualOpts.style.display = S.bgMode === 'manual' ? 'block' : 'none';
    if (S.bgMode !== 'manual') cancelBGDraw();
  });

  D.bgPercentile.addEventListener('input', () => {
    S.bgPercentile = +D.bgPercentile.value;
    D.bgPercentileV.textContent = S.bgPercentile + '%';
  });

  D.bgDrawBtn.addEventListener('click', startBGDraw);
  D.bgClearBtn.addEventListener('click', clearBGPolygon);

  D.aucStart.addEventListener('change', () => {
    S.aucStart = Math.max(0, +D.aucStart.value);
    if (S.deltaF) { recomputeAuc(); renderSummary(); renderRiseRates(); }
  });
  D.aucEnd.addEventListener('change', () => {
    S.aucEnd = Math.max(0, +D.aucEnd.value);
    if (S.deltaF) { recomputeAuc(); renderSummary(); renderRiseRates(); }
  });

  D.analysisModeEl.addEventListener('change', () => {
    S.analysisMode = D.analysisModeEl.value;
    D.ratioOpts.style.display = S.analysisMode === 'ratio' ? 'block' : 'none';
  });
  D.ratioCh340El.addEventListener('change', () => { S.ratioCh340 = +D.ratioCh340El.value; });
  D.ratioCh380El.addEventListener('change', () => { S.ratioCh380 = +D.ratioCh380El.value; });

  D.selAllBtn.addEventListener('click', () => {
    S.selected = new Set(displayRois().map(r => r.id));
    renderROIList(); drawROIs();
  });
  D.selNoneBtn.addEventListener('click', () => {
    S.selected.clear();
    renderROIList(); drawROIs();
  });

  D.tabBtns.forEach(btn => btn.addEventListener('click', () => {
    D.tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    D.plotRaw.style.display     = tab === 'raw'     ? 'block' : 'none';
    D.plotDelta.style.display   = tab === 'delta'   ? 'block' : 'none';
    D.plotSummary.style.display = tab === 'summary' ? 'flex' : 'none';
    D.plotRise.style.display    = tab === 'rise'    ? 'block' : 'none';
    // Plotly needs a nudge after display:none -> block
    requestAnimationFrame(() => {
      if (tab === 'raw'     && D.plotRaw.offsetParent)     Plotly.Plots.resize(D.plotRaw);
      if (tab === 'delta'   && D.plotDelta.offsetParent)   Plotly.Plots.resize(D.plotDelta);
      if (tab === 'summary' && D.plotSummary.offsetParent) {
        Plotly.Plots.resize(D.plotPeak);
        Plotly.Plots.resize(D.plotAuc);
      }
      if (tab === 'rise' && D.plotRise.offsetParent) Plotly.Plots.resize(D.plotRise);
    });
  }));

  D.roiCanvas.addEventListener('mousemove',  onCanvasMove);
  D.roiCanvas.addEventListener('click',      onCanvasClick);
  D.roiCanvas.addEventListener('dblclick',   onCanvasDblClick);
  D.roiCanvas.addEventListener('mouseleave', () => {
    if (S.bgDrawing) { S.bgMousePos = null; drawROIs(); return; }
    if (S.hovered !== null) { S.hovered = null; drawROIs(); syncListHighlight(null); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancelBGDraw();
  });

  window.addEventListener('resize', debounce(onResize, 150));
  window.addEventListener('pagehide', () => {
    cleanupFileSession(S.files.source.fileId, { keepalive: true });
    cleanupFileSession(S.files.measure.fileId, { keepalive: true });
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadFile(role, file) {
  const dataset = S.files[role];
  const previousFileId = dataset.fileId;
  setStatus(`Loading ${role === 'source' ? 'ROI source' : 'measurement'}…`);
  D.detectBtn.disabled = true;
  D.transferBtn.disabled = true;
  D.analyzeBtn.disabled = true;

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
    dataset.cmin     = initial_contrast.min;
    dataset.cmax     = initial_contrast.max;
    dataset.rois     = [];

    if (role === 'source') {
      S.selected = new Set();
      clearAnalysisState();
      clearBGPolygon();
      measureFile().rois = [];
      D.transferStatus.textContent = '';
      D.detectStatus.textContent = '';
    } else {
      clearAnalysisState();
    }

    if (S.activeRole === role || !currentFile().metadata) {
      S.activeRole = role;
      D.activeView.value = role;
      syncViewerFromActiveFile();
    } else {
      syncDatasetInfo();
      syncButtons();
    }

    if (role === 'measure') {
      D.baselineEnd.value = Math.max(1, Math.min(10, Math.floor(metadata.n_frames * 0.1)));
      D.aucStart.value = 0;
      D.aucStart.max   = metadata.n_frames - 1;
      D.aucEnd.value   = metadata.n_frames;
      D.aucEnd.max     = metadata.n_frames;
      S.aucStart = 0;
      S.aucEnd   = metadata.n_frames;
    }

    cleanupFileSession(previousFileId);
    setStatus('');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

function populateChannelSelects(metadata, file) {
  D.channelSel.innerHTML = '';
  metadata.channel_names.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    if (i === file.channel) opt.selected = true;
    D.channelSel.appendChild(opt);
  });

  const analysisMeta = measureFile().metadata || metadata;
  D.ratioCh340El.innerHTML = '';
  D.ratioCh380El.innerHTML = '';
  analysisMeta.channel_names.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    D.ratioCh340El.appendChild(opt.cloneNode(true));
    D.ratioCh380El.appendChild(opt.cloneNode(true));
  });
  S.ratioCh340 = 0;
  S.ratioCh380 = Math.min(1, analysisMeta.n_channels - 1);
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
  D.detectBtn.disabled = !sourceFile().fileId;
  D.transferBtn.disabled = !(sourceFile().fileId && sourceFile().rois.length && measureFile().fileId);
  D.analyzeBtn.disabled = !(measureFile().fileId && measureFile().rois.length);
}

function syncViewerFromActiveFile() {
  const file = currentFile();
  syncDatasetInfo();
  if (!file.metadata) {
    D.viewStatus.textContent = S.activeRole === 'source' ? 'No source' : 'No target';
    D.frameLabel.textContent = '— / —';
    D.timeLabel.textContent = '';
    D.channelSel.innerHTML = '';
    D.cmin.value = 0;
    D.cmax.value = 65535;
    imgCtx.clearRect(0, 0, D.imgCanvas.width, D.imgCanvas.height);
    roiCtx.clearRect(0, 0, D.roiCanvas.width, D.roiCanvas.height);
    renderROIList();
    updatePlotTimeCursor();
    syncButtons();
    return;
  }

  D.viewStatus.textContent = S.activeRole === 'source' ? 'ROI source' : 'Measurement';
  D.frameSlider.max = file.metadata.n_frames - 1;
  D.frameSlider.value = file.frame;
  D.frameLabel.textContent = `${file.frame + 1} / ${file.metadata.n_frames}`;
  D.timeLabel.textContent = `${file.metadata.time_axis[file.frame].toFixed(2)} s`;
  D.cmin.value = Math.round(file.cmin);
  D.cmax.value = Math.round(file.cmax);
  populateChannelSelects(file.metadata, file);
  setupCanvas(file.metadata.width, file.metadata.height);
  renderROIList();
  drawROIs();
  requestFrame();
  updatePlotTimeCursor();
  syncButtons();
}

// ── Canvas setup ──────────────────────────────────────────────────────────────
function setupCanvas(w, h) {
  const cont = document.getElementById('canvas-container');
  const cw = cont.clientWidth;
  const ch = cont.clientHeight;
  const scale = Math.min(cw / w, ch / h, 1);

  currentFile().scale = scale;
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  [D.imgCanvas, D.roiCanvas].forEach(c => {
    c.width  = dw; c.height = dh;
    c.style.width  = dw + 'px';
    c.style.height = dh + 'px';
  });
}

function onResize() {
  const file = currentFile();
  if (!file.metadata) return;
  setupCanvas(file.metadata.width, file.metadata.height);
  requestFrame();
  drawROIs();
}

// ── Frame display ─────────────────────────────────────────────────────────────
let _frameTimer = null;

function requestFrame() {
  if (!currentFile().fileId) return;
  clearTimeout(_frameTimer);
  _frameTimer = setTimeout(_loadFrame, 40);
}

async function _loadFrame() {
  const file = currentFile();
  if (!file.fileId) return;
  const url = `${API}/api/frame/${file.fileId}` +
    `?t=${file.frame}&channel=${file.channel}` +
    `&cmin=${file.cmin}&cmax=${file.cmax}&colormap=${S.colormap}`;

  const img = new Image();
  img.onload = () => {
    imgCtx.clearRect(0, 0, D.imgCanvas.width, D.imgCanvas.height);
    imgCtx.drawImage(img, 0, 0, D.imgCanvas.width, D.imgCanvas.height);
  };
  img.src = url + `&_=${Date.now()}`;
}

async function autoContrast() {
  const file = currentFile();
  if (!file.fileId) return;
  try {
    const res = await apiFetch(
      `/api/contrast/${file.fileId}?channel=${file.channel}&p_low=1&p_high=99.5`
    );
    file.cmin = res.min; file.cmax = res.max;
    D.cmin.value = Math.round(file.cmin);
    D.cmax.value = Math.round(file.cmax);
    requestFrame();
  } catch (err) { setStatus(`Auto-contrast error: ${err.message}`); }
}

// ── Detection ─────────────────────────────────────────────────────────────────
async function runDetection() {
  const file = sourceFile();
  if (!file.fileId) return;
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
  };

  try {
    const res = await apiFetch(`/api/detect/${file.fileId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    file.rois = res.rois.map((r, i) => ({ ...r, color: ROI_COLORS[i % ROI_COLORS.length] }));
    measureFile().rois = [];
    S.selected = new Set(file.rois.map(r => r.id));
    clearAnalysisState();

    D.detectStatus.textContent = `${res.n_rois} cells detected on ROI source`;
    D.transferStatus.textContent = measureFile().fileId ? 'Copy these ROIs to the measurement file before analysis.' : 'Load a measurement file to transfer these ROIs.';
    syncAnalysisUI();
    syncButtons();

    if (S.activeRole === 'source') {
      renderROIList();
      drawROIs();
    }
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
    clearAnalysisState();
    D.transferStatus.textContent = `${res.n_rois} ROIs copied to measurement file`;
    S.activeRole = 'measure';
    D.activeView.value = 'measure';
    syncViewerFromActiveFile();
  } catch (err) {
    D.transferStatus.textContent = `Error: ${err.message}`;
  } finally {
    syncButtons();
  }
}

// ── ROI drawing ───────────────────────────────────────────────────────────────
function drawROIs() {
  const ctx = roiCtx;
  const sc  = currentFile().scale || 1;
  ctx.clearRect(0, 0, D.roiCanvas.width, D.roiCanvas.height);

  // ── Cell ROIs ──
  for (const roi of displayRois()) {
    const sel = S.selected.has(roi.id);
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

  // ── Completed BG polygon ──
  if (S.bgPolygon && S.bgPolygon.length >= 3) {
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
  if (S.bgDrawing && S.bgPoints.length > 0) {
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
  const rois = displayRois();
  D.roiList.innerHTML = '';
  D.roiCount.textContent = `(${rois.length})`;

  for (const roi of rois) {
    const div = document.createElement('div');
    div.className = 'roi-item';
    div.dataset.id = roi.id;

    div.innerHTML = `
      <input type="checkbox" class="roi-checkbox" ${S.selected.has(roi.id) ? 'checked' : ''}>
      <div class="roi-dot" style="background:${roi.color}"></div>
      <span class="roi-label">ROI ${roi.id}</span>
      <span class="roi-area">${roi.area} px²</span>
      <button class="roi-del" title="Remove ROI">×</button>
    `;

    div.querySelector('.roi-checkbox').addEventListener('change', e => {
      if (e.target.checked) S.selected.add(roi.id); else S.selected.delete(roi.id);
      div.classList.toggle('selected', e.target.checked);
      drawROIs();
      if (S.traces) { renderPlots(); recomputeAuc(); renderSummary(); }
    });

    div.querySelector('.roi-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteROI(roi.id);
    });

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
    const roles = ['source', 'measure'];
    for (const role of roles) {
      const file = S.files[role];
      if (!file.fileId || !file.rois.some(r => r.id === roiId)) continue;
      await apiFetch(`/api/roi/${file.fileId}/${roiId}`, { method: 'DELETE' });
      file.rois = file.rois.filter(r => r.id !== roiId);
    }
    S.selected.delete(roiId);
    if (S.hovered === roiId) S.hovered = null;
    clearAnalysisState();
    syncAnalysisUI();
    syncButtons();
    renderROIList();
    drawROIs();
    setStatus('ROI removed. Run analysis again to refresh traces.');
  } catch (err) { setStatus(`Delete error: ${err.message}`); }
}

function syncListHighlight(roiId) {
  document.querySelectorAll('.roi-item').forEach(el => {
    el.classList.toggle('highlighted', +el.dataset.id === roiId);
  });
}

// ── Canvas interaction ────────────────────────────────────────────────────────
function canvasXY(e) {
  const rect = D.roiCanvas.getBoundingClientRect();
  const sc = currentFile().scale || 1;
  return {
    x: (e.clientX - rect.left) / sc,
    y: (e.clientY - rect.top)  / sc,
  };
}

function roiAtPoint(x, y) {
  const rois = displayRois();
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

function onCanvasMove(e) {
  const { x, y } = canvasXY(e);

  if (S.bgDrawing) {
    S.bgMousePos = [x, y];
    drawROIs();
    return;
  }

  const roi = roiAtPoint(x, y);
  const id  = roi ? roi.id : null;
  if (id !== S.hovered) {
    S.hovered = id;
    drawROIs();
    syncListHighlight(id);
    if (id !== null) {
      const el = D.roiList.querySelector(`[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }
}

function onCanvasClick(e) {
  if (e.detail >= 2) return; // ignore — dblclick handles this

  if (S.bgDrawing) {
    const { x, y } = canvasXY(e);
    S.bgPoints.push([x, y]);
    drawROIs();
    return;
  }

  const { x, y } = canvasXY(e);
  const roi = roiAtPoint(x, y);
  if (!roi) return;

  if (S.selected.has(roi.id)) S.selected.delete(roi.id);
  else S.selected.add(roi.id);

  renderROIList();
  drawROIs();
  if (S.traces) { renderPlots(); recomputeAuc(); renderSummary(); }
}

function onCanvasDblClick(e) {
  if (!S.bgDrawing) return;
  const { x, y } = canvasXY(e);
  S.bgPoints.push([x, y]);
  if (S.bgPoints.length >= 3) {
    S.bgPolygon = [...S.bgPoints];
  }
  S.bgDrawing  = false;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.roiCanvas.classList.remove('drawing-bg', 'drawing-bg-active');
  D.bgDrawBtn.textContent  = 'Redraw BG Region';
  D.bgClearBtn.style.display = S.bgPolygon ? 'block' : 'none';
  drawROIs();
}

// ── BG polygon drawing ────────────────────────────────────────────────────────
function startBGDraw() {
  if (S.activeRole !== 'measure') {
    setStatus('Switch the display to the measurement file to draw a background region.');
    return;
  }
  S.bgDrawing  = true;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.roiCanvas.classList.add('drawing-bg');
  D.bgDrawBtn.textContent = 'Drawing… (dbl-click to finish)';
  drawROIs();
}

function cancelBGDraw() {
  if (!S.bgDrawing) return;
  S.bgDrawing  = false;
  S.bgPoints   = [];
  S.bgMousePos = null;
  D.roiCanvas.classList.remove('drawing-bg', 'drawing-bg-active');
  D.bgDrawBtn.textContent = S.bgPolygon ? 'Redraw BG Region' : 'Draw BG Region';
  drawROIs();
}

function clearBGPolygon() {
  S.bgPolygon = null;
  cancelBGDraw();
  D.bgClearBtn.style.display = 'none';
  D.bgDrawBtn.textContent = 'Draw BG Region';
  drawROIs();
}

// ── Analysis ──────────────────────────────────────────────────────────────────
async function runAnalysis() {
  const file = measureFile();
  if (!file.fileId || file.rois.length === 0) return;
  if (S.bgMode === 'manual' && (!Array.isArray(S.bgPolygon) || S.bgPolygon.length < 3)) {
    setStatus('Manual background mode requires a drawn polygon.');
    return;
  }
  D.analyzeBtn.disabled = true;
  D.analyzeBtn.textContent = 'Analyzing…';
  setStatus('Extracting traces…');

  const body = {
    channel:        file.channel,
    baseline_start: +D.baselineStart.value,
    baseline_end:   +D.baselineEnd.value,
    roi_ids:        file.rois.map(r => r.id),
    bg_mode:        S.bgMode,
    bg_percentile:  S.bgPercentile,
    bg_polygon:     (S.bgMode === 'manual' && S.bgPolygon) ? S.bgPolygon : null,
    analysis_mode:  S.analysisMode,
    ratio_ch_num:   S.ratioCh340,
    ratio_ch_den:   S.ratioCh380,
  };

  try {
    const res = await apiFetch(`/api/analyze/${file.fileId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    S.timeAxis     = res.time_axis;
    S.traces       = res.traces;
    S.deltaF       = res.delta_f;
    S.bgTrace      = Array.isArray(res.bg_trace) && res.bg_trace.length ? res.bg_trace : null;
    S.analysisMode = res.analysis_mode || 'single';
    S.peaks        = res.peaks  || null;
    S.aucs         = res.aucs   || null;
    S.riseRates    = res.rise_rates || null;

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
      recomputeAuc();
      renderSummary();
      renderRiseRates();
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
  const deltaTraces = roiTraces(deltaF);

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

  // Click on trace -> toggle ROI selection
  [D.plotRaw, D.plotDelta].forEach(el => {
    el.removeAllListeners?.('plotly_click');
    el.on('plotly_click', data => {
      const name = data.points[0].data.name;
      const roiId = +name.replace('ROI ', '');
      if (S.selected.has(roiId)) S.selected.delete(roiId); else S.selected.add(roiId);
      renderROIList(); drawROIs(); renderPlots(); recomputeAuc(); renderSummary(); renderRiseRates();
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

function updatePlotTimeCursor() {
  const t = currentGraphTime();
  const plots = [D.plotRaw, D.plotDelta];
  const shape = t === null ? [] : [{
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: t,
    x1: t,
    y0: 0,
    y1: 1,
    line: {
      color: '#fbbf24',
      width: 1.5,
      dash: 'dot',
    },
  }];

  plots.forEach(plot => {
    if (!plot || !plot.data) return;
    Plotly.relayout(plot, { shapes: shape }).catch?.(() => {});
  });
}

// ── AUC recomputation (frontend, from stored deltaF + time axis) ─────────────
function recomputeAuc() {
  if (!S.deltaF || !S.timeAxis) return;
  const t     = S.timeAxis;
  const end   = S.aucEnd > 0 ? Math.min(S.aucEnd, t.length) : t.length;
  const start = Math.min(S.aucStart, end - 1);
  const aucs  = {};
  const riseRates = {};
  for (const [id, trace] of Object.entries(S.deltaF)) {
    const y = trace.slice(start, end);
    const x = t.slice(start, end);
    let auc = 0;
    for (let i = 1; i < y.length; i++) {
      if (!isNaN(y[i]) && !isNaN(y[i - 1])) {
        auc += (x[i] - x[i - 1]) * (y[i] + y[i - 1]) / 2;
      }
    }
    aucs[+id] = auc;

    let riseRate = 0;
    for (let i = 1; i < y.length; i++) {
      const dt = x[i] - x[i - 1];
      if (!isNaN(y[i]) && !isNaN(y[i - 1]) && dt > 0) {
        riseRate = Math.max(riseRate, (y[i] - y[i - 1]) / dt);
      }
    }
    riseRates[+id] = riseRate;
  }
  S.aucs = aucs;
  S.riseRates = riseRates;
}

// ── Summary (peak + AUC violin plots) ────────────────────────────────────────
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

  function violinTrace(yVals, yLabel) {
    return {
      type: 'violin',
      y: yVals,
      text: labels,
      box:      { visible: true, fillcolor: '#374151', line: { color: '#9ca3af' } },
      meanline: { visible: true, color: '#f3f4f6' },
      fillcolor: 'rgba(96,165,250,0.25)',
      line:     { color: '#60a5fa' },
      points:   'all',
      jitter:   0.4,
      pointpos: 0,
      marker: {
        color: colors,
        size:  6,
        line:  { color: '#1f2937', width: 0.8 },
      },
      hovertemplate: `<b>%{text}</b><br>${yLabel}: %{y:.4f}<extra></extra>`,
    };
  }

  Plotly.react(
    D.plotPeak,
    [violinTrace(peakVals, `Peak ${deltaLbl}`)],
    { ...baseLayout,
      title: { text: `Peak ${deltaLbl}`, font: { size: 11, color: '#f3f4f6' } },
      yaxis: { ...baseLayout.yaxis, title: `Peak ${deltaLbl}` },
    },
    PLOTLY_CONFIG,
  );

  const aucEnd   = S.aucEnd > 0 ? Math.min(S.aucEnd, S.timeAxis.length) : S.timeAxis.length;
  const aucRange = `frames ${S.aucStart}–${aucEnd}`;
  Plotly.react(
    D.plotAuc,
    [violinTrace(ids.map(id => aucs[id] ?? null), `AUC ${deltaLbl}`)],
    { ...baseLayout,
      title: { text: `AUC of ${deltaLbl} (${aucRange})`, font: { size: 11, color: '#f3f4f6' } },
      yaxis: { ...baseLayout.yaxis, title: `AUC (${deltaLbl} · s)` },
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
      type: 'violin',
      y: riseVals,
      text: labels,
      box: { visible: true, fillcolor: '#374151', line: { color: '#9ca3af' } },
      meanline: { visible: true, color: '#f3f4f6' },
      fillcolor: 'rgba(34,211,238,0.22)',
      line: { color: '#22d3ee' },
      points: 'all',
      jitter: 0.4,
      pointpos: 0,
      marker: {
        color: colors,
        size: 6,
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

// ── Export ────────────────────────────────────────────────────────────────────
function exportCSV(type) {
  if (!measureFile().fileId) return;
  const a = document.createElement('a');
  a.href     = `${API}/api/export/${measureFile().fileId}?type=${type}`;
  a.download = `calcium_${type}.csv`;
  a.click();
}

function clearAnalysisState() {
  S.traces = null;
  S.deltaF = null;
  S.bgTrace = null;
  S.peaks = null;
  S.aucs = null;
  S.riseRates = null;
}

function syncAnalysisUI() {
  const hasAnalysis = !!(S.traces && S.deltaF);
  D.plotsSection.style.display = hasAnalysis ? 'flex' : 'none';
  D.exportRow.style.display = hasAnalysis ? 'flex' : 'none';
}

function cleanupFileSession(fileId, opts = {}) {
  if (!fileId) return;

  fetch(`${API}/api/file/${fileId}`, {
    method: 'DELETE',
    keepalive: !!opts.keepalive,
  }).catch(() => {});
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
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
