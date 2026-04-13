# Calcium Imaging Analyzer

Web application for analyzing `.nd2` calcium imaging datasets with ROI detection, trace extraction, background correction, and summary metrics.

## What It Does

- Loads Nikon `.nd2` files through a FastAPI backend
- Displays frames and image projections in the browser
- Detects cell ROIs on a source dataset
- Transfers detected ROIs to a separate measurement dataset
- Extracts raw fluorescence traces per ROI
- Computes normalized traces (`ΔF/F0`)
- Supports Fura-2 ratio analysis
- Supports automatic or manual background correction
- Exports analysis results as CSV
- Reports summary metrics including peak, AUC, and rate of rise

## Project Structure

```text
backend/
  main.py            FastAPI app and API routes
  image_io.py        ND2 loading, projections, contrast, PNG conversion
  detection.py       ROI detection and contour extraction
  analysis.py        Trace extraction and analysis utilities
  requirements.txt   Python dependencies

frontend/
  index.html         Application shell
  style.css          UI styling
  app.js             Frontend logic and plotting

start.sh             Local startup script
```

## Requirements

- Python 3.12 recommended
- `python3-venv`

Backend dependencies are listed in `backend/requirements.txt`.

## Running Locally

From the repository root:

```bash
./start.sh
```

The script will:

1. Create `backend/venv` if needed
2. Install or update Python dependencies
3. Start the FastAPI server on `http://localhost:8001`

Then open:

```text
http://localhost:8001
```

If `python3-venv` is missing on Ubuntu/Debian:

```bash
sudo apt install python3.12-venv
```

## Typical Workflow

1. Load an `.nd2` file as the ROI source
2. Run cell detection on the source file
3. Load an `.nd2` file as the measurement file
4. Copy ROIs to the measurement dataset
5. Choose analysis settings:
   - single-channel or Fura-2 ratio mode
   - baseline frame range
   - background correction mode
6. Run trace extraction
7. Review raw traces, normalized traces, and summary plots
8. Export CSV output

## Main Backend Endpoints

- `POST /api/upload`
- `GET /api/frame/{file_id}`
- `GET /api/projection/{file_id}`
- `GET /api/contrast/{file_id}`
- `POST /api/detect/{file_id}`
- `DELETE /api/roi/{file_id}/{roi_id}`
- `POST /api/transfer-rois`
- `POST /api/analyze/{file_id}`
- `GET /api/export/{file_id}`
- `DELETE /api/file/{file_id}`

## Notes

- Only `.nd2` files are accepted by the upload API
- Uploaded datasets are kept in memory for the active session
- Large raw microscopy files are intentionally not stored in the repository
- Local virtual environments and Python cache files are ignored through `.gitignore`
