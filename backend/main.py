import asyncio
import csv
import io
import json
import os
import tempfile
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Optional
from xml.sax.saxutils import escape

import psutil
import numpy as np
from datetime import timedelta
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from PIL import ImageDraw
from pydantic import BaseModel, field_validator
from scipy import ndimage
from skimage import measure

from auth import get_current_user, create_access_token, AUTH_USERNAME, AUTH_PASSWORD_HASH, pwd_context, AUTH_TOKEN_EXPIRE_HOURS

from analysis import (
    compute_addback_metrics,
    compute_summary_metrics,
    compute_delta_f,
    extract_ratio_traces,
    extract_traces,
    polygon_to_mask,
)
from detection import detect_rois, get_contours
from image_io import (
    compute_percentile_contrast,
    compute_ratio_percentile_contrast,
    frame_to_image,
    frame_to_png,
    get_projection,
    get_ratio_frame,
    get_ratio_projection,
    load_nd2_file,
)

SESSION_TTL_SECONDS = 2 * 60 * 60   # 2 hours
SESSION_SWEEP_INTERVAL = 5 * 60     # sweep every 5 minutes

# Maximum process RSS before new uploads are rejected.
# Override with env var: CACELLFIE_MAX_RSS_MB=2048
# Set to 0 to disable the limit.
_max_rss_mb = int(os.environ.get('CACELLFIE_MAX_RSS_MB', '1500'))
MAX_PROCESS_RSS_BYTES = _max_rss_mb * 1024 * 1024 if _max_rss_mb > 0 else None

# Maximum file upload size (700 MB)
MAX_FILE_SIZE_BYTES = 700 * 1024 * 1024


async def _evict_stale_sessions():
    while True:
        await asyncio.sleep(SESSION_SWEEP_INTERVAL)
        cutoff = time.monotonic() - SESSION_TTL_SECONDS
        stale = [fid for fid, s in sessions.items() if s['last_accessed'] < cutoff]
        for fid in stale:
            sessions.pop(fid, None)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_evict_stale_sessions())
    yield
    task.cancel()


app = FastAPI(title="Ca2+ cell-fie", lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, lambda request, exc: HTTPException(429, "Too many requests. Please try again later."))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8001", "http://127.0.0.1:8001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory sessions: file_id -> session dict
sessions: dict = {}


# ── Pydantic models ──────────────────────────────────────────────────────────

class DetectParams(BaseModel):
    channel: int = 0
    projection_type: str = 'mean'
    min_size: int = 100
    max_size: int = 10000
    threshold_adjust: float = 1.0
    smooth_sigma: float = 2.0
    background_radius: Optional[int] = None
    seed_sigma: float = 1.0
    allow_edge_rois: bool = False
    exclude_mask: Optional[List[List[int]]] = None  # [[y,x], ...]

    @field_validator('projection_type')
    @classmethod
    def validate_projection_type(cls, v):
        if v not in ('mean', 'max', 'min'):
            raise ValueError("projection_type must be 'mean', 'max', or 'min'")
        return v

    @field_validator('min_size')
    @classmethod
    def validate_min_size(cls, v):
        if v <= 0:
            raise ValueError("min_size must be positive")
        return v

    @field_validator('max_size')
    @classmethod
    def validate_max_size(cls, v):
        if v <= 0:
            raise ValueError("max_size must be positive")
        return v

    @field_validator('threshold_adjust')
    @classmethod
    def validate_threshold_adjust(cls, v):
        if v <= 0:
            raise ValueError("threshold_adjust must be positive")
        return v

    @field_validator('smooth_sigma')
    @classmethod
    def validate_smooth_sigma(cls, v):
        if v < 0:
            raise ValueError("smooth_sigma must be non-negative")
        return v

    @field_validator('background_radius')
    @classmethod
    def validate_background_radius(cls, v):
        if v is not None and v <= 0:
            raise ValueError("background_radius must be positive")
        return v

    @field_validator('seed_sigma')
    @classmethod
    def validate_seed_sigma(cls, v):
        if v <= 0:
            raise ValueError("seed_sigma must be positive")
        return v

    @field_validator('max_size', mode='after')
    @classmethod
    def validate_size_range(cls, v, info):
        if 'data' in info.data and info.data.get('min_size') and v < info.data['min_size']:
            raise ValueError("max_size must be >= min_size")
        return v


class AnalyzeParams(BaseModel):
    channel: int = 0
    baseline_start: int = 0
    baseline_end: int = 0
    auc_start: int = 0
    auc_end: int = 0
    roi_ids: Optional[List[int]] = None        # None = all current ROIs
    bg_mode: str = 'auto'                      # 'none' | 'auto' | 'manual'
    bg_percentile: float = 50.0                # background statistic percentile for auto/manual modes (50 = median)
    bg_polygon: Optional[List[List[float]]] = None  # manual mode: [[x,y], ...]
    photobleach_mode: str = 'none'             # 'none' | 'linear' | 'single_exp'
    analysis_mode: str = 'single'              # 'single' | 'ratio'
    ratio_ch_num: int = 0                      # Fura-2: numerator channel (e.g. 340 nm)
    ratio_ch_den: int = 1                      # Fura-2: denominator channel (e.g. 380 nm)
    tg_frame: int = 0
    tg_end_frame: int = 0
    tg_baseline_frames: int = 5
    tg_slope_frames: int = 5
    addback_frame: int = 0
    addback_end_frame: int = 0
    addback_baseline_frames: int = 5
    addback_slope_frames: int = 5

    @field_validator('channel')
    @classmethod
    def validate_channel(cls, v):
        if v < 0:
            raise ValueError("channel must be non-negative")
        return v

    @field_validator('baseline_start', 'baseline_end', 'auc_start', 'auc_end', 'tg_frame', 'tg_end_frame', 'addback_frame', 'addback_end_frame')
    @classmethod
    def validate_frame_indices(cls, v):
        if v < 0:
            raise ValueError("frame indices must be non-negative")
        return v

    @field_validator('bg_mode')
    @classmethod
    def validate_bg_mode(cls, v):
        if v not in ('none', 'auto', 'manual'):
            raise ValueError("bg_mode must be 'none', 'auto', or 'manual'")
        return v

    @field_validator('bg_percentile')
    @classmethod
    def validate_bg_percentile(cls, v):
        if not (0 <= v <= 100):
            raise ValueError("bg_percentile must be between 0 and 100")
        return v

    @field_validator('photobleach_mode')
    @classmethod
    def validate_photobleach_mode(cls, v):
        if v not in ('none', 'linear', 'single_exp'):
            raise ValueError("photobleach_mode must be 'none', 'linear', or 'single_exp'")
        return v

    @field_validator('analysis_mode')
    @classmethod
    def validate_analysis_mode(cls, v):
        if v not in ('single', 'ratio'):
            raise ValueError("analysis_mode must be 'single' or 'ratio'")
        return v

    @field_validator('ratio_ch_num', 'ratio_ch_den')
    @classmethod
    def validate_ratio_channels(cls, v):
        if v < 0:
            raise ValueError("channel indices must be non-negative")
        return v

    @field_validator('tg_baseline_frames', 'tg_slope_frames', 'addback_baseline_frames', 'addback_slope_frames')
    @classmethod
    def validate_frame_counts(cls, v):
        if v < 0:
            raise ValueError("frame counts must be non-negative")
        return v


class TransferRoisParams(BaseModel):
    source_file_id: str
    target_file_id: str


class ManualRoiParams(BaseModel):
    polygon: List[List[float]]  # [[x, y], ...]


class MergeRoisParams(BaseModel):
    roi_ids: List[int]


# ── API routes ────────────────────────────────────────────────────────────────

@app.post("/api/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Login endpoint: returns JWT token for authenticated user."""
    if form_data.username != AUTH_USERNAME or not pwd_context.verify(form_data.password, AUTH_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token_expires = timedelta(hours=AUTH_TOKEN_EXPIRE_HOURS)
    access_token = create_access_token(data={"sub": AUTH_USERNAME}, expires_delta=access_token_expires)
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/upload")
@limiter.limit("10/hour")
async def upload_file(request: Request, file: UploadFile = File(...), _: str = Depends(get_current_user)):
    if not (file.filename or '').lower().endswith('.nd2'):
        raise HTTPException(400, "Only .nd2 files are supported")

    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        size_mb = file.size // (1024 * 1024)
        limit_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            413,
            f"File too large ({size_mb} MB). Maximum allowed size is {limit_mb} MB."
        )

    if MAX_PROCESS_RSS_BYTES is not None:
        rss = psutil.Process().memory_info().rss
        if rss >= MAX_PROCESS_RSS_BYTES:
            used_mb = rss // (1024 * 1024)
            limit_mb = MAX_PROCESS_RSS_BYTES // (1024 * 1024)
            raise HTTPException(
                507,
                f"Server memory full ({used_mb} MB used, limit {limit_mb} MB). "
                "Close an open session or ask the administrator to raise CACELLFIE_MAX_RSS_MB."
            )

    file_content = await file.read()
    if len(file_content) > MAX_FILE_SIZE_BYTES:
        size_mb = len(file_content) // (1024 * 1024)
        limit_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            413,
            f"File too large ({size_mb} MB). Maximum allowed size is {limit_mb} MB."
        )

    with tempfile.NamedTemporaryFile(suffix='.nd2', delete=False) as tmp:
        tmp.write(file_content)
        tmp_path = tmp.name

    try:
        data, metadata = load_nd2_file(tmp_path)
    except Exception as exc:
        raise HTTPException(500, "Failed to read file. Please ensure the file is a valid ND2 format.") from exc
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    file_id = str(uuid.uuid4())
    contrast = {
        ch: {
            'min': lo,
            'max': hi,
        }
        for ch, (lo, hi) in (
            (ch, compute_percentile_contrast(data, channel=ch))
            for ch in range(metadata['n_channels'])
        )
    }

    sessions[file_id] = {
        'last_accessed': time.monotonic(),
        'file_name': file.filename,
        'data': data,
        'metadata': metadata,
        'labels': None,
        'rois': [],
        'detection_params': None,
        'analysis_params': None,
        'traces': None,
        'delta_f': None,
        'bg_trace': None,
        'peaks': None,
        'aucs': None,
        'durations': None,
        'frequencies': None,
        'latencies': None,
        'decays': None,
        'rise_rates': None,
        'event_times': None,
        'tg_peaks': None,
        'tg_slopes': None,
        'tg_aucs': None,
        'addback_peaks': None,
        'addback_slopes': None,
        'addback_aucs': None,
        'addback_latencies': None,
        'contrast': contrast,
    }

    return {
        'file_id': file_id,
        'metadata': metadata,
        'initial_contrast': contrast[0],
    }


@app.get("/api/frame/{file_id}")
async def get_frame(
    file_id: str,
    t: int = Query(0),
    mode: str = Query('channel'),
    channel: int = Query(0),
    ratio_ch_num: int = Query(0),
    ratio_ch_den: int = Query(1),
    cmin: Optional[float] = None,
    cmax: Optional[float] = None,
    colormap: str = Query('green'),
    _: str = Depends(get_current_user),
):
    if mode not in ('channel', 'ratio'):
        raise HTTPException(400, "mode must be 'channel' or 'ratio'")

    sess = _get_session(file_id)
    data = sess['data']
    meta = sess['metadata']

    t = int(np.clip(t, 0, meta['n_frames'] - 1))
    channel = int(np.clip(channel, 0, meta['n_channels'] - 1))
    ratio_ch_num = int(np.clip(ratio_ch_num, 0, meta['n_channels'] - 1))
    ratio_ch_den = int(np.clip(ratio_ch_den, 0, meta['n_channels'] - 1))

    if mode == 'ratio':
        if ratio_ch_num == ratio_ch_den:
            raise HTTPException(400, "Ratio display requires different numerator and denominator channels")
        if cmin is None or cmax is None:
            lo, hi = compute_ratio_percentile_contrast(
                data, ch_num=ratio_ch_num, ch_den=ratio_ch_den
            )
            cmin = lo if cmin is None else cmin
            cmax = hi if cmax is None else cmax
        frame = get_ratio_frame(data, t=t, ch_num=ratio_ch_num, ch_den=ratio_ch_den)
    else:
        if cmin is None:
            cmin = sess['contrast'][channel]['min']
        if cmax is None:
            cmax = sess['contrast'][channel]['max']
        frame = data[t, channel, :, :]
    return Response(
        content=frame_to_png(frame, cmin, cmax, colormap),
        media_type='image/png',
    )


@app.get("/api/projection/{file_id}")
async def get_projection_image(
    file_id: str,
    type: str = Query('mean'),
    mode: str = Query('channel'),
    channel: int = Query(0),
    ratio_ch_num: int = Query(0),
    ratio_ch_den: int = Query(1),
    cmin: Optional[float] = None,
    cmax: Optional[float] = None,
    colormap: str = Query('green'),
    _: str = Depends(get_current_user),
):
    if type not in ('mean', 'max', 'min'):
        raise HTTPException(400, "type must be 'mean', 'max', or 'min'")
    if mode not in ('channel', 'ratio'):
        raise HTTPException(400, "mode must be 'channel' or 'ratio'")

    sess = _get_session(file_id)
    meta = sess['metadata']
    channel = int(np.clip(channel, 0, meta['n_channels'] - 1))
    ratio_ch_num = int(np.clip(ratio_ch_num, 0, meta['n_channels'] - 1))
    ratio_ch_den = int(np.clip(ratio_ch_den, 0, meta['n_channels'] - 1))
    if mode == 'ratio':
        if ratio_ch_num == ratio_ch_den:
            raise HTTPException(400, "Ratio display requires different numerator and denominator channels")
        proj = get_ratio_projection(
            sess['data'], proj_type=type, ch_num=ratio_ch_num, ch_den=ratio_ch_den
        )
        if cmin is None or cmax is None:
            lo, hi = compute_ratio_percentile_contrast(
                sess['data'], ch_num=ratio_ch_num, ch_den=ratio_ch_den
            )
            cmin = lo if cmin is None else cmin
            cmax = hi if cmax is None else cmax
    else:
        proj = get_projection(sess['data'], proj_type=type, channel=channel)
    return Response(
        content=frame_to_png(proj, cmin, cmax, colormap),
        media_type='image/png',
    )


@app.get("/api/contrast/{file_id}")
async def get_contrast(
    file_id: str,
    mode: str = Query('channel'),
    channel: int = Query(0),
    ratio_ch_num: int = Query(0),
    ratio_ch_den: int = Query(1),
    p_low: float = Query(1.0),
    p_high: float = Query(99.5),
    _: str = Depends(get_current_user),
):
    if not (0 <= p_low <= 100):
        raise HTTPException(400, "p_low must be between 0 and 100")
    if not (0 <= p_high <= 100):
        raise HTTPException(400, "p_high must be between 0 and 100")
    if p_low > p_high:
        raise HTTPException(400, "p_low must be <= p_high")

    sess = _get_session(file_id)
    meta = sess['metadata']
    channel = int(np.clip(channel, 0, meta['n_channels'] - 1))
    ratio_ch_num = int(np.clip(ratio_ch_num, 0, meta['n_channels'] - 1))
    ratio_ch_den = int(np.clip(ratio_ch_den, 0, meta['n_channels'] - 1))

    if mode == 'ratio':
        if ratio_ch_num == ratio_ch_den:
            raise HTTPException(400, "Ratio display requires different numerator and denominator channels")
        lo, hi = compute_ratio_percentile_contrast(
            sess['data'], ch_num=ratio_ch_num, ch_den=ratio_ch_den,
            p_low=p_low, p_high=p_high
        )
    else:
        lo, hi = compute_percentile_contrast(
            sess['data'], channel=channel, p_low=p_low, p_high=p_high
        )
        sess['contrast'][channel] = {'min': lo, 'max': hi}
    return {'min': lo, 'max': hi}


@app.post("/api/detect/{file_id}")
@limiter.limit("30/hour")
async def detect(request: Request, file_id: str, params: DetectParams, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    data = sess['data']

    proj = get_projection(data, proj_type=params.projection_type,
                          channel=params.channel).astype(float)

    exclude = None
    if params.exclude_mask:
        h, w = proj.shape
        exclude = np.zeros((h, w), dtype=bool)
        for coord in params.exclude_mask:
            if 0 <= coord[0] < h and 0 <= coord[1] < w:
                exclude[coord[0], coord[1]] = True

    try:
        labels, regions = detect_rois(
            proj,
            min_size=params.min_size,
            max_size=params.max_size,
            threshold_adjust=params.threshold_adjust,
            smooth_sigma=params.smooth_sigma,
            background_radius=params.background_radius,
            seed_sigma=params.seed_sigma,
            allow_edge_rois=params.allow_edge_rois,
            exclude_mask=exclude,
        )
    except Exception as exc:
        raise HTTPException(500, "Detection failed. Please try with different parameters.") from exc

    sess['labels'] = labels
    sess['traces'] = None
    sess['delta_f'] = None
    sess['detection_params'] = params.model_dump()

    rois = get_contours(labels, regions)
    sess['rois'] = rois

    return {'n_rois': len(rois), 'rois': rois}


@app.delete("/api/roi/{file_id}/{roi_id}")
async def delete_roi(file_id: str, roi_id: int, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    if sess['labels'] is None:
        raise HTTPException(400, "No ROIs detected yet")

    sess['labels'][sess['labels'] == roi_id] = 0
    sess['rois'] = [r for r in sess['rois'] if r['id'] != roi_id]
    _clear_analysis_results(sess)
    return {'deleted': roi_id}


@app.post("/api/roi/{file_id}")
async def add_manual_roi(file_id: str, params: ManualRoiParams, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    h = sess['metadata']['height']
    w = sess['metadata']['width']

    if not params.polygon or len(params.polygon) < 3:
        raise HTTPException(400, "Manual ROI requires a polygon with at least 3 points")

    mask = polygon_to_mask(params.polygon, (h, w))
    if not mask.any():
        raise HTTPException(400, "Manual ROI polygon does not cover any image pixels")

    if sess['labels'] is None:
        sess['labels'] = np.zeros((h, w), dtype=int)

    overlap = mask & (sess['labels'] > 0)
    if overlap.any():
        raise HTTPException(400, "Manual ROI overlaps an existing ROI")

    new_id = int(sess['labels'].max()) + 1
    sess['labels'][mask] = new_id

    rois = get_contours(sess['labels'], [r for r in measure.regionprops(sess['labels']) if r.label == new_id])
    if len(rois) != 1:
        sess['labels'][mask] = 0
        raise HTTPException(500, "Manual ROI could not be converted into a valid contour")

    sess['rois'].append(rois[0])
    sess['rois'].sort(key=lambda roi: roi['id'])
    _clear_analysis_results(sess)

    return {
        'roi': rois[0],
        'n_rois': len(sess['rois']),
        'rois': sess['rois'],
    }


@app.post("/api/roi/{file_id}/merge")
async def merge_rois(file_id: str, params: MergeRoisParams, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    if sess['labels'] is None or not sess['rois']:
        raise HTTPException(400, "No ROIs detected yet")

    roi_ids = sorted({int(roi_id) for roi_id in params.roi_ids})
    if len(roi_ids) != 2:
        raise HTTPException(400, "Merge requires exactly 2 ROI ids")

    existing_ids = {roi['id'] for roi in sess['rois']}
    missing = [roi_id for roi_id in roi_ids if roi_id not in existing_ids]
    if missing:
        raise HTTPException(400, f"ROI ids not found: {missing}")

    keep_id = min(roi_ids)
    remove_id = max(roi_ids)
    labels = sess['labels']

    mask_keep = labels == keep_id
    mask_remove = labels == remove_id
    dilated_keep = ndimage.binary_dilation(mask_keep)
    if not (dilated_keep & mask_remove).any():
        raise HTTPException(400, "ROIs must be touching to merge. The selected ROIs are not adjacent.")

    labels[labels == remove_id] = keep_id

    merged_regions = [r for r in measure.regionprops(labels) if r.label == keep_id]
    if len(merged_regions) != 1:
        raise HTTPException(500, "Merged ROI could not be converted into a valid contour")

    merged_roi = get_contours(labels, merged_regions)[0]
    sess['rois'] = [roi for roi in sess['rois'] if roi['id'] not in roi_ids]
    sess['rois'].append(merged_roi)
    sess['rois'].sort(key=lambda roi: roi['id'])
    _clear_analysis_results(sess)

    return {
        'roi': merged_roi,
        'merged_ids': roi_ids,
        'n_rois': len(sess['rois']),
        'rois': sess['rois'],
    }


@app.post("/api/transfer-rois")
async def transfer_rois(params: TransferRoisParams, _: str = Depends(get_current_user)):
    source = _get_session(params.source_file_id)
    target = _get_session(params.target_file_id)

    if source['labels'] is None or not source['rois']:
        raise HTTPException(400, "Run detection on the ROI source file first")

    source_shape = (
        source['metadata']['height'],
        source['metadata']['width'],
    )
    target_shape = (
        target['metadata']['height'],
        target['metadata']['width'],
    )
    if source_shape != target_shape:
        raise HTTPException(
            400,
            f"ROI transfer requires matching image dimensions. Source is {source_shape[1]}x{source_shape[0]}, "
            f"target is {target_shape[1]}x{target_shape[0]}."
        )

    target['labels'] = source['labels'].copy()
    target['rois'] = [dict(roi) for roi in source['rois']]
    target['detection_params'] = source.get('detection_params')
    target['traces'] = None
    target['delta_f'] = None
    target['bg_trace'] = None
    target['durations'] = None
    target['frequencies'] = None
    target['latencies'] = None
    target['decays'] = None
    target['event_times'] = None
    target['peaks'] = None
    target['aucs'] = None
    target['tg_peaks'] = None
    target['tg_slopes'] = None
    target['tg_aucs'] = None
    target['addback_peaks'] = None
    target['addback_slopes'] = None
    target['addback_aucs'] = None
    target['addback_latencies'] = None

    return {
        'target_file_id': params.target_file_id,
        'n_rois': len(target['rois']),
        'rois': target['rois'],
    }


@app.post("/api/analyze/{file_id}")
@limiter.limit("30/hour")
async def analyze(request: Request, file_id: str, params: AnalyzeParams, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    if sess['labels'] is None:
        raise HTTPException(400, "Run detection first")

    roi_ids = params.roi_ids or [r['id'] for r in sess['rois']]
    if not roi_ids:
        raise HTTPException(400, "No ROIs selected for analysis")

    # Build background mask for manual mode
    bg_mask = None
    if params.bg_mode == 'manual':
        if not params.bg_polygon or len(params.bg_polygon) < 3:
            raise HTTPException(400, "Manual background mode requires a polygon with at least 3 points")

        h = sess['metadata']['height']
        w = sess['metadata']['width']
        bg_mask = polygon_to_mask(params.bg_polygon, (h, w))
        if not bg_mask.any():
            raise HTTPException(400, "Manual background polygon does not cover any image pixels")

    try:
        if params.analysis_mode == 'ratio':
            n_ch = sess['metadata']['n_channels']
            if params.ratio_ch_num >= n_ch or params.ratio_ch_den >= n_ch:
                raise HTTPException(400, "Channel index out of range for ratio analysis")
            if params.ratio_ch_num == params.ratio_ch_den:
                raise HTTPException(400, "Numerator and denominator channels must differ")

            traces, bg_trace_num, _bg_den = extract_ratio_traces(
                sess['data'], sess['labels'], roi_ids,
                ch_num=params.ratio_ch_num,
                ch_den=params.ratio_ch_den,
                bg_mode=params.bg_mode,
                bg_percentile=params.bg_percentile,
                bg_mask=bg_mask,
                photobleach_mode=params.photobleach_mode,
                time_axis=sess['metadata']['time_axis'],
            )
            bg_trace = bg_trace_num  # expose numerator BG for display
        else:
            traces, bg_trace = extract_traces(
                sess['data'], sess['labels'], roi_ids,
                channel=params.channel,
                bg_mode=params.bg_mode,
                bg_percentile=params.bg_percentile,
                bg_mask=bg_mask,
                photobleach_mode=params.photobleach_mode,
                time_axis=sess['metadata']['time_axis'],
            )

        delta_f = compute_delta_f(
            traces,
            baseline_start=params.baseline_start,
            baseline_end=params.baseline_end,
        )
        peaks, aucs, durations, frequencies, latencies, decays, rise_rates, event_times = compute_summary_metrics(
            delta_f,
            sess['metadata']['time_axis'],
            baseline_start=params.baseline_start,
            baseline_end=params.baseline_end,
            auc_start=params.auc_start,
            auc_end=params.auc_end,
        )
        tg_peaks, tg_slopes, tg_aucs, addback_peaks, addback_slopes, addback_aucs, addback_latencies = compute_addback_metrics(
            delta_f,
            sess['metadata']['time_axis'],
            tg_frame=params.tg_frame,
            tg_end_frame=params.tg_end_frame,
            tg_baseline_frames=params.tg_baseline_frames,
            tg_slope_frames=params.tg_slope_frames,
            addback_frame=params.addback_frame,
            addback_end_frame=params.addback_end_frame,
            addback_baseline_frames=params.addback_baseline_frames,
            addback_slope_frames=params.addback_slope_frames,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, "Analysis failed. Please try with different parameters.") from exc

    sess['traces'] = traces
    sess['delta_f'] = delta_f
    sess['bg_trace'] = bg_trace
    sess['analysis_params'] = params.model_dump()
    sess['peaks'] = peaks
    sess['aucs'] = aucs
    sess['durations'] = durations
    sess['frequencies'] = frequencies
    sess['latencies'] = latencies
    sess['decays'] = decays
    sess['rise_rates'] = rise_rates
    sess['event_times'] = event_times
    sess['tg_peaks'] = tg_peaks
    sess['tg_slopes'] = tg_slopes
    sess['tg_aucs'] = tg_aucs
    sess['addback_peaks'] = addback_peaks
    sess['addback_slopes'] = addback_slopes
    sess['addback_aucs'] = addback_aucs
    sess['addback_latencies'] = addback_latencies

    return {
        'time_axis':     sess['metadata']['time_axis'],
        'traces':        {str(k): v for k, v in traces.items()},
        'delta_f':       {str(k): v for k, v in delta_f.items()},
        'bg_trace':      bg_trace,
        'bg_mode':       params.bg_mode,
        'photobleach_mode': params.photobleach_mode,
        'analysis_mode': params.analysis_mode,
        'peaks':         {str(k): v for k, v in peaks.items()},
        'aucs':          {str(k): v for k, v in aucs.items()},
        'durations':     {str(k): v for k, v in durations.items()},
        'frequencies':   {str(k): v for k, v in frequencies.items()},
        'latencies':     {str(k): v for k, v in latencies.items()},
        'decays':        {str(k): v for k, v in decays.items()},
        'rise_rates':    {str(k): v for k, v in rise_rates.items()},
        'event_times':   {str(k): v for k, v in event_times.items()},
        'tg_peaks':      {str(k): v for k, v in tg_peaks.items()},
        'tg_slopes':     {str(k): v for k, v in tg_slopes.items()},
        'tg_aucs':       {str(k): v for k, v in tg_aucs.items()},
        'addback_peaks': {str(k): v for k, v in addback_peaks.items()},
        'addback_slopes': {str(k): v for k, v in addback_slopes.items()},
        'addback_aucs':  {str(k): v for k, v in addback_aucs.items()},
        'addback_latencies': {str(k): v for k, v in addback_latencies.items()},
    }


@app.get("/api/export/{file_id}")
async def export_csv(file_id: str, type: str = Query('raw'), _: str = Depends(get_current_user)):
    if type not in ('raw', 'delta_f'):
        raise HTTPException(400, "type must be 'raw' or 'delta_f'")

    sess = _get_session(file_id)
    data_map = sess['traces'] if type == 'raw' else sess['delta_f']
    if data_map is None:
        raise HTTPException(400, "Run analysis first")

    time_axis = sess['metadata']['time_axis']
    roi_ids = sorted(data_map.keys())

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['Time_s'] + [f'ROI_{rid}' for rid in roi_ids])
    for i, t in enumerate(time_axis):
        writer.writerow([f'{t:.4f}'] + [f'{data_map[rid][i]:.4f}' for rid in roi_ids])

    fname = f'calcium_{"raw" if type == "raw" else "deltaF"}.csv'
    return Response(
        content=out.getvalue(),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


@app.get("/api/export-workbook/{file_id}")
async def export_workbook(file_id: str, _: str = Depends(get_current_user)):
    sess = _get_session(file_id)
    if sess['traces'] is None or sess['delta_f'] is None:
        raise HTTPException(400, "Run analysis first")

    workbook_bytes = _build_analysis_workbook(sess)
    stem = os.path.splitext(sess.get('file_name') or 'calcium_analysis')[0]
    fname = f'{stem}_analysis.xlsx'
    return Response(
        content=workbook_bytes,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


@app.get("/api/export-overlay/{file_id}")
async def export_overlay_image(
    file_id: str,
    view: str = Query('frame'),
    t: int = Query(0),
    proj_type: str = Query('mean'),
    mode: str = Query('channel'),
    channel: int = Query(0),
    ratio_ch_num: int = Query(0),
    ratio_ch_den: int = Query(1),
    cmin: Optional[float] = None,
    cmax: Optional[float] = None,
    colormap: str = Query('green'),
    _: str = Depends(get_current_user),
):
    if view not in ('frame', 'projection'):
        raise HTTPException(400, "view must be 'frame' or 'projection'")
    if proj_type not in ('mean', 'max', 'min'):
        raise HTTPException(400, "proj_type must be 'mean', 'max', or 'min'")
    if mode not in ('channel', 'ratio'):
        raise HTTPException(400, "mode must be 'channel' or 'ratio'")

    sess = _get_session(file_id)
    if not sess['rois']:
        raise HTTPException(400, "No ROIs available to overlay")

    meta = sess['metadata']
    data = sess['data']
    t = int(np.clip(t, 0, meta['n_frames'] - 1))
    channel = int(np.clip(channel, 0, meta['n_channels'] - 1))
    ratio_ch_num = int(np.clip(ratio_ch_num, 0, meta['n_channels'] - 1))
    ratio_ch_den = int(np.clip(ratio_ch_den, 0, meta['n_channels'] - 1))

    if mode == 'ratio':
        if ratio_ch_num == ratio_ch_den:
            raise HTTPException(400, "Ratio export requires different numerator and denominator channels")
        if view == 'projection':
            frame = get_ratio_projection(data, proj_type=proj_type, ch_num=ratio_ch_num, ch_den=ratio_ch_den)
        else:
            frame = get_ratio_frame(data, t=t, ch_num=ratio_ch_num, ch_den=ratio_ch_den)
        if cmin is None or cmax is None:
            lo, hi = compute_ratio_percentile_contrast(data, ch_num=ratio_ch_num, ch_den=ratio_ch_den)
            cmin = lo if cmin is None else cmin
            cmax = hi if cmax is None else cmax
    else:
        if view == 'projection':
            frame = get_projection(data, proj_type=proj_type, channel=channel)
        else:
            frame = data[t, channel, :, :]
        if cmin is None:
            cmin = sess['contrast'][channel]['min']
        if cmax is None:
            cmax = sess['contrast'][channel]['max']

    img = frame_to_image(frame, cmin, cmax, colormap).convert('RGB')
    draw = ImageDraw.Draw(img)
    for roi in sess['rois']:
        contour = roi.get('contour') or []
        if len(contour) >= 2:
            pts = [(float(x), float(y)) for x, y in contour]
            draw.line(pts, fill=(255, 255, 0), width=2)
        centroid = roi.get('centroid') or []
        if len(centroid) == 2:
            draw.text((float(centroid[0]) + 3, float(centroid[1]) + 3), str(roi['id']), fill=(255, 255, 255))

    out = io.BytesIO()
    img.save(out, format='PNG')
    out.seek(0)
    stem = os.path.splitext(sess.get('file_name') or 'calcium_analysis')[0]
    suffix = 'projection' if view == 'projection' else f'frame_{t:04d}'
    fname = f'{stem}_roi_overlay_{suffix}.png'
    return Response(
        content=out.getvalue(),
        media_type='image/png',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


@app.get("/api/memory")
async def memory_stats(_: str = Depends(get_current_user)):
    proc = psutil.Process()
    rss = proc.memory_info().rss

    session_data_bytes = sum(
        s['data'].nbytes for s in sessions.values() if s.get('data') is not None
    )
    session_other_bytes = sum(
        (s['labels'].nbytes if s.get('labels') is not None else 0) +
        sum(v.nbytes for v in (s.get('traces') or {}).values() if hasattr(v, 'nbytes')) +
        sum(v.nbytes for v in (s.get('delta_f') or {}).values() if hasattr(v, 'nbytes'))
        for s in sessions.values()
    )

    return {
        'process_rss_bytes':    rss,
        'max_rss_bytes':        MAX_PROCESS_RSS_BYTES,
        'session_count':        len(sessions),
        'session_data_bytes':   session_data_bytes,
        'session_other_bytes':  session_other_bytes,
    }


@app.delete("/api/file/{file_id}")
async def cleanup(file_id: str, _: str = Depends(get_current_user)):
    sessions.pop(file_id, None)
    return {'status': 'ok'}


# ── Helper ───────────────────────────────────────────────────────────────────

def _get_session(file_id: str) -> dict:
    if file_id not in sessions:
        raise HTTPException(404, "Session not found — please re-upload the file")
    sessions[file_id]['last_accessed'] = time.monotonic()
    return sessions[file_id]


def _clear_analysis_results(sess: dict):
    sess['traces'] = None
    sess['delta_f'] = None
    sess['bg_trace'] = None
    sess['analysis_params'] = None
    sess['peaks'] = None
    sess['aucs'] = None
    sess['durations'] = None
    sess['frequencies'] = None
    sess['latencies'] = None
    sess['decays'] = None
    sess['rise_rates'] = None
    sess['event_times'] = None
    sess['tg_peaks'] = None
    sess['tg_slopes'] = None
    sess['tg_aucs'] = None
    sess['addback_peaks'] = None
    sess['addback_slopes'] = None
    sess['addback_aucs'] = None
    sess['addback_latencies'] = None


def _stringify_cell(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True)
    return str(value)


def _excel_col(idx: int) -> str:
    result = ''
    while idx:
        idx, rem = divmod(idx - 1, 26)
        result = chr(65 + rem) + result
    return result


def _sheet_xml(rows):
    row_xml = []
    for r_idx, row in enumerate(rows, start=1):
        cells = []
        for c_idx, value in enumerate(row, start=1):
            ref = f'{_excel_col(c_idx)}{r_idx}'
            if value is None or value == '':
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t></t></is></c>')
            elif isinstance(value, (int, float)) and not isinstance(value, bool) and np.isfinite(value):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                text = escape(_stringify_cell(value))
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>')
        row_xml.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(row_xml)}</sheetData>'
        '</worksheet>'
    )


def _build_xlsx(sheets):
    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ]
    for i in range(1, len(sheets) + 1):
        content_types.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    content_types.append('</Types>')

    workbook_rels = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ]
    workbook_sheets = []
    for i, (name, _rows) in enumerate(sheets, start=1):
        workbook_sheets.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
        workbook_rels.append(
            f'<Relationship Id="rId{i}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i}.xml"/>'
        )
    workbook_rels.append('</Relationships>')

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{"".join(workbook_sheets)}</sheets>'
        '</workbook>'
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '</Relationships>'
    )

    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', ''.join(content_types))
        zf.writestr('_rels/.rels', root_rels)
        zf.writestr('xl/workbook.xml', workbook_xml)
        zf.writestr('xl/_rels/workbook.xml.rels', ''.join(workbook_rels))
        for i, (_name, rows) in enumerate(sheets, start=1):
            zf.writestr(f'xl/worksheets/sheet{i}.xml', _sheet_xml(rows))
    return out.getvalue()


def _rows_from_trace_map(time_axis, data_map, bg_trace=None):
    roi_ids = sorted(data_map.keys())
    header = ['Time_s']
    if bg_trace is not None:
        header.append('Background')
    header.extend([f'ROI_{rid}' for rid in roi_ids])
    rows = [header]
    for i, t in enumerate(time_axis):
        row = [float(t)]
        if bg_trace is not None:
            row.append(float(bg_trace[i]) if i < len(bg_trace) else '')
        for rid in roi_ids:
            trace = data_map[rid]
            row.append(float(trace[i]) if i < len(trace) else '')
        rows.append(row)
    return rows


def _build_analysis_workbook(sess):
    meta = sess['metadata']
    analysis = sess.get('analysis_params') or {}
    detection = sess.get('detection_params') or {}
    traces = sess['traces']
    delta_f = sess['delta_f']
    time_axis = meta['time_axis']
    roi_ids = sorted(traces.keys())

    metadata_rows = [['Field', 'Value']]
    metadata_rows.extend([
        ['file_name', sess.get('file_name', '')],
        ['n_frames', meta['n_frames']],
        ['n_channels', meta['n_channels']],
        ['width', meta['width']],
        ['height', meta['height']],
        ['pixel_size', meta.get('pixel_size', '')],
        ['dtype', meta.get('dtype', '')],
        ['time_interval', meta.get('time_interval', '')],
        ['channel_names', meta.get('channel_names', [])],
        ['dropped_axes', meta.get('dropped_axes', {})],
        ['exported_at_utc', datetime.now(timezone.utc).isoformat()],
    ])

    settings_rows = [['Setting', 'Value']]
    for key in [
        'analysis_mode', 'channel', 'ratio_ch_num', 'ratio_ch_den',
        'baseline_start', 'baseline_end', 'auc_start', 'auc_end',
        'bg_mode', 'bg_percentile', 'bg_polygon', 'photobleach_mode',
        'tg_frame', 'tg_end_frame', 'tg_baseline_frames', 'tg_slope_frames',
        'addback_frame', 'addback_end_frame', 'addback_baseline_frames', 'addback_slope_frames',
        'roi_ids',
    ]:
        settings_rows.append([key, analysis.get(key, '')])
    for key in [
        'channel', 'projection_type', 'min_size', 'max_size',
        'threshold_adjust', 'smooth_sigma', 'background_radius',
        'seed_sigma', 'allow_edge_rois',
    ]:
        settings_rows.append([f'detection_{key}', detection.get(key, '')])

    roi_rows = [[
        'roi_id', 'area_px', 'centroid_x', 'centroid_y',
        'bbox_x1', 'bbox_y1', 'bbox_x2', 'bbox_y2', 'contour_json',
    ]]
    for roi in sorted(sess['rois'], key=lambda item: item['id']):
        bbox = roi.get('bbox', ['', '', '', ''])
        centroid = roi.get('centroid', ['', ''])
        roi_rows.append([
            roi['id'],
            roi.get('area', ''),
            centroid[0],
            centroid[1],
            bbox[0], bbox[1], bbox[2], bbox[3],
            roi.get('contour', []),
        ])

    metric_rows = [[
        'roi_id', 'peak', 'auc', 'event_fwhm', 'event_frequency',
        'time_to_peak', 'decay_t_half', 'rate_of_rise',
        'tg_peak', 'tg_slope', 'tg_auc',
        'addback_peak', 'addback_slope', 'addback_auc', 'addback_latency',
        'event_times_s',
    ]]
    for rid in roi_ids:
        metric_rows.append([
            rid,
            sess['peaks'].get(rid, ''),
            sess['aucs'].get(rid, ''),
            sess['durations'].get(rid, ''),
            sess['frequencies'].get(rid, ''),
            sess['latencies'].get(rid, ''),
            sess['decays'].get(rid, ''),
            sess['rise_rates'].get(rid, ''),
            sess['tg_peaks'].get(rid, ''),
            sess['tg_slopes'].get(rid, ''),
            sess['tg_aucs'].get(rid, ''),
            sess['addback_peaks'].get(rid, ''),
            sess['addback_slopes'].get(rid, ''),
            sess['addback_aucs'].get(rid, ''),
            sess['addback_latencies'].get(rid, ''),
            sess['event_times'].get(rid, []),
        ])

    sheets = [
        ('Metadata', metadata_rows),
        ('Settings', settings_rows),
        ('ROI_List', roi_rows),
        ('Raw_Traces', _rows_from_trace_map(time_axis, traces, sess.get('bg_trace'))),
        ('DeltaF', _rows_from_trace_map(time_axis, delta_f)),
        ('Metrics', metric_rows),
    ]
    return _build_xlsx(sheets)


# ── Static frontend (mounted last so API routes take priority) ────────────────

_frontend = os.path.join(os.path.dirname(__file__), '..', 'frontend')
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
