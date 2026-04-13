import csv
import io
import os
import tempfile
import uuid
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from analysis import (
    compute_delta_f,
    compute_peak_and_auc,
    compute_rate_of_rise,
    extract_ratio_traces,
    extract_traces,
    polygon_to_mask,
)
from detection import detect_rois, get_contours
from image_io import (
    compute_percentile_contrast,
    frame_to_png,
    get_projection,
    load_nd2_file,
)

app = FastAPI(title="Calcium Imaging Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    exclude_mask: Optional[List[List[int]]] = None  # [[y,x], ...]


class AnalyzeParams(BaseModel):
    channel: int = 0
    baseline_start: int = 0
    baseline_end: int = 10
    roi_ids: Optional[List[int]] = None        # None = all current ROIs
    bg_mode: str = 'none'                      # 'none' | 'auto' | 'manual'
    bg_percentile: float = 10.0                # auto mode: darkest N% of non-cell pixels
    bg_polygon: Optional[List[List[float]]] = None  # manual mode: [[x,y], ...]
    analysis_mode: str = 'single'              # 'single' | 'ratio'
    ratio_ch_num: int = 0                      # Fura-2: numerator channel (e.g. 340 nm)
    ratio_ch_den: int = 1                      # Fura-2: denominator channel (e.g. 380 nm)


class TransferRoisParams(BaseModel):
    source_file_id: str
    target_file_id: str


# ── API routes ────────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not (file.filename or '').lower().endswith('.nd2'):
        raise HTTPException(400, "Only .nd2 files are supported")

    with tempfile.NamedTemporaryFile(suffix='.nd2', delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        data, metadata = load_nd2_file(tmp_path)
    except Exception as exc:
        raise HTTPException(500, f"Failed to read ND2 file: {exc}") from exc
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
        'data': data,
        'metadata': metadata,
        'labels': None,
        'rois': [],
        'traces': None,
        'delta_f': None,
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
    channel: int = Query(0),
    cmin: Optional[float] = None,
    cmax: Optional[float] = None,
    colormap: str = Query('green'),
):
    sess = _get_session(file_id)
    data = sess['data']
    meta = sess['metadata']

    t = int(np.clip(t, 0, meta['n_frames'] - 1))
    channel = int(np.clip(channel, 0, meta['n_channels'] - 1))

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
    channel: int = Query(0),
    cmin: Optional[float] = None,
    cmax: Optional[float] = None,
    colormap: str = Query('green'),
):
    sess = _get_session(file_id)
    proj = get_projection(sess['data'], proj_type=type, channel=channel)
    return Response(
        content=frame_to_png(proj, cmin, cmax, colormap),
        media_type='image/png',
    )


@app.get("/api/contrast/{file_id}")
async def get_contrast(
    file_id: str,
    channel: int = Query(0),
    p_low: float = Query(1.0),
    p_high: float = Query(99.5),
):
    sess = _get_session(file_id)
    lo, hi = compute_percentile_contrast(sess['data'], channel=channel,
                                         p_low=p_low, p_high=p_high)
    sess['contrast'][channel] = {'min': lo, 'max': hi}
    return {'min': lo, 'max': hi}


@app.post("/api/detect/{file_id}")
async def detect(file_id: str, params: DetectParams):
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
            exclude_mask=exclude,
        )
    except Exception as exc:
        raise HTTPException(500, f"Detection failed: {exc}") from exc

    sess['labels'] = labels
    sess['traces'] = None
    sess['delta_f'] = None

    rois = get_contours(labels, regions)
    sess['rois'] = rois

    return {'n_rois': len(rois), 'rois': rois}


@app.delete("/api/roi/{file_id}/{roi_id}")
async def delete_roi(file_id: str, roi_id: int):
    sess = _get_session(file_id)
    if sess['labels'] is None:
        raise HTTPException(400, "No ROIs detected yet")

    sess['labels'][sess['labels'] == roi_id] = 0
    sess['rois'] = [r for r in sess['rois'] if r['id'] != roi_id]
    sess['traces'] = None
    sess['delta_f'] = None
    return {'deleted': roi_id}


@app.post("/api/transfer-rois")
async def transfer_rois(params: TransferRoisParams):
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
    target['traces'] = None
    target['delta_f'] = None
    target['bg_trace'] = None
    target['peaks'] = None
    target['aucs'] = None

    return {
        'target_file_id': params.target_file_id,
        'n_rois': len(target['rois']),
        'rois': target['rois'],
    }


@app.post("/api/analyze/{file_id}")
async def analyze(file_id: str, params: AnalyzeParams):
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
            )
            bg_trace = bg_trace_num  # expose numerator BG for display
        else:
            traces, bg_trace = extract_traces(
                sess['data'], sess['labels'], roi_ids,
                channel=params.channel,
                bg_mode=params.bg_mode,
                bg_percentile=params.bg_percentile,
                bg_mask=bg_mask,
            )

        delta_f = compute_delta_f(
            traces,
            baseline_start=params.baseline_start,
            baseline_end=params.baseline_end,
        )
        peaks, aucs = compute_peak_and_auc(delta_f, sess['metadata']['time_axis'])
        rise_rates = compute_rate_of_rise(delta_f, sess['metadata']['time_axis'])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Analysis failed: {exc}") from exc

    sess['traces'] = traces
    sess['delta_f'] = delta_f
    sess['bg_trace'] = bg_trace
    sess['peaks'] = peaks
    sess['aucs'] = aucs
    sess['rise_rates'] = rise_rates

    return {
        'time_axis':     sess['metadata']['time_axis'],
        'traces':        {str(k): v for k, v in traces.items()},
        'delta_f':       {str(k): v for k, v in delta_f.items()},
        'bg_trace':      bg_trace,
        'bg_mode':       params.bg_mode,
        'analysis_mode': params.analysis_mode,
        'peaks':         {str(k): v for k, v in peaks.items()},
        'aucs':          {str(k): v for k, v in aucs.items()},
        'rise_rates':    {str(k): v for k, v in rise_rates.items()},
    }


@app.get("/api/export/{file_id}")
async def export_csv(file_id: str, type: str = Query('raw')):
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


@app.delete("/api/file/{file_id}")
async def cleanup(file_id: str):
    sessions.pop(file_id, None)
    return {'status': 'ok'}


# ── Helper ───────────────────────────────────────────────────────────────────

def _get_session(file_id: str) -> dict:
    if file_id not in sessions:
        raise HTTPException(404, "Session not found — please re-upload the file")
    return sessions[file_id]


# ── Static frontend (mounted last so API routes take priority) ────────────────

_frontend = os.path.join(os.path.dirname(__file__), '..', 'frontend')
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
