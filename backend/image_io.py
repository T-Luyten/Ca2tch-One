import io

import nd2
import numpy as np
from PIL import Image


def load_nd2_file(filepath: str):
    """
    Load ND2 file. Returns (data, metadata) where data is (T, C, Y, X).
    """
    with nd2.ND2File(filepath) as f:
        sizes = dict(f.sizes)
        data = f.asarray()

        source_n_channels = sizes.get('C', 1)

        # Time axis
        time_axis = None
        time_interval = None
        try:
            events = f.events()
            if events:
                times = [e.get('Time [s]', None) for e in events]
                times = [t for t in times if t is not None]
                if len(times) > 1:
                    time_axis = [float(t) for t in times]
                    time_interval = (times[-1] - times[0]) / (len(times) - 1)
        except Exception:
            pass

        # Channel names
        channel_names = [f'Ch{i + 1}' for i in range(source_n_channels)]
        try:
            for i, ch in enumerate(f.metadata.channels):
                if i < source_n_channels:
                    channel_names[i] = ch.channel.name
        except Exception:
            pass

        # Pixel size
        pixel_size = None
        try:
            pixel_size = float(f.metadata.channels[0].volume.axesCalibration[0])
        except Exception:
            pass

    # Normalize to (T, C, Y, X)
    data, extra_axes = _normalize_shape(data, sizes)

    n_frames = data.shape[0]
    n_channels = data.shape[1]
    channel_names = channel_names[:n_channels]
    if time_axis is None or len(time_axis) != n_frames:
        if time_interval:
            time_axis = [i * time_interval for i in range(n_frames)]
        else:
            time_axis = list(range(n_frames))

    metadata = {
        'n_frames': data.shape[0],
        'n_channels': data.shape[1],
        'height': data.shape[2],
        'width': data.shape[3],
        'time_interval': time_interval,
        'time_axis': time_axis,
        'channel_names': channel_names,
        'pixel_size': pixel_size,
        'dropped_axes': extra_axes,
        'dtype': str(data.dtype),
        'dtype_max': float(np.iinfo(data.dtype).max)
        if np.issubdtype(data.dtype, np.integer)
        else 1.0,
    }

    return data, metadata


def _normalize_shape(data, sizes):
    """Ensure data is (T, C, Y, X), dropping unsupported axes by taking index 0."""
    keys = list(sizes.keys())
    extra_axes = {}

    # Collapse Z by max projection if present
    if 'Z' in keys:
        z_idx = keys.index('Z')
        extra_axes['Z'] = sizes['Z']
        data = data.max(axis=z_idx)
        keys.pop(z_idx)

    # Unsupported axes such as position/scene are not handled in the UI.
    # Keep the first plane so channel/time indexing remains correct.
    for axis_name in list(keys):
        if axis_name in {'T', 'C', 'Y', 'X'}:
            continue
        axis_idx = keys.index(axis_name)
        extra_axes[axis_name] = sizes[axis_name]
        data = np.take(data, indices=0, axis=axis_idx)
        keys.pop(axis_idx)

    order = [keys.index(axis_name) for axis_name in ('T', 'C', 'Y', 'X') if axis_name in keys]
    data = np.transpose(data, axes=order)
    ordered_keys = [axis_name for axis_name in ('T', 'C', 'Y', 'X') if axis_name in keys]

    if ordered_keys == ['Y', 'X']:
        data = data[np.newaxis, np.newaxis, :, :]
    elif ordered_keys == ['T', 'Y', 'X']:
        data = data[:, np.newaxis, :, :]
    elif ordered_keys == ['C', 'Y', 'X']:
        data = data[np.newaxis, :, :, :]
    elif ordered_keys != ['T', 'C', 'Y', 'X']:
        raise ValueError(f"Unsupported ND2 axis layout after normalization: {ordered_keys}")

    return data, extra_axes


def get_projection(data, proj_type='mean', channel=0):
    ch = data[:, channel, :, :]
    if proj_type == 'max':
        return ch.max(axis=0)
    elif proj_type == 'std':
        return ch.std(axis=0)
    else:
        return ch.mean(axis=0)


def get_ratio_frame(data, t=0, ch_num=0, ch_den=1):
    num = data[t, ch_num, :, :].astype(float)
    den = data[t, ch_den, :, :].astype(float)
    with np.errstate(divide='ignore', invalid='ignore'):
        ratio = np.where(den > 0, num / den, np.nan)
    return ratio


def get_ratio_projection(data, proj_type='mean', ch_num=0, ch_den=1):
    num = data[:, ch_num, :, :].astype(float)
    den = data[:, ch_den, :, :].astype(float)
    with np.errstate(divide='ignore', invalid='ignore'):
        ratio = np.where(den > 0, num / den, np.nan)

    if proj_type == 'max':
        return np.nanmax(ratio, axis=0)
    elif proj_type == 'std':
        return np.nanstd(ratio, axis=0)
    else:
        return np.nanmean(ratio, axis=0)


def compute_percentile_contrast(data, channel=0, p_low=1.0, p_high=99.5):
    sample = data[:, channel, :, :].ravel()
    return float(np.percentile(sample, p_low)), float(np.percentile(sample, p_high))


def compute_ratio_percentile_contrast(data, ch_num=0, ch_den=1, p_low=1.0, p_high=99.5):
    ratio = get_ratio_projection(data, proj_type='mean', ch_num=ch_num, ch_den=ch_den)
    finite = ratio[np.isfinite(ratio)]
    if finite.size == 0:
        return 0.0, 1.0
    return float(np.percentile(finite, p_low)), float(np.percentile(finite, p_high))


def frame_to_image(frame_2d, contrast_min=None, contrast_max=None, colormap='green'):
    """Convert 2D array to a PIL image for browser display/export."""
    frame = frame_2d.astype(float)
    if not np.isfinite(frame).any():
        frame = np.zeros_like(frame, dtype=float)
    else:
        finite = frame[np.isfinite(frame)]
        frame = np.where(np.isfinite(frame), frame, float(np.nanmedian(finite)))

    if contrast_min is None:
        contrast_min = float(np.percentile(frame, 1))
    if contrast_max is None:
        contrast_max = float(np.percentile(frame, 99.5))

    if contrast_max <= contrast_min:
        contrast_max = contrast_min + 1.0

    normalized = np.clip(frame, contrast_min, contrast_max)
    normalized = (normalized - contrast_min) / (contrast_max - contrast_min)  # float [0, 1]

    if colormap == 'green':
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 1] = u8
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'red':
        # Red — mCherry / RFP
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 0] = u8
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'orange':
        # Orange — mCherry / tdTomato alternative
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 0] = u8
        rgb[:, :, 1] = (normalized * 160).astype(np.uint8)
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'cyan':
        # Cyan — CFP / Fura-2 340 nm
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 1] = u8
        rgb[:, :, 2] = u8
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'magenta':
        # Magenta — mVenus / YFP alternatives
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 0] = u8
        rgb[:, :, 2] = u8
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'blue':
        # Blue — DAPI / Hoechst
        u8 = (normalized * 255).astype(np.uint8)
        rgb = np.zeros((*u8.shape, 3), dtype=np.uint8)
        rgb[:, :, 2] = u8
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'hot':
        # Hot: black → red → yellow → white  (MATLAB-style)
        r = np.clip(normalized * 3,       0.0, 1.0)
        g = np.clip(normalized * 3 - 1.0, 0.0, 1.0)
        b = np.clip(normalized * 3 - 2.0, 0.0, 1.0)
        rgb = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
        img = Image.fromarray(rgb, mode='RGB')
    elif colormap == 'rainbow':
        # Blue → cyan → green → yellow → red
        stops = np.array([0.0, 0.25, 0.5, 0.75, 1.0], dtype=float)
        colors = np.array([
            [0, 0, 255],
            [0, 255, 255],
            [0, 255, 0],
            [255, 255, 0],
            [255, 0, 0],
        ], dtype=float)
        r = np.interp(normalized, stops, colors[:, 0])
        g = np.interp(normalized, stops, colors[:, 1])
        b = np.interp(normalized, stops, colors[:, 2])
        rgb = np.stack([r, g, b], axis=-1).astype(np.uint8)
        img = Image.fromarray(rgb, mode='RGB')
    else:
        img = Image.fromarray((normalized * 255).astype(np.uint8), mode='L')

    return img


def frame_to_png(frame_2d, contrast_min=None, contrast_max=None, colormap='green'):
    """Convert 2D array to PNG bytes for browser display."""
    img = frame_to_image(frame_2d, contrast_min, contrast_max, colormap)

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf.getvalue()
