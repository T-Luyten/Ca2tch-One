# Ca²⁺tch-One User Manual
## Complete Guide to Calcium Imaging Analysis

**Version:** v1.1.0-alpha  
**Application:** Browser-based ND2 analysis tool for calcium-imaging experiments

---

## Table of Contents

1. [Introduction](#introduction)
2. [Installation & Setup](#installation--setup)
3. [Getting Started](#getting-started)
4. [User Interface Overview](#user-interface-overview)
5. [Loading Data](#loading-data)
6. [Image Viewing & Display Controls](#image-viewing--display-controls)
7. [ROI Detection](#roi-detection)
8. [Manual ROI Editing](#manual-roi-editing)
9. [ROI Transfer & Selection](#roi-transfer--selection)
10. [Analysis Configuration](#analysis-configuration)
11. [Running Analysis](#running-analysis)
12. [Results & Metrics](#results--metrics)
13. [Export Options](#export-options)
14. [Advanced Features](#advanced-features)
15. [Troubleshooting](#troubleshooting)
16. [Technical Specifications](#technical-specifications)

---

## 1. Introduction

Ca²⁺tch-One is a specialized browser-based application designed for analyzing calcium imaging experiments from Nikon ND2 files. The application integrates multiple analysis workflows into a single interface:

- **ROI Detection:** Automatic cell detection using projection-based watershed segmentation
- **Manual ROI Editing:** Interactive tools for refining detected regions
- **Trace Extraction:** Single-channel fluorescence or Fura-2 ratio analysis
- **Event Analysis:** Automated detection and quantification of calcium transients
- **Assay Quantification:** Specialized analysis for thapsigargin leak and calcium add-back experiments
- **Export:** Multi-format export including CSV traces, Excel workbooks, and overlay images

### Key Features

✓ Direct ND2 file support (no conversion required)  
✓ Side-by-side source and measurement datasets  
✓ Automatic and manual ROI tools  
✓ Single-channel and Fura-2 ratio modes  
✓ Background subtraction with auto and manual modes  
✓ Photobleach correction (linear and exponential)  
✓ Comprehensive event metrics (peak, AUC, FWHM, rise time, decay kinetics)  
✓ Specialized TG leak and Ca²⁺ add-back quantification  
✓ Multi-format export (CSV, XLSX, PNG)

---

## 2. Installation & Setup

### System Requirements

- **Operating System:** Linux, macOS, or Windows
- **Python:** Python 3.12 recommended (3.10+ supported)
- **Browser:** Modern web browser (Chrome, Firefox, Safari, Edge)
- **Memory:** Minimum 2 GB RAM; 4 GB+ recommended for large datasets
- **Disk Space:** 500 MB for application + dependencies

### Installation Steps

#### Linux / macOS

1. Navigate to the Ca²⁺tch-One directory:
```bash
cd /path/to/Ca2tchOne
```

2. Make the startup script executable (if needed):
```bash
chmod +x start.sh
```

3. Launch the application:
```bash
./start.sh
```

The startup script will:
- Create a Python virtual environment in `backend/venv/`
- Install or upgrade all dependencies from `requirements.txt`
- Start the FastAPI server on `http://127.0.0.1:8001`

#### Windows

1. Open Command Prompt or PowerShell
2. Navigate to the Ca²⁺tch-One directory:
```cmd
cd C:\path\to\Ca2tchOne
```

3. Run the startup batch file:
```cmd
start.bat
```

The script will automatically:
- Create the virtual environment
- Install dependencies
- Start the server
- Open your default browser to `http://localhost:8001`

### Accessing the Application

Once launched, open your browser and navigate to:
```
http://localhost:8001
```

The application interface will load with a splash screen animation, followed by the main analysis interface.

---

## 3. Getting Started

### Basic Workflow Overview

Ca²⁺tch-One uses a two-dataset workflow:

1. **ROI Source Dataset:** Used for detecting and editing ROIs
2. **Measurement Dataset:** Used for extracting and analyzing traces

**Typical Analysis Steps:**

1. Load an ND2 file as "ROI Source"
2. Detect cells on the source dataset
3. Refine ROIs if needed
4. Load an ND2 file as "Measurement"
5. Copy ROIs to measurement dataset
6. Configure analysis parameters
7. Run analysis
8. Review results and export

This separation allows you to:
- Use a high-quality reference image for ROI detection
- Apply the same ROIs to multiple measurement datasets
- Keep detection and analysis parameters independent

---

## 4. User Interface Overview

The Ca²⁺tch-One interface is organized into several key sections:

### Top Header Bar

- **Application Title:** "Ca²⁺tch-One (v1.1.0-alpha)"
- **File Load Buttons:**
  - "Load ROI Source" - Load dataset for ROI detection
  - "Load Measurement" - Load dataset for analysis
- **Status Display:**
  - Currently loaded file names
  - Memory usage (RSS)
  - ND2 data size
  - Active session count

### Main Viewing Area

**Left Panel: ROI Source Viewer**
- Frame slider for navigating through time
- Channel selector
- Contrast controls (min/max)
- Auto-contrast with percentile adjustment
- Colormap selection
- Live ROI overlay display

**Right Panel: Measurement Viewer**
- Identical controls to source viewer
- Additional ratio display mode for Fura-2 data
- Frame and channel synchronization options

### Right Sidebar (Scrollable)

The sidebar contains all analysis controls organized into collapsible sections:

1. **Cell Detection** - Parameters for automatic ROI detection
2. **ROI Tools** - Manual editing tools
3. **Detection** - Run detection button
4. **Dataset Pairing** - ROI transfer controls
5. **Background Correction** - Background subtraction settings
6. **Analysis Mode** - Single channel vs. Fura-2 ratio
7. **Baseline & Integration** - Frame windows for analysis
8. **Signal Processing** - Photobleach correction and margin settings
9. **Event Detection** - Event threshold and duration parameters
10. **TG Assay** - Thapsigargin leak analysis settings
11. **Ca²⁺ Add-Back Assay** - Calcium add-back analysis settings
12. **Analysis Controls** - Run analysis button
13. **ROIs** - ROI selection list with All/None buttons

### Bottom Panel (After Analysis)

After running analysis, a tabbed results panel appears below the viewers:

- **Raw Fluorescence (F)** - Original extracted traces
- **ΔF/F₀** - Normalized traces
- **Peak + AUC** - Peak amplitude and area under curve
- **Event FWHM** - Event width at half maximum
- **Event Raster** - Temporal event display
- **Rise Time** - Event onset kinetics
- **Time To Peak** - Latency to peak
- **Decay t₁/₂** - Decay half-time
- **Decay tau** - Exponential decay time constant (if enabled)
- **Rate Of Rise** - Peak rise rate
- **TG Leak** - Thapsigargin leak metrics (if enabled)
- **Ca Add-Back** - Calcium add-back metrics (if enabled)

---

## 5. Loading Data

### Supported File Formats

Ca²⁺tch-One currently supports:
- **Nikon ND2 files** only
- Maximum file size: **700 MB** per upload

### Loading the ROI Source Dataset

1. Click the **"Load ROI Source"** button in the top header
2. Navigate to your ND2 file in the file browser dialog
3. Select the file and click "Open"
4. Wait for the upload and processing to complete
5. The source viewer will display the first frame of the first channel

**Status Updates:**
- Progress indicator appears during upload
- File name displays in header once loaded
- Memory usage updates in status bar

### Loading the Measurement Dataset

1. Click the **"Load Measurement"** button in the top header
2. Select your measurement ND2 file
3. Wait for processing
4. The measurement viewer will become active

**Important Notes:**
- Source and measurement files must have **matching image dimensions** (width × height)
- Files can have different:
  - Number of frames
  - Number of channels
  - Frame rates
  - Acquisition times

### File Information Display

Once loaded, the header shows:
```
ROI source: filename.nd2 | Measurement: filename.nd2
mem: XXX MB rss · XX KB nd2 · X sess
```

Where:
- **rss** = Resident set size (application memory usage)
- **nd2** = Size of loaded ND2 data
- **sess** = Number of active sessions

---

## 6. Image Viewing & Display Controls

### Frame Navigation

**Frame Slider:**
- Drag the slider to navigate through time
- Current frame number and total frames display below slider
- Format: `Frame N / Total`

**Time Display:**
- Shows elapsed time for the current frame
- Format depends on frame rate metadata

### Channel Selection

**Channel Dropdown:**
- Lists all available channels in the dataset
- Automatically populated from ND2 metadata
- Channel names are read from file (e.g., "GFP 488nm", "Fura-2 340nm")

**Automatic Colormap Inference:**
The application automatically selects colormaps based on channel names:

| Channel Name Keywords | Assigned Colormap |
|----------------------|-------------------|
| Brightfield, BF, Transmission, Phase, DIC | Gray |
| DAPI, Hoechst, Pacific Blue, 405 | Blue |
| CFP, Cyan, Fura-2 340, Fluo-3, Indo-1 | Cyan |
| YFP, Venus, Fura-2 380 | Magenta |
| GFP, EGFP, FITC, Fluo-4, Cal-520, Oregon Green, 488 | Green |
| tdTomato, dsRed, TRITC, Texas Red, Orange | Orange |
| mCherry, RFP, Scarlet, Cy3, Cy5, Alexa 594, 561 | Red |

### Contrast Controls

**Manual Contrast Adjustment:**

1. **Contrast Min:** Lower bound of display range (spinbox)
2. **Contrast Max:** Upper bound of display range (spinbox)

Default range: 0 – 65535 (16-bit)

**Auto Contrast:**

Click the **"Auto"** button to automatically adjust contrast based on image statistics.

**Percentile Controls:**
- **Low percentile:** Default 1%
  - Pixels below this percentile are clipped to minimum
  - Lower values = darker shadows
- **High percentile:** Default 99.5%
  - Pixels above this percentile are clipped to maximum
  - Higher values = brighter highlights

**Example Settings:**
- **Standard:** 1% – 99.5% (recommended for most data)
- **High dynamic range:** 0.1% – 99.9% (preserve extreme values)
- **Noisy data:** 2% – 99% (clip noise outliers)

### Colormap Selection

**Available Colormaps:**
- **Green (GFP)** - Default for green fluorophores
- **Red (mCherry)** - For red fluorescent proteins
- **Orange (tdTomato)** - For orange/red proteins
- **Cyan (CFP)** - For cyan fluorescent protein and Fura-2 340nm
- **Magenta** - For Fura-2 380nm and yellow fluorophores
- **Blue (DAPI)** - For nuclear stains
- **Rainbow (ratio)** - For ratio imaging (automatically selected for Fura-2)
- **Gray** - For brightfield or generic display
- **Hot** - Black-red-yellow-white gradient

**Colormap Behavior:**
- Colormaps affect **display only** - they do not modify data
- Each channel can have an independent colormap
- Ratio display automatically uses Rainbow colormap

### Ratio Display (Fura-2 Imaging)

For Fura-2 ratio imaging:

1. Load a dataset with two channels (e.g., 340 nm and 380 nm)
2. The app automatically detects Fura-2 channels based on naming
3. Use the channel dropdown to select "Ratio 340/380"
4. The viewer displays the computed ratio image
5. Ratio colormap (Rainbow) is automatically applied

**Manual Ratio Configuration:**
- Requires two different channels to be selected
- Numerator and denominator must be different
- Ratio = Channel A ÷ Channel B (pixel-wise division)

### ROI Overlay Display

When ROIs are detected or copied:
- ROI outlines are drawn on the image
- Each ROI is color-coded (20 distinct colors cycling)
- ROI ID numbers are displayed at ROI centroids
- Selected ROIs are highlighted
- Unchecked ROIs are shown with reduced opacity

---

## 7. ROI Detection

ROI detection in Ca²⁺tch-One uses a projection-based approach with watershed segmentation. This method is **not activity-based** - it detects cells based on their average appearance, not their calcium dynamics.

### When to Use ROI Source Dataset

The ROI source should be:
- A high-quality reference recording
- Representative of cell morphology
- Same field of view as measurement datasets
- Can be the measurement dataset itself if quality is sufficient

### Detection Workflow

1. Load ROI source dataset
2. Adjust detection parameters
3. Click **"Detect Cells On Source"**
4. Review detected ROIs
5. Refine if necessary using manual tools

### Detection Parameters

#### Projection Type

**Purpose:** Create a 2D summary image from the time series.

**Options:**
- **Mean (Default):** Average signal across all frames
  - Best for: Stable fluorescent markers
  - Advantage: Reduces temporal noise
  - Use when: Cells are evenly illuminated

- **Max:** Maximum intensity projection
  - Best for: Dim cells that light up occasionally
  - Advantage: Captures transient bright signals
  - Use when: Cell visibility varies over time

- **Std:** Standard deviation projection
  - Best for: Activity-based detection
  - Advantage: Highlights cells with dynamic signals
  - Use when: You want to detect only active cells

**Recommendation:** Start with **Mean** for most experiments.

---

#### Threshold Adjustment

**Range:** 0.1 – 3.0  
**Default:** 1.0

**Purpose:** Multiplier on the automatic detection threshold.

**Effect:**
- **> 1.0:** Stricter threshold → fewer ROIs detected
- **< 1.0:** More permissive → more ROIs detected

**When to Adjust:**
- **Increase (1.2 – 1.5)** if detecting too much background
- **Decrease (0.7 – 0.9)** if missing dim cells
- Fine-tune in **0.1 increments**

**Warning:** Values < 0.5 or > 2.0 may produce unreliable results.

---

#### Smooth Sigma (pixels)

**Range:** 0 – 10 pixels  
**Default:** 2.0

**Purpose:** Gaussian blur radius applied before detection.

**Effect:**
- **Higher values:** Smoother detection, may merge adjacent cells
- **Lower values:** More sensitive to noise, better separation

**Guidelines:**
| Cell Spacing | Recommended Sigma |
|--------------|-------------------|
| Well-separated (> 5 px apart) | 2.0 – 3.0 |
| Moderate spacing (3-5 px) | 1.0 – 2.0 |
| Touching cells | 0.5 – 1.0 |

**Warning:** Sigma > 5 can cause loss of small cells.

---

#### Background Radius (pixels)

**Range:** 5 – 200 pixels  
**Default:** 30

**Purpose:** Rolling-ball background subtraction radius.

**Effect:** Removes slowly-varying background illumination.

**How to Choose:**
- Set to **larger than the widest cell diameter**
- Typical values: 20-50 pixels for 10-20 µm cells at 0.5 µm/pixel
- Formula: `radius ≥ (cell diameter in µm) / (pixel size in µm/px)`

**Example:**
- Cell diameter: 20 µm
- Pixel size: 0.5 µm/px
- Minimum radius: 20 / 0.5 = **40 pixels**

---

#### Seed Sigma (pixels)

**Range:** 0 – 5 pixels  
**Default:** 1.0

**Purpose:** Smoothing applied to the distance transform before finding watershed seeds.

**Effect:**
- **Higher values:** Fewer seeds, more merging of nearby cells
- **Lower values:** More seeds, better separation of touching cells

**When to Adjust:**
- **Increase (1.5 – 2.0)** if cells are being over-segmented
- **Decrease (0.5 – 0.8)** if touching cells are not separated

---

#### Min Size (px²)

**Range:** 10 – 10,000 pixels²  
**Default:** 100

**Purpose:** Minimum ROI area. Smaller regions are discarded.

**Effect:** Filters out noise and debris.

**How to Choose:**

Calculate minimum expected cell area:
```
Min area (px²) = (cell diameter in µm / pixel size)²
```

**Example:**
- Cell diameter: 10 µm (small cell)
- Pixel size: 0.5 µm/px
- Min size: (10 / 0.5)² = 20² = **400 px²**

**Recommendation:** Set to **50-70%** of calculated minimum to allow for irregular shapes.

---

#### Max Size (px²)

**Range:** 100 – 50,000 pixels²  
**Default:** 10,000

**Purpose:** Maximum ROI area. Larger regions are discarded.

**Effect:** Filters out merged cell clusters and artifacts.

**How to Choose:**

Calculate maximum expected cell area:
```
Max area (px²) = 2 × (cell diameter in µm / pixel size)²
```

**Warning:** Merged cells will be rejected if they exceed this limit.

---

#### Compactness

**Range:** 0.0 – 1.0  
**Default:** 0.001

**Purpose:** Watershed compactness penalty (roundness enforcement).

**Effect:**
- **0.0:** No shape constraint (allows elongated ROIs)
- **1.0:** Maximum circularity enforcement

**When to Adjust:**
- **Increase (0.01 – 0.1)** if detecting elongated artifacts instead of round cells
- **Keep low (< 0.01)** for irregularly shaped cells or neurons

**Warning:** High compactness (> 0.1) can shrink or split real cells.

---

#### Keep Edge ROIs

**Options:** Checked / Unchecked  
**Default:** Unchecked

**Purpose:** Retain ROIs that touch the image border.

**Effect:**
- **Checked:** Keep partially visible cells at edges
- **Unchecked:** Discard edge-touching ROIs

**When to Enable:**
- Your region of interest includes the image border
- You want to maximize cell count
- Edge cells are complete enough for analysis

**When to Disable:**
- Edge cells are truncated and unreliable
- You want to analyze only complete cells
- Avoiding partial ROI bias

---

### Detection Pipeline Summary

The detection algorithm executes these steps:

1. **Projection:** Compute Mean/Max/Std across time
2. **Normalization:** Robust intensity scaling using percentiles
3. **Smoothing:** Gaussian blur with specified sigma
4. **Background Removal:** Rolling-ball (white top-hat) filter
5. **Thresholding:** Automatic threshold with adjustment multiplier
6. **Binary Cleanup:** Morphological opening and closing
7. **Distance Transform:** Compute distance from background
8. **Seed Detection:** Find local maxima in smoothed distance map
9. **Watershed:** Segment touching cells using compactness constraint
10. **Seed Expansion:** Grow seeds to cell boundaries
11. **Size Filtering:** Apply min/max area filters
12. **Edge Filtering:** Remove edge-touching ROIs if disabled
13. **Contour Extraction:** Convert labels to polygon outlines

---

### Troubleshooting Detection

| Problem | Solution |
|---------|----------|
| Too many small artifacts detected | Increase **Min size** or **Threshold adj.** |
| Missing dim cells | Decrease **Threshold adj.** or use **Max projection** |
| Cells merged together | Decrease **Smooth sigma** and **Seed sigma** |
| Over-segmentation (cells split) | Increase **Seed sigma** or **Compactness** |
| Elongated artifacts detected | Increase **Compactness** to 0.01-0.05 |
| Background patches detected | Increase **BG radius** or **Threshold adj.** |

---

## 8. Manual ROI Editing

After automatic detection, you can refine ROIs using manual tools.

### Measure On Source

**Purpose:** Measure distances on the source image.

**Usage:**
1. Click **"Measure On Source"** button
2. Click on the image to set the first point
3. Click again to set the second point
4. Distance is displayed in pixels
5. Click anywhere to exit measurement mode

**Applications:**
- Calibrate pixel size
- Measure inter-cell distances
- Verify cell sizes

---

### Add ROI On Source

**Purpose:** Manually draw a new ROI region.

**Usage:**
1. Click **"Add ROI On Source"** button
2. Click on the image to place polygon vertices
3. Click near the first point to close the polygon
4. ROI is validated and added to the list

**Requirements:**
- Polygon must contain **at least 3 pixels**
- Must **not overlap** existing ROIs
- Must be entirely within image bounds

**Tips:**
- Use for cells missed by automatic detection
- Place vertices carefully to trace cell boundaries
- Press Escape to cancel polygon drawing

---

### Merge 2 ROIs

**Purpose:** Combine two adjacent ROIs into one.

**Usage:**
1. Select **exactly two ROIs** from the ROI list
   - Click first ROI in list to select
   - Hold Ctrl/Cmd and click second ROI
2. Click **"Merge 2 ROIs"** button
3. The two ROIs are combined into a single region

**Requirements:**
- Exactly 2 ROIs must be selected (no more, no less)
- ROIs must be **touching** (adjacent pixels)

**When to Use:**
- Cell was incorrectly split by detection
- Two detected regions belong to the same cell
- Manual correction of over-segmentation

---

### Delete ROIs

**Purpose:** Remove unwanted ROIs.

**Usage:**
1. Select one or more ROIs from the ROI list
   - Single click to select one
   - Ctrl/Cmd + click to select multiple
   - Shift + click to select range
2. Click **"Delete ROIs"** button
3. Selected ROIs are permanently removed

**Common Uses:**
- Remove artifacts (debris, non-cellular objects)
- Exclude dead or unhealthy cells
- Clean up edge ROIs
- Remove overlapping detections

**Warning:** Deletion cannot be undone without re-running detection.

---

### Important Notes on ROI Editing

⚠️ **Analysis Invalidation:**
- Any ROI edit (add, merge, delete) **clears downstream analysis results**
- You must re-run **"Copy ROIs To Measurement"** after editing
- Then re-run **"Analyze Measurement File"**

⚠️ **Edit on Source Only:**
- ROI editing tools work **only** on the ROI source dataset
- You cannot directly edit ROIs on the measurement dataset
- Transfer edited ROIs using "Copy ROIs To Measurement"

---

## 9. ROI Transfer & Selection

### Copying ROIs to Measurement

Once ROIs are finalized on the source dataset, transfer them to the measurement dataset for analysis.

**Steps:**
1. Ensure both source and measurement datasets are loaded
2. Verify image dimensions match (width × height)
3. Click **"Copy ROIs To Measurement"** button
4. ROIs appear on the measurement viewer
5. ROI list populates in the sidebar

**Important:**
- Source and measurement **must have matching dimensions**
- Different frame counts and channel counts are OK
- ROI coordinates are copied exactly (pixel-for-pixel transfer)
- Previous analysis results are cleared

---

### ROI Selection for Analysis

After copying, the ROI list appears in the bottom-right sidebar.

**ROI List Features:**
- Checkbox for each ROI (include/exclude from analysis)
- ROI ID number
- Click to select/highlight ROI on image
- Multi-select with Ctrl/Cmd

**Selection Buttons:**
- **"All"** - Check all ROIs (include all in analysis)
- **"None"** - Uncheck all ROIs (exclude all from analysis)

**Selection Behavior:**
- Only **checked** ROIs are analyzed
- Unchecked ROIs are displayed but not measured
- Changing selection **invalidates** existing analysis results
- Must re-run analysis after changing selection

**When to Exclude ROIs:**
- Artifact regions that passed detection
- Cells outside the experimental field
- Unhealthy or dying cells
- ROIs with poor measurement quality

---

## 10. Analysis Configuration

### Background Correction Mode

**Purpose:** Subtract non-specific fluorescence before trace extraction.

#### Option 1: None

**Effect:** No background subtraction.

**When to Use:**
- Pre-processed data with background already subtracted
- Very sparse preparations with negligible background
- Testing or comparison purposes

**Warning:** Raw fluorescence without background correction can produce:
- Overestimated baseline (F₀)
- Underestimated ΔF/F₀
- Inaccurate event detection

---

#### Option 2: Auto (Default)

**Effect:** Automatic per-frame background estimation from non-cell pixels.

**How It Works:**
1. Exclude all ROI pixels
2. Exclude a surrounding halo (Cell margin)
3. Compute background from remaining pixels
4. Subtract per-frame background value

**Parameters:**

**BG Percentile:** (Default: 50%)
- Percentile of background pixels used as the background value
- **50%:** Median (default) - robust to bright artifacts
- **25%:** Lower quartile - more conservative (darker background estimate)
- **Higher values (60-75%):** Liberal estimate (includes more background signal)

**Effect on ΔF/F₀:**
- Lower percentile → larger ΔF/F₀ (more conservative background → larger signal)
- Higher percentile → smaller ΔF/F₀ (more liberal background → smaller signal)

**When to Adjust:**
- **Use 25-40%** for:
  - Sparse preparations
  - Autofluorescent debris
  - Non-uniform illumination
- **Use 50-60%** for:
  - Standard preparations (default)
  - Clean background
- **Use 60-75%** for:
  - Dense cell cultures
  - High background signal

**Cell Margin (pixels):** (Default: 5)
- Dilation radius around each ROI before background estimation
- Excludes cell fluorescence halo due to PSF spread

**How to Choose:**
- **Low magnification (10×):** 3-5 pixels
- **Medium magnification (20×):** 5-10 pixels
- **High magnification (40×-60×):** 10-15 pixels

**Warning:** Including cell halos in background estimation:
- Over-estimates background
- Under-corrects cell traces
- Reduces apparent ΔF/F₀

---

#### Option 3: Manual ROI

**Effect:** User-defined background region.

**How to Use:**
1. Select "Manual ROI" mode
2. Click **"Draw Background"** button (appears after mode selection)
3. Draw a polygon on the measurement image
4. Background is computed from pixels inside the polygon

**Polygon Requirements:**
- Must contain non-cell pixels after halo exclusion
- Should avoid ROIs and bright artifacts
- Typical size: 100-500 pixels

**Advantages:**
- Full control over background region
- Can avoid local artifacts
- Can select region-specific background

**Disadvantages:**
- Requires user input
- May not represent global background
- Single region may not capture spatial variation

**When to Use:**
- Non-uniform illumination
- Localized background artifacts
- Specific background region is known

---

### Analysis Mode

#### Single Channel (Default)

**Effect:** Analyze raw fluorescence from one channel.

**Output:** ΔF/F₀ (normalized fluorescence change)

**When to Use:**
- Single-wavelength indicators (GCaMP, jRGECO1a, etc.)
- Fluo-4, Cal-520, Calcium Green
- Any non-ratiometric fluorophore

**Normalization:**
```
ΔF/F₀ = (F - F₀) / F₀
```
Where:
- F = fluorescence at each time point
- F₀ = mean fluorescence during baseline window

---

#### Fura-2 Ratio

**Effect:** Compute ratiometric calcium indicator traces.

**Output:** ΔR/R₀ (normalized ratio change)

**When to Use:**
- Fura-2 AM or Fura-2 salt
- Indo-1
- Other ratiometric indicators

**Requirements:**
- At least **two channels** (numerator and denominator)
- Channels must be **different**
- Typically 340 nm / 380 nm for Fura-2

**Channel Detection:**
- Automatic: App detects "340" and "380" in channel names
- Manual: Select numerator and denominator channels manually

**Normalization:**
```
R = Channel₁ / Channel₂  (pixel-wise ratio)
ΔR/R₀ = (R - R₀) / R₀
```

**Advantages of Ratio Imaging:**
- Corrects for:
  - Uneven dye loading
  - Cell thickness variations
  - Photobleaching
  - Movement artifacts
- Provides quantitative calcium levels (if calibrated)

---

### Baseline & Integration Windows

**Purpose:** Define time windows for normalization and analysis.

#### Baseline Start Frame

**Default:** 0

**Purpose:** Start of baseline window for computing F₀ or R₀.

**How to Choose:**
- Select a stable period **before** stimulation
- Minimum **3-5 seconds** of data recommended
- Avoid periods with spontaneous activity

**Example:**
- Stimulation at frame 100
- Frame rate: 10 Hz
- Baseline: Frames 0-80 (8 seconds before stimulation)

---

#### Baseline End Frame

**Default:** 0

**Purpose:** End of baseline window.

**Calculation:**
```
F₀ = mean(F[baseline_start : baseline_end])
```

**Warning:** Setting baseline_end ≤ baseline_start will cause an error.

---

#### Window Start Frame

**Default:** 0

**Purpose:** Start of analysis window.

**When to Use:**
- Exclude pre-stimulation period from event detection
- Focus analysis on a specific time window
- Skip initial settling period

**Example:**
- Analyze only post-stimulation period
- Set window_start = stimulation frame

---

#### Window End Frame

**Default:** 0  
**Special:** If set to 0, analysis extends to the **last frame**.

**Purpose:** End of analysis window.

**When to Use:**
- Exclude washout or recovery period
- Limit analysis to stimulation response
- Define specific response window

**Example:**
- Stimulation: Frames 100-200
- Set window_start = 100, window_end = 200

---

### Signal Processing

#### Photobleach Correction

**Purpose:** Correct for fluorescence decay due to photobleaching.

**Options:**

1. **None (Default):**
   - No correction applied
   - Use when: Short recordings (< 1 minute) or pre-bleached samples

2. **Linear:**
   - Fit straight line to trace
   - Subtract linear trend
   - Use when: Short-to-moderate recordings with slow bleaching

3. **Single Exponential:**
   - Fit exponential decay: F(t) = A × exp(-B×t) + C
   - Subtract exponential trend
   - Use when: Long recordings with significant bleaching

**How It Works:**
1. Fit model to entire trace
2. Compute fitted baseline trend
3. Subtract trend while preserving mean baseline level
4. Apply normalization (ΔF/F₀ or ΔR/R₀)

**When to Use Correction:**
- Visible fluorescence decay over time
- Baseline drift in ΔF/F₀ traces
- Long imaging sessions (> 5 minutes)

**When to Skip:**
- Short recordings (< 1 minute)
- Stable fluorescence
- Ratiometric indicators (less susceptible to bleaching)

**Warning:** Aggressive correction (exponential) on stable data can introduce artifacts.

---

### Event Detection Settings

#### Event Threshold (×MAD)

**Range:** 0.5 – 10  
**Default:** 2.0

**Purpose:** Threshold for detecting calcium transients above baseline noise.

**Formula:**
```
Threshold = baseline_median + (N × MAD)
```
Where MAD = Median Absolute Deviation (robust noise estimate)

**Effect:**
- **Higher values (3-5):** More conservative - detects only large, clear events
- **Lower values (1-2):** More sensitive - detects smaller events, more noise

**Guidelines:**
| Data Quality | Recommended Threshold |
|--------------|----------------------|
| Clean, low noise | 1.5 – 2.0 |
| Moderate noise | 2.0 – 3.0 |
| High noise or sparse events | 3.0 – 5.0 |

**MAD Advantages:**
- More robust than standard deviation
- Insensitive to outliers
- Works well with non-Gaussian noise

---

#### Duration Width (%)

**Range:** 10 – 90%  
**Default:** 50% (FWHM)

**Purpose:** Percentage of peak amplitude used to measure event duration.

**Effect:**
- **50%:** Full Width at Half Maximum (FWHM) - standard
- **Lower values (20-30%):** Longer reported durations
- **Higher values (70-80%):** Shorter reported durations

**Measurement:**
```
Duration = time where signal > baseline + (width_fraction × peak_amplitude)
```

**Use Cases:**
- **FWHM (50%):** Standard for most applications
- **Lower (20-30%):** When interested in event "envelope"
- **Higher (70-80%):** When interested in peak duration only

---

#### Onset Threshold (%)

**Range:** 5 – 50%  
**Default:** 10%

**Purpose:** Percentage of peak amplitude used to define rise time onset.

**Effect:**
- **Lower values (5-10%):** Earlier onset, longer rise time
- **Higher values (20-30%):** Later onset, shorter rise time

**Measurement:**
```
Rise time = time from (baseline + onset_fraction × peak) to peak
```

**Use Cases:**
- **10%:** Standard - captures initial rise phase
- **20%:** Steeper rise time - excludes slow initial rise
- **5%:** Full rise - includes very early rise phase

---

#### Compute Decay Tau

**Options:** Checked / Unchecked  
**Default:** Unchecked

**Purpose:** Fit mono-exponential decay to each event's falling phase.

**Model:**
```
F(t) = A × exp(-t / τ) + C
```
Where τ is the decay time constant.

**Effect:**
- **Checked:** Fit exponential to each event decay, report τ
- **Unchecked:** Only compute decay half-time (t₁/₂)

**When to Enable:**
- Interested in decay kinetics
- Comparing decay rates between conditions
- Need exponential time constant for modeling

**Performance Note:**
- Adds computation time per event
- May fail for events with incomplete decays
- Requires clean, exponential decay phase

---

## 11. Running Analysis

### Pre-Analysis Checklist

Before clicking **"Analyze Measurement File"**, ensure:

✓ Measurement dataset is loaded  
✓ ROIs have been copied to measurement  
✓ At least one ROI is checked for analysis  
✓ Background correction mode is configured  
✓ Baseline window is set (start < end)  
✓ Analysis window is set (or 0 for full trace)  
✓ Event detection parameters are configured

---

### Running the Analysis

1. Click **"Analyze Measurement File"** button in the sidebar
2. Progress indicator appears
3. Analysis runs in the background
4. Results populate in bottom panel tabs
5. Status updates when complete

**Processing Steps:**
1. Extract raw fluorescence from each ROI
2. Compute background trace (if enabled)
3. Subtract background from ROI traces
4. Apply photobleach correction (if enabled)
5. Compute baseline (F₀ or R₀)
6. Normalize traces (ΔF/F₀ or ΔR/R₀)
7. Detect events above threshold
8. Compute event metrics
9. Run assay analysis (if enabled)
10. Generate result plots

---

### Analysis Duration

Processing time depends on:
- Number of ROIs
- Number of frames
- Event detection complexity
- Assay analysis enabled

**Typical times:**
- 10 ROIs, 1000 frames: < 5 seconds
- 50 ROIs, 5000 frames: 10-30 seconds
- 100+ ROIs, long recordings: 1-2 minutes

---

### Analysis Validation

After analysis completes, check:

1. **Raw Fluorescence Tab:**
   - Traces look reasonable (positive values)
   - Background subtraction looks correct
   - No obvious artifacts

2. **ΔF/F₀ Tab:**
   - Baseline is near zero
   - Events are clearly visible
   - Normalization looks appropriate

3. **Event Raster Tab:**
   - Events detected at expected times
   - Event count seems reasonable
   - No excessive false positives

If results look incorrect:
- Adjust parameters
- Re-run analysis
- Check background correction
- Verify baseline window

---

## 12. Results & Metrics

After analysis, results are displayed in tabs below the viewers.

### Raw Fluorescence (F)

**Display:**
- Time (seconds) on X-axis
- Fluorescence (AU) on Y-axis
- One trace per ROI
- Color-coded by ROI ID

**Content:**
- Background-corrected raw fluorescence
- Photobleach-corrected (if enabled)
- Before normalization

**Uses:**
- Verify background subtraction
- Check for artifacts
- Compare absolute signal levels

---

### ΔF/F₀ (or ΔR/R₀)

**Display:**
- Time (seconds) on X-axis
- Normalized change on Y-axis
- Baseline should be near zero
- Peaks represent calcium transients

**Content:**
- Normalized fluorescence change
- Standard format for comparing across cells
- Unit-less (fractional change)

**Interpretation:**
- ΔF/F₀ = 0: Baseline fluorescence
- ΔF/F₀ = 1: 100% increase over baseline
- Negative values: Below baseline (rare, may indicate noise)

---

### Peak + AUC

**Metrics Displayed:**

| ROI | Peak ΔF/F₀ | AUC (F·s) | Event Count |
|-----|------------|-----------|-------------|
| 1   | 2.34       | 145.2     | 3           |
| 2   | 1.87       | 98.5      | 2           |
| ... | ...        | ...       | ...         |

**Definitions:**

**Peak:** Maximum ΔF/F₀ during the analysis window
- **Units:** Dimensionless (fractional change)
- **Interpretation:** Magnitude of largest transient

**AUC:** Area Under Curve
- **Units:** F·seconds (fluorescence × time)
- **Interpretation:** Total calcium load over analysis window
- **Calculation:** Trapezoidal integration of ΔF/F₀ above baseline

**Event Count:** Number of detected transients
- **Criteria:** Peak amplitude > threshold
- **Uses:** Frequency analysis, activity index

---

### Event FWHM

**Full Width at Half Maximum**

**Display:**
- Distribution of event widths (histogram or violin plot)
- Per-ROI mean FWHM
- Per-event FWHM values

**Metrics:**

| ROI | Mean FWHM (s) | SD | Min | Max |
|-----|---------------|----|-----|-----|
| 1   | 3.2           | 0.8| 2.1 | 4.5 |
| ... | ...           |... | ... | ... |

**Interpretation:**
- **Shorter FWHM (< 2s):** Fast transients, rapid kinetics
- **Longer FWHM (> 5s):** Slow transients, prolonged calcium elevation
- **Variability:** Heterogeneity in response kinetics

---

### Event Raster

**Display:**
- X-axis: Time (seconds)
- Y-axis: ROI ID
- Marks: Individual event occurrences

**Sorting Options:**
- **ROI ID:** Numerical order
- **Event Count:** Most active cells first
- **First Event:** Earliest responder first
- **Peak Amplitude:** Strongest responder first

**Uses:**
- Visualize temporal activity patterns
- Identify synchronized events
- Detect wave propagation
- Compare response latencies

---

### Rise Time

**Definition:** Time from onset (e.g., 10% of peak) to peak.

**Metrics:**

| ROI | Mean Rise Time (s) | SD | Min | Max |
|-----|--------------------|----|-----|-----|
| 1   | 1.2                | 0.3| 0.8 | 1.7 |
| ... | ...                |... | ... | ... |

**Interpretation:**
- **Fast rise (< 1s):** Rapid calcium influx
- **Slow rise (> 3s):** Gradual accumulation or slow release

**Applications:**
- Compare kinetics between cell types
- Identify mechanisms (influx vs. release)

---

### Time To Peak

**Definition:** Time from event onset to peak amplitude.

**Similar to Rise Time but measured from absolute onset.**

**Uses:**
- Response latency analysis
- Propagation timing
- Synchrony assessment

---

### Decay t₁/₂

**Decay Half-Time**

**Definition:** Time for signal to decay from peak to 50% of peak amplitude.

**Metrics:**

| ROI | Mean t₁/₂ (s) | SD | Min | Max |
|-----|---------------|----|-----|-----|
| 1   | 2.5           | 0.6| 1.8 | 3.4 |
| ... | ...           |... | ... | ... |

**Interpretation:**
- **Fast decay (< 2s):** Efficient calcium removal
- **Slow decay (> 5s):** Impaired calcium handling or sustained release

---

### Decay Tau (Optional)

**Exponential Decay Time Constant**

**Only displayed if "Compute decay tau" is enabled.**

**Model:**
```
F(t) = A × exp(-t / τ) + C
```

**Metrics:**

| ROI | Mean τ (s) | SD | Min | Max |
|-----|------------|----|-----|-----|
| 1   | 3.1        | 0.7| 2.2 | 4.3 |
| ... | ...        |... | ... | ... |

**Interpretation:**
- τ is the time constant of exponential decay
- 1/τ = decay rate constant
- Smaller τ = faster decay

**Difference from t₁/₂:**
- t₁/₂ is a geometric measure (50% point)
- τ is a fitted exponential parameter
- Relationship: t₁/₂ ≈ 0.693 × τ (for pure exponential)

---

### Rate Of Rise

**Definition:** Maximum slope during the rising phase of each event.

**Units:** ΔF/F₀ per second

**Metrics:**

| ROI | Mean Rate (s⁻¹) | SD | Min | Max |
|-----|-----------------|----|----|-----|
| 1   | 0.85            | 0.2| 0.6| 1.2 |
| ... | ...             |... |... | ... |

**Interpretation:**
- **High rate:** Rapid calcium mobilization
- **Low rate:** Slow calcium accumulation

**Applications:**
- Quantify calcium influx kinetics
- Identify response phenotypes

---

### TG Leak (Thapsigargin Assay)

**Only displayed if TG assay is enabled (TG frame > 0).**

**Purpose:** Quantify store-operated calcium leak after thapsigargin treatment.

**Thapsigargin (TG):**
- SERCA pump inhibitor
- Depletes ER calcium stores
- Causes passive leak of residual ER calcium

**Assay Protocol:**
1. Baseline recording in calcium-free medium
2. Add thapsigargin at TG frame
3. Monitor slow calcium leak from ER
4. Quantify leak kinetics

**Metrics:**

| ROI | TG Peak | TG Slope (s⁻¹) | TG AUC |
|-----|---------|----------------|--------|
| 1   | 0.42    | 0.015          | 25.3   |
| ... | ...     | ...            | ...    |

**Definitions:**

**TG Peak:** Maximum ΔF/F₀ during TG leak window
- **Interpretation:** Total ER calcium content

**TG Slope:** Linear slope during leak phase
- **Units:** ΔF/F₀ per second
- **Interpretation:** Leak rate

**TG AUC:** Area under leak curve
- **Interpretation:** Total leaked calcium

---

### Ca Add-Back (Calcium Re-Addition Assay)

**Only displayed if add-back assay is enabled (Ca add-back frame > 0).**

**Purpose:** Quantify store-operated calcium entry (SOCE) after store depletion.

**Assay Protocol:**
1. Deplete stores with TG in calcium-free medium
2. Re-add external calcium at add-back frame
3. Monitor rapid calcium influx through SOC channels
4. Quantify entry kinetics

**Metrics:**

| ROI | Add-Back Peak | Add-Back Slope | Add-Back AUC | Latency (s) |
|-----|---------------|----------------|--------------|-------------|
| 1   | 3.25          | 0.42           | 187.4        | 1.2         |
| ... | ...           | ...            | ...          | ...         |

**Definitions:**

**Add-Back Peak:** Maximum ΔF/F₀ during entry window
- **Interpretation:** SOCE amplitude

**Add-Back Slope:** Maximum rate during influx
- **Units:** ΔF/F₀ per second
- **Interpretation:** Entry rate

**Add-Back AUC:** Total calcium entry
- **Interpretation:** Integrated SOCE

**Latency:** Time from calcium re-addition to response onset
- **Interpretation:** Activation delay

---

## 13. Export Options

After analysis, export results in multiple formats.

### Export Raw Trace CSV

**Button:** "Export Raw CSV"

**Content:**
- Plain text CSV file
- Column 1: Time (seconds)
- Columns 2-N: One column per ROI
- Values: Background-corrected fluorescence (or ratio)

**File Format:**
```csv
Time,ROI_1,ROI_2,ROI_3
0.0,1234.5,2345.6,3456.7
0.1,1240.2,2351.3,3462.1
...
```

**Uses:**
- Import into other analysis software
- Custom plotting in Python/R/MATLAB
- Sharing raw data

---

### Export Analysis Workbook

**Button:** "Export Analysis XLSX"

**Content:**
- Multi-sheet Excel workbook (.xlsx)
- Separate sheets for:
  - **Raw Traces:** Time + fluorescence
  - **Normalized Traces:** Time + ΔF/F₀
  - **Peak + AUC Summary:** Per-ROI metrics
  - **Event Widths:** FWHM data
  - **Rise Times:** Per-event rise times
  - **Decay Metrics:** t₁/₂ and optionally τ
  - **Event Raster:** Event timing data
  - **TG Leak:** If assay enabled
  - **Ca Add-Back:** If assay enabled

**Uses:**
- Comprehensive data archive
- Share complete analysis results
- Import into statistical software
- Create figures in Excel

---

### Export ROI Overlay PNG (Current Frame)

**Button:** "Export ROI Overlay (Frame)"

**Content:**
- PNG image of current viewer frame
- ROI outlines drawn on image
- ROI ID numbers labeled
- Contrast and colormap as displayed

**Uses:**
- Figure preparation
- Documentation
- Visual reference

---

### Export ROI Overlay PNG (Projection)

**Button:** "Export ROI Overlay (Projection)"

**Content:**
- PNG image of projection view (Mean/Max/Std)
- ROI outlines and IDs
- Useful for showing all cells at once

**Uses:**
- Publication figures
- Overview images
- Presentations

---

## 14. Advanced Features

### Session Management

**Automatic Session Cleanup:**
- Inactive sessions expire after **2 hours**
- Cleanup runs every **5 minutes**
- Prevents memory accumulation

**Session Data:**
- All data kept in memory (no project files saved to disk)
- Upload new files to start new session
- Close browser tab to end session immediately

**Multiple Users:**
- Each browser session is independent
- Concurrent sessions are supported
- Memory usage scales with number of active sessions

---

### Memory Management

**Memory Limits:**

**Default Memory Guard:** 1500 MB per process

**Environment Variable Override:**
```bash
export CACELLFIE_MAX_RSS_MB=3000
```

**Disable Memory Guard:**
```bash
export CACELLFIE_MAX_RSS_MB=0
```

**Warning:** Disabling the memory guard can lead to system instability if files are too large.

**Monitoring:**
- Real-time memory usage displayed in header
- Format: `mem: XXX MB rss · XX KB nd2 · X sess`

---

### File Size Limits

**Maximum Upload Size:** 700 MB per ND2 file

**Workaround for Large Files:**
- Split long recordings into segments
- Analyze segments separately
- Use binning or downsampling before export from NIS-Elements

---

### Keyboard Shortcuts

**Viewer Navigation:**
- **Arrow Keys:** Navigate frames
- **Page Up/Down:** Jump 10 frames
- **Home/End:** First/last frame

**ROI Selection:**
- **Click:** Select single ROI
- **Ctrl/Cmd + Click:** Multi-select
- **Shift + Click:** Range select

**Zoom:**
- **Scroll wheel:** Zoom in/out
- **Ctrl/Cmd + Scroll:** Fine zoom

---

### Fura-2 Ratio Calibration

For quantitative calcium measurements, calibrate ratio values:

**Kd Equation:**
```
[Ca²⁺] = Kd × (R - Rmin) / (Rmax - R) × (Sf2 / Sb2)
```

Where:
- Kd = 224 nM (Fura-2 dissociation constant at room temp)
- R = measured ratio (340/380)
- Rmin = ratio at zero calcium
- Rmax = ratio at saturating calcium
- Sf2, Sb2 = correction factors from calibration

**To Calibrate:**
1. Record cells with calcium-free buffer + EGTA (Rmin)
2. Record cells with high calcium + ionomycin (Rmax)
3. Measure 380 nm fluorescence for Sf2/Sb2

**Export Ratios:**
- Use "Export Raw CSV" to get ratio traces
- Apply calibration equation in external software

---

## 15. Troubleshooting

### Common Issues & Solutions

#### Problem: No Cells Detected

**Possible Causes:**
- Threshold too high
- Smooth sigma too large
- Min size too large
- Wrong projection type

**Solutions:**
1. Decrease **Threshold adj.** to 0.7-0.9
2. Try **Max projection** instead of Mean
3. Reduce **Smooth sigma** to 1.0
4. Reduce **Min size** to 50-100 px²
5. Check image quality in viewer (adjust contrast)

---

#### Problem: Too Many False Detections

**Possible Causes:**
- Threshold too low
- Min size too small
- Background not properly removed

**Solutions:**
1. Increase **Threshold adj.** to 1.2-1.5
2. Increase **Min size** to 200-400 px²
3. Increase **BG radius** to 40-50 pixels
4. Enable edge ROI filtering (uncheck "Keep edge ROIs")

---

#### Problem: Cells Merged Together

**Possible Causes:**
- Smooth sigma too high
- Seed sigma too high
- Compactness too high

**Solutions:**
1. Reduce **Smooth sigma** to 0.5-1.0
2. Reduce **Seed sigma** to 0.5-0.8
3. Set **Compactness** to 0.001 (default)
4. Manually split merged ROIs using Delete + Add tools

---

#### Problem: Negative ΔF/F₀ Values

**Possible Causes:**
- Background over-correction
- Baseline window includes transients
- Photobleaching not corrected

**Solutions:**
1. Check **BG percentile** - increase to 50-60%
2. Verify **baseline window** is truly at rest
3. Enable **photobleach correction** (Linear or Exponential)
4. Review raw traces for anomalies

---

#### Problem: No Events Detected

**Possible Causes:**
- Event threshold too high
- Analysis window excludes events
- Baseline incorrectly defined

**Solutions:**
1. Decrease **Event threshold** to 1.5-2.0 ×MAD
2. Verify **analysis window** includes stimulation period
3. Check **baseline window** is before activity
4. Review ΔF/F₀ traces - are peaks visible?

---

#### Problem: Too Many False-Positive Events

**Possible Causes:**
- Event threshold too low
- Noisy data
- Baseline noise

**Solutions:**
1. Increase **Event threshold** to 3.0-4.0 ×MAD
2. Check raw traces for artifacts
3. Smooth data with photobleach correction
4. Re-check background subtraction

---

#### Problem: Upload Fails

**Possible Causes:**
- File too large (> 700 MB)
- Network timeout
- Browser memory limit

**Solutions:**
1. Check file size - split if necessary
2. Refresh page and retry
3. Use a different browser
4. Restart server and clear cache

---

#### Problem: Analysis Button Disabled

**Possible Causes:**
- No measurement file loaded
- No ROIs copied to measurement
- No ROIs selected (all unchecked)

**Solutions:**
1. Verify measurement file is loaded (check header)
2. Click **"Copy ROIs To Measurement"**
3. Check at least one ROI in the ROI list
4. Refresh page if button remains disabled

---

#### Problem: ROI Copy Fails

**Error:** "Image dimensions must match"

**Cause:** Source and measurement datasets have different image sizes.

**Solutions:**
1. Verify both files have same width × height
2. Re-export files from NIS-Elements with matching dimensions
3. Use cropping tools to match dimensions before upload

---

#### Problem: Memory Error

**Error:** "Memory limit exceeded"

**Cause:** Dataset too large for current memory limit.

**Solutions:**
1. Close other browser tabs and applications
2. Increase memory limit:
```bash
export CACELLFIE_MAX_RSS_MB=3000
```
3. Restart server with new limit
4. Use smaller datasets or split files

---

## 16. Technical Specifications

### Supported Input Formats

| Format | Extension | Support Level |
|--------|-----------|---------------|
| Nikon ND2 | `.nd2` | Full support |
| TIFF series | `.tif`, `.tiff` | Not supported |
| Other formats | `.czi`, `.lif`, etc. | Not supported |

**Note:** Future versions may support additional formats.

---

### File Size & Memory Limits

| Parameter | Default | Configurable |
|-----------|---------|--------------|
| Max upload size | 700 MB | No |
| Process memory limit | 1500 MB | Yes (env var) |
| Session timeout | 2 hours | No |
| Cleanup interval | 5 minutes | No |

---

### Detection Algorithm

**Method:** Watershed segmentation with projection-based seeding

**Pipeline:**
1. Temporal projection (Mean/Max/Std)
2. Robust normalization (percentile-based)
3. Gaussian smoothing
4. Rolling-ball background subtraction (white top-hat)
5. Automatic thresholding (Otsu-based with adjustment)
6. Morphological cleanup
7. Distance transform
8. Gaussian smoothing of distance map
9. Local maxima detection (watershed seeds)
10. Watershed segmentation with compactness
11. Size filtering
12. Edge filtering
13. Contour extraction

**Dependencies:**
- NumPy
- SciPy
- scikit-image

---

### Analysis Algorithms

**Background Correction:**
- Auto mode: Percentile-based per-frame estimation
- Manual mode: User-defined polygon region
- Cell margin exclusion via morphological dilation

**Normalization:**
- Single channel: ΔF/F₀ = (F - F₀) / F₀
- Ratio: ΔR/R₀ = (R - R₀) / R₀

**Photobleach Correction:**
- Linear: First-order polynomial fit
- Exponential: A×exp(-B×t) + C model

**Event Detection:**
- Threshold: Median + N×MAD (Median Absolute Deviation)
- Peak finding: SciPy `find_peaks`
- Width estimation: Signal crossings at specified fraction

**Kinetics:**
- Rise time: Time from onset to peak
- Decay t₁/₂: Time to 50% decay
- Decay τ: Exponential fit (optional)
- Rate of rise: Maximum derivative during rise

---

### System Architecture

**Frontend:**
- Vanilla JavaScript (ES6+)
- HTML5 + CSS3
- Canvas-based image rendering
- Interactive SVG overlays

**Backend:**
- FastAPI (Python)
- Uvicorn ASGI server
- In-memory session storage
- RESTful API endpoints

**Dependencies:**
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `nd2` - ND2 file reader
- `numpy` - Numerical computation
- `scipy` - Scientific algorithms
- `scikit-image` - Image processing
- `Pillow` - Image I/O
- `psutil` - System monitoring
- `slowapi` - Rate limiting

---

### API Endpoints (For Developers)

**Session Management:**
- `GET /` - Serve frontend HTML
- `POST /upload-source` - Upload ROI source file
- `POST /upload-measurement` - Upload measurement file

**Imaging:**
- `GET /frame-source` - Fetch source frame image
- `GET /frame-measurement` - Fetch measurement frame image
- `GET /projection-source` - Build projection image

**ROI Operations:**
- `POST /detect-rois` - Run cell detection
- `POST /add-roi` - Add manual ROI
- `POST /merge-rois` - Merge two ROIs
- `POST /delete-rois` - Delete selected ROIs
- `POST /copy-rois` - Transfer ROIs to measurement

**Analysis:**
- `POST /analyze` - Run full analysis pipeline
- `GET /plot-{metric}` - Fetch result plots

**Export:**
- `GET /export-traces-csv` - Download CSV
- `GET /export-analysis-xlsx` - Download workbook
- `GET /export-overlay-png` - Download overlay image

---

### Browser Compatibility

**Tested Browsers:**
- Chrome 90+ ✓
- Firefox 88+ ✓
- Safari 14+ ✓
- Edge 90+ ✓

**Requirements:**
- ES6 JavaScript support
- Canvas API
- SVG rendering
- Fetch API
- File API

---

### Performance Benchmarks

**Detection Speed:**
- 512×512 image, 1000 frames: ~2-5 seconds
- 1024×1024 image, 2000 frames: ~5-10 seconds

**Analysis Speed:**
- 10 ROIs, 1000 frames: ~3 seconds
- 50 ROIs, 5000 frames: ~15 seconds
- 100 ROIs, 10000 frames: ~45 seconds

**Memory Usage:**
- 512×512×1000 frames (2 channels): ~500 MB
- 1024×1024×2000 frames (2 channels): ~2 GB

*Benchmarks on Intel i7-8700, 16 GB RAM, Python 3.12*

---

## Appendix A: Parameter Quick Reference

### Detection Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Projection | Mean/Max/Std | Mean | Temporal projection type |
| Threshold adj. | 0.1-3.0 | 1.0 | Detection threshold multiplier |
| Smooth σ | 0-10 px | 2.0 | Gaussian blur radius |
| BG radius | 5-200 px | 30 | Rolling-ball radius |
| Seed σ | 0-5 px | 1.0 | Distance map smoothing |
| Min size | 10-10000 px² | 100 | Minimum ROI area |
| Max size | 100-50000 px² | 10000 | Maximum ROI area |
| Compactness | 0.0-1.0 | 0.001 | Circularity penalty |
| Keep edge ROIs | On/Off | Off | Keep border-touching ROIs |

---

### Analysis Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| BG mode | None/Auto/Manual | Auto | Background correction method |
| BG percentile | 0-100% | 50% | Background pixel percentile |
| Cell margin | 1-20 px | 5 | ROI halo exclusion radius |
| Analysis mode | Single/Ratio | Single | Fluorescence or ratio |
| Baseline start | Frame # | 0 | Start of baseline window |
| Baseline end | Frame # | 0 | End of baseline window |
| Window start | Frame # | 0 | Start of analysis window |
| Window end | Frame # | 0 | End of analysis window |
| Photobleach | None/Linear/Exp | None | Bleach correction method |
| Event threshold | 0.5-10 ×MAD | 2.0 | Event detection threshold |
| Duration width | 10-90% | 50% | Event width fraction (FWHM) |
| Onset threshold | 5-50% | 10% | Rise time onset fraction |
| Compute decay τ | On/Off | Off | Fit exponential decay |

---

## Appendix B: Glossary

**AUC:** Area Under Curve - integrated signal over time.

**Baseline (F₀, R₀):** Mean signal during pre-stimulation window.

**Compactness:** Watershed parameter enforcing circular ROI shape.

**ΔF/F₀:** Normalized fluorescence change: (F - F₀) / F₀.

**ΔR/R₀:** Normalized ratio change: (R - R₀) / R₀.

**FWHM:** Full Width at Half Maximum - event duration at 50% of peak.

**MAD:** Median Absolute Deviation - robust noise estimate.

**ND2:** Nikon's proprietary microscopy file format.

**Photobleaching:** Fluorescence loss due to photochemical damage.

**Projection:** 2D summary image from 3D (x, y, t) stack.

**PSF:** Point Spread Function - optical blur around fluorescent objects.

**ROI:** Region Of Interest - a detected or manually defined cell region.

**SOCE:** Store-Operated Calcium Entry - influx through SOC channels.

**TG:** Thapsigargin - SERCA inhibitor used to deplete ER calcium.

**Watershed:** Segmentation algorithm that separates touching objects.

---

## Appendix C: Typical Workflows

### Workflow 1: Basic Calcium Imaging (GCaMP)

1. Load single-wavelength ND2 file as ROI Source
2. Set detection parameters:
   - Projection: Mean
   - Threshold: 1.0
   - Smooth σ: 2.0
   - Min size: 100 px²
3. Click "Detect Cells On Source"
4. Review and refine ROIs (delete artifacts)
5. Load same file as Measurement
6. Click "Copy ROIs To Measurement"
7. Configure analysis:
   - Mode: Single channel
   - Background: Auto (50%)
   - Baseline: Frames 0-50
   - Window: Frames 50-500
   - Event threshold: 2.0 ×MAD
8. Click "Analyze Measurement File"
9. Review traces and metrics
10. Export XLSX workbook

---

### Workflow 2: Fura-2 Ratio Imaging

1. Load Fura-2 ND2 (two channels: 340 nm, 380 nm) as ROI Source
2. Select 340 nm channel in viewer
3. Run detection (same as Workflow 1)
4. Load measurement Fura-2 file
5. Copy ROIs to measurement
6. Configure analysis:
   - Mode: **Fura-2 ratio**
   - Numerator: 340 nm
   - Denominator: 380 nm
   - Background: Auto (50%)
   - Photobleach: Linear (Fura-2 bleaches less, but linear is safe)
7. Run analysis
8. Review ΔR/R₀ traces
9. Export for calibration if needed

---

### Workflow 3: TG Leak + Ca Add-Back Assay

1. Load and detect ROIs (as Workflow 1)
2. Load assay recording as Measurement
3. Copy ROIs
4. Configure analysis:
   - Background: Auto (25% - conservative for long recording)
   - Baseline: Pre-TG frames (e.g., 0-100)
   - Window: Full recording
   - Photobleach: Single exponential
5. Configure TG assay:
   - TG frame: Frame where TG was added (e.g., 100)
   - TG end frame: Before Ca add-back (e.g., 500)
   - TG baseline: 5 seconds
   - TG slope: 5 seconds
6. Configure Ca add-back assay:
   - Ca add-back frame: Frame where Ca was restored (e.g., 550)
   - Add-back end frame: End of recording (0 = auto)
   - Add-back baseline: 5 seconds
   - Add-back slope: 5 seconds
7. Run analysis
8. Review TG Leak and Ca Add-Back tabs
9. Export XLSX with assay metrics

---

## Appendix D: Citation & Acknowledgments

**Software:**
Ca²⁺tch-One v1.1.0-alpha

**Dependencies:**
This software uses the following open-source libraries:
- FastAPI (MIT License)
- NumPy (BSD License)
- SciPy (BSD License)
- scikit-image (BSD License)
- nd2 (BSD License)

**How to Cite:**
If you use Ca²⁺tch-One in your research, please cite:
```
[Your citation format here]
```

---

## Appendix E: Support & Contact

**Questions & Issues:**
- GitHub Issues: [Repository URL]
- Email: [Contact email]

**Documentation Updates:**
- This manual corresponds to **v1.1.0-alpha**
- Check for updates at [Documentation URL]

**Contributing:**
- Contributions welcome via pull requests
- See CONTRIBUTING.md in repository

---

## Document Information

**Manual Version:** 1.0  
**Software Version:** v1.1.0-alpha  
**Last Updated:** April 2026  
**Author:** Ca²⁺tch-One Development Team

---

**End of User Manual**
