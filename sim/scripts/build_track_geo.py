#!/usr/bin/env python3
"""Build a simulator track with real elevation from open geodata.

Combines:
  * a centre line + track widths in local metres (TUM racetrack-database CSV),
  * the circuit's geographic outline (GeoJSON, e.g. bacinger/f1-circuits) to
    georeference that centre line (rigid 2D alignment: Procrustes + ICP),
  * a digital elevation model GeoTIFF (e.g. Copernicus GLO-30) sampled along
    the aligned centre line, then smoothed (the DEM is a surface model with
    ~30 m cells, so trees/buildings next to the track add noise).

Output: TUM layout plus z -> x_m, y_m, w_tr_right_m, w_tr_left_m, z_m

    pip install numpy rasterio
    python build_track_geo.py --tum Spielberg.csv --geojson f1-circuits.geojson --id at-1969 \
        --dem Copernicus_DSM_COG_10_N47_00_E014_00_DEM.tif --out ../data/tracks/red_bull_ring.csv
"""
import argparse
import json
import math
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tum", required=True)
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--id", required=True, help="feature id in the GeoJSON (e.g. at-1969)")
    ap.add_argument("--dem", required=True, nargs="+", help="one or more GeoTIFF tiles")
    ap.add_argument("--out", required=True)
    ap.add_argument("--smooth-m", type=float, default=60.0, help="elevation smoothing window [m]")
    ap.add_argument("--start-shift-m", type=float, default=0.0, help="move the start line along the lap [m]")
    ap.add_argument("--reverse", action="store_true", help="reverse the TUM direction of travel")
    ap.add_argument("--header", default="", help="extra comment line for the output file")
    args = ap.parse_args()
    import numpy as np
    import rasterio

    tum = np.array([[float(v) for v in line.split(",")] for line in open(args.tum)
                    if line.strip() and not line.startswith("#")])
    if args.reverse:
        tum = tum[::-1].copy()
        tum[:, [2, 3]] = tum[:, [3, 2]]  # right/left widths swap with direction
    feat = next(f for f in json.load(open(args.geojson))["features"] if f["properties"].get("id") == args.id)
    lonlat = np.array(feat["geometry"]["coordinates"], dtype=float)
    if lonlat.ndim == 3:
        lonlat = lonlat[0]
    lon0, lat0 = lonlat[:, 0].mean(), lonlat[:, 1].mean()
    R = 6371008.8
    kx = math.cos(math.radians(lat0)) * math.pi / 180 * R
    ky = math.pi / 180 * R
    geo = np.column_stack([(lonlat[:, 0] - lon0) * kx, (lonlat[:, 1] - lat0) * ky])

    def resample(p, n):
        q = np.vstack([p, p[:1]])
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))]
        g = np.linspace(0, s[-1], n, endpoint=False)
        return np.column_stack([np.interp(g, s, q[:, 0]), np.interp(g, s, q[:, 1])]), s[-1]

    n = 400
    a, la = resample(tum[:, :2], n)
    b, lb = resample(geo, n)
    print(f"lengths: TUM {la:.0f} m, GeoJSON {lb:.0f} m")

    def procrustes(src, dst):
        ms, md = src.mean(0), dst.mean(0)
        u, _, vt = np.linalg.svd((src - ms).T @ (dst - md))
        r = (u @ vt).T
        if np.linalg.det(r) < 0:
            vt[-1] *= -1
            r = (u @ vt).T
        return r, md - ms @ r.T

    # Coarse search over direction and cyclic shift, then ICP refinement.
    best = None
    for rev in (False, True):
        bb = b[::-1] if rev else b
        for shift in range(0, n, 4):
            r, t = procrustes(a, np.roll(bb, shift, axis=0))
            err = np.mean(np.linalg.norm(a @ r.T + t - np.roll(bb, shift, axis=0), axis=1))
            if best is None or err < best[0]:
                best = (err, r, t)
    _, r, t = best
    dense_b, _ = resample(geo, 4000)
    for _ in range(30):
        moved = a @ r.T + t
        idx = np.argmin(((moved[:, None, :] - dense_b[None, :, :]) ** 2).sum(-1), axis=1)
        r, t = procrustes(a, dense_b[idx])
    moved = a @ r.T + t
    idx = np.argmin(((moved[:, None, :] - dense_b[None, :, :]) ** 2).sum(-1), axis=1)
    rms = float(np.sqrt(np.mean(np.sum((moved - dense_b[idx]) ** 2, axis=1))))
    print(f"alignment RMS {rms:.1f} m (rotation {math.degrees(math.atan2(r[1, 0], r[0, 0])):.1f} deg)")
    if rms > 25.0:
        print("alignment is poor - check the GeoJSON id / direction", file=sys.stderr)
        return 1

    # Sample the DEM along the full-resolution centre line.
    xy = tum[:, :2] @ r.T + t
    lon = xy[:, 0] / kx + lon0
    lat = xy[:, 1] / ky + lat0
    z = np.full(len(xy), np.nan)
    for path in args.dem:
        with rasterio.open(path) as ds:
            band = ds.read(1).astype(float)
            inv = ~ds.transform
            for i, (lo, la_) in enumerate(zip(lon, lat)):
                if not np.isnan(z[i]):
                    continue
                c, rr = inv * (lo, la_)
                c0, r0 = int(math.floor(c - 0.5)), int(math.floor(rr - 0.5))
                if 0 <= r0 < band.shape[0] - 1 and 0 <= c0 < band.shape[1] - 1:
                    fx, fy = c - 0.5 - c0, rr - 0.5 - r0
                    v = band[r0:r0 + 2, c0:c0 + 2]
                    z[i] = (v[0, 0] * (1 - fx) * (1 - fy) + v[0, 1] * fx * (1 - fy) +
                            v[1, 0] * (1 - fx) * fy + v[1, 1] * fx * fy)
    if np.isnan(z).any():
        print(f"{int(np.isnan(z).sum())} points outside the DEM tiles", file=sys.stderr)
        return 1

    # Robust smoothing along the lap: rolling median, then moving average.
    seg = np.linalg.norm(np.diff(np.vstack([tum[:, :2], tum[:1, :2]]), axis=0), axis=1)
    step = float(np.mean(seg))
    w = max(3, int(args.smooth_m / step) | 1)
    pad = np.r_[z[-w:], z, z[:w]]
    med = np.array([np.median(pad[i:i + w]) for i in range(len(z) + w)])[w // 2 + 1: w // 2 + 1 + len(z)]
    k = np.ones(w) / w
    pad2 = np.r_[med[-w:], med, med[:w]]
    zs = np.convolve(pad2, k, mode="same")[w:-w]
    zs -= zs.min()

    out = np.column_stack([tum[:, 0], tum[:, 1], tum[:, 2], tum[:, 3], zs])
    if args.start_shift_m:
        s = np.r_[0, np.cumsum(seg[:-1])]
        out = np.roll(out, -int(np.searchsorted(s, args.start_shift_m % s[-1])), axis=0)
    grade = np.diff(np.r_[zs, zs[:1]]) / seg
    with open(args.out, "w") as f:
        f.write("# x_m,y_m,w_tr_right_m,w_tr_left_m,z_m\n")
        if args.header:
            f.write("# " + args.header + "\n")
        for row in out:
            f.write(",".join(f"{v:.3f}" for v in row) + "\n")
    print(f"{args.out}: {len(out)} points, elevation range {zs.max():.1f} m, "
          f"max grade {grade.max() * 100:.1f}% / {grade.min() * 100:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
