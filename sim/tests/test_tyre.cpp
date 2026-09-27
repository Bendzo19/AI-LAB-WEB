#include "f1sim/tyre.hpp"
#include "harness.hpp"

using namespace f1sim;

TEST_CASE(tyre_curve_peaks_at_one) {
    for (double c : {1.3, 1.45, 1.6}) {
        for (double e : {-1.0, -0.4, 0.0, 0.5}) {
            const double b = TyreModel::solvePeakB(c, e);
            double best = 0.0, bestS = 0.0;
            for (double s = 0.0; s < 4.0; s += 0.001) {
                const double v = TyreModel::curve(s, b, c, e);
                if (v > best) { best = v; bestS = s; }
            }
            CHECK_NEAR(bestS, 1.0, 0.01);
            CHECK_NEAR(best, 1.0, 1e-4);
        }
    }
}

TEST_CASE(tyre_lateral_force_sign_and_peak) {
    const auto car = th::loadCar();
    TyreModel tyre(car.front.tyre);
    TyreInput in;
    in.fz = car.front.tyre.fz0;
    in.gripTemperature = car.front.tyre.tempOptimal;
    in.camberAuto = car.front.tyre.camberOptimal;
    in.vx = 50.0;
    // Patch sliding left (+tanAlpha) -> force to the right (negative).
    in.tanAlpha = std::tan(car.front.tyre.peakSlipAngle);
    const auto peak = tyre.compute(in);
    CHECK(peak.fy < 0.0);
    CHECK_NEAR(-peak.fy / in.fz, car.front.tyre.muY, 0.02);
    // Beyond the peak the force drops but stays substantial.
    in.tanAlpha = std::tan(3.0 * car.front.tyre.peakSlipAngle);
    const auto past = tyre.compute(in);
    CHECK(-past.fy < -peak.fy);
    CHECK(-past.fy > 0.7 * -peak.fy);
    // Symmetry.
    in.tanAlpha = -std::tan(car.front.tyre.peakSlipAngle);
    CHECK_NEAR(tyre.compute(in).fy, -peak.fy, 1e-6);
}

TEST_CASE(tyre_combined_slip_reduces_lateral_force) {
    const auto car = th::loadCar();
    TyreModel tyre(car.rear.tyre);
    TyreInput in;
    in.fz = 5000.0;
    in.vx = 40.0;
    in.gripTemperature = 100.0;
    in.camberAuto = car.rear.tyre.camberOptimal;
    in.tanAlpha = std::tan(0.5 * car.rear.tyre.peakSlipAngle);
    const double pureFy = tyre.compute(in).fy;
    in.kappa = car.rear.tyre.peakSlipRatio;
    const auto comb = tyre.compute(in);
    CHECK(std::fabs(comb.fy) < 0.8 * std::fabs(pureFy));
    CHECK(comb.fx > 0.0);
    // Total force stays within the friction ellipse.
    const double ex = comb.fx / (comb.muX * in.fz), ey = comb.fy / (comb.muY * in.fz);
    CHECK(ex * ex + ey * ey <= 1.02);
}

TEST_CASE(tyre_aligning_moment_centres_and_drops_before_peak) {
    const auto car = th::loadCar();
    TyreModel tyre(car.front.tyre);
    TyreInput in;
    in.fz = 4000.0;
    in.vx = 50.0;
    in.gripTemperature = 100.0;
    in.camberAuto = car.front.tyre.camberOptimal;
    double peakMz = 0.0, alphaAtPeakMz = 0.0;
    for (double a = 0.0; a < 0.2; a += 0.001) {
        in.tanAlpha = std::tan(a);
        const auto o = tyre.compute(in);
        // Aligning: patch sliding left -> moment turns the wheel left (+z)
        // up to the grip peak; deep in the slide it may turn slightly negative.
        if (a > 0.005 && a < car.front.tyre.peakSlipAngle) CHECK(o.mz > 0.0);
        if (a > 2.0 * car.front.tyre.peakSlipAngle) CHECK(std::fabs(o.mz) < 0.3 * peakMz);
        if (o.mz > peakMz) { peakMz = o.mz; alphaAtPeakMz = a; }
    }
    CHECK(alphaAtPeakMz < car.front.tyre.peakSlipAngle);
    CHECK(peakMz > 50.0);
}

TEST_CASE(tyre_temperature_window) {
    const auto car = th::loadCar();
    TyreModel tyre(car.front.tyre);
    CHECK_NEAR(tyre.temperatureFactor(car.front.tyre.tempOptimal), 1.0, 1e-9);
    CHECK(tyre.temperatureFactor(40.0) < tyre.temperatureFactor(80.0));
    CHECK(tyre.temperatureFactor(160.0) < tyre.temperatureFactor(120.0));
    CHECK(tyre.temperatureFactor(-50.0) >= 0.55);
}

TEST_CASE(tyre_zero_load_gives_no_force) {
    const auto car = th::loadCar();
    TyreModel tyre(car.front.tyre);
    TyreInput in;
    in.fz = 0.0;
    in.kappa = 0.3;
    in.tanAlpha = 0.2;
    const auto o = tyre.compute(in);
    CHECK(o.fx == 0.0 && o.fy == 0.0 && o.mz == 0.0);
}
