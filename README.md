# Ca2+tch-One

<p align="center">
  <img src="CatchOne.png" alt="Ca2+tch-One logo" width="240" />
</p>

Web application for ROI detection, ROI editing, fluorescence trace extraction, calcium-response analysis, assay-specific `thapsigargin / Ca add-back` quantification, and export from `.nd2` files.

The frontend is served directly by the FastAPI backend, so you only need to start one app.

## 1. What The Program Does

Ca2+tch-One is designed for calcium-imaging workflows where you want to:

- load a dataset for ROI detection
- optionally load a second dataset for measurement
- inspect frames or projections from individual channels
- display Fura-2 style ratio images in the measurement viewer
- detect ROIs automatically on a projection image
- add, merge, and delete ROIs manually
- transfer ROIs from a source file to a measurement file
- extract raw fluorescence or ratio traces
- apply automatic or manual background subtraction
- apply optional photobleach correction
- normalize traces to `DeltaF/F0` or `DeltaR/R0`
- compute event-level and per-ROI summary metrics
- compute TG and Ca add-back assay metrics
- export CSV, workbook, and ROI-overlay images

## 2. Running The Program

### Linux / macOS

From the repository root:

```bash
bash ./start.sh
```

If `start.sh` opens in an editor instead of running, execute it from a terminal with `bash ./start.sh`, or make it executable first:

```bash
chmod +x start.sh
./start.sh
```

### Windows

From the repository root in Command Prompt:

```bat
start.bat
```

Then open:

```text
http://localhost:8001
```

The launcher will:

1. create `backend/venv` if needed
2. install Python dependencies
3. start the FastAPI server on port `8001`

## 3. Main Workflow

Typical use:

1. Load a file as `ROI Source`.
2. Inspect frames, channels, contrast, and projection type.
3. Run `Detect Cells On ROI Source`.
4. Optionally refine ROIs on the source file:
   - draw a polygon with `Add ROI On Source`
   - merge two touching ROIs with `Merge 2 Selected ROIs`
   - remove false positives with `Delete Selected ROIs`
5. Load a file as `Measurement`.
6. Click `Copy ROIs To Measurement`.
7. Review the ROI list and uncheck ROIs you do not want to analyze.
8. Choose analysis settings:
   - background correction
   - analysis mode
   - ratio channels if needed
   - baseline range
   - response window
   - photobleach correction
   - TG and add-back assay windows if relevant
9. Click `Analyze Measurement File`.
10. Review the plots and metric tabs.
11. Export the results you need.

Important:

- ROI selection is part of the actual analysis. Unchecked ROIs are excluded.
- Changing ROI selection or analysis settings invalidates downstream metrics until analysis is rerun.
- The raw trace plot can remain visible while downstream plots are cleared after a settings change.
- At the moment, it is safest to set an explicit `AUC end` frame when you want summary metrics over a defined response window.

## 4. File Roles

### ROI Source

This is the dataset used for ROI detection and source-side ROI editing.

Use it when:

- the structural signal is clearer in one file than another
- you want to detect cells on one recording and analyze another recording with the same field of view

### Measurement

This is the dataset used for trace extraction, normalization, event analysis, and assay-specific analysis.

The actual analysis always runs on the `Measurement` file after ROIs have been copied into it.

ROI transfer currently requires matching source and measurement image dimensions.

## 5. Image Viewer Controls

Each viewer provides:

- `Frame`
  - selects the current time point
- `Channel`
  - selects the displayed channel
- `Contrast min / max`
  - display scaling only
- `Auto`
  - estimates display contrast automatically
- `Colormap`
  - display coloring only

The measurement viewer can also display a ratio view when a Fura-2 style `340 / 380` channel pair is detected.

These settings do not modify the underlying stored data. They only affect visualization.

The trace plots can show analysis markers:

- yellow dotted line
  - current frame
- green shaded region
  - baseline window
- blue shaded region
  - AUC / response window
- orange shaded region
  - TG window
- purple shaded region
  - Ca add-back window

## 6. ROI Detection

ROI detection runs on the `ROI Source` file.

### Detection Settings

- `Projection`
  - `Mean`: average intensity projection over time
  - `Max`: maximum intensity projection
  - `Std`: standard-deviation projection

- `Min size (px^2)`
  - minimum accepted ROI area

- `Max size (px^2)`
  - maximum accepted ROI area

- `Threshold adj.`
  - scales the automatically chosen threshold
  - lower values usually detect more objects
  - higher values usually detect fewer objects

- `Smooth sigma (px)`
  - Gaussian smoothing before thresholding

- `BG radius (px)`
  - background-removal scale used before thresholding
  - this is separate from ROI size filtering

- `Seed sigma (px)`
  - smoothing applied to the distance map before seed detection
  - mainly affects splitting of touching cells

- `Keep edge ROIs`
  - if unchecked, ROIs touching the image border are discarded

### Detection Pipeline

The detector:

1. builds a 2D projection from the selected channel
2. rescales intensities using robust percentiles
3. smooths the image
4. removes slowly varying background with a white top-hat filter
5. thresholds the corrected image
6. cleans the binary mask
7. finds watershed seeds from the distance transform
8. splits touching cells
9. filters ROIs by size and edge policy
10. converts final labels into polygon contours for the browser

Detection is intensity-based on the projection image. It is not activity-based.

## 7. ROI Management

After detection, ROIs can be refined manually on the source dataset before transfer.

### Add ROI

Click `Add ROI On Source` to draw a polygon directly on the ROI source viewer.

- click to place vertices
- double-click to close the polygon
- press `Esc` or click `Cancel ROI Drawing` to abort

Rules:

- the polygon must contain at least 3 pixels
- it must not overlap an existing ROI

### Merge ROIs

Select exactly 2 ROIs in the list, then click `Merge 2 Selected ROIs`.

The two regions are merged into a single ROI using the lower ROI ID. This is intended for touching segments that were split by the detector.

### Delete ROIs

Select one or more ROIs in the list, then click `Delete Selected ROIs`.

Deleted ROIs are removed from both the label image and the ROI list.

Any add, merge, or delete action clears the current analysis results. You need to rerun analysis after modifying ROIs or retransferring them.

## 8. ROI Selection

After ROIs are transferred to the measurement file, the ROI list becomes the analysis-selection list.

- checked ROI
  - included in analysis
- unchecked ROI
  - excluded from analysis

You can also:

- click `All`
- click `None`
- click traces in the raw or normalized plot to toggle ROIs directly

The ROI list changes context automatically:

- on the source side it is used for edit, merge, and delete actions
- on the measurement side it is used for include / exclude analysis selection

## 9. Background Correction

Three modes are available.

### `None`

No background is subtracted.

### `Auto`

For each frame, the app:

1. excludes ROI pixels
2. excludes a safety halo around each ROI
3. takes the chosen percentile of the remaining pixels

Default:

- `50%`
  - median background

This is robust to bright debris and isolated hot pixels.

### `Manual ROI`

You draw a polygon on the measurement image.

The app then:

1. uses only pixels inside that polygon
2. still excludes ROI pixels and their halo
3. calculates the chosen percentile frame by frame

Important:

- if your polygon overlaps ROIs too much, analysis fails with an error instead of silently subtracting cell signal
- `Clear BG Region` removes the stored manual region
- changing the background region invalidates downstream analysis

## 10. Analysis Modes

### Single Channel

This uses one selected measurement channel.

- raw trace
  - mean ROI intensity over time after optional background subtraction and optional bleach correction
- normalized trace
  - `DeltaF/F0`

Where:

- `F0` is the mean over the selected baseline frame range

### Ratio

This is intended for ratiometric imaging such as Fura-2.

The app:

1. extracts mean ROI intensity from the numerator channel
2. extracts mean ROI intensity from the denominator channel
3. subtracts background separately from each channel if enabled
4. computes raw ratio = numerator / denominator
5. computes normalized ratio change = `DeltaR/R0`

Where:

- `R0` is the mean ratio over the selected baseline frame range

## 11. Analysis Windows

The analysis panel lets you define several frame windows:

- `Baseline start` / `Baseline end`
  - used to compute `F0` or `R0`
- `AUC start` / `AUC end`
  - used for summary-metric response-window calculations
- `TG frame` / `TG end frame`
  - TG assay response window
- `Ca add-back frame` / `Add-back end frame`
  - Ca add-back response window

Additional assay controls:

- `TG baseline frames`
- `TG slope frames`
- `Add-back baseline frames`
- `Add-back slope frames`

The UI validates assay windows and shows hints when a TG or add-back window is disabled or inconsistent.

## 12. Photobleach Correction

Three choices are available:

### `None`

No photobleach correction is applied.

### `Linear`

A straight line is fit to each ROI trace and subtracted before normalization.

This is useful for mild monotonic drift.

### `Single exponential`

A single exponential decay is fit and subtracted before normalization.

This can help with stronger bleaching, but may distort traces if the fit is poor.

## 13. Event And Summary Metrics

Per-ROI metrics are estimated from the normalized trace.

The app reports:

- `Peak`
  - maximum normalized response inside the response window

- `AUC`
  - suprathreshold area under the normalized trace inside the response window

- `Event FWHM`
  - mean full width at half maximum across detected events

- `Event Raster`
  - detected event peak times for each ROI

- `Time To Peak`
  - mean onset-to-peak time across detected events

- `Decay t1/2`
  - mean event half-decay time

- `Rate Of Rise`
  - maximum positive slope in the normalized trace

Internally, event detection uses the baseline window to derive a threshold and then detects peaks inside the response window.

## 14. TG Leak And Ca Add-Back Metrics

These metrics are intended for thapsigargin / calcium re-addition style assays.

### TG Leak

For each ROI:

1. a pre-TG baseline is calculated from the `TG baseline frames` immediately before `TG frame`
2. the normalized signal is measured inside the TG window relative to that baseline

The app reports:

- `TG Peak`
  - maximum value in the TG window above pre-TG baseline
- `TG Initial Slope`
  - linear-fit slope over the first `TG slope frames`
- `TG AUC`
  - area under the TG response above pre-TG baseline

### Ca Add-Back

For each ROI:

1. a pre-add-back baseline is calculated from the `Add-back baseline frames` immediately before `Ca add-back frame`
2. the normalized signal is measured inside the add-back window relative to that baseline

The app reports:

- `Add-Back Peak`
  - maximum value in the add-back window above pre-add-back baseline
- `Add-Back Initial Slope`
  - linear-fit slope over the first `Add-back slope frames`
- `Add-Back AUC`
  - area under the add-back response above pre-add-back baseline
- `Add-Back Time To Peak`
  - time from window start to the maximum response

## 15. Plot Tabs

The plot area contains these tabs:

- `Raw Fluorescence (F)` or ratio raw
  - raw extracted traces
- `DeltaF / F0` or `DeltaR / R0`
  - normalized traces
- `Peak + AUC`
  - box plots with per-ROI points for peak and AUC
- `Event FWHM`
  - box plot of mean per-ROI event widths
- `Event Raster`
  - raster plot of detected event times
- `Time To Peak`
  - box plot of mean per-ROI event latency
- `Decay t1/2`
  - box plot of mean per-ROI decay half-time
- `Rate Of Rise`
  - box plot of maximum per-ROI rise rate
- `TG Leak`
  - TG peak, slope, and AUC box plots
- `Ca Add-Back`
  - add-back peak, slope, AUC, and time-to-peak box plots

The event raster can be sorted by:

- ROI ID
- event count
- first event
- peak amplitude

## 16. Export

Four export buttons are available after analysis:

- `Export Raw CSV`
  - one column per analyzed ROI, time in seconds in the first column
  - exports raw traces from the last completed analysis

- `Export Analysis XLSX`
  - multi-sheet workbook containing:
    - `Metadata`
    - `Settings`
    - `ROI_List`
    - `Raw_Traces`
    - `DeltaF`
    - `Metrics`
  - the raw-trace sheet includes a background column when background subtraction was used
  - the filename is derived from the measurement filename

- `Export ROI Overlay PNG`
  - current displayed frame with ROI contours and ROI ID labels

- `Export Projection ROI PNG`
  - current projection view with ROI contours and ROI ID labels

## 17. Memory And Session Behavior

The app keeps uploaded datasets in server memory for the active session.

Operational details:

- sessions are stored in memory only
- inactive sessions are evicted automatically after about 2 hours
- the server sweeps for stale sessions every 5 minutes
- the browser asks the backend to clean up loaded files on page exit when possible
- the header shows a memory readout with:
  - process RSS
  - ND2 memory currently held in sessions
  - number of open sessions

The backend can reject new uploads when process memory exceeds the configured limit.

Environment variable:

- `CACELLFIE_MAX_RSS_MB`
  - maximum allowed process RSS in MB
  - set to `0` to disable the limit

## 18. Practical Recommendations

### For standard single-channel calcium imaging

Recommended starting settings:

- background mode: `Auto`
- background percentile: `50`
- photobleach: `None`
- baseline: early stable frames before stimulation

### For Fura-2

- use `Ratio` mode
- choose the correct numerator and denominator channels
- make sure the baseline window is before stimulation
- confirm that the ratio viewer is using the expected `340 / 380` channel pair

### For TG / add-back assays

- place `TG frame` at the first frame after reagent arrival
- place `Ca add-back frame` at the first frame after calcium reintroduction
- use windows long enough to capture the rise and peak
- keep windows short enough to avoid unrelated late behavior dominating the metric

## 19. Common Failure Cases

### `Run detection first`

You tried to analyze before ROIs exist in the measurement session.

### `No ROIs selected for analysis`

All measurement ROIs are unchecked.

### Manual background error

Your manual polygon:

- overlaps ROIs too much
- or contains no usable background pixels

### No useful auto background pixels

The field is too dense or ROIs cover almost the whole image.

### ROI transfer size mismatch

The source and measurement files do not share the same image dimensions.

### Strange assay metrics

Check:

- `TG frame`
- `TG end frame`
- `Ca add-back frame`
- `Add-back end frame`
- baseline frame counts
- slope frame counts

These metrics depend directly on those settings.

## 20. Technical Notes

- only `.nd2` files are supported
- the browser UI is served by the FastAPI backend
- uploads are loaded fully into memory for the session
- ROI overlays are rendered from stored polygon contours plus ROI centroids
- the workbook export is generated server-side without an external Excel dependency

## 21. Project Structure

```text
backend/
  main.py
  image_io.py
  detection.py
  analysis.py
  requirements.txt

frontend/
  index.html
  style.css
  app.js

bundle/
  start.bat
  build_bundle.bat

start.sh
start.bat
SESSION_NOTES.md
```
