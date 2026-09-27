# f1sim – project guide for Claude Code

A realistic Formula 1 simulator (desktop game) for a Slovak-speaking owner
who drives with a Logitech G29 wheel and pedals and wants **realistic,
data-driven physics** and **high-end graphics** (target: better than
Assetto Corsa; long-term renderer: Unreal Engine 5). **Talk to the user in
Slovak.** They are not a programmer: explain results, not code; ask only
when a decision is genuinely theirs.

## Layout

```
core/            physics library (C++17, no dependencies, engine-agnostic) – the valuable part
  include/f1sim/   math, ini, car_params, tyre, track, vehicle, lapsim, ai_driver, timing, ffb, telemetry, session, scenarios
  src/
app/             playable game: SDL3 window + OpenGL 3.3 renderer, HUD apps, wheel/pedal input + FFB
tests/           regression tests (harness.hpp, test_*.cpp) – run after every physics change
tools/bench.cpp  validation benchmark vs public F1 reference values + robot laps
data/cars/       car definitions (*.ini, every value tagged [PUB]/[REG]/[EST])
data/tracks/     tracks (.trk turtle format, TUM .csv with z + "# aero_zone" directives), SOURCES.md, licenses/
data/models/     glTF car models + per-car model config (*.ini), steering_wheel.glb
art/blender/     editable .blend scenes of the generated cars
scripts/         Python: FastF1 export, track builders, lap comparison, AC telemetry logger, blender/build_car.py
docs/            PHYSICS.md, DATA.md, ROADMAP.md (Slovak, user-facing)
private/         (git-ignored) data from the user's Assetto Corsa cars – never commit, repo is public
```

## Build, test, run (Windows)

- One step: `setup.ps1` (or double-click `build.bat`) – finds Visual Studio's CMake,
  configures `build/`, builds Release, runs the tests, installs Python packages.
- Manually (Developer PowerShell for VS):
  `cmake -S . -B build -A x64` → `cmake --build build --config Release` →
  `build\Release\f1sim_tests.exe` → `build\Release\f1sim.exe`
- Visual Studio: File → Open → Folder → `sim`, configuration x64-Release, target f1sim.exe.
- The POST_BUILD step copies `data/` next to the exe; after editing data only, rebuild or copy it.
- App flags: `--demo` (robot), `--car cars/x.ini --track tracks/y.csv`, `--camera N`, `--menu`,
  `--screenshot out.png --frames N` (renders and exits), `--all-apps`. F12 saves a screenshot in game.
- Linux (CI / headless): `cmake -S . -B build -G Ninja && cmake --build build`; screenshots with
  `xvfb-run -a ./build/f1sim --demo --screenshot x.png`.

**Definition of done for any change:** tests pass (`f1sim_tests`, 28 now), `f1sim_bench` still in
its reference ranges for both cars, the app builds on Windows (CI: `.github/workflows/f1sim.yml`),
and visual changes are checked on screenshots from several cameras.

## Physics (core/)

- 1 kHz fixed step (`Session::kDt`), deterministic. 14-DOF vehicle: 6-DOF chassis, 4 unsprung
  vertical DOF, 4 wheel spin DOF, engine + driveline with clutch, clutch-pack LSD solved with
  impulse constraints, brake-by-wire incl. engine braking and MGU-K regen.
- Tyres: Magic-Formula-shaped combined slip, load sensitivity, relaxation lengths, two-node
  thermals (surface/carcass) affecting grip. Tyre data are estimates – Pirelli data are not public.
- Aero: ride-height and yaw sensitive downforce, straight/corner modes (2026 active aero or
  2025 DRS limited to track zones, closes on the brakes).
- Powertrain: ICE power curve, MGU-K deploy/harvest limits per lap, MGU-H (2025), ERS modes.
- Track: centre line + widths/kerbs/run-off; ground query uses a smooth 2D elevation grid
  (Track::baseHeight) so hairpins on slopes are consistent; `terrainHeight` for scenery.
- FFB: steering-rack torque from the physics (`VehicleState::steeringTorque`) → `FfbProcessor`
  (scale, filter, damping, min force, soft lock) → SDL haptics constant force.
- Validation: `f1sim_bench` (0-100/200/300, top speed, braking, steady-state cornering at R50/R150,
  steering torque, robot laps, QSS theoretical lap). Current QSS Red Bull Ring: 2025 car 67.3 s vs
  2025 pole 63.971 s (model ~5 % slow – tyre/aero calibration pending real data).

## Graphics (app/)

- OpenGL 3.3 core: PBR (GGX, metallic/roughness from glTF), analytic sky with clouds + ACES tone
  mapping, 2-cascade sun shadow maps, emissive materials, procedural asphalt/grass detail,
  terrain height field from the physics elevation data.
- Car models come from `scripts/blender/build_car.py` (parametric, matched to the physics
  dimensions; exact bounds are printed and must equal the car length). Materials named
  `Livery*` are recoloured from `[visual] livery_rgb`. No real team or sponsor logos – keep it that way.
- This renderer will not reach AC/UE5 quality (no hand-made textured assets, no GI). The plan is UE5.

## Next steps (agreed direction)

1. **Wheel test feedback** (user drives v0.2+ on the G29): FFB direction/strength, clipping,
   handling at the limit. Tune `data/cars/*.ini` and FFB presets (`app/wheel_presets.cpp`).
2. **Assetto Corsa comparison** – `scripts/ac_telemetry.py` records AC laps from shared memory
   into the same CSV format as the sim; `scripts/compare_laps.py` overlays them. Drive the same
   track (Red Bull Ring) in both. The logger is untested against a real AC install – verify
   the first recorded lap (GLat sign, gear index, steering scale) and fix. If the user shares
   unpacked AC car data (Content Manager → unpack data.acd), put it in `private/` only and use it
   to compare tyre/aero/engine parameters; never publish it.
3. **Unreal Engine 5 port** (graphics; physics stays in core/):
   - UE5 C++ plugin `F1Sim` linking `f1sim_core` built by CMake as a static library
     (ThirdParty module, PublicAdditionalLibraries) – one source of truth for the physics.
   - Physics on its own FRunnable thread at 1 kHz exactly like `physicsMain` in `app/main.cpp`;
     publish snapshots; game thread only reads/interpolates transforms.
   - Wheel input + FFB: reuse `app/input.cpp` (SDL3 inside the plugin); UE's own FFB is weak.
   - Track: keep the physics Track (centre line + elevation) and build the UE level on top of
     the same geometry; later abstract ground queries so UE collision meshes can be used.
   - Car: import the glTF models (Interchange), set up UE materials, Lumen/Nanite, cameras.
   - Acceptance: `f1sim_bench` numbers identical in UE (same core), 1 kHz without overruns,
     FFB latency no worse than the SDL app.
4. Tyre wear/pressures, setup screen, more tracks with elevation, sound, UDP telemetry for SimHub.

## Known issues / limitations

- Robot driver (F5 / `--demo`) is a test tool: on Red Bull Ring it laps in 78-87 s and runs wide
  at Remus/T4. Not a physics bug for human drivers.
- In slow hairpins the inside wheels unload strongly (roll stiffness balance 180/120 N/mm).
- DRS flap is not animated on the external model (only on the built-in primitive car).
- Steering wheel display/LEDs are static.
- Nothing has been tested on a physical wheel yet (developed in a cloud container without devices).

## Conventions

- C++17, match existing style (4-space indent, `snake_case` files, `camelCase` members with `_`).
- Car/track data are INI/CSV with units in key names; unknown keys are reported (`unusedKeys`).
- Commit messages in English; no model names in commits. The GitHub workflow publishes
  `f1sim-latest` (Windows zip) on every push:
  https://github.com/Bendzo19/AI-LAB-WEB/releases/download/f1sim-latest/f1sim-windows-x64.zip
