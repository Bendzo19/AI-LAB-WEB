#!/usr/bin/env python3
"""Build a simulator track (with real elevation) from FastF1 position data.

Uses the fastest lap's X/Y/Z trace as the centre line, smooths and resamples
it, and writes the TUM racetrack-database CSV layout with an extra z column:

    x_m, y_m, w_tr_right_m, w_tr_left_m, z_m

Track widths are not in the timing data, so constant widths are used (edit the
CSV or pass --width-left/--width-right). The car's path is a racing line, not
the geometric centre line; with ~7 m half-widths the error is acceptable for
early tests but a surveyed centre line is better (see docs/DATA.md).

    pip install fastf1 numpy
    python track_from_fastf1.py --year 2025 --event Austria --out ../data/tracks/spielberg_ff1.csv
"""
import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--event", required=True)
    ap.add_argument("--session", default="Q")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width-left", type=float, default=7.0)
    ap.add_argument("--width-right", type=float, default=7.0)
    ap.add_argument("--spacing", type=float, default=5.0, help="output point spacing [m]")
    ap.add_argument("--smooth", type=int, default=7, help="moving-average window (points)")
    ap.add_argument("--cache", default="fastf1_cache")
    args = ap.parse_args()

    try:
        import fastf1
        import numpy as np
    except ImportError:
        print("pip install fastf1 numpy", file=sys.stderr)
        return 1
    import os

    os.makedirs(args.cache, exist_ok=True)
    fastf1.Cache.enable_cache(args.cache)
    event = int(args.event) if args.event.isdigit() else args.event
    session = fastf1.get_session(args.year, event, args.session)
    session.load(laps=True, telemetry=True, weather=False, messages=False)
    try:
        session.laps  # raises if the timing data could not be downloaded
    except Exception:
        print("Could not load timing data. FastF1 needs internet access to livetiming.formula1.com "
              "(and the session must have taken place).", file=sys.stderr)
        return 2
    pos = session.laps.pick_fastest().get_pos_data()
    xyz = np.column_stack([pos["X"].to_numpy(), pos["Y"].to_numpy(), pos["Z"].to_numpy()]) / 10.0

    # Drop duplicates (car stationary / repeated samples).
    keep = np.r_[True, np.linalg.norm(np.diff(xyz[:, :2], axis=0), axis=1) > 0.05]
    xyz = xyz[keep]

    # Resample by arc length on the closed loop.
    closed = np.vstack([xyz, xyz[:1]])
    seg = np.linalg.norm(np.diff(closed[:, :2], axis=0), axis=1)
    s = np.r_[0.0, np.cumsum(seg)]
    total = s[-1]
    n = int(total // args.spacing)
    grid = np.linspace(0.0, total, n, endpoint=False)
    res = np.column_stack([np.interp(grid, s, closed[:, k]) for k in range(3)])

    # Circular moving average (x, y lightly; z more, the Z channel is noisy).
    def circ_smooth(v, w):
        if w <= 1:
            return v
        k = np.ones(w) / w
        pad = np.r_[v[-w:], v, v[:w]]
        return np.convolve(pad, k, mode="same")[w:-w]

    for k, w in ((0, args.smooth), (1, args.smooth), (2, args.smooth * 3)):
        res[:, k] = circ_smooth(res[:, k], w)

    with open(args.out, "w") as f:
        f.write(f"# generated from FastF1 {args.year} {args.event} {args.session} fastest lap position data\n")
        f.write("# x_m,y_m,w_tr_right_m,w_tr_left_m,z_m\n")
        for x, y, z in res:
            f.write(f"{x:.3f},{y:.3f},{args.width_right:.2f},{args.width_left:.2f},{z:.3f}\n")
    print(f"{args.out}: {len(res)} points, {total:.0f} m, elevation {res[:, 2].min():.1f}..{res[:, 2].max():.1f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
