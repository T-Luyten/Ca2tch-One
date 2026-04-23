import numpy as np
from scipy import ndimage as ndi
from skimage import filters, morphology, segmentation, measure, feature


def _remove_small_objects(binary, min_size):
    cutoff = max(4, int(min_size))
    try:
        return morphology.remove_small_objects(binary, max_size=cutoff - 1)
    except TypeError:
        return morphology.remove_small_objects(binary, min_size=cutoff)


def _remove_small_holes(binary, area_threshold):
    cutoff = max(4, int(area_threshold))
    try:
        return morphology.remove_small_holes(binary, max_size=cutoff - 1)
    except TypeError:
        return morphology.remove_small_holes(binary, area_threshold=cutoff)


def _touches_image_edge(region, shape, margin=0):
    min_row, min_col, max_row, max_col = region.bbox
    height, width = shape
    return (
        min_row <= margin
        or min_col <= margin
        or max_row >= height - margin
        or max_col >= width - margin
    )


def _relabel_by_size(labels, min_size, max_size, allow_edge_rois=False, edge_margin=0):
    regions = measure.regionprops(labels)
    new_labels = np.zeros_like(labels)
    new_id = 1
    for region in regions:
        touches_edge = _touches_image_edge(region, labels.shape, margin=edge_margin)
        if min_size <= region.area <= max_size and (allow_edge_rois or not touches_edge):
            new_labels[labels == region.label] = new_id
            new_id += 1
    return new_labels, measure.regionprops(new_labels)


def detect_rois(
    projection,
    min_size=100,
    max_size=10000,
    threshold_adjust=1.0,
    smooth_sigma=2.0,
    background_radius=None,
    seed_sigma=1.0,
    allow_edge_rois=False,
    exclude_mask=None,
    compactness=0.001,
):
    """
    Detect cell ROIs from a 2D projection image.

    Parameters
    ----------
    projection : 2D array
    min_size : minimum ROI area in pixels
    max_size : maximum ROI area in pixels
    threshold_adjust : multiplier for threshold (>1 = stricter, <1 = more inclusive)
    smooth_sigma : Gaussian blur sigma before thresholding
    exclude_mask : boolean 2D array of pixels to exclude

    Returns
    -------
    labels : 2D int array (0 = background, 1..N = ROI ids)
    regions : list of skimage RegionProperties
    """
    proj = projection.astype(float)

    # Robust percentile normalization — resistant to single bright outlier pixels
    p1, p999 = np.percentile(proj, [1, 99.9])
    if p999 > p1:
        proj = np.clip((proj - p1) / (p999 - p1), 0.0, 1.0)

    # Gaussian smoothing to reduce shot noise before thresholding
    smoothed = filters.gaussian(proj, sigma=smooth_sigma)

    # Rolling ball background subtraction via morphological white top-hat.
    # This removes slowly varying background (autofluorescence, uneven illumination)
    # while preserving bright cell bodies. Ball radius should be larger than the
    # largest expected cell so it only captures background structure.
    if background_radius is None:
        # Scale with expected cell size rather than image dimensions.
        # Ball must exceed cell diameter so it only captures background structure.
        expected_radius = (min_size / np.pi) ** 0.5
        ball_radius = int(np.clip(3 * expected_radius, 15, 500))
    else:
        ball_radius = max(3, int(background_radius))
    corrected = morphology.white_tophat(smoothed, morphology.disk(ball_radius))
    if corrected.max() > 0:
        corrected = corrected / corrected.max()

    # Triangle threshold: designed for skewed histograms where background pixels
    # dominate (typical in sparse fluorescence images). Falls back to Otsu.
    try:
        thresh = filters.threshold_triangle(corrected) * threshold_adjust
    except Exception:
        try:
            thresh = filters.threshold_otsu(corrected) * threshold_adjust
        except Exception:
            thresh = corrected.mean() * threshold_adjust

    binary = corrected > thresh

    if exclude_mask is not None:
        excl = morphology.dilation(exclude_mask.astype(bool), morphology.disk(5))
        binary[excl] = False

    # Morphological closing fills small gaps within cell bodies before cleanup
    binary = morphology.closing(binary, morphology.disk(2))
    binary = _remove_small_objects(binary, min_size=min_size)
    binary = _remove_small_holes(binary, area_threshold=max(4, min_size // 2))

    # Distance transform: peak = cell centre, used as watershed seed
    distance = ndi.distance_transform_edt(binary)

    # Smooth the distance map just enough to remove edge noise without merging
    # peaks from adjacent cells. A fixed small sigma is safer than scaling with
    # smooth_sigma, which could over-smooth when cells are tightly packed.
    distance_smooth = filters.gaussian(distance, sigma=max(0.1, float(seed_sigma)))

    # min_distance controls how close two seeds can be. Using 0.5× cell radius
    # (rather than 0.8×) ensures that touching cells — whose centres can be as
    # close as one diameter apart — still produce two distinct seeds.
    cell_radius = max(3, int(np.sqrt(min_size / np.pi)))
    min_dist = max(3, int(cell_radius * 0.5))

    local_max_coords = feature.peak_local_max(
        distance_smooth,
        min_distance=min_dist,
        labels=binary,
    )

    if len(local_max_coords) == 0:
        return np.zeros(binary.shape, dtype=int), []

    local_max = np.zeros_like(distance, dtype=bool)
    local_max[tuple(local_max_coords.T)] = True
    markers = measure.label(local_max)

    # Watershed on the smoothed distance map. compactness > 0 adds a distance
    # penalty that encourages rounder, more cell-like segments and reduces
    # irregular borders between touching cells.
    labels = segmentation.watershed(
        -distance_smooth, markers, mask=binary, compactness=compactness
    )
    labels, _ = _relabel_by_size(
        labels,
        min_size=min_size,
        max_size=max_size,
        allow_edge_rois=allow_edge_rois,
    )

    # Expand seed regions to full cell body using the background-corrected signal.
    # Reuses the existing binary mask (slightly dilated) so the expansion is
    # consistent with the initial segmentation rather than re-thresholding.
    return _expand_labels_to_cell_edges(
        labels,
        corrected=corrected,
        binary=binary,
        min_size=min_size,
        max_size=max_size,
        allow_edge_rois=allow_edge_rois,
        exclude_mask=exclude_mask,
        compactness=compactness,
    )


def _expand_labels_to_cell_edges(
    labels,
    corrected,
    binary,
    min_size,
    max_size,
    allow_edge_rois=False,
    exclude_mask=None,
    compactness=0.001,
):
    """Expand seed labels to the full cell body via watershed on the signal image."""
    if labels.max() == 0:
        return labels, []

    # Use the binary mask as-is without dilation. Dilating even by 1–2 px can
    # bridge the narrow gap between touching cells and merge them into one ROI.
    cell_mask = binary.copy()
    cell_mask = _remove_small_objects(cell_mask, min_size=min_size)

    if exclude_mask is not None:
        excl = morphology.dilation(exclude_mask.astype(bool), morphology.disk(5))
        cell_mask[excl] = False

    # Watershed on the intensity image fills each seed region toward the cell
    # boundary; compactness keeps segments from becoming elongated in gaps.
    grown_labels = segmentation.watershed(
        -corrected, labels, mask=cell_mask, compactness=compactness
    )
    return _relabel_by_size(
        grown_labels,
        min_size=min_size,
        max_size=max_size,
        allow_edge_rois=allow_edge_rois,
    )


def get_contours(labels, regions):
    """Extract polygon contours and metadata for each ROI."""
    rois = []
    for r in regions:
        roi_id = r.label
        mask = (labels == roi_id).astype(float)

        try:
            contours = measure.find_contours(mask, 0.5)
            if contours:
                contour = max(contours, key=len)
                # Downsample long contours for JSON performance
                step = max(1, len(contour) // 150)
                contour = contour[::step]
                # Convert [row, col] -> [x, y]
                contour_xy = [[float(c[1]), float(c[0])] for c in contour]
                if contour_xy[0] != contour_xy[-1]:
                    contour_xy.append(contour_xy[0])
            else:
                raise ValueError("no contour")
        except Exception:
            minr, minc, maxr, maxc = r.bbox
            contour_xy = [
                [float(minc), float(minr)],
                [float(maxc), float(minr)],
                [float(maxc), float(maxr)],
                [float(minc), float(maxr)],
            ]

        rois.append({
            'id': int(roi_id),
            'area': int(r.area),
            'centroid': [float(r.centroid[1]), float(r.centroid[0])],  # [x, y]
            'contour': contour_xy,
            'bbox': [
                int(r.bbox[1]), int(r.bbox[0]),
                int(r.bbox[3]), int(r.bbox[2]),
            ],  # [x1, y1, x2, y2]
        })

    return rois
