// Regression tests on the full vehicle model. Ranges are public ballpark
// figures for current F1 cars; they catch regressions and gross modelling
// errors, not fine calibration (that needs real data, see docs/DATA.md).
#include "f1sim/scenarios.hpp"
#include "f1sim/session.hpp"
#include "f1sim/vehicle.hpp"
#include "harness.hpp"

using namespace f1sim;

TEST_CASE(vehicle_static_equilibrium) {
    const auto car = th::loadCar();
    const auto r = runStaticSettle(car);
    // Ride heights are measured at the aero reference points between the axles.
    auto design = [&](double x) {
        return 1000.0 * lerp(car.rear.rideHeight, car.front.rideHeight, (x - car.rear.x) / (car.front.x - car.rear.x));
    };
    CHECK_NEAR(r.rideFrontMm, design(car.aero.frontFloorX), 3.0);
    CHECK_NEAR(r.rideRearMm, design(car.aero.rearFloorX), 3.0);
    CHECK(r.residualSpeed < 0.01);
    const double m = car.totalMass() * kGravity;
    CHECK_NEAR(r.loadFrontN, m * car.chassis.weightFront * 0.5, 60.0);
    CHECK_NEAR(r.loadRearN, m * (1.0 - car.chassis.weightFront) * 0.5, 60.0);
    CHECK(std::fabs(r.rollDeg) < 0.05);
}

TEST_CASE(vehicle_acceleration_and_top_speed) {
    const auto car = th::loadCar();
    const auto z = runAcceleration(car, false);
    const auto x = runAcceleration(car, true);
    CHECK_RANGE(z.t0to100, 2.0, 3.4);
    CHECK_RANGE(z.t0to200, 3.8, 6.5);
    CHECK_RANGE(z.topSpeedKph, 295.0, 350.0);
    CHECK(x.topSpeedKph > z.topSpeedKph + 5.0);  // straight mode must pay off
    CHECK(z.maxYawDeg < 2.0);
}

TEST_CASE(vehicle_braking) {
    const auto car = th::loadCar();
    const auto b = runBraking(car);
    CHECK_RANGE(b.distance300to100, 60.0, 140.0);
    CHECK_RANGE(b.peakDecelG, 3.8, 7.0);
    CHECK(b.distance200to0 > 0.0);
}

TEST_CASE(vehicle_cornering_limits) {
    const auto car = th::loadCar();
    const auto low = runSteadyStateCircle(car, 50.0);
    const auto high = runSteadyStateCircle(car, 150.0);
    CHECK_RANGE(low.maxLatG, 1.6, 3.0);
    CHECK_RANGE(high.maxLatG, 2.8, 5.0);
    CHECK(high.maxLatG > low.maxLatG);  // downforce
    // Force feedback: the steering centres (torque opposes a left turn) ...
    CHECK(high.steeringTorqueAtMax < 0.0);
    // ... and it goes light before the grip limit.
    CHECK(high.latGAtPeakTorque < high.maxLatG);
}

TEST_CASE(vehicle_is_deterministic) {
    const auto car = th::loadCar();
    Track pad = Track::flatPad();
    Vehicle a(car, &pad), b(car, &pad);
    a.resetAt(0, 0, 30.0, 3);
    b.resetAt(0, 0, 30.0, 3);
    DriverInputs in;
    for (int i = 0; i < 3000; ++i) {
        in.throttle = 0.5 + 0.5 * std::sin(i * 0.01);
        in.steeringWheelAngle = 0.4 * std::sin(i * 0.003);
        a.step(0.001, in);
        b.step(0.001, in);
    }
    CHECK(a.state().pos.x == b.state().pos.x);
    CHECK(a.state().pos.y == b.state().pos.y);
    CHECK(a.state().wheels[RL].omega == b.state().wheels[RL].omega);
}

TEST_CASE(vehicle_does_not_creep_off_throttle) {
    // Anti-stall keeps the clutch open without throttle: a stationary car in
    // gear on level ground stays put (regression: it crept to ~33 km/h).
    for (const char* file : {"cars/f1_2025_generic.ini", "cars/f1_2026_generic.ini"}) {
        const auto car = th::loadCar(file);
        Track pad = Track::flatPad();
        Vehicle v(car, &pad);
        v.resetAt(0, 0, 0.0, 1);
        DriverInputs in;
        for (int i = 0; i < 5000; ++i) v.step(0.001, in);
        CHECK(v.state().speed() < 0.3);
        CHECK(v.state().rpm() > car.powertrain.idleRpm - 300.0);  // engine idles, not stalled
        // ...and still pulls away normally.
        in.throttle = 1.0;
        for (int i = 0; i < 2000; ++i) v.step(0.001, in);
        CHECK(v.state().speed() > 15.0);
    }
}

TEST_CASE(vehicle_ers_deploys_and_harvests) {
    const auto car = th::loadCar();
    Track pad = Track::flatPad();
    Vehicle v(car, &pad);
    v.resetAt(0, 0, 50.0, 4);
    DriverInputs in;
    in.throttle = 1.0;
    const double soc0 = v.state().pt.soc;
    for (int i = 0; i < 3000; ++i) v.step(0.001, in);
    CHECK(v.state().pt.soc < soc0 - 0.5e6);
    CHECK(v.state().pt.mgukPower > 100000.0);
    const double soc1 = v.state().pt.soc;
    in.throttle = 0.0;
    in.brake = 0.6;
    for (int i = 0; i < 1500; ++i) v.step(0.001, in);
    CHECK(v.state().pt.soc > soc1);
    CHECK(v.state().pt.lapHarvest <= car.powertrain.harvestPerLap);
}

TEST_CASE(vehicle_gearbox_refuses_overrev_downshift) {
    const auto car = th::loadCar();
    Track pad = Track::flatPad();
    Vehicle v(car, &pad);
    v.resetAt(0, 0, 85.0, 8);
    DriverInputs in;
    in.shiftDown = true;
    v.step(0.001, in);
    in.shiftDown = false;
    for (int i = 0; i < 50; ++i) v.step(0.001, in);
    in.shiftDown = true;
    v.step(0.001, in);  // 7th ok at 306 km/h, keep going down until refused
    in.shiftDown = false;
    for (int k = 0; k < 6; ++k) {
        for (int i = 0; i < 50; ++i) v.step(0.001, in);
        in.shiftDown = true;
        v.step(0.001, in);
        in.shiftDown = false;
    }
    CHECK(v.state().pt.gear >= 5);
    CHECK(v.state().rpm() < car.powertrain.revLimit + 300.0);
}

TEST_CASE(vehicle_ai_completes_test_circuit) {
    const auto car = th::loadCar();
    const auto r = runAiLaps(car, th::dataPath("tracks/test_circuit.trk"), 1, 0.93);
    if (!r.completed) std::printf("    failure: %s\n", r.failure.c_str());
    CHECK(r.completed);
    if (r.completed) {
        CHECK_RANGE(r.lapTimes[0], r.qssLapTime * 0.98, r.qssLapTime * 1.25);
        CHECK(r.lapValid[0]);
    }
}
