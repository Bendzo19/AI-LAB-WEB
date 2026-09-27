# Track data sources and licences

## test_circuit.trk
Original layout made for this project.

## red_bull_ring.csv
Built with `scripts/build_track_geo.py` from:

- **Centre line and track widths:** TUM racetrack-database, `tracks/Spielberg.csv`
  (https://github.com/TUMFTM/racetrack-database), LGPL-3.0, see
  `licenses/TUM_racetrack-database_LGPL-3.0.txt`. Derived from OpenStreetMap
  (© OpenStreetMap contributors, ODbL) and satellite imagery.
- **Georeferencing:** f1-circuits GeoJSON (https://github.com/bacinger/f1-circuits),
  MIT, see `licenses/f1-circuits_MIT.txt`.
- **Elevation:** Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus
  Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European
  Union and ESA; all rights reserved. Sampled along the centre line and
  smoothed (60 m window).
- DRS zones set by hand to match the three real zones.

The start line position follows the TUM data (on the main straight) and may
differ slightly from the real timing line. Accuracy: centre line ~2 m,
elevation a few metres (30 m DEM) - good for driving, not for laser-scan-grade
bumps.
