// Racing line and quasi-steady-state (QSS) speed profile.
//
// Used by the AI driver (targets), the benchmark (theoretical lap time) and
// the renderer (braking boards). The QSS model is a point mass with the same
// aero/tyre/power parameters as the full model, so its lap time is an
// independent sanity check of the dynamic simulation.
#pragma once

#include <vector>

#include "f1sim/car_params.hpp"
#include "f1sim/track.hpp"

namespace f1sim {

struct RacingLine {
    std::vector<Vec3> points;
    std::vector<double> trackS;      // lap coordinate of each point
    std::vector<double> offset;      // lateral offset from the centre line
    std::vector<double> curvature;   // [1/m], + = left
    std::vector<double> speed;       // QSS target [m/s]
    std::vector<double> distance;    // cumulative distance along the line
    double length = 0.0;
    double lapTime = 0.0;            // QSS lap time [s]

    size_t size() const { return points.size(); }
    // Index of the closest point, searching around `hint` when given.
    size_t nearest(const Vec3& p, long hint = -1) const;
};

struct LapSimOptions {
    double edgeMargin = 0.6;     // car centre distance from the white line [m] (wheels may use the kerbs)
    double gripScale = 1.0;      // multiplier on tyre friction
    int smoothingIterations = 2500;
};

RacingLine computeRacingLine(const Track& track, const LapSimOptions& opt = {});
void computeSpeedProfile(RacingLine& line, const CarParams& car, const LapSimOptions& opt = {});

}  // namespace f1sim
