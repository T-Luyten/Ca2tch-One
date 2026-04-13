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


def _relabel_by_size(labels, min_size, max_size):
    regions = measure.regionprops(labels)
    new_labels = np.zeros_like(labels)
    new_id = 1
    for region in regions:
        if min_size <= region.area <= max_size and not _touches_image_edge(region, labels.shape):
            new_labels[labels == region.label] = new_id
            new_id += 1
    return new_labels, measure.regionprops(new_labels)


def _expand_labels_to_cell_edges(labels, smoothed, min_size, max_size, exclude_mask=None):
    if labels.max() == 0:
        return labels, []

    # Grow nucleus-centered seeds into a broader cell-body mask derived from
    # the original smoothed signal. This extends ROIs toward the cell edge
    # without allowing neighboring cells to merge.
    growth_threshold = min(filters.threshold_li(smoothed), float(np.quantile(smoothed, 0.94)))
    cell_mask = smoothed > growth_threshold
    cell_mask = morphology.closing(cell_mask, morphology.disk(3))
    cell_mask = _remove_small_objects(cell_mask, min_size=min_size)
    cell_mask = _remove_small_holes(cell_mask, area_threshold=max(16, min_size))

    if exclude_mask is not None:
        excl = morphology.dilation(exclude_mask.astype(bool), morphology.disk(5))
        cell_mask[excl] = False

    grown_labels = segmentation.watershed(-smoothed, labels, mask=cell_mask)
    return _relabel_by_size(grown_labels, min_size=min_size, max_size=max_size)


def detect_rois(
    projection,
    min_size=100,
    max_size=10000,
    threshold_adjust=1.0,
    smooth_sigma=2.0,
    exclude_mask=None,
):
    """
    Detect cell ROIs from a 2D projection image.

    Parameters
    ----------
    projection : 2D array
    min_size : minimum ROI area in pixels
    max_size : maximum ROI area in pixels
    threshold_adjust : multiplier for Otsu threshold (>1 = stricter, <1 = more inclusive)
    smooth_sigma : Gaussian blur sigma before thresholding
    exclude_mask : boolean 2D array of pixels to exclude

    Returns
    -------
    labels : 2D int array (0 = background, 1..N = ROI ids)
    regions : list of skimage RegionProperties
    """
    proj = projection.astype(float)
    pmin, pmax = proj.min(), proj.max()
    if pmax > pmin:
        proj = (proj - pmin) / (pmax - pmin)

    smoothed = filters.gaussian(proj, sigma=smooth_sigma)

    # Mild background subtraction
    bg = filters.gaussian(proj, sigma=max(smooth_sigma * 8, 20))
    corrected = np.clip(smoothed - bg * 0.8, 0, None)
    if corrected.max() > 0:
        corrected /= corrected.max()

    try:
        thresh = filters.threshold_otsu(corrected) * threshold_adjust
    except Exception:
        thresh = corrected.mean() * threshold_adjust

    binary = corrected > thresh

    if exclude_mask is not None:
        excl = morphology.dilation(exclude_mask.astype(bool), morphology.disk(5))
        binary[excl] = False

    binary = _remove_small_objects(binary, min_size=min_size)
    binary = _remove_small_holes(binary, area_threshold=max(4, min_size // 2))

    distance = ndi.distance_transform_edt(binary)
    min_dist = max(3, int(np.sqrt(min_size / np.pi) * 0.7))

    local_max_coords = feature.peak_local_max(distance, min_distance=min_dist, labels=binary)

    if len(local_max_coords) == 0:
        return np.zeros(binary.shape, dtype=int), []

    local_max = np.zeros_like(distance, dtype=bool)
    local_max[tuple(local_max_coords.T)] = True
    markers = measure.label(local_max)

    labels = segmentation.watershed(-distance, markers, mask=binary)
    labels, _ = _relabel_by_size(labels, min_size=min_size, max_size=max_size)
    return _expand_labels_to_cell_edges(
        labels,
        smoothed=smoothed,
        min_size=min_size,
        max_size=max_size,
        exclude_mask=exclude_mask,
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
