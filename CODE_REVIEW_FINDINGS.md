# Ca2tchOne Backend Code Review — Scientific / Quantitative Issues

**Scope:** `analysis.py`, `detection.py`, `image_io.py`, `main.py`, `requirements.txt`  
**Runtime versions found:** numpy 2.0.2, scipy 1.13.1, scikit-image 0.24.0, nd2 0.11.3, czifile 2019.7.2.2

---

## Legend
- **Critical** — can produce silently wrong scientific results.
- **Major** — can distort quantification or reduce reproducibility.
- **Minor** — edge cases, maintainability, or best-practice gaps.

---

## Critical

### 1. ~~Traces are clamped to non-negative after background subtraction~~ ✅ FIXED
**File:** `analysis.py:221` (removed)  
```python
corrected = np.maximum(corrected, 0.0)
```
**Problem:** After subtracting the background, any value below zero is clipped to zero. This destroys the noise distribution, biases the mean upward, and makes ΔF/F₀, AUC, peak and frequency estimates incorrect whenever the true signal is near background. Fluorescence after background subtraction can legitimately be negative because of photon shot noise.  
**Fix applied:** Clamp removed; `compute_delta_f` now rejects F₀ ≤ 0 instead of only F₀ == 0, preventing sign-inverted ΔF/F₀ values.

### 2. ~~F₀ for ΔF/F₀ uses a simple mean over the baseline window~~ ✅ FIXED
**File:** `analysis.py:302` (now uses percentile)  
```python
# old:
f0 = arr[start:end].mean()
# new:
f0 = float(np.percentile(baseline_window, baseline_percentile))
```
**Problem:** The mean is not robust to calcium transients or drift that may occur inside the user-selected baseline window. A single spike in the baseline window raises F₀ and suppresses all reported ΔF/F₀ amplitudes. Community tools (CaImAn, Suite2p, FLIKA) typically use a percentile (e.g., 8th–20th) or a median/percentile baseline.  
**Fix applied:** `compute_delta_f` now accepts `baseline_percentile` (default 8). The UI exposes an "F₀ percentile" field (0 = mean legacy mode, 8 = default, 50 = median). `AnalyzeParams` validates the percentile and the setting is exported in the analysis workbook.

### 3. ~~Unsupported image axes are silently dropped~~ ✅ FIXED
**File:** `image_io.py:200–220`  
```python
# old: dropped every unsupported axis by taking index 0
# new: singleton axes are dropped safely; non-singleton axes raise ValueError
```
**Problem:** Any axis other than T/C/Y/X (e.g., `S` scene, `R` rotation, `H` phase, `I` illumination, `M` mosaic, `B` block) was silently discarded by taking index 0. Multi-scene ND2/CZI files are common; the app analyzed only the first scene without telling the user.  
**Fix applied:** `_normalize_shape` now drops only singleton unsupported axes. Non-singleton unsupported axes raise a clear `ValueError` listing the offending axes. `upload_file` in `main.py` catches `ValueError` and returns HTTP 400 so the user sees a readable error instead of a generic 500.

---

## Major

### 4. ~~Decay metrics use the minimum of the falling phase as the baseline~~ ✅ FIXED
**Files:** `analysis.py:418–419`, `analysis.py:457–458`  
```python
# old:
baseline = float(np.nanmin(tw))
baseline_level = float(np.nanmin(window[peak_idx:]))
# new: pre-event baseline passed from compute_summary_metrics
```
**Problem:** Both decay τ and t½ estimated the baseline from the minimum value *after* the peak. If the tail was noisy, contained a secondary rise, or had not returned to baseline, the decay was underestimated.  
**Fix applied:** `_event_decay_tau` and `_event_decay_half_time` now accept a `baseline_level` argument. `compute_summary_metrics` passes the same pre-event baseline used for thresholding (`b_median` of the user-selected baseline window). If the supplied baseline is ≥ the peak, the functions return NaN. The old minimum-of-tail behavior is still available as a fallback when `baseline_level=None`.

### 5. ~~Rise rate is computed from raw finite differences without smoothing~~ ✅ FIXED
**File:** `analysis.py` (new `_max_rise_rate` helper)  
```python
# old:
slopes = np.diff(window)[good] / dt[good]
rise_rates[roi_id] = float(np.nanmax(slopes)) if slopes.size else 0.0
# new: Savitzky-Golay smoothed derivative via _max_rise_rate(window, x)
```
**Problem:** The maximum instantaneous slope between two adjacent frames was extremely sensitive to frame-to-frame noise and often reported physically implausible spikes.  
**Fix applied:** Added `_max_rise_rate`, which interpolates NaNs, applies a small Savitzky–Golay filter (window 5–7 frames, polyorder ≤3), and then computes the maximum slope on the smoothed trace. Falls back to the raw difference for very short traces. This produces a much more stable rate-of-rise estimate.

### 6. ~~Ratio denominator allows negative values through `abs(den) > eps`~~ ✅ FIXED
**File:** `analysis.py:279`  
```python
# old:
ratio = np.where(np.abs(den) > _eps, num / den, np.nan)
# new:
ratio = np.where(den > _eps, num / den, np.nan)
```
**Problem:** `np.abs(den) > eps` returned `True` for strongly negative denominators, producing a negative ratio. After removing the non-negative clamp (fix #1), negative corrected fluorescence is possible, so this guard became more important.  
**Fix applied:** The guard now requires `den > _eps`. Negative or near-zero denominators produce `NaN` instead of a physically meaningless negative ratio.

### 7. ~~Event FWHM baseline is not the true event baseline~~ ✅ FIXED
**File:** `analysis.py:381`  
```python
# old:
baseline_level = float(np.nanmin(window[:peak_idx + 1])) if peak_idx >= 0 else 0.0
# new: pre-event baseline passed from compute_summary_metrics
```
**Problem:** The baseline for the FWHM calculation was taken as the minimum value anywhere before the peak. Noise dips or incomplete decay from a previous event could distort the width.  
**Fix applied:** `_event_fwhm` now accepts a `baseline_level` argument. `compute_summary_metrics` passes the same pre-event baseline used for thresholding. If the baseline is ≥ the peak, the function returns `NaN`. The old minimum-before-peak behavior remains as a fallback when `baseline_level=None`.

### 8. ~~Onset detection and rise time depend on a global baseline~~ ✅ FIXED
**File:** `analysis.py`, `_event_onset_time`  
```python
# old: onset computed relative to global baseline_level
# new: two-step local-baseline onset search
```
**Problem:** The onset of every event was computed relative to the same global `baseline_level`. If baseline drifted between events, the 10 % crossing point was wrong.  
**Fix applied:** `_event_onset_time` now performs a two-step search:
1. Find a rough onset using the global baseline (or a short pre-peak median if none supplied).
2. Estimate a local baseline from a short window just before that rough onset.
3. Recompute the final onset relative to the local baseline.
This makes rise times robust to slow drift and residual signal from previous events. `compute_summary_metrics` now calls `_event_onset_time` with `baseline_level=None` to activate the local-baseline mode.

### 9. ~~`find_peaks` prominence is set equal to the noise MAD~~ ✅ FIXED
**File:** `analysis.py:681`  
```python
# old:
prominence = max(mad if baseline.size else 0.0, 1e-9)
# new:
prominence = max((threshold_std_multiplier * mad) if baseline.size else 0.0, 1e-9)
```
**Problem:** `height` was already `median + multiplier*MAD`. Setting `prominence ≈ MAD` added a redundant constraint that could reject small real events.  
**Fix applied:** Prominence now scales with `threshold_std_multiplier * mad`, consistent with the height threshold.

---

## Minor / Best-practice

### 10. ~~Stimulus-response slope is a raw linear fit to the first N frames~~ ✅ FIXED
**File:** `analysis.py:787–793`  
```python
# old:
x_s = x[:slope_end]
y_s = y[:slope_end]
# new: skip the immediate post-stimulus artifact frame when enough frames remain
start_idx = 1 if slope_end >= 3 else 0
x_s = x[start_idx:slope_end]
y_s = y[start_idx:slope_end]
```
**Problem:** The initial slope included the immediate post-stimulus frame, which often contains a perfusion/pipetting artifact. Additionally, always skipping frame 0 caused the slope to fall back to 0 for very short response windows (only 2 frames).  
**Fix applied:** The first post-stimulus frame is now excluded only when at least 3 frames are available, so 2-frame windows still produce a slope.

### 11. ~~Ratio projection is computed frame-wise then projected~~ ✅ FIXED
**File:** `image_io.py:266`  
```python
# Added docstring explaining the ratio-then-project convention
```
**Problem:** The frame-wise-ratio-then-project convention was not documented, so users could confuse it with project-then-ratio.  
**Fix applied:** Added a docstring to `get_ratio_projection` explaining that it computes the pixel-wise ratio per frame and then projects over time, and noting that this differs from projecting channels first.

### 12. ~~ND2 pixel-size extraction assumes axis order~~ ✅ FIXED
**File:** `image_io.py:59–64`  
```python
# old:
pixel_size = float(f.metadata.channels[0].volume.axesCalibration[0])
# new:
voxel = f.voxel_size()
pixel_size = float(voxel.x)
```
**Problem:** `axesCalibration[0]` was assumed to be the X pixel size, which is fragile to axis-order changes.  
**Fix applied:** Uses `nd2.ND2File.voxel_size()`, which returns a named tuple `(x, y, z)` in micrometres. `voxel.x` is now used as the pixel size.

### 13. ~~CSV export rounds values to 4 decimal places~~ ✅ FIXED
**File:** `main.py:1133–1134`  
```python
# old:
writer.writerow([f'{t:.4f}'] + [f'{data_map[rid][i]:.4f}' for rid in roi_ids])
# new:
writer.writerow([f'{t:.6g}'] + [f'{data_map[rid][i]:.6g}' for rid in roi_ids])
```
**Problem:** Fixed 4-decimal rounding lost precision for high frame-rate timestamps and small ΔF/F₀ values.  
**Fix applied:** CSV export now uses `%.6g`, preserving more significant figures without excessive trailing zeros.

### 14. ~~`np.trapz` is deprecated in NumPy 2.x~~ ✅ FIXED
**File:** `analysis.py:18–26`  
```python
# Added DeprecationWarning suppression around the numpy < 2.0 fallback
```
**Problem:** The `trapz` fallback is deprecated in NumPy 2.0+ (the current runtime is NumPy 2.0.2), producing deprecation warnings.  
**Fix applied:** The fallback import is now wrapped with `warnings.catch_warnings()` filtering out `DeprecationWarning`, so the compatibility path stays silent on modern NumPy.

### 15. ~~`RateLimitExceeded` exception handler returns an exception, not a response~~ ✅ FIXED
**File:** `main.py:118–127`  
```python
# old:
app.add_exception_handler(RateLimitExceeded, lambda request, exc: HTTPException(429, ...))
# new:
def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests..."})
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```
**Problem:** The handler returned an `HTTPException` object instead of a `Response`.  
**Fix applied:** The handler now returns a proper `JSONResponse` with status code 429.

### 16. ~~CZI reading depends on two overlapping libraries~~ ✅ DOCUMENTED
**File:** `image_io.py:98–108`  
```python
# Added docstring noting the intentional use of both libraries
```
**Problem:** `aicspylibczi` reads the array while `czifile` reads metadata/timestamps, adding dependency surface.  
**Fix applied:** Added a docstring to `load_czi_file` documenting that the two libraries are used intentionally (`aicspylibczi` for array/dims, `czifile` for XML metadata and timestamps) and noting that consolidation is a future refactor.

### 17. ~~`compute_delta_f` returns all NaNs when F₀ == 0 instead of warning~~ ✅ FIXED
**File:** `analysis.py:314–323`  
```python
# Added logger.warning when F₀ <= 0
```
**Problem:** A non-positive F₀ produced NaNs for the entire trace with no feedback to the user.  
**Fix applied:** Added a `logging.getLogger(__name__)` to `analysis.py` and a `logger.warning` in `compute_delta_f` when F₀ ≤ 0, including the ROI id, F₀ value, baseline window, and percentile used.

### 18. ~~Manual/auto background percentile is silently clipped~~ ✅ FIXED
**File:** `analysis.py:82`  
```python
# old:
percentile = float(np.clip(percentile, 0.0, 100.0))
# new:
percentile = float(percentile)
```
**Problem:** Out-of-range background percentiles were silently clamped to 0–100.  
**Fix applied:** Removed the silent `np.clip`. The value is already validated by `AnalyzeParams.bg_percentile` in `main.py` (0–100).

---

## Summary of most urgent fixes

1. Remove `np.maximum(corrected, 0.0)` in `extract_traces`.
2. Replace mean-based F₀ with a robust percentile/median estimator.
3. Stop silently dropping non-T/C/Y/X axes; either expose them or error out.
4. Use a consistent, physically meaningful baseline for decay metrics (pre-event baseline, not post-peak minimum).
5. Smooth or window the trace before computing the maximum rise rate.
6. Fix ratio denominator guard to `den > eps`.

These six changes would significantly improve the quantitative reliability of the app and bring it closer to current calcium-imaging analysis conventions.
