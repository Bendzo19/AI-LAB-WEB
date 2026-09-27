// Tyre force model.
//
// Steady-state forces use Magic-Formula-shaped curves over a *normalized*
// combined slip (slip / peak slip), which yields a friction ellipse whose
// axes follow the load-dependent peak friction. Transient behaviour comes
// from first-order relaxation of the slip quantities (handled by the vehicle)
// and a two-node thermal model feeding back into grip.
//
// Sign conventions in the tyre frame (x along wheel heading, y left, z = road
// normal):
//   slip ratio     kappa = (omega*r - Vx) / |Vx|   (> 0 when driving)
//   slip angle     tan(alpha) = Vy / |Vx|          (> 0 when the patch slides left)
//   Fy opposes lateral sliding, Mz = aligning moment about +z.
#pragma once

#include "f1sim/car_params.hpp"

namespace f1sim {

struct TyreInput {
    double fz = 0.0;         // vertical load [N]
    double kappa = 0.0;      // (transient) slip ratio
    double tanAlpha = 0.0;   // (transient) tan of slip angle
    double camber = 0.0;     // tyre-frame inclination [rad], + = top leaning to +y
    double camberAuto = 0.0; // automotive camber relative to road [rad] (negative = top in)
    double vx = 0.0;         // longitudinal speed of the wheel centre [m/s]
    double surfaceGrip = 1.0;
    double gripTemperature = 100.0;  // effective temperature [degC]
};

struct TyreOutput {
    double fx = 0.0, fy = 0.0, mz = 0.0;
    double normalizedSlip = 0.0;   // 1.0 == at the peak of the combined curve
    double gripFactor = 1.0;       // combined thermal/camber/surface multiplier
    double muX = 0.0, muY = 0.0;   // effective peak friction coefficients
};

class TyreModel {
public:
    explicit TyreModel(const TyreParams& p);
    TyreOutput compute(const TyreInput& in) const;
    const TyreParams& params() const { return p_; }

    // Normalized Magic Formula curve with peak == 1 at s == 1.
    static double curve(double s, double b, double c, double e);
    // Finds B such that the curve peaks exactly at s == 1 for given C, E.
    static double solvePeakB(double c, double e);

    double temperatureFactor(double temp) const;

private:
    TyreParams p_;
    double bx_ = 1.0, by_ = 1.0;
};

// Thermal state of one tyre (two lumped nodes).
struct TyreThermal {
    double surface = 70.0;
    double carcass = 70.0;
    double effective(const TyreParams& p) const {
        return p.surfaceWeight * surface + (1.0 - p.surfaceWeight) * carcass;
    }
    // slidingPower: |Fx*Vsx| + |Fy*Vsy| [W]; speed [m/s]; fz [N].
    void update(const TyreParams& p, double slidingPower, double speed, double fz, double airTemp,
                double trackTemp, double dt);
    // Hot pressure from carcass temperature (ideal gas, relative to 70 degC set point) [kPa].
    double pressureKpa(const TyreParams& p) const;
};

}  // namespace f1sim
