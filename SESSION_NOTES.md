# Session Notes

## Scope Of This Session

This session focused on:

- ROI detection review and fixes
- background subtraction review and fixes
- frontend/backend consistency for analysis settings
- event metric revisions for calcium analysis
- assay-specific `thapsigargin / Ca add-back` analysis
- UI plotting changes
- user documentation

## Major Changes Made

### 1. ROI Detection

The ROI detection pipeline was reviewed and updated.

Changes:

- decoupled background-removal scale from ROI area filtering
- added explicit ROI detection controls:
  - `BG radius`
  - `Seed σ`
  - `Keep edge ROIs`
- made border-touching ROI handling configurable
- exposed those settings in both backend and frontend

Files affected:

- `backend/detection.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`

### 2. Background Subtraction

Background subtraction was reviewed and corrected.

Changes:

- default background mode set to `auto`
- default background percentile set to `50`
- manual background no longer falls back to ROI pixels when invalid
- auto background now fails clearly if no valid non-cell pixels remain
- manual background uses the same percentile-based estimator as auto
- frontend and backend defaults were aligned

Files affected:

- `backend/analysis.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`

### 3. Frontend / Backend Consistency

Several consistency problems were fixed.

Changes:

- selected ROIs are now the ROIs actually analyzed
- selection changes invalidate downstream analysis results
- raw traces remain visible when ROI selection changes
- background, ratio, and photobleach settings are now carried through correctly
- frontend state now matches DOM defaults on load
- colormap reload mismatch was fixed by reading dropdown values into state at startup

Files affected:

- `frontend/app.js`
- `backend/main.py`
- `backend/analysis.py`

### 4. Event Metric Revisions

The event metrics were made more literature-aligned.

Changes:

- event duration changed to `FWHM`
- event frequency changed to peak-based event counting
- added:
  - `Time To Peak`
  - `Decay t1/2`
- refined onset and decay calculations
- invalid / edge-clipped events are excluded from mean kinetics instead of counted as zero
- frequency now counts only valid events

Current event definitions:

- event peak: local peak above threshold
- threshold for detection/AUC: `baseline mean + 2 × baseline SD`
- event onset for `Time To Peak`: backward crossing of `10%` event amplitude above baseline
- event duration: baseline-relative `FWHM`
- decay: baseline-relative half-decay time

Files affected:

- `backend/analysis.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`

### 5. Plotting Changes

Plot presentation was revised.

Changes:

- generic metric tabs now use `box + individual points`
- old frequency violin replaced with `Event Raster`
- backend now returns `event_times` for raster plotting

Current plot tabs:

- `Raw Fluorescence (F)` or raw ratio
- `ΔF / F₀` or `ΔR / R₀`
- `Peak + AUC`
- `Event FWHM`
- `Event Raster`
- `Time To Peak`
- `Decay t1/2`
- `Rate Of Rise`
- `TG Leak`
- `Ca Add-Back`

Files affected:

- `backend/analysis.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`
- `frontend/style.css`

### 6. TG / Ca Add-Back Assay Analysis

Assay-specific metrics were added for experiments using:

1. `Thapsigargin`
2. `Ca add-back`

Settings added:

- `TG frame`
- `TG window (frames)`
- `Ca add-back frame`
- `Add-back window (frames)`

These are used to calculate phase-specific metrics on the normalized trace.

Current TG metrics:

- `TG Peak`
- `TG Initial Slope`
- `TG AUC`

Current add-back metrics:

- `Add-Back Peak`
- `Add-Back Initial Slope`
- `Add-Back AUC`
- `Add-Back Time To Peak`

Implementation details:

- pre-stimulus baseline for each phase = mean of 5 frames immediately before phase start
- phase response = normalized trace inside phase window minus that pre-phase baseline
- initial slope = linear fit over the first part of the phase window

Files affected:

- `backend/analysis.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`

### 7. Assay Window Markers On Plots

The raw and normalized plots now show assay windows visually.

Current overlays:

- yellow dotted line = current frame
- orange shaded box = `TG` analysis window
- purple shaded box = `Ca add-back` analysis window
- dashed line = window start
- dotted line = window end

These update when the corresponding frame/window settings are changed.

Files affected:

- `frontend/app.js`

### 8. Photobleach Correction

Optional photobleach correction was added.

Options:

- `None`
- `Single exponential`

Current implementation:

- per-trace single-exponential fit
- correction applied before normalization
- enabled through analysis settings

Files affected:

- `backend/analysis.py`
- `backend/main.py`
- `frontend/index.html`
- `frontend/app.js`

### 9. Windows Startup

A Windows launcher was added.

Files:

- `start.bat`
- `README.md`

## Documentation Added

The README was rewritten as a full user manual.

File:

- `README.md`

It now includes:

- how to run the app
- workflow
- setting explanations
- metric definitions
- TG / add-back explanation
- troubleshooting notes

## Important Current Behavior

### ROI Selection

- ROI selection affects actual analysis
- deselected ROIs are not analyzed
- selection changes preserve the raw plot but clear downstream analysis

### Session Persistence

- app session state is not persisted
- backend session data is in-memory only
- uploaded files, ROIs, and results are lost when the server stops

### Current Defaults

- background mode: `auto`
- background percentile: `50`
- photobleach: `none`
- colormap state is initialized from the UI on load

## Current Limitations

- no save/load project session feature inside the app
- assay metrics depend on user-set `TG` and `Ca add-back` frames/windows
- add-back and TG analysis are window-based, not automatic stimulus detection
- event metrics are per-ROI summaries rather than full event-level export tables

## Files Most Heavily Changed

- `backend/analysis.py`
- `backend/main.py`
- `frontend/app.js`
- `frontend/index.html`
- `frontend/style.css`
- `README.md`
- `start.bat`

## Good Next Steps Later

Useful future improvements:

1. Save/load project session to JSON
2. Export event-level tables in addition to ROI-level summaries
3. Add direct draggable markers for TG and add-back on the plots
4. Add optional comparison/group analysis
5. Add validation hints for baseline and assay-window placement
