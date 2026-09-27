#include "f1sim/tyre.hpp"

#include <cmath>

#include "f1sim/math.hpp"

namespace f1sim {

double TyreModel::curve(double s, double b, double c, double e) {
    const double bs = b * s;
    return std::sin(c * std::atan(bs - e * (bs - std::atan(bs))));
}

double TyreModel::solvePeakB(double c, double e) {
    // Peak of sin(C*atan(phi)) is where phi(B) = tan(pi/(2C)) at s = 1:
    // phi = B - E*(B - atan(B)) is monotonic in B for E < 1, so bisect.
    const double target = std::tan(kPi / (2.0 * c));
    double lo = 1e-4, hi = 100.0;
    for (int i = 0; i < 200; ++i) {
        const double mid = 0.5 * (lo + hi);
        const double phi = mid - e * (mid - std::atan(mid));
        if (phi < target) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
}

TyreModel::TyreModel(const TyreParams& p) : p_(p) {
    bx_ = solvePeakB(p_.shapeCx, p_.curvEx);
    by_ = solvePeakB(p_.shapeCy, p_.curvEy);
}

double TyreModel::temperatureFactor(double temp) const {
    const double d = (temp - p_.tempOptimal) / p_.tempWindow;
    // Quadratic loss within the window, continuing linearly beyond it so that
    // stone-cold or overheated tyres keep losing grip without going negative.
    auto loss = [](double x, double k) { return x <= 1.0 ? k * x * x : k * (2.0 * x - 1.0); };
    const double l = d < 0.0 ? loss(-d, p_.coldGripLoss) : loss(d, p_.hotGripLoss);
    return clamp(1.0 - l, 0.55, 1.0);
}

TyreOutput TyreModel::compute(const TyreInput& in) const {
    TyreOutput out;
    if (in.fz <= 0.0) return out;
    const double fz = in.fz;
    const double dfz = (fz - p_.fz0) / p_.fz0;

    const double camberFactor = clamp(1.0 - p_.camberSensitivity * sq(in.camberAuto - p_.camberOptimal), 0.7, 1.0);
    const double grip = temperatureFactor(in.gripTemperature) * camberFactor * in.surfaceGrip;
    out.gripFactor = grip;

    // Load sensitivity is clamped so extreme loads do not produce nonsense.
    const double muY = p_.muY * clamp(1.0 + p_.loadSensY * dfz, 0.5, 1.4) * grip;
    const double muX = p_.muX * clamp(1.0 + p_.loadSensX * dfz, 0.5, 1.4) * grip;
    out.muX = muX;
    out.muY = muY;

    const double growth = clamp(1.0 + p_.peakSlipLoadGrowth * dfz, 0.6, 1.6);
    const double kappaPeak = p_.peakSlipRatio * growth;
    const double tanAlphaPeak = std::tan(p_.peakSlipAngle * growth);

    const double sx = in.kappa / kappaPeak;
    const double sy = in.tanAlpha / tanAlphaPeak;
    const double s = std::sqrt(sx * sx + sy * sy);
    out.normalizedSlip = s;

    double fx = 0.0, fy = 0.0;
    if (s > 1e-9) {
        const double cx = curve(s, bx_, p_.shapeCx, p_.curvEx);
        const double cy = curve(s, by_, p_.shapeCy, p_.curvEy);
        fx = muX * fz * cx * (sx / s);
        fy = -muY * fz * cy * (sy / s);
    }

    // Camber thrust, faded out as the tyre saturates so it cannot exceed grip.
    const double thrust = p_.camberThrust * fz * in.camber * clamp(1.0 - s, 0.0, 1.0);
    fy += thrust;

    // Rolling resistance, smoothed around standstill.
    fx -= p_.rollingResistance * fz * std::tanh(in.vx / 0.5);

    // Aligning moment: pneumatic trail shrinks with combined slip and turns
    // slightly negative once the patch is mostly sliding.
    double trail;
    if (s < p_.trailZeroSlip) {
        trail = p_.pneumaticTrail * (1.0 - s / p_.trailZeroSlip);
    } else {
        trail = -p_.pneumaticTrail * clamp(0.12 * (s - p_.trailZeroSlip) / p_.trailZeroSlip, 0.0, 0.12);
    }
    const double pureFy = fy - thrust;
    double mz = -trail * pureFy;
    // Longitudinal force acting at the laterally deflected contact patch.
    const double yOffset = fy / p_.lateralCarcassStiffness;
    mz += -yOffset * fx;

    out.fx = fx;
    out.fy = fy;
    out.mz = mz;
    return out;
}

void TyreThermal::update(const TyreParams& p, double slidingPower, double speed, double fz, double airTemp,
                         double trackTemp, double dt) {
    const double v = std::fabs(speed);
    const double loaded = fz > 10.0 ? 1.0 : 0.0;
    const double qFriction = p.frictionHeatShare * slidingPower;
    const double qSurfCarc = p.surfaceToCarcass * (surface - carcass);
    const double qSurfAir = (p.surfaceToAirBase + p.surfaceToAirPerSpeed * v) * (surface - airTemp);
    const double qSurfTrack = loaded * p.surfaceToTrack * (surface - trackTemp);
    const double qHyst = p.hysteresisCoeff * std::max(fz, 0.0) * v;
    const double qCarcAir = p.carcassToAir * (carcass - airTemp);

    surface += dt * (qFriction - qSurfCarc - qSurfAir - qSurfTrack) / p.surfaceHeatCapacity;
    carcass += dt * (qHyst + qSurfCarc - qCarcAir) / p.carcassHeatCapacity;
}

double TyreThermal::pressureKpa(const TyreParams& p) const {
    // Gauge pressure scales with absolute temperature of the contained gas
    // (approximated by the carcass). Set point: cold pressure at 70 degC.
    const double atm = 101.3;
    const double abs0 = p.coldPressureKpa + atm;
    return abs0 * (carcass + 273.15) / (70.0 + 273.15) - atm;
}

}  // namespace f1sim
