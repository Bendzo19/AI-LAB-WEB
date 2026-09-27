#include "f1sim/scenarios.hpp"

#include <cmath>

#include "f1sim/ai_driver.hpp"
#include "f1sim/session.hpp"
#include "f1sim/vehicle.hpp"

namespace f1sim {
namespace {

constexpr double kDt = 0.001;

int pickGear(const CarParams& car, double speed) {
    int gear = 1;
    const auto& pp = car.powertrain;
    for (int g = 1; g <= car.gearCount(); ++g) {
        const double rpm = speed / car.rear.tyre.radius * pp.gearRatios[g - 1] * pp.finalDrive * 60.0 / (2.0 * kPi);
        if (rpm > 7000.0 && rpm < pp.revLimit - 300.0) gear = g;
    }
    return gear;
}

// Keeps the car on the x axis of the pad (road-wheel angle -> steering wheel).
double holdStraight(const CarParams& car, const VehicleState& s) {
    const double yaw = s.rot.yaw();
    const double road = clamp(-0.004 * s.pos.y - 0.25 * yaw - 0.02 * s.angVel.z, -0.05, 0.05);
    return road * car.steering.ratio;
}

bool autoUpshift(const CarParams& car, const VehicleState& s, double* cooldown, double dt) {
    *cooldown = std::max(0.0, *cooldown - dt);
    if (*cooldown > 0.0 || s.pt.gear < 1 || s.pt.gear >= car.gearCount()) return false;
    if (s.rpm() > car.powertrain.revLimit - 250.0) {
        *cooldown = 0.2;
        return true;
    }
    return false;
}

}  // namespace

SettleResult runStaticSettle(const CarParams& car) {
    Track pad = Track::flatPad();
    Vehicle v(car, &pad);
    v.resetAt(0.0, 0.0, 0.0, 0);
    DriverInputs in;
    in.brake = 0.3;
    for (int i = 0; i < 4000; ++i) v.step(kDt, in);
    const auto& s = v.state();
    SettleResult r;
    r.rideFrontMm = s.rideHeightFront * 1000.0;
    r.rideRearMm = s.rideHeightRear * 1000.0;
    r.loadFrontN = 0.5 * (s.wheels[FL].fz + s.wheels[FR].fz);
    r.loadRearN = 0.5 * (s.wheels[RL].fz + s.wheels[RR].fz);
    r.residualSpeed = s.speed();
    r.pitchDeg = rad2deg(s.rot.pitch());
    r.rollDeg = rad2deg(s.rot.roll());
    return r;
}

AccelResult runAcceleration(const CarParams& car, bool straightMode, double seconds) {
    Track pad = Track::flatPad();
    pad.setBumpScale(0.0);
    Vehicle v(car, &pad);
    v.resetAt(0.0, 0.0, 0.0, 1);
    v.setTyreTemperatures(95.0, 90.0);
    AccelResult r;
    double cooldown = 0.0, throttle = 1.0, slipF = 0.0;
    bool aeroRequested = false;
    const int steps = static_cast<int>(seconds / kDt);
    for (int i = 0; i < steps; ++i) {
        const auto& s = v.state();
        DriverInputs in;
        // Driver-level launch/traction management (F1 has no traction
        // control): a smooth integral controller on ~9% rear slip.
        const double slip = std::max(s.wheels[RL].slipRatio, s.wheels[RR].slipRatio);
        slipF = relaxTowards(slipF, slip, 60.0, kDt);
        throttle = clamp(throttle + kDt * 25.0 * (0.09 - slipF), 0.15, 1.0);
        in.throttle = throttle;
        in.steeringWheelAngle = holdStraight(car, s);
        in.shiftUp = autoUpshift(car, s, &cooldown, kDt);
        if (straightMode && !aeroRequested && s.speed() > 30.0) {
            in.aeroToggle = true;
            aeroRequested = true;
        }
        v.step(kDt, in);
        const double kph = v.state().speed() * 3.6;
        const double t = (i + 1) * kDt;
        if (r.t0to100 < 0 && kph >= 100.0) r.t0to100 = t;
        if (r.t0to200 < 0 && kph >= 200.0) r.t0to200 = t;
        if (r.t0to300 < 0 && kph >= 300.0) {
            r.t0to300 = t;
            r.distanceTo300 = v.state().pos.x;
        }
        r.topSpeedKph = std::max(r.topSpeedKph, kph);
        r.maxYawDeg = std::max(r.maxYawDeg, std::fabs(rad2deg(v.state().rot.yaw())));
    }
    return r;
}

BrakeResult runBraking(const CarParams& car) {
    Track pad = Track::flatPad();
    pad.setBumpScale(0.0);
    Vehicle v(car, &pad);
    const double v0 = 300.0 / 3.6;
    v.resetAt(0.0, 0.0, v0, pickGear(car, v0));
    v.setTyreTemperatures(95.0, 90.0);
    DriverInputs in;
    // Let the suspension settle under aero load while holding speed.
    for (int i = 0; i < 1500; ++i) {
        in.throttle = v.state().speed() < v0 ? 1.0 : 0.3;
        in.steeringWheelAngle = holdStraight(car, v.state());
        v.step(kDt, in);
    }
    BrakeResult r;
    double pedal = 1.0, cooldown = 0.0;
    const double x0 = v.state().pos.x;
    double t = 0.0, x200 = -1.0;
    while (v.state().speed() > 0.3 && t < 20.0) {
        const auto& s = v.state();
        // Threshold braking: back off when any tyre starts to lock.
        double lock = 0.0;
        for (const auto& w : s.wheels) lock = std::min(lock, w.slipRatio);
        pedal = clamp(pedal + kDt * (lock < -0.13 ? -10.0 : 5.0), 0.2, 1.0);
        in = DriverInputs{};
        in.brake = pedal;
        in.steeringWheelAngle = holdStraight(car, s);
        cooldown = std::max(0.0, cooldown - kDt);
        if (cooldown <= 0.0 && s.pt.gear > 1 && s.rpm() < 8500.0) {
            in.shiftDown = true;
            cooldown = 0.15;
        }
        v.step(kDt, in);
        t += kDt;
        const double kph = v.state().speed() * 3.6;
        r.peakDecelG = std::max(r.peakDecelG, -v.state().gForce().x);
        if (r.time300to100 < 0 && kph <= 100.0) {
            r.time300to100 = t;
            r.distance300to100 = v.state().pos.x - x0;
        }
        if (x200 < 0 && kph <= 200.0) x200 = v.state().pos.x;
    }
    if (x200 >= 0.0) r.distance200to0 = v.state().pos.x - x200;
    return r;
}

CorneringResult runSteadyStateCircle(const CarParams& car, double radius) {
    Track pad = Track::flatPad();
    pad.setBumpScale(0.0);
    Vehicle v(car, &pad);
    const double v0 = std::sqrt(0.8 * kGravity * radius);
    v.resetAt(0.0, 0.0, v0, pickGear(car, v0));
    v.setTyreTemperatures(100.0, 95.0);
    const Vec3 centre{0.0, radius, 0.0};  // left-hand circle
    CorneringResult r;
    double throttle = 0.3, cooldown = 0.0, latFiltered = 0.0, sampleTimer = 0.0, behind = 0.0;
    const double ramp = radius < 100.0 ? 0.25 : 0.4;  // target speed ramp [m/s per s]
    for (int i = 0; i < 240000; ++i) {
        const auto& s = v.state();
        const double t = i * kDt;
        const Vec3 rel = s.pos - centre;
        const double dist = std::hypot(rel.x, rel.y);
        const double tangent = std::atan2(rel.x, -rel.y);  // CCW tangent heading
        const double velHeading = std::atan2(s.vel.y, s.vel.x);
        const double headErr = wrapAngle(tangent - velHeading);
        const double road = car.chassis.wheelbase / radius + 0.015 * (dist - radius) + 0.8 * headErr;
        DriverInputs in;
        in.steeringWheelAngle = clamp(road * car.steering.ratio, -car.steering.lock, car.steering.lock);
        const double vt = v0 + ramp * t;
        const double err = vt - s.speed();
        throttle = clamp(throttle + kDt * 2.0 * err, 0.0, 1.0);
        in.throttle = throttle;
        in.shiftUp = autoUpshift(car, s, &cooldown, kDt);
        v.step(kDt, in);

        const auto& n = v.state();
        const double lat = n.gForce().y;
        latFiltered = relaxTowards(latFiltered, lat, 5.0, kDt);
        const bool tracking = std::fabs(dist - radius) < 2.5 && std::fabs(headErr) < 0.15;
        if (tracking && t > 2.0 && latFiltered > r.maxLatG) {
            r.maxLatG = latFiltered;
            r.speedAtMaxKph = n.speed() * 3.6;
            r.steeringTorqueAtMax = n.steeringTorque;
        }
        if (tracking && t > 2.0 && std::fabs(n.steeringTorque) > r.peakSteeringTorque) {
            r.peakSteeringTorque = std::fabs(n.steeringTorque);
            r.latGAtPeakTorque = latFiltered;
        }
        sampleTimer += kDt;
        if (sampleTimer >= 0.1) {
            sampleTimer = 0.0;
            r.torqueCurve.push_back({latFiltered, n.steeringTorque});
        }
        // Stop once the car can no longer follow the circle at the requested speed.
        behind = err > 3.0 ? behind + kDt : 0.0;
        if (std::fabs(dist - radius) > 6.0 || behind > 3.0) break;
        if (std::fabs(headErr) > 0.8) {
            r.spun = true;
            break;
        }
    }
    return r;
}

LapResult runAiLaps(const CarParams& car, const std::string& trackPath, int laps, double pace,
                    const std::string& telemetryCsv) {
    LapResult r;
    Track track;
    std::string err;
    if (!Track::load(trackPath, &track, &err)) {
        r.failure = err;
        return r;
    }
    Session session(car, std::move(track));
    const auto& line = session.racingLine();
    r.qssLapTime = line.lapTime;
    // Rolling start at the QSS speed 300 m before the line.
    const size_t startIdx = line.nearest(session.track().positionAt(session.track().wrapS(-200.0), 0.0));
    session.resetRolling(line.speed[startIdx] * pace, 200.0, line.offset[startIdx]);
    AIDriver ai(&line, car, pace);
    double stuck = 0.0;
    const double timeout = 60.0 + laps * 200.0;
    while (session.time() < timeout) {
        const auto& s = session.vehicle().state();
        const DriverInputs in = ai.update(s, Session::kDt);
        const auto ev = session.step(in);
        const auto& n = session.vehicle().state();
        const double kph = n.speed() * 3.6;
        if (session.timer().timing()) {
            r.maxSpeedKph = std::max(r.maxSpeedKph, kph);
            r.minSpeedKph = std::min(r.minSpeedKph, kph);
            r.maxLatG = std::max(r.maxLatG, std::fabs(n.gForce().y));
            r.maxBrakeG = std::max(r.maxBrakeG, -n.gForce().x);
            for (const auto& w : n.wheels) {
                r.tyreSurfaceMax = std::max(r.tyreSurfaceMax, w.thermal.surface);
                r.brakeTempMax = std::max(r.brakeTempMax, w.brakeTemp);
            }
        }
        if (ev == LapTimer::Event::LapCompleted) {
            if (!telemetryCsv.empty()) {
                std::string werr;
                if (!session.lastLapTelemetry().saveCsv(telemetryCsv, &werr)) r.failure = werr;
            }
            r.lapTimes.push_back(session.timer().lastLap());
            r.lapValid.push_back(session.timer().lastLapValid());
            if (static_cast<int>(r.lapTimes.size()) >= laps) {
                r.completed = true;
                double carc = 0.0;
                for (const auto& w : n.wheels) carc += 0.25 * w.thermal.carcass;
                r.tyreCarcassEnd = carc;
                r.socEndMj = n.pt.soc / 1.0e6;
                break;
            }
        }
        stuck = n.speed() < 3.0 ? stuck + Session::kDt : 0.0;
        if (stuck > 5.0) {
            r.failure = "car stopped at s=" + std::to_string(session.carS());
            break;
        }
        const double heading = session.track().headingAt(session.carS());
        const double velHeading = std::atan2(n.vel.y, n.vel.x);
        if (n.speed() > 10.0 && std::fabs(wrapAngle(velHeading - heading)) > 1.2) {
            r.failure = "car spun at s=" + std::to_string(session.carS());
            break;
        }
    }
    if (!r.completed && r.failure.empty()) r.failure = "timeout";
    return r;
}

}  // namespace f1sim
