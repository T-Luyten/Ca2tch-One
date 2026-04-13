import numpy as np
from skimage.draw import polygon as sk_polygon


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


def compute_background_trace(ch_data, labels, mode, percentile=10.0, bg_mask=None):
    """
    Estimate per-frame background fluorescence.

    Parameters
    ----------
    ch_data : (T, Y, X) array
    labels  : (Y, X) int array — cell ROI labels (0 = background)
    mode    : 'auto' | 'manual'
    percentile : for auto mode — darkest N% of non-cell pixels used
    bg_mask : for manual mode — boolean (Y, X) array

    Returns
    -------
    bg_trace : list of float, length T
    """
    n_frames = ch_data.shape[0]
    bg_trace = []

    if mode == 'auto':
        non_cell = (labels == 0)
        for t in range(n_frames):
            frame = ch_data[t]
            vals = frame[non_cell]
            if vals.size == 0:
                bg_trace.append(0.0)
                continue
            threshold = np.percentile(vals, percentile)
            dark_vals = vals[vals <= threshold]
            bg_trace.append(float(dark_vals.mean() if dark_vals.size else vals.min()))

    elif mode == 'manual' and bg_mask is not None:
        for t in range(n_frames):
            frame = ch_data[t]
            vals = frame[bg_mask]
            bg_trace.append(float(vals.mean()) if vals.size else 0.0)

    else:
        bg_trace = [0.0] * n_frames

    return bg_trace


def extract_traces(data, labels, roi_ids, channel=0,
                   bg_mode='none', bg_percentile=10.0, bg_mask=None):
    """
    Extract mean fluorescence per ROI per frame, with optional background subtraction.

    Parameters
    ----------
    data        : (T, C, Y, X) array
    labels      : (Y, X) int array
    roi_ids     : list of ROI ids
    channel     : channel index
    bg_mode     : 'none' | 'auto' | 'manual'
    bg_percentile : used when bg_mode == 'auto'
    bg_mask     : boolean (Y, X) array, used when bg_mode == 'manual'

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
        traces[roi_id] = corrected.tolist()

    return traces, bg_trace


def extract_ratio_traces(data, labels, roi_ids,
                         ch_num=0, ch_den=1,
                         bg_mode='none', bg_percentile=10.0,
                         bg_mask=None):
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
    bg_percentile : used when bg_mode == 'auto'
    bg_mask       : boolean (Y, X) array, used when bg_mode == 'manual'

    Returns
    -------
    ratio_traces : dict {roi_id: [float]}  — F_num / F_den per frame
    bg_trace_num : list of float | None    — background for numerator channel
    bg_trace_den : list of float | None    — background for denominator channel
    """
    traces_num, bg_num = extract_traces(
        data, labels, roi_ids, channel=ch_num,
        bg_mode=bg_mode, bg_percentile=bg_percentile, bg_mask=bg_mask,
    )
    traces_den, bg_den = extract_traces(
        data, labels, roi_ids, channel=ch_den,
        bg_mode=bg_mode, bg_percentile=bg_percentile, bg_mask=bg_mask,
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


def compute_peak_and_auc(traces, time_axis):
    """
    Compute peak value and area under the curve (AUC) for each ROI trace.

    Peak is the maximum value (NaN-safe).
    AUC is the trapezoidal integral over the supplied time axis.

    Parameters
    ----------
    traces    : dict {roi_id: [float]}
    time_axis : list of float  — time in seconds, length == len(trace)

    Returns
    -------
    peaks : dict {roi_id: float}
    aucs  : dict {roi_id: float}
    """
    t = np.array(time_axis, dtype=float)
    peaks = {}
    aucs = {}
    for roi_id, trace in traces.items():
        arr = np.array(trace, dtype=float)
        peaks[roi_id] = float(np.nanmax(arr)) if arr.size else float('nan')
        # mask NaNs for integration (Fura-2 can produce NaN where den == 0)
        valid = ~np.isnan(arr)
        aucs[roi_id] = float(np.trapezoid(arr[valid], t[valid])) if valid.sum() > 1 else 0.0
    return peaks, aucs


def compute_rate_of_rise(traces, time_axis):
    """
    Compute the maximum positive slope for each ROI trace.

    The slope is computed between adjacent time points on the analyzed
    normalized trace (ΔF/F₀ or ΔR/R₀) and reported in units per second.
    """
    t = np.array(time_axis, dtype=float)
    rates = {}
    for roi_id, trace in traces.items():
        arr = np.array(trace, dtype=float)
        if arr.size < 2 or t.size < 2:
            rates[roi_id] = 0.0
            continue

        valid = ~np.isnan(arr)
        valid_pairs = valid[:-1] & valid[1:]
        dt = np.diff(t)
        positive_dt = dt > 0
        good = valid_pairs & positive_dt
        if not np.any(good):
            rates[roi_id] = 0.0
            continue

        slopes = np.diff(arr)[good] / dt[good]
        rates[roi_id] = float(np.nanmax(slopes)) if slopes.size else 0.0
    return rates
