// Track representation: a closed centre line sampled every ~1 m with widths,
// banking, elevation, kerbs and run-off, plus a spatial grid for fast ground
// queries from the physics (4 wheels + floor points at 1 kHz).
//
// Loaders:
//   *.trk  - native "turtle" definition (straights/arcs, auto closure).
//   *.csv  - TUM racetrack-database format: x_m, y_m, w_tr_right_m, w_tr_left_m
//            with an optional 5th column z_m (e.g. elevation from FastF1).
#pragma once

#include <string>
#include <vector>

#include "f1sim/math.hpp"

namespace f1sim {

enum class Surface { Asphalt = 0, Kerb = 1, Grass = 2, Gravel = 3, Outside = 4 };
const char* surfaceName(Surface s);

struct TrackSample {
    double s = 0.0;
    Vec3 pos;                   // centre line position
    double heading = 0.0;       // [rad], direction of travel
    double curvature = 0.0;     // [1/m], + = left turn
    double widthLeft = 7.0;     // centre to track edge (white line) [m]
    double widthRight = 7.0;
    double bank = 0.0;          // [rad], + = left side higher
    double kerbLeft = 0.0;      // kerb width outside the left edge [m], 0 = none
    double kerbRight = 0.0;
    double runoffLeft = 25.0;   // edge to wall [m]
    double runoffRight = 25.0;
};

struct GroundHit {
    double height = 0.0;
    Vec3 normal{0.0, 0.0, 1.0};
    Surface surface = Surface::Asphalt;
    double grip = 1.0;          // multiplier on tyre friction
    double rollingDrag = 0.0;   // extra rolling resistance coefficient
    double s = 0.0;             // distance along the lap
    double d = 0.0;             // lateral offset from centre, + = left
    int segment = -1;
    bool onTrack = true;        // inside the white lines
    double wallLeft = 0.0;      // lateral positions of the barriers at this s
    double wallRight = 0.0;
};

class Track {
public:
    static bool load(const std::string& path, Track* out, std::string* error);
    static bool loadTrk(const std::string& path, Track* out, std::string* error);
    static bool loadCsv(const std::string& path, Track* out, std::string* error);
    // Infinite flat asphalt plane for tests (s = x, d = y).
    static Track flatPad();

    GroundHit query(const Vec3& p, int hint = -1) const;
    // Height/normal on the reference surface given lap coordinates.
    double heightAt(double s, double d, Surface* surface = nullptr) const;
    // World position of lap coordinates (on the smooth surface, no bumps).
    Vec3 positionAt(double s, double d) const;
    double headingAt(double s) const;
    TrackSample sampleAt(double s) const;  // interpolated

    double length() const { return length_; }
    bool isPad() const { return pad_; }
    const std::string& name() const { return name_; }
    const std::vector<TrackSample>& samples() const { return samples_; }
    double wrapS(double s) const;
    // Signed distance a -> b along the lap in (-L/2, L/2].
    double deltaS(double a, double b) const;

    // Straight-line mode (DRS / X-mode) activation zones as [start, end) in lap distance.
    const std::vector<std::pair<double, double>>& aeroZones() const { return aeroZones_; }
    bool inAeroZone(double s) const;
    void setAeroZones(std::vector<std::pair<double, double>> z) { aeroZones_ = std::move(z); }
    // Detects long straights: runs of low curvature longer than `minLength`.
    void autoAeroZones(double minLength = 350.0);

    // Micro-texture amplitude multiplier (1 = default); 0 disables bumps.
    void setBumpScale(double k) { bumpScale_ = k; }

    // Builds the track from a raw closed polyline (x, y, z, wLeft, wRight).
    struct RawPoint { double x, y, z, wLeft, wRight; };
    bool buildFromPolyline(const std::vector<RawPoint>& pts, double startS, std::string* error);

private:
    void buildGrid();
    // Smooth elevation field over the whole area (continuous in x/y, also
    // inside tight hairpins where lap coordinates fold over).
    void buildHeightGrid();
    double baseHeight(double x, double y) const;
    // Kerb / grass / banking / micro-texture relative to the base surface.
    double surfaceOffset(double s, double d, Surface* surface) const;
    void autoKerbs();
    double bumps(double s, double d, Surface surf) const;

    std::string name_;
    std::vector<TrackSample> samples_;
    double length_ = 0.0;
    double spacing_ = 1.0;
    bool pad_ = false;
    double bumpScale_ = 1.0;
    std::vector<std::pair<double, double>> aeroZones_;

    // Uniform grid of segment indices.
    double gridMinX_ = 0.0, gridMinY_ = 0.0, cell_ = 25.0;
    int gridW_ = 0, gridH_ = 0;
    std::vector<std::vector<int>> grid_;
    double hgMinX_ = 0.0, hgMinY_ = 0.0, hgCell_ = 2.0;
    int hgW_ = 0, hgH_ = 0;
    std::vector<float> hg_;
};

}  // namespace f1sim
