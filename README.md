# Ca2+tch-One

Web application for ROI detection, fluorescence trace extraction, calcium-response analysis, and assay-specific `thapsigargin / Ca add-back` analysis from `.nd2` files.

## 1. What The Program Does

The program is designed for calcium imaging experiments where you:

- load a dataset used to detect ROIs
- optionally load a second dataset used for measurement
- extract fluorescence traces from the selected ROIs
- apply background subtraction
- normalize traces to `ΔF/F0` or `ΔR/R0`
- calculate event metrics
- calculate assay-specific metrics for:
  - `thapsigargin (TG)`-evoked leak / store-release phase
  - `Ca add-back` phase at the end of the recording

The frontend is served by the FastAPI backend, so you only run one server.

## 2. Running The Program

### Linux / macOS

From the repository root:

```bash
bash ./start.sh
```

If `start.sh` opens in an editor instead of running, it is being opened as a text file by the desktop environment. Run it from a terminal with `bash ./start.sh`, or make it executable with:

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
3. start the server on port `8001`

## 3. Main Workflow

Typical use:

1. Load a file as `ROI Source`.
2. Adjust image display if needed:
   - frame
   - channel
   - contrast
   - colormap
3. Run `Detect Cells On ROI Source`.
4. Optionally refine ROIs:
   - draw a manual ROI with `Add ROI On Source`
   - merge two touching segments with `Merge 2 Selected ROIs`
   - remove false positives with `Delete Selected ROIs`
5. Load a file as `Measurement`.
6. Click `Copy ROIs To Measurement`.
7. Review the ROI list and deselect ROIs you do not want to analyze.
8. Set analysis options:
   - background correction
   - single-channel or ratio mode
   - baseline range
   - analysis window
   - photobleach correction
   - TG and add-back frames/windows if relevant
9. Click `Analyze Measurement File`.
10. Review:
   - raw traces
   - normalized traces
   - summary metric tabs
   - event raster
   - TG Leak tab
   - Ca Add-Back tab
11. Export results if needed.

Important:

- ROI selection is part of the actual analysis. Unchecked ROIs are not analyzed.
- If you change analysis settings, the current results are invalidated and you need to rerun analysis.
- The raw trace plot stays visible when you change ROI selection, but downstream metric plots are cleared until you rerun analysis.

## 4. File Roles

### ROI Source

This is the dataset used for ROI detection.

Use this when:

- the structural signal is clearer in one file than another
- you want to detect cells on one dataset and measure them on a separate recording

### Measurement

This is the dataset used for trace extraction and calcium analysis.

The analysis always runs on the `Measurement` file after ROIs have been copied into it.

## 5. Image Viewer Controls

Each viewer has:

- `Frame`: selects time point
- `Channel`: selects imaging channel
- `Contrast min / max`: display scaling only
- `Auto`: automatic contrast estimate
- `Colormap`: display coloring only

These settings do not change the raw stored data. They only affect what you see in the browser.

The raw and normalized plots also show vertical markers:

- yellow dotted line: current frame
- orange shaded region: `TG` analysis window
- purple shaded region: `Ca add-back` analysis window

## 6. ROI Detection

ROI detection is run on the `ROI Source` file.

### Detection Settings

- `Projection`
  - `Mean`: average intensity projection over time
  - `Max`: maximum intensity projection
  - `Std`: standard deviation projection

- `Min size (px²)`
  - minimum accepted ROI area

- `Max size (px²)`
  - maximum accepted ROI area

- `Threshold adj.`
  - scales the automatically chosen threshold
  - lower values usually detect more objects
  - higher values usually detect fewer objects

- `Smooth σ (px)`
  - Gaussian smoothing before thresholding

- `BG radius (px)`
  - background-removal scale used before thresholding
  - this is separate from ROI size filtering

- `Seed σ (px)`
  - smoothing used for watershed seed separation
  - mainly affects splitting of touching cells

- `Keep edge ROIs`
  - if unchecked, ROIs touching the image border are discarded

### What ROI Detection Calculates

The detection pipeline:

1. builds a 2D projection from the selected channel
2. normalizes and smooths it
3. performs background subtraction with a white top-hat filter
4. thresholds the corrected image
5. cleans the binary mask
6. splits touching cells using distance-transform seeding and watershed
7. filters ROIs by size
8. converts final labels into polygon contours

Detection is intensity-based on the projection image. It is not activity-based.

## 7. ROI Management

After detection, ROIs can be refined manually before analysis.

### Add ROI

Click `Add ROI On Source` to draw a polygon directly on the ROI source viewer.

- click to place vertices
- double-click to close the polygon
- click `Cancel ROI Drawing` to abort

The polygon must cover at least 3 pixels and must not overlap an existing ROI.

### Merge ROIs

Select exactly 2 ROIs in the list, then click `Merge 2 Selected ROIs`.

The two segments are merged into a single ROI with the lower ID. Use this to join cells that were split by the detector.

### Delete ROIs

Select one or more ROIs in the list, then click `Delete Selected ROIs`.

Deleted ROIs are removed from both the label image and the ROI list.

Any add, merge, or delete operation clears the current analysis results. You need to rerun analysis after modifying ROIs.

## 8. ROI Selection

After ROIs are detected or transferred, they appear in the ROI list.

- checked ROI = included in analysis
- unchecked ROI = excluded from analysis

You can also:

- click `All`
- click `None`
- click traces in the raw or normalized plot to toggle a ROI

## 9. Background Correction

The program supports three modes.

### `None`

No background is subtracted.

### `Auto`

For each frame, the program:

1. excludes all ROI pixels
2. excludes a safety halo around each ROI
3. takes the chosen percentile of the remaining pixels

Default:

- `50%` = median background

This is robust to bright debris and isolated hot pixels.

### `Manual ROI`

You draw a polygon on the measurement image.

The program:

1. uses only pixels inside that polygon
2. still excludes ROI pixels and their halo
3. calculates the chosen percentile frame by frame

Important:

- if your manual polygon overlaps ROIs too much, analysis fails with an error instead of silently subtracting cell signal

## 10. Analysis Modes

### Single Channel

This uses one selected channel:

- raw trace = mean ROI intensity over time
- normalized trace = `ΔF/F0`

Where:

- `F0` is the mean over the selected baseline frame range

### Ratio

This is intended for ratiometric imaging such as Fura-2.

The program:

1. extracts mean ROI intensity from the numerator channel
2. extracts mean ROI intensity from the denominator channel
3. computes raw ratio = numerator / denominator
4. computes normalized ratio change = `ΔR/R0`

Where:

- `R0` is the mean ratio over the baseline frame range

## 11. Photobleach Correction

Three choices are available:

### `None`

No photobleach correction is applied.

### `Linear`

A straight line is fit to each ROI trace and subtracted before normalization.

This can help when the recording has mild drift.

### `Exponential`

A single exponential decay is fit and subtracted before normalization.

This can help with stronger bleaching, but may distort traces if the fit is poor.

## 12. Event Detection

Event metrics are estimated from the normalized trace for each ROI.

The program measures:

- `Peak`
  - maximum normalized response

- `AUC`
  - area under the normalized curve

- `Event count`
  - number of detected peaks

- `Event frequency`
  - event count per unit time

- `Mean event amplitude`
  - average peak height of detected events

- `Mean FWHM`
  - average full width at half maximum of detected events

- `Mean time to peak`
  - average rise time to event peak

- `Mean decay t1/2`
  - average half-decay time

- `Max rate of rise`
  - steepest positive slope in the normalized trace

## 13. TG Leak And Ca Add-Back Metrics

These metrics are useful for thapsigargin / calcium re-addition assays.

### TG Leak

The user specifies:

- `TG frame`
  - first frame of the TG response window

- `TG window`
  - number of frames used to quantify the TG response

### Ca Add-Back

The user specifies:

- `Ca add-back frame`
  - first frame of the add-back response window

- `Add-back window`
  - number of frames used to quantify the add-back response

### How TG Metrics Are Calculated

For each ROI:

1. pre-TG baseline = mean of the `TG baseline frames` immediately before `TG frame`
2. TG response trace = normalized signal inside the TG window minus that pre-TG baseline

The following metrics are calculated:

- `TG Peak`
  - maximum value in the TG window above pre-TG baseline

- `TG Initial Slope`
  - linear-fit slope over the first few frames of the TG window

- `TG AUC`
  - area under the TG response above pre-TG baseline over the TG window

Interpretation:

- higher `TG slope` can indicate faster leak / release into the cytosol
- higher `TG peak` indicates a larger transient response
- `TG AUC` reflects the integrated TG response over the chosen window

### How Ca Add-Back Metrics Are Calculated

For each ROI:

1. pre-add-back baseline = mean of the `Add-back baseline frames` immediately before `Ca add-back frame`
2. add-back response trace = normalized signal inside the add-back window minus that pre-add-back baseline

The following metrics are calculated:

- `Add-Back Peak`
  - maximum value in the add-back window above pre-add-back baseline

- `Add-Back Initial Slope`
  - linear-fit slope over the first few frames of the add-back window

- `Add-Back AUC`
  - area under the add-back response above pre-add-back baseline

- `Add-Back Time To Peak`
  - time from add-back window start to the maximum value inside the window

Interpretation:

- `Add-Back Initial Slope` is often the most direct calcium-entry metric
- `Add-Back Peak` measures the response size
- `Add-Back Time To Peak` measures entry kinetics

## 14. Tabs In The Plot Area

### `Raw Fluorescence (F)` or ratio raw

Shows raw extracted ROI traces.

### `ΔF / F0` or `ΔR / R0`

Shows normalized traces.

### `Peak + AUC`

Box plots with per-ROI points for:

- peak
- AUC

### `Event FWHM`

Box plot of mean per-ROI event FWHM.

### `Event Raster`

Per-ROI raster of detected event peak times.

### `Time To Peak`

Box plot of mean per-ROI event time to peak.

### `Decay t1/2`

Box plot of mean per-ROI decay half-time.

### `Rate Of Rise`

Box plot of maximum per-ROI rise rate.

### `TG Leak`

Box plots for:

- TG peak
- TG initial slope
- TG AUC

### `Ca Add-Back`

Box plots for:

- add-back peak
- add-back initial slope
- add-back time to peak

## 15. Export

Four export buttons are available after analysis:

- `Export Raw CSV`
  - one column per ROI, time in seconds as the first column
  - contains only the ROIs included in the last completed analysis

- `Export Analysis XLSX`
  - multi-sheet workbook containing:
    - `Metadata` — file and recording metadata
    - `Settings` — all analysis and detection parameters used
    - `ROI_List` — per-ROI area, centroid, bounding box, and contour
    - `Raw_Traces` — raw fluorescence per ROI with background column
    - `DeltaF` — normalized traces (`ΔF/F₀` or `ΔR/R₀`)
    - `Metrics` — all per-ROI summary metrics in one table
  - filename is derived from the loaded measurement file

- `Export ROI Overlay PNG`
  - current frame with ROI contours and ID labels drawn on top

- `Export Projection ROI PNG`
  - mean projection with ROI contours and ID labels drawn on top

## 16. Practical Recommendations

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

### For TG / add-back assays

- place `TG frame` at the first frame after reagent arrival
- place `Ca add-back frame` at the first frame after calcium reintroduction
- use windows long enough to capture the rise and peak, but not so long that unrelated later behavior dominates the metric

## 17. Common Failure Cases

### `Run detection first`

You tried to analyze before ROIs exist in the measurement file.

### `No ROIs selected for analysis`

All ROIs are unchecked.

### Manual background error

Your manual polygon:

- overlaps ROIs too much
- or contains no usable background pixels

### No useful auto background pixels

The field is too dense or ROIs cover almost the whole image.

### Strange assay metrics

Check:

- `TG frame`
- `TG window`
- `Ca add-back frame`
- `Add-back window`

These metrics depend directly on those settings.

## 18. Technical Notes

- uploaded files are stored in memory for the active session
- only `.nd2` files are supported
- the browser UI is served by the backend
- the app currently uses per-ROI summaries for most metric tabs

## 19. Project Structure

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

start.sh
start.bat
```
