import numpy as np
from scipy.optimize import curve_fit
from scipy.signal import find_peaks
from skimage.draw import polygon as sk_polygon
from skimage import morphology as morph

# Pixels to exclude around cell edges when estimating background.
# Cells cast a fluorescence halo due to PSF spread; including these pixels
# would over-estimate the background and under-correct cell traces.
_CELL_MARGIN_PX = 5


def polygon_to_mask(polygon, shape):
    """Convert [[x, y], ...] polygon (image coords) to boolean mask."""
    mask = np.zeros(shape, dtype=bool)
    if len(polygon) < 3:
        return mask
    rows = np.array([p[1] for p in polygon])
    cols = np.array([p[0] for p in polygon])
    rows = np.clip(rows, 0, shape[0] - 1)
    cols = np.clip(cols, 0, shape[1] - 1)
    rr, cc = sk_polygon(rows, cols, shape)
    mask[rr, cc] = True
    return mask


def _exclusion_mask(labels):
    """
    Return a boolean mask of pixels that belong to (or are within
    _CELL_MARGIN_PX of) any cell ROI.  Used to keep bleed-through from
    cell halos out of background estimates.
    """
    cell_mask = labels > 0
    if cell_mask.any():
        return morph.dilation(cell_mask, morph.disk(_CELL_MARGIN_PX))
    return cell_mask


def compute_background_trace(ch_data, labels, mode, percentile=50.0, bg_mask=None):
    """
    Estimate per-frame background fluorescence.

    Parameters
    ----------
    ch_data    : (T, Y, X) array
    labels     : (Y, X) int array — cell ROI labels (0 = background)
    mode       : 'auto' | 'manual'
    percentile : percentile of background pixels used as the background value.
                 50 (median) is the standard — robust to bright artefacts.
                 Lower values (e.g. 25) give a more conservative (darker) estimate.
    bg_mask    : for manual mode — boolean (Y, X) array drawn by the user

    Returns
    -------
    bg_trace : list of float, length T
    """
    n_frames = ch_data.shape[0]
    bg_trace = []
    percentile = float(np.clip(percentile, 0.0, 100.0))

    # Build the exclusion mask once — dilation is expensive and labels are static.
    exclude = _exclusion_mask(labels)

    if mode == 'auto':
        # Background pixels = everything outside cells (+ safety margin).
        # Using the Nth percentile (default: median) of these pixels gives a
        # statistically robust per-frame background estimate.  The median is
        # the standard in calcium imaging because it is insensitive to isolated
        # bright artefacts (debris, autofluorescent particles) in the background.
        non_cell = ~exclude
        if not non_cell.any():
            raise ValueError(
                "Automatic background subtraction failed: no non-cell pixels remain after ROI exclusion"
            )
        for t in range(n_frames):
            vals = ch_data[t][non_cell]
            if not vals.size:
                raise ValueError(
                    "Automatic background subtraction failed: no background pixels available"
                )
            bg_trace.append(float(np.percentile(vals, percentile)))

    elif mode == 'manual' and bg_mask is not None:
        # Exclude any cell pixels that fall inside the manually drawn region.
        # If nothing remains, fail clearly instead of subtracting cell signal.
        valid_bg = bg_mask & ~exclude
        if not valid_bg.any():
            raise ValueError(
                "Manual background subtraction failed: the selected polygon overlaps ROIs or their halo entirely"
            )
        for t in range(n_frames):
            vals = ch_data[t][valid_bg]
            if not vals.size:
                raise ValueError(
                    "Manual background subtraction failed: no background pixels available in the selected polygon"
                )
            bg_trace.append(float(np.percentile(vals, percentile)))

    else:
        bg_trace = [0.0] * n_frames

    return bg_trace


def _exp_decay(t, a, b, c):
    return a * np.exp(-b * t) + c


def _photobleach_correct_trace(trace, time_axis, mode='none'):
    arr = np.array(trace, dtype=float)
    if mode == 'none':
        return arr

    t = np.array(time_axis, dtype=float)
    valid = (~np.isnan(arr)) & np.isfinite(arr)
    if valid.sum() < 4:
        return arr

    y = arr[valid]
    x = t[valid]

    if mode == 'linear':
        try:
            slope, intercept = np.polyfit(x, y, 1)
            fitted = slope * t + intercept
            baseline_level = float(fitted[0]) if np.isfinite(fitted[0]) else 0.0
            corrected = arr - fitted + baseline_level
            return corrected
        except Exception:
            return arr

    y_min = float(np.nanmin(y))
    y_max = float(np.nanmax(y))
    amplitude = max(y_max - y_min, 1e-6)
    duration = max(float(x[-1] - x[0]), 1e-6)

    try:
        popt, _ = curve_fit(
            _exp_decay,
            x,
            y,
            p0=(amplitude, 1.0 / duration, y_min),
            bounds=([0.0, 0.0, -np.inf], [np.inf, np.inf, np.inf]),
            maxfev=10000,
        )
        fitted = _exp_decay(t, *popt)
        baseline_level = float(fitted[0]) if np.isfinite(fitted[0]) else 0.0
        corrected = arr - fitted + baseline_level
        return corrected
    except Exception:
        return arr


def extract_traces(data, labels, roi_ids, channel=0,
                   bg_mode='auto', bg_percentile=50.0, bg_mask=None,
                   photobleach_mode='none', time_axis=None):
    """
    Extract mean fluorescence per ROI per frame, with optional background subtraction.

    Parameters
    ----------
    data        : (T, C, Y, X) array
    labels      : (Y, X) int array
    roi_ids     : list of ROI ids
    channel     : channel index
    bg_mode     : 'none' | 'auto' | 'manual'
    bg_percentile : used when bg_mode in ('auto', 'manual')
    bg_mask     : boolean (Y, X) array, used when bg_mode == 'manual'
    photobleach_mode : 'none' | 'linear' | 'single_exp'
    time_axis   : list/array of frame times used for bleach fitting

    Returns
    -------
    traces   : dict {roi_id: [float]}  — background-corrected mean F per frame
    bg_trace : list of float | None    — background signal used (for display)
    """
    ch_data = data[:, channel, :, :]  # (T, Y, X)

    # Compute background
    if bg_mode in ('auto', 'manual'):
        bg_trace = compute_background_trace(
            ch_data, labels, bg_mode,
            percentile=bg_percentile,
            bg_mask=bg_mask,
        )
        bg_arr = np.array(bg_trace)
    else:
        bg_trace = None
        bg_arr = np.zeros(ch_data.shape[0])

    # Extract per-ROI traces
    traces = {}
    for roi_id in roi_ids:
        mask = labels == roi_id
        if not mask.any():
            continue
        raw = ch_data[:, mask].mean(axis=1)  # (T,)
        corrected = raw - bg_arr
        if time_axis is not None and photobleach_mode != 'none':
            corrected = _photobleach_correct_trace(corrected, time_axis, photobleach_mode)
        traces[roi_id] = corrected.tolist()

    return traces, bg_trace


def extract_ratio_traces(data, labels, roi_ids,
                         ch_num=0, ch_den=1,
                         bg_mode='auto', bg_percentile=50.0,
                         bg_mask=None,
                         photobleach_mode='none',
                         time_axis=None):
    """
    Extract Fura-2 ratiometric traces: ratio = F_num / F_den per ROI per frame.

    Background subtraction is applied independently to each channel before
    computing the ratio.

    Parameters
    ----------
    data          : (T, C, Y, X) array
    labels        : (Y, X) int array
    roi_ids       : list of ROI ids
    ch_num        : numerator channel index   (e.g. 340 nm excitation)
    ch_den        : denominator channel index (e.g. 380 nm excitation)
    bg_mode       : 'none' | 'auto' | 'manual'
    bg_percentile : used when bg_mode in ('auto', 'manual')
    bg_mask       : boolean (Y, X) array, used when bg_mode == 'manual'
    photobleach_mode : 'none' | 'linear' | 'single_exp'
    time_axis     : list/array of frame times used for bleach fitting

    Returns
    -------
    ratio_traces : dict {roi_id: [float]}  — F_num / F_den per frame
    bg_trace_num : list of float | None    — background for numerator channel
    bg_trace_den : list of float | None    — background for denominator channel
    """
    traces_num, bg_num = extract_traces(
        data, labels, roi_ids, channel=ch_num,
        bg_mode=bg_mode, bg_percentile=bg_percentile, bg_mask=bg_mask,
        photobleach_mode=photobleach_mode, time_axis=time_axis,
    )
    traces_den, bg_den = extract_traces(
        data, labels, roi_ids, channel=ch_den,
        bg_mode=bg_mode, bg_percentile=bg_percentile, bg_mask=bg_mask,
        photobleach_mode=photobleach_mode, time_axis=time_axis,
    )

    ratio_traces = {}
    for roi_id in roi_ids:
        if roi_id not in traces_num or roi_id not in traces_den:
            continue
        num = np.array(traces_num[roi_id])
        den = np.array(traces_den[roi_id])
        with np.errstate(divide='ignore', invalid='ignore'):
            ratio = np.where(den != 0, num / den, np.nan)
        ratio_traces[roi_id] = ratio.tolist()

    return ratio_traces, bg_num, bg_den


def compute_delta_f(traces, baseline_start=0, baseline_end=10):
    """
    Compute ΔF/F₀ for each ROI trace.

    F₀ = mean of frames [baseline_start, baseline_end).
    ΔF/F₀ = (F − F₀) / F₀
    """
    delta_f = {}
    for roi_id, trace in traces.items():
        arr = np.array(trace)
        start = max(0, baseline_start)
        end   = min(baseline_end, len(arr))
        if start >= end:
            end = min(start + 1, len(arr))
        f0 = arr[start:end].mean()
        df = (arr - f0) / f0 if f0 != 0 else (arr - f0)
        delta_f[roi_id] = df.tolist()
    return delta_f


def _baseline_window(arr, baseline_start, baseline_end):
    start = max(0, baseline_start)
    end = min(baseline_end, len(arr))
    if start >= end:
        end = min(start + 1, len(arr))
    return arr[start:end]


def _interpolated_crossing_time(x0, y0, x1, y1, level):
    if y1 == y0:
        return float(x0)
    return float(x0 + (level - y0) * (x1 - x0) / (y1 - y0))


def _event_fwhm(window, x, peak_idx):
    peak_value = window[peak_idx]
    if np.isnan(peak_value) or peak_value <= 0:
        return float('nan')

    baseline_level = float(np.nanmin(window[:peak_idx + 1])) if peak_idx >= 0 else 0.0
    half_height = baseline_level + 0.5 * (peak_value - baseline_level)

    left_time = None
    for i in range(peak_idx, 0, -1):
        y_prev = window[i - 1]
        y_curr = window[i]
        if np.isnan(y_prev) or np.isnan(y_curr):
            continue
        if y_prev <= half_height <= y_curr:
            left_time = _interpolated_crossing_time(
                x[i - 1], y_prev, x[i], y_curr, half_height
            )
            break

    right_time = None
    for i in range(peak_idx, len(window) - 1):
        y_curr = window[i]
        y_next = window[i + 1]
        if np.isnan(y_curr) or np.isnan(y_next):
            continue
        if y_curr >= half_height >= y_next:
            right_time = _interpolated_crossing_time(
                x[i], y_curr, x[i + 1], y_next, half_height
            )
            break

    if left_time is None or right_time is None:
        return float('nan')

    return max(0.0, right_time - left_time)


def _event_onset_time(window, x, peak_idx, baseline_level, onset_fraction=0.1):
    peak_value = window[peak_idx]
    if np.isnan(peak_value):
        return float('nan')

    amplitude = peak_value - baseline_level
    if amplitude <= 0:
        return float('nan')

    onset_level = baseline_level + onset_fraction * amplitude
    for i in range(peak_idx, 0, -1):
        y_prev = window[i - 1]
        y_curr = window[i]
        if np.isnan(y_prev) or np.isnan(y_curr):
            continue
        if y_prev <= onset_level <= y_curr:
            return _interpolated_crossing_time(
                x[i - 1], y_prev, x[i], y_curr, onset_level
            )
    return float('nan')


_TAU_FIT_FRAMES = 60  # max frames to use for decay tau fit


def _event_decay_tau(window, x, peak_idx):
    """Estimate decay tau from the falling phase.

    Uses a log-linear fit as a fast initial estimate, then refines with a
    bounded nonlinear least-squares fit (curve_fit) using that estimate as
    the starting point. Falls back to the log-linear value if the refinement
    fails or diverges.
    """
    peak_value = window[peak_idx]
    if np.isnan(peak_value) or peak_value <= 0:
        return float('nan')

    end = min(peak_idx + _TAU_FIT_FRAMES, len(window))
    tail_w = window[peak_idx:end]
    tail_x = x[peak_idx:end]

    valid = ~np.isnan(tail_w)
    if valid.sum() < 4:
        return float('nan')

    tw = tail_w[valid]
    tx = tail_x[valid]
    baseline = float(np.nanmin(tw))
    above = tw - baseline
    positive = above > 0
    if positive.sum() < 4:
        return float('nan')

    # log-linear estimate (fast, used as p0 for refinement)
    try:
        slope, _ = np.polyfit(tx[positive], np.log(above[positive]), 1)
        tau0 = -1.0 / slope if slope < 0 and np.isfinite(slope) else None
    except Exception:
        tau0 = None

    if tau0 is None:
        return float('nan')

    # nonlinear refinement with tight maxfev — converges quickly from a good p0
    amplitude = float(tw[0]) - baseline
    t0 = float(tx[0])
    try:
        popt, _ = curve_fit(
            lambda t, tau, c: amplitude * np.exp(-(t - t0) / tau) + c,
            tx,
            tw,
            p0=(tau0, baseline),
            bounds=([1e-6, -np.inf], [np.inf, np.inf]),
            maxfev=200,
        )
        tau = float(popt[0])
        return tau if np.isfinite(tau) and tau > 0 else float(tau0)
    except Exception:
        return float(tau0)


def _event_decay_half_time(window, x, peak_idx):
    peak_value = window[peak_idx]
    if np.isnan(peak_value) or peak_value <= 0:
        return float('nan')

    baseline_level = float(np.nanmin(window[peak_idx:])) if peak_idx < len(window) else 0.0
    half_height = baseline_level + 0.5 * (peak_value - baseline_level)
    peak_time = float(x[peak_idx])
    for i in range(peak_idx, len(window) - 1):
        y_curr = window[i]
        y_next = window[i + 1]
        if np.isnan(y_curr) or np.isnan(y_next):
            continue
        if y_curr >= half_height >= y_next:
            half_time = _interpolated_crossing_time(
                x[i], y_curr, x[i + 1], y_next, half_height
            )
            return max(0.0, half_time - peak_time)
    return float('nan')


def compute_summary_metrics(
    traces,
    time_axis,
    baseline_start=0,
    baseline_end=10,
    auc_start=0,
    auc_end=0,
    threshold_std_multiplier=2.0,
    compute_decay_tau=False,
):
    """
    Compute peak, suprathreshold AUC, mean event FWHM, event frequency,
    mean time-to-peak, mean decay half-time, and maximum rise rate.

    All three metrics are computed within the same response window
    [auc_start, auc_end). The threshold for AUC is derived from the baseline
    window as mean + threshold_std_multiplier * std.
    """
    t = np.array(time_axis, dtype=float)
    peaks = {}
    aucs = {}
    durations = {}
    frequencies = {}
    rise_times = {}
    time_to_peaks = {}
    decays = {}
    decay_taus = {}
    rise_rates = {}
    event_times = {}

    end = len(t) if not auc_end or int(auc_end) <= 0 else min(int(auc_end), len(t))
    start = min(max(0, int(auc_start)), max(end - 1, 0))
    x = t[start:end]

    for roi_id, trace in traces.items():
        arr = np.array(trace, dtype=float)
        window = arr[start:end]

        if window.size:
            valid_window = window[~np.isnan(window)]
            peaks[roi_id] = float(np.nanmax(valid_window)) if valid_window.size else float('nan')
        else:
            peaks[roi_id] = 0.0

        baseline = _baseline_window(arr, baseline_start, baseline_end)
        baseline = baseline[~np.isnan(baseline)]
        if baseline.size:
            b_median = float(np.median(baseline))
            # MAD scaled to be consistent with std for Gaussian data
            mad = float(np.median(np.abs(baseline - b_median))) * 1.4826
            mad = max(mad, 1e-9)
            threshold = b_median + threshold_std_multiplier * mad
            baseline_level = b_median
        else:
            mad = 1e-9
            threshold = 0.0
            baseline_level = 0.0

        suprathreshold = np.maximum(window - threshold, 0.0)
        valid_auc = ~np.isnan(suprathreshold)
        aucs[roi_id] = (
            float(np.trapezoid(suprathreshold[valid_auc], x[valid_auc]))
            if valid_auc.sum() > 1 else 0.0
        )

        peak_candidates = np.where(~np.isnan(window), window, -np.inf)
        prominence = max(mad if baseline.size else 0.0, 1e-9)
        peak_indices, _ = find_peaks(peak_candidates, height=threshold, prominence=prominence)

        event_widths = []
        event_rise_times = []
        event_time_to_peaks = []
        event_decays = []
        event_decay_taus = []
        roi_event_times = []
        if x.size:
            for idx in peak_indices:
                idx = int(idx)
                event_time_to_peaks.append(float(x[idx]) - float(x[0]))
                roi_event_times.append(float(x[idx]))
                onset_time = _event_onset_time(window, x, idx, baseline_level=baseline_level)
                width = _event_fwhm(window, x, idx)
                decay = _event_decay_half_time(window, x, idx)
                if not (np.isfinite(onset_time) and np.isfinite(width) and np.isfinite(decay)):
                    continue
                event_rise_times.append(float(x[idx]) - onset_time)
                event_widths.append(width)
                event_decays.append(decay)
                if compute_decay_tau:
                    tau = _event_decay_tau(window, x, idx)
                    if np.isfinite(tau):
                        event_decay_taus.append(tau)

        durations[roi_id] = float(np.mean(event_widths)) if event_widths else 0.0
        window_duration = float(x[-1] - x[0]) if x.size > 1 else 0.0
        frequencies[roi_id] = (
            float(len(peak_indices) / window_duration) if window_duration > 0 else 0.0
        )
        rise_times[roi_id] = float(np.mean(event_rise_times)) if event_rise_times else 0.0
        time_to_peaks[roi_id] = float(np.mean(event_time_to_peaks)) if event_time_to_peaks else 0.0
        decays[roi_id] = float(np.mean(event_decays)) if event_decays else 0.0
        decay_taus[roi_id] = float(np.mean(event_decay_taus)) if event_decay_taus else 0.0
        event_times[roi_id] = roi_event_times

        if window.size < 2 or x.size < 2:
            rise_rates[roi_id] = 0.0
            continue

        valid_pairs = (~np.isnan(window[:-1])) & (~np.isnan(window[1:]))
        dt = np.diff(x)
        good = valid_pairs & (dt > 0)
        if not np.any(good):
            rise_rates[roi_id] = 0.0
            continue

        slopes = np.diff(window)[good] / dt[good]
        rise_rates[roi_id] = float(np.nanmax(slopes)) if slopes.size else 0.0

    return peaks, aucs, durations, frequencies, rise_times, time_to_peaks, decays, decay_taus, rise_rates, event_times


def _stimulus_response_metrics(arr, t, stim_frame, end_frame, baseline_frames=5, slope_frames=5):
    n = len(arr)
    if stim_frame is None or stim_frame < 0 or stim_frame >= n:
        return {
            'peak': 0.0,
            'slope': 0.0,
            'auc': 0.0,
            'time_to_peak': 0.0,
        }

    end = min(n, max(int(end_frame), int(stim_frame) + 1))
    if end - stim_frame < 2:
        return {
            'peak': 0.0,
            'slope': 0.0,
            'auc': 0.0,
            'time_to_peak': 0.0,
        }

    baseline_frames = max(1, int(baseline_frames))
    baseline_start = max(0, stim_frame - baseline_frames)
    baseline_end = max(stim_frame, baseline_start + 1)
    baseline_vals = arr[baseline_start:baseline_end]
    baseline_vals = baseline_vals[~np.isnan(baseline_vals)]
    baseline_level = float(np.nanmean(baseline_vals)) if baseline_vals.size else 0.0

    x = np.array(t[stim_frame:end], dtype=float)
    y = np.array(arr[stim_frame:end], dtype=float) - baseline_level
    valid = ~np.isnan(y)
    x = x[valid]
    y = y[valid]
    if x.size < 2:
        return {
            'peak': 0.0,
            'slope': 0.0,
            'auc': 0.0,
            'time_to_peak': 0.0,
        }

    peak_idx = int(np.nanargmax(y))
    peak = float(max(0.0, y[peak_idx]))
    time_to_peak = float(max(0.0, x[peak_idx] - x[0]))
    auc = float(np.trapezoid(np.maximum(y, 0.0), x)) if x.size > 1 else 0.0

    slope_end = min(x.size, max(2, int(slope_frames)))
    slope = 0.0
    if slope_end >= 2:
        x_s = x[:slope_end]
        y_s = y[:slope_end]
        if np.unique(x_s).size >= 2:
            slope = float(np.polyfit(x_s, y_s, 1)[0])

    return {
        'peak': peak,
        'slope': slope,
        'auc': auc,
        'time_to_peak': time_to_peak,
    }


def compute_addback_metrics(
    traces,
    time_axis,
    tg_frame=0,
    tg_end_frame=0,
    tg_baseline_frames=5,
    tg_slope_frames=5,
    addback_frame=0,
    addback_end_frame=0,
    addback_baseline_frames=5,
    addback_slope_frames=5,
):
    tg_peaks = {}
    tg_slopes = {}
    tg_aucs = {}
    addback_peaks = {}
    addback_slopes = {}
    addback_aucs = {}
    addback_latencies = {}

    t = np.array(time_axis, dtype=float)
    tg_baseline_frames = max(1, int(tg_baseline_frames))
    tg_slope_frames = max(2, int(tg_slope_frames))
    addback_baseline_frames = max(1, int(addback_baseline_frames))
    addback_slope_frames = max(2, int(addback_slope_frames))
    tg_end_frame = int(tg_end_frame)
    addback_end_frame = int(addback_end_frame)

    for roi_id, trace in traces.items():
        arr = np.array(trace, dtype=float)

        if tg_end_frame > 0:
            tg = _stimulus_response_metrics(
                arr, t,
                stim_frame=int(tg_frame),
                end_frame=tg_end_frame,
                baseline_frames=tg_baseline_frames,
                slope_frames=tg_slope_frames,
            )
        else:
            tg = {
                'peak': 0.0,
                'slope': 0.0,
                'auc': 0.0,
                'time_to_peak': 0.0,
            }

        if addback_end_frame > 0:
            addback = _stimulus_response_metrics(
                arr, t,
                stim_frame=int(addback_frame),
                end_frame=addback_end_frame,
                baseline_frames=addback_baseline_frames,
                slope_frames=addback_slope_frames,
            )
        else:
            addback = {
                'peak': 0.0,
                'slope': 0.0,
                'auc': 0.0,
                'time_to_peak': 0.0,
            }

        tg_peaks[roi_id] = tg['peak']
        tg_slopes[roi_id] = tg['slope']
        tg_aucs[roi_id] = tg['auc']
        addback_peaks[roi_id] = addback['peak']
        addback_slopes[roi_id] = addback['slope']
        addback_aucs[roi_id] = addback['auc']
        addback_latencies[roi_id] = addback['time_to_peak']

    return (
        tg_peaks,
        tg_slopes,
        tg_aucs,
        addback_peaks,
        addback_slopes,
        addback_aucs,
        addback_latencies,
    )
