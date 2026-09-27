#!/usr/bin/env python3
"""Overlay two laps (simulator and/or FastF1 export) against distance.

Plots speed, throttle, brake, gear and the running time delta, and prints a
short summary (lap time, top/min speed, time lost per sector). Both files
need the columns Distance, Speed, Throttle, Brake, nGear and Time.

    pip install numpy matplotlib
    python compare_laps.py sim_lap.csv real_lap.csv --labels SIM REAL --out compare.png
"""
import argparse
import csv
import sys


def load(path):
    cols = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(r for r in f if not r.startswith("#")):
            for k, v in row.items():
                try:
                    cols.setdefault(k, []).append(float(v))
                except (TypeError, ValueError):
                    pass
    for need in ("Distance", "Speed", "Throttle", "Brake", "nGear", "Time"):
        if need not in cols:
            raise SystemExit(f"{path}: missing column '{need}'")
    return cols


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--labels", nargs=2, default=["A", "B"])
    ap.add_argument("--out", default="compare.png")
    args = ap.parse_args()
    try:
        import numpy as np
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("pip install numpy matplotlib", file=sys.stderr)
        return 1

    A, B = load(args.a), load(args.b)
    la, lb = args.labels
    da, db = np.array(A["Distance"]), np.array(B["Distance"])
    # Normalise both to lap fraction x common length (tracks may differ slightly).
    length = min(da.max(), db.max())
    grid = np.linspace(0, length, 2000)
    def on_grid(C, d, key):
        return np.interp(grid, d * (length / d.max()), np.array(C[key]))
    ta, tb = on_grid(A, da, "Time"), on_grid(B, db, "Time")

    fig, ax = plt.subplots(5, 1, figsize=(14, 12), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1.3, 1.3, 1, 1.5]})
    for C, d, lab, col in ((A, da, la, "#8b7cff"), (B, db, lb, "#e0463c")):
        x = d * (length / d.max())
        ax[0].plot(x, C["Speed"], color=col, lw=1.2, label=lab)
        ax[1].plot(x, C["Throttle"], color=col, lw=1)
        ax[2].plot(x, C["Brake"], color=col, lw=1)
        ax[3].plot(x, C["nGear"], color=col, lw=1, drawstyle="steps-post")
    ax[4].plot(grid, ta - tb, color="#333")
    ax[4].axhline(0, color="#999", lw=0.8)
    ax[0].set_ylabel("speed [km/h]")
    ax[1].set_ylabel("throttle [%]")
    ax[2].set_ylabel("brake")
    ax[3].set_ylabel("gear")
    ax[4].set_ylabel(f"delta {la}-{lb} [s]")
    ax[4].set_xlabel("distance [m]")
    ax[0].legend(loc="lower right")
    for a in ax:
        a.grid(alpha=0.3)
    fig.suptitle(f"{la}: {max(A['Time']):.3f} s   {lb}: {max(B['Time']):.3f} s")
    fig.tight_layout()
    fig.savefig(args.out, dpi=110)

    print(f"{la}: lap {max(A['Time']):.3f} s, vmax {max(A['Speed']):.1f}, vmin {min(A['Speed']):.1f} km/h")
    print(f"{lb}: lap {max(B['Time']):.3f} s, vmax {max(B['Speed']):.1f}, vmin {min(B['Speed']):.1f} km/h")
    for k in range(3):
        i0, i1 = int(k * len(grid) / 3), int((k + 1) * len(grid) / 3) - 1
        print(f"sector {k + 1}: {la} - {lb} = {(ta[i1] - ta[i0]) - (tb[i1] - tb[i0]):+.3f} s")
    print(f"plot: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
