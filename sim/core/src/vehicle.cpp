#include "f1sim/vehicle.hpp"

#include <cmath>

namespace f1sim {
namespace {

constexpr double kLowSpeed = 2.5;           // [m/s] floor for slip normalisation
constexpr double kFloorStiffness = 600000.0;  // plank/skid contact [N/m]
constexpr double kFloorDamping = 8000.0;
constexpr double kFloorFriction = 0.35;
constexpr double kWallStiffness = 400000.0;
constexpr double kWallDamping = 30000.0;
constexpr double kWallFriction = 0.4;
constexpr double kStefanBoltzmann = 5.670e-8;
const Vec3 kGravityVec{0.0, 0.0, -kGravity};

double rpmToRad(double rpm) { return rpm * 2.0 * kPi / 60.0; }

}  // namespace

const char* ersModeName(ErsMode m) {
    switch (m) {
        case ErsMode::Balanced: return "BALANCED";
        case ErsMode::Qualifying: return "QUALI";
        default: return "HARVEST";
    }
}

Vehicle::Vehicle(const CarParams& params, const Track* track)
    : p_(params),
      track_(track),
      tyres_{TyreModel(params.front.tyre), TyreModel(params.front.tyre), TyreModel(params.rear.tyre),
             TyreModel(params.rear.tyre)} {
    st_.brakeBias = p_.brakes.biasFront;
    st_.pt.fuelMass = p_.powertrain.fuelMass;
    st_.pt.soc = p_.powertrain.batteryWindow;
    unsprungTotal_ = 2.0 * (p_.front.unsprungMass + p_.rear.unsprungMass);
    resetAt(0.0, 0.0, 0.0, 1);
}

double Vehicle::floorBodyZ(double x) const {
    const double t = (x - p_.rear.x) / (p_.front.x - p_.rear.x);
    return -p_.chassis.cgHeight + lerp(p_.rear.rideHeight, p_.front.rideHeight, t);
}

Vec3 Vehicle::wheelBodyPosition(int i) const {
    const auto& a = axle(i);
    return {a.x, side(i) * a.track * 0.5, cache_[i].zWheelStatic};
}

void Vehicle::setTyreTemperatures(double surfaceC, double carcassC) {
    for (auto& w : st_.wheels) {
        w.thermal.surface = surfaceC;
        w.thermal.carcass = carcassC;
    }
}

double Vehicle::totalRatio(int gear) const {
    const auto& pt = p_.powertrain;
    if (gear == 0) return 0.0;
    if (gear < 0) return -pt.reverseRatio * pt.finalDrive;
    return pt.gearRatios[static_cast<size_t>(gear - 1)] * pt.finalDrive;
}

void Vehicle::resetAt(double s, double d, double speed, int gear) {
    const double mass = p_.chassis.mass + st_.pt.fuelMass;
    const double g = kGravity;
    // Static corner loads and the spring preloads that hold design ride height.
    for (int i = 0; i < 4; ++i) {
        const auto& a = axle(i);
        const double axleShare = i < 2 ? p_.chassis.weightFront : 1.0 - p_.chassis.weightFront;
        const double cornerLoad = mass * g * axleShare * 0.5;
        cache_[i].staticSpringForce = cornerLoad - a.unsprungMass * g;
        const double loadedRadius = a.tyre.radius - cornerLoad / a.tyre.vertStiffness;
        cache_[i].zWheelStatic = loadedRadius - p_.chassis.cgHeight;
    }

    const double heading = track_->headingAt(s);
    const Vec3 ground = track_->positionAt(s, d);
    const double slope = (track_->heightAt(s + 1.0, d) - track_->heightAt(s - 1.0, d)) / 2.0;
    const double pitch = -std::atan(slope);
    st_.rot = Quat::fromEuler(0.0, pitch, heading);
    st_.pos = ground + st_.rot.rotate({0.0, 0.0, p_.chassis.cgHeight});
    st_.vel = st_.rot.rotate({speed, 0.0, 0.0});
    st_.angVel = {};
    st_.accWorld = {};
    st_.angAcc = {};
    st_.aeroMode = 0.0;
    st_.aeroStraightRequested = false;
    st_.time = 0.0;

    for (int i = 0; i < 4; ++i) {
        auto& w = st_.wheels[i];
        const auto& t = axle(i).tyre;
        w.compression = 0.0;
        w.compressionVel = 0.0;
        w.kappaT = 0.0;
        w.tanAlphaT = 0.0;
        w.trackHint = -1;
        w.effectiveRadius = t.radius;
        w.omega = speed / t.radius;
    }
    auto& pt = st_.pt;
    pt.gear = std::max(-1, std::min(gear, p_.gearCount()));
    pt.shiftTimer = 0.0;
    pt.upshifting = false;
    pt.shiftRefused = false;
    pt.clutchEngagement = speed > 5.0 ? 1.0 : 0.0;
    pt.lapHarvest = 0.0;
    const double wheelSideOmega = std::fabs(totalRatio(pt.gear) * speed / p_.rear.tyre.radius);
    pt.engineOmega = std::max(wheelSideOmega, rpmToRad(p_.powertrain.idleRpm));
}

double Vehicle::damperForce(const AxleParams& a, double v) const {
    if (v >= 0.0) {
        return a.damperBumpSlow * std::min(v, a.damperKnee) + a.damperBumpFast * std::max(v - a.damperKnee, 0.0);
    }
    const double r = -v;
    return -(a.damperReboundSlow * std::min(r, a.damperKnee) + a.damperReboundFast * std::max(r - a.damperKnee, 0.0));
}

void Vehicle::updateAero(double dt, const DriverInputs& in) {
    if (in.aeroToggle) st_.aeroStraightRequested = !st_.aeroStraightRequested;
    // The straight-line mode closes automatically on the brakes.
    if (st_.brake > 0.05) st_.aeroStraightRequested = false;
    const double target = st_.aeroStraightRequested ? 1.0 : 0.0;
    const double rate = dt / std::max(p_.aero.modeTransitionTime, 1e-3);
    st_.aeroMode = st_.aeroMode < target ? std::min(target, st_.aeroMode + rate) : std::max(target, st_.aeroMode - rate);
}

void Vehicle::updateShifting(double dt, const DriverInputs& in) {
    auto& pt = st_.pt;
    const int n = p_.gearCount();
    pt.shiftTimer = std::max(0.0, pt.shiftTimer - dt);
    const double speed = st_.speed();
    if (pt.shiftTimer > 0.0) return;
    if (in.shiftUp) {
        pt.shiftRefused = false;
        if (pt.gear < n) {
            pt.gear = pt.gear + 1;
            pt.shiftTimer = p_.powertrain.shiftTime;
            pt.upshifting = true;
        }
    } else if (in.shiftDown) {
        pt.shiftRefused = false;
        if (pt.gear > 1) {
            // Over-rev protection: the gearbox controller refuses the shift.
            const double wheelOmega = 0.5 * (st_.wheels[RL].omega + st_.wheels[RR].omega);
            const double predicted = std::fabs(wheelOmega * totalRatio(pt.gear - 1)) * 60.0 / (2.0 * kPi);
            if (predicted > p_.powertrain.revLimit + 250.0) {
                pt.shiftRefused = true;
            } else {
                pt.gear -= 1;
                pt.shiftTimer = p_.powertrain.shiftTime;
                pt.upshifting = false;
            }
        } else if (pt.gear == 1 && speed < 5.0) {
            pt.gear = 0;
        } else if (pt.gear == 0 && speed < 1.0) {
            pt.gear = -1;
        }
    }
}

void Vehicle::step(double dt, const DriverInputs& in) {
    const auto& P = p_;
    auto& S = st_;
    S.time += dt;
    S.throttle = clamp(in.throttle, 0.0, 1.0);
    S.brake = clamp(in.brake, 0.0, 1.0);
    S.clutch = clamp(in.clutch, 0.0, 1.0);
    S.steeringWheelAngle = clamp(in.steeringWheelAngle, -P.steering.lock, P.steering.lock);

    updateShifting(dt, in);
    updateAero(dt, in);

    const double mass = P.chassis.mass + S.pt.fuelMass;
    const Quat& R = S.rot;
    const Vec3 zb = R.rotate({0.0, 0.0, 1.0});

    // ---- Steering geometry ---------------------------------------------
    const double delta = S.steeringWheelAngle / P.steering.ratio;
    double steerL = delta, steerR = delta;
    if (std::fabs(delta) > 1e-6 && P.steering.ackermann > 0.0) {
        const double L = P.chassis.wheelbase, t = P.front.track;
        const double radius = L / std::tan(std::fabs(delta));
        const double inner = std::atan(L / std::max(radius - t * 0.5, 0.5));
        const double outer = std::atan(L / (radius + t * 0.5));
        const double k = P.steering.ackermann;
        const double sgn = sign(delta);
        // Turning left: the left wheel is the inner one.
        const double innerA = sgn * lerp(std::fabs(delta), inner, k);
        const double outerA = sgn * lerp(std::fabs(delta), outer, k);
        steerL = delta > 0.0 ? innerA : outerA;
        steerR = delta > 0.0 ? outerA : innerA;
    }
    const std::array<double, 4> steer = {steerL - P.front.staticToe, steerR + P.front.staticToe,
                                         -P.rear.staticToe, P.rear.staticToe};

    // Acceleration of a body point from the previous step (for unsprung base motion).
    auto pointAcc = [&](const Vec3& rb) {
        const Vec3 w = S.angVel;
        return S.accWorld + R.rotate(cross(S.angAcc, rb) + cross(w, cross(w, rb)));
    };

    Vec3 force = kGravityVec * (mass - unsprungTotal_);
    Vec3 torque{};  // world, about the CoG
    auto applyForce = [&](const Vec3& f, const Vec3& pointWorld) {
        force += f;
        torque += cross(pointWorld - S.pos, f);
    };

    // ---- Tyres ------------------------------------------------------------
    std::array<double, 4> tyreTorque{};
    for (int i = 0; i < 4; ++i) {
        auto& w = S.wheels[i];
        const auto& a = axle(i);
        const auto& tp = a.tyre;
        const double sd = side(i);
        w.steer = steer[i];

        const Vec3 rb{a.x, sd * a.track * 0.5, cache_[i].zWheelStatic + w.compression};
        const Vec3 wc = S.pos + R.rotate(rb);
        const Vec3 vwc = S.vel + R.rotate(cross(S.angVel, rb)) + zb * w.compressionVel;
        const GroundHit g = track_->query(wc, w.trackHint);
        w.trackHint = g.segment;
        w.surface = g.surface;
        w.onTrack = g.onTrack;
        w.groundS = g.s;
        w.groundD = g.d;
        const Vec3 n = g.normal;
        const Vec3 groundPoint{wc.x, wc.y, g.height};
        const double dist = dot(wc - groundPoint, n);
        const double pen = tp.radius - dist;

        // Wheel spin axis with steer and camber, then tyre frame on the road plane.
        const double camberBody = a.staticCamber + a.camberGain * w.compression;
        const double gammaT = camberBody * sd;
        const Vec3 axisBody{-std::sin(w.steer) * std::cos(gammaT), std::cos(w.steer) * std::cos(gammaT),
                            -std::sin(gammaT)};
        const Vec3 axis = R.rotate(axisBody);
        const Vec3 lon = normalize(cross(axis, n));
        const Vec3 lat = cross(n, lon);
        const double gammaTyre = -std::asin(clamp(dot(axis, n), -1.0, 1.0));
        w.camber = gammaTyre * sd;

        double fz = 0.0;
        if (pen > 0.0) {
            const double penRate = -dot(vwc, n);
            fz = std::max(0.0, tp.vertStiffness * pen + tp.vertDamping * penRate);
        }
        w.fz = fz;
        w.effectiveRadius = tp.radius - std::max(pen, 0.0) / 3.0;
        w.wheelCentre = wc;
        w.contactPoint = wc - n * dist;

        const double vx = dot(vwc, lon);
        const double vy = dot(vwc, lat);
        const double vsx = vx - w.omega * w.effectiveRadius;
        const double vref = std::max(std::fabs(vx), kLowSpeed);
        w.kappaT = clamp(relaxTowards(w.kappaT, -vsx / vref, vref / tp.relaxLengthX, dt), -1.0, 2.0);
        w.tanAlphaT = clamp(relaxTowards(w.tanAlphaT, vy / vref, vref / tp.relaxLengthY, dt), -3.0, 3.0);

        TyreInput ti;
        ti.fz = fz;
        ti.kappa = w.kappaT;
        ti.tanAlpha = w.tanAlphaT;
        ti.camber = gammaTyre;
        ti.camberAuto = w.camber;
        ti.vx = vx;
        ti.surfaceGrip = g.grip;
        ti.gripTemperature = w.thermal.effective(tp);
        TyreOutput to = tyres_[i].compute(ti);
        to.fx -= g.rollingDrag * fz * std::tanh(vx / 0.5);
        w.fx = to.fx;
        w.fy = to.fy;
        w.mz = to.mz;
        w.normalizedSlip = to.normalizedSlip;
        w.gripFactor = to.gripFactor;
        w.slipAngle = std::atan(w.tanAlphaT);
        w.slipRatio = w.kappaT;
        tyreTorque[i] = -to.fx * w.effectiveRadius;

        // Force path: the component along the strut goes to the unsprung
        // mass, the rest into the chassis through the links (with jacking
        // from roll-centre and anti geometry).
        const Vec3 fTyre = lon * to.fx + lat * to.fy + n * fz;
        const double fAlong = dot(fTyre, zb);
        const Vec3 fPerp = fTyre - zb * fAlong;
        const double antiJack = i < 2 ? -to.fx * a.antiTan : to.fx * a.antiTan;
        const double rollJack = -sd * to.fy * 2.0 * a.rollCentreHeight / a.track;
        const double jack = antiJack + rollJack;
        applyForce(fPerp + zb * jack, w.contactPoint);

        // Thermal: sliding power heats the tread, deflection heats the carcass.
        const double slidePower = std::fabs(to.fx * vsx) + std::fabs(to.fy * vy);
        w.thermal.update(tp, slidePower, vx, fz, airTemp_, trackTemp_, dt);

        // Stash for the suspension pass.
        w.suspensionForce = fAlong - jack;  // temporarily: net tyre+link force on the unsprung mass
    }

    // ---- Suspension ---------------------------------------------------------
    std::array<double, 4> springForce{};
    for (int ax = 0; ax < 2; ++ax) {
        const AxleParams& a = ax == 0 ? P.front : P.rear;
        const int il = ax * 2, ir = il + 1;
        const double xl = S.wheels[il].compression, xr = S.wheels[ir].compression;
        const double xm = 0.5 * (xl + xr);
        double heave = a.heaveRate * xm;
        if (xm > a.heaveGap) heave += a.heavePackerRate * (xm - a.heaveGap);
        const double roll = 0.5 * (xl - xr);
        for (int k = 0; k < 2; ++k) {
            const int i = il + k;
            const auto& w = S.wheels[i];
            const double x = w.compression;
            double f = cache_[i].staticSpringForce + a.springRate * x + 0.5 * heave + (k == 0 ? 1.0 : -1.0) * a.arbRate * roll;
            if (x > a.bumpStopGap) f += a.bumpStopRate * (x - a.bumpStopGap);
            if (x < -a.droopTravel) f += a.bumpStopRate * (x + a.droopTravel);
            f += damperForce(a, w.compressionVel);
            springForce[i] = f;
        }
    }
    for (int i = 0; i < 4; ++i) {
        auto& w = S.wheels[i];
        const auto& a = axle(i);
        const Vec3 rb{a.x, side(i) * a.track * 0.5, cache_[i].zWheelStatic + w.compression};
        const double netOnUnsprung = w.suspensionForce;  // tyre along strut minus jacking
        applyForce(zb * springForce[i], S.pos + R.rotate(rb));
        const double base = dot(pointAcc(rb), zb);
        const double acc = (netOnUnsprung - springForce[i]) / a.unsprungMass + dot(kGravityVec, zb) - base;
        w.compressionVel += acc * dt;
        w.compression += w.compressionVel * dt;
        const double lo = -(a.droopTravel + 0.03), hi = a.bumpStopGap + 0.03;
        if (w.compression < lo) { w.compression = lo; w.compressionVel = std::max(0.0, w.compressionVel); }
        if (w.compression > hi) { w.compression = hi; w.compressionVel = std::min(0.0, w.compressionVel); }
        w.suspensionForce = springForce[i];
    }

    // ---- Aerodynamics -------------------------------------------------------
    {
        const auto& A = P.aero;
        auto floorHeight = [&](double x, int hintWheel) {
            const Vec3 pb{x, 0.0, floorBodyZ(x)};
            const Vec3 pw = S.pos + R.rotate(pb);
            const GroundHit g = track_->query(pw, S.wheels[hintWheel].trackHint);
            return pw.z - g.height;
        };
        S.rideHeightFront = floorHeight(A.frontFloorX, FL);
        S.rideHeightRear = floorHeight(A.rearFloorX, RL);
        const double staticFront = floorBodyZ(A.frontFloorX) + P.chassis.cgHeight;
        const double staticRear = floorBodyZ(A.rearFloorX) + P.chassis.cgHeight;
        const double hm = 0.5 * (S.rideHeightFront + S.rideHeightRear);
        double fh;
        if (hm >= A.stallRideHeight) fh = 1.0 + A.rideHeightSensitivity * (A.refRideHeight - hm);
        else fh = 1.0 + A.rideHeightSensitivity * (A.refRideHeight - A.stallRideHeight) - A.stallSlope * (A.stallRideHeight - hm);
        fh = clamp(fh, 0.4, 1.4);

        const Vec3 vb = R.inverseRotate(S.vel);
        const double speed = length(S.vel);
        const double beta = speed > 5.0 ? std::atan2(vb.y, std::fabs(vb.x)) : 0.0;
        const double fyaw = clamp(1.0 - A.yawSensitivity * beta * beta, 0.5, 1.0);
        const double m = S.aeroMode;
        const double cla = lerp(A.claCorner, A.claStraight, m) * fh * fyaw;
        const double cda = lerp(A.cdaCorner, A.cdaStraight, m) * (1.0 + 2.0 * beta * beta);
        double bal = lerp(A.balanceFrontCorner, A.balanceFrontStraight, m) +
                     A.rakeBalanceSensitivity * ((S.rideHeightRear - S.rideHeightFront) - (staticRear - staticFront));
        bal = clamp(bal, 0.2, 0.7);
        const double q = 0.5 * A.airDensity * speed * speed;
        const double df = q * cla;
        S.downforceFront = df * bal;
        S.downforceRear = df * (1.0 - bal);
        S.drag = q * cda;
        applyForce(-zb * S.downforceFront, S.pos + R.rotate({P.front.x, 0.0, floorBodyZ(P.front.x)}));
        applyForce(-zb * S.downforceRear, S.pos + R.rotate({P.rear.x, 0.0, floorBodyZ(P.rear.x)}));
        if (speed > 0.1) applyForce(-S.vel / speed * S.drag, S.pos + R.rotate({0.0, 0.0, A.copHeight}));
    }

    // ---- Floor (plank) and wall contacts ----------------------------------------
    S.floorContact = false;
    {
        const double xs[3] = {P.aero.frontFloorX, 0.0, P.aero.rearFloorX};
        for (double x : xs) {
            for (double y : {-0.25, 0.25}) {
                const Vec3 pb{x, y, floorBodyZ(x)};
                const Vec3 pw = S.pos + R.rotate(pb);
                const GroundHit g = track_->query(pw, S.wheels[x > 0.0 ? FL : RL].trackHint);
                const double pen = g.height - pw.z;
                if (pen <= 0.0) continue;
                S.floorContact = true;
                const Vec3 v = S.vel + R.rotate(cross(S.angVel, pb));
                const double vn = dot(v, g.normal);
                const double fn = std::max(0.0, kFloorStiffness * pen - kFloorDamping * vn);
                const Vec3 vt = v - g.normal * vn;
                const double vtl = length(vt);
                Vec3 f = g.normal * fn;
                if (vtl > 1e-4) f -= vt / vtl * (kFloorFriction * fn * std::tanh(vtl / 0.2));
                applyForce(f, pw);
            }
        }
    }
    S.wallContact = false;
    if (!track_->isPad()) {
        const double xf = P.front.x + 1.0, xr = P.rear.x - 0.9, hw = P.chassis.width * 0.5;
        const Vec3 pts[4] = {{xf, hw * 0.6, 0.0}, {xf, -hw * 0.6, 0.0}, {xr, hw, 0.0}, {xr, -hw, 0.0}};
        for (int k = 0; k < 4; ++k) {
            const Vec3 pw = S.pos + R.rotate(pts[k]);
            const GroundHit g = track_->query(pw, S.wheels[k < 2 ? FL : RL].trackHint);
            double pen = 0.0, dirSign = 0.0;
            if (g.d > g.wallLeft) { pen = g.d - g.wallLeft; dirSign = -1.0; }
            else if (g.d < g.wallRight) { pen = g.wallRight - g.d; dirSign = 1.0; }
            if (pen <= 0.0) continue;
            S.wallContact = true;
            const double h = track_->headingAt(g.s);
            const Vec3 nrm = Vec3{-std::sin(h), std::cos(h), 0.0} * dirSign;  // points back to the track
            const Vec3 v = S.vel + R.rotate(cross(S.angVel, pts[k]));
            const double vn = dot(v, nrm);
            const double fn = std::max(0.0, kWallStiffness * std::min(pen, 0.5) - kWallDamping * std::min(vn, 0.0));
            const Vec3 vt = v - nrm * vn;
            const double vtl = length(vt);
            Vec3 f = nrm * fn;
            if (vtl > 1e-3) f -= vt / vtl * (kWallFriction * fn);
            applyForce(f, pw);
        }
    }

    // ---- Driveline, brakes, ERS ---------------------------------------------------
    solveDriveline(dt, tyreTorque);

    // ---- Chassis integration (semi-implicit Euler) ------------------------------------
    const Vec3 acc = force / mass;
    const Vec3 torqueBody = R.inverseRotate(torque);
    const Vec3 I{P.chassis.ixx, P.chassis.iyy, P.chassis.izz};
    const Vec3 w = S.angVel;
    const Vec3 Iw{I.x * w.x, I.y * w.y, I.z * w.z};
    const Vec3 gyro = cross(w, Iw);
    const Vec3 angAcc{(torqueBody.x - gyro.x) / I.x, (torqueBody.y - gyro.y) / I.y, (torqueBody.z - gyro.z) / I.z};
    S.vel += acc * dt;
    S.pos += S.vel * dt;
    S.angVel += angAcc * dt;
    S.rot = S.rot.integrated(S.angVel, dt);
    S.accWorld = acc;
    S.angAcc = angAcc;

    // ---- Steering rack torque (force feedback source) ----------------------------------
    {
        const auto& sp = P.steering;
        double kingpin = 0.0;
        for (int i = 0; i < 2; ++i) {
            const auto& wh = S.wheels[i];
            kingpin += wh.mz - wh.fy * sp.mechanicalTrail - side(i) * sp.scrubRadius * wh.fx -
                       wh.fz * sp.weightCentering * std::sin(wh.steer);
        }
        S.steeringTorque = kingpin / sp.ratio * (1.0 - sp.powerAssist);
    }
    for (auto& wh : S.wheels) wh.spinAngle = std::fmod(wh.spinAngle + wh.omega * dt, 2.0 * kPi);
}

void Vehicle::solveDriveline(double dt, const std::array<double, 4>& tyreTorque) {
    const auto& P = p_;
    const auto& pp = P.powertrain;
    auto& S = st_;
    auto& pt = S.pt;
    const double speed = S.speed();
    const double idle = rpmToRad(pp.idleRpm);
    const double G = totalRatio(pt.gear);
    const double rpm = S.rpm();

    // ---- Clutch engagement (auto launch / anti-stall + manual paddle) ----
    const double rearOmega = 0.5 * (S.wheels[RL].omega + S.wheels[RR].omega);
    const double wheelSideRpm = std::fabs(G * rearOmega) * 60.0 / (2.0 * kPi);
    double autoEng = 1.0;
    if (G == 0.0) autoEng = 0.0;
    else if (pt.shiftTimer <= 0.0 && wheelSideRpm < pp.idleRpm + 1500.0) {
        // Launch / anti-stall: the clutch bites harder as the engine revs up,
        // so the engine settles where its torque matches the clutch torque.
        autoEng = smoothstep(pp.idleRpm - 500.0, pp.idleRpm + 3000.0, rpm);
    }
    // The actuator cannot slam the clutch shut: engagement rises over ~0.35 s
    // but opens quickly (anti-stall).
    const double engageTarget = std::min(autoEng, 1.0 - S.clutch);
    if (engageTarget > pt.clutchEngagement) pt.clutchEngagement = std::min(engageTarget, pt.clutchEngagement + 3.0 * dt);
    else pt.clutchEngagement = std::max(engageTarget, pt.clutchEngagement - 12.0 * dt);
    double clutchCap = pp.clutchMaxTorque * pt.clutchEngagement;
    if (pt.shiftTimer > 0.0) clutchCap = std::min(clutchCap, 450.0);

    // ---- ICE torque --------------------------------------------------------
    double thr = S.throttle;
    if (rpm < pp.idleRpm) thr = std::max(thr, clamp((pp.idleRpm - rpm) / 1500.0, 0.0, 0.35));
    const double omegaE = std::max(pt.engineOmega, 1.0);
    // Constant torque below the first power-curve point, power curve above it.
    const double full = rpm < pp.iceRpm.front() ? pp.icePowerW.front() / rpmToRad(pp.iceRpm.front())
                                                : P.icePowerAt(rpm) / omegaE;
    const double engineBrake = -(pp.engineBrakeTorque + pp.engineBrakePerRpm * rpm);
    double ice = thr * full + (1.0 - thr) * engineBrake;
    pt.revLimiter = rpm >= pp.revLimit;
    if (pt.revLimiter) ice = std::min(ice, engineBrake);
    if (pt.shiftTimer > 0.0) {
        if (pt.upshifting) ice *= 0.25;
        else ice = std::max(ice, 0.5 * full);  // throttle blip
    }
    pt.iceTorque = ice;

    // ---- ERS (MGU-K) -----------------------------------------------------------
    const double kph = speed * 3.6;
    const double taper = clamp((pp.mgukTaperEndKph - kph) / (pp.mgukTaperEndKph - pp.mgukTaperStartKph), 0.0, 1.0);
    const bool driveConnected = pt.gear > 0 && pt.clutchEngagement > 0.99 && pt.shiftTimer <= 0.0;
    const double harvestRoom = std::min(pp.batteryWindow - pt.soc, pp.harvestPerLap - pt.lapHarvest);
    double mguk = 0.0;
    const double brakeTotal = S.brake * P.brakes.maxTorque;
    const double rearTarget = brakeTotal * (1.0 - S.brakeBias);
    // Overrun torque the engine already puts on the rear wheels (positive = braking).
    const double engineBrakeAtWheels = driveConnected ? std::max(0.0, -ice) * std::fabs(G) : 0.0;
    // Rough rear grip estimate used by the brake-by-wire / harvest controller.
    const double rearGripTorque = P.rear.tyre.muX * (S.wheels[RL].fz + S.wheels[RR].fz) * P.rear.tyre.radius;
    double regenAtWheels = 0.0;
    // Deployment map: qualifying spends everything, balanced tapers off as
    // the battery drains so a lap does not end on an empty store.
    const double socFrac = pt.soc / pp.batteryWindow;
    double deployScale = 1.0;
    if (pt.ersMode == ErsMode::Balanced) deployScale = 0.85 * smoothstep(0.10, 0.45, socFrac);
    else if (pt.ersMode == ErsMode::Harvest) deployScale = 0.0;
    if (driveConnected && S.throttle > 0.6 && pt.soc > 0.0 && S.brake < 0.02 && deployScale > 0.0) {
        const double power = pp.mgukMaxPower * taper * deployScale * smoothstep(0.6, 0.98, S.throttle);
        mguk = std::min(power / omegaE, pp.mgukMaxTorque);
    } else if (driveConnected && harvestRoom > 0.0 && S.brake >= 0.02 && rearOmega > 5.0) {
        // Brake-by-wire: the rear target is met by engine braking first, then
        // the MGU-K, and only the remainder goes to the hydraulic rear brakes.
        const double wanted = std::max(0.0, rearTarget - engineBrakeAtWheels);
        const double wheelTorque = std::min(wanted, pp.mgukMaxPower / rearOmega);
        mguk = -std::min(wheelTorque / std::fabs(G), pp.mgukMaxTorque);
        regenAtWheels = -mguk * std::fabs(G);
    } else if (driveConnected && harvestRoom > 0.0 && S.throttle < 0.05 && speed > 20.0 && rearOmega > 5.0) {
        // Off-throttle harvesting, limited so the total overrun torque stays
        // well inside the rear tyres' grip (the ECU's engine-braking map).
        const double room = std::max(0.0, 0.35 * rearGripTorque - engineBrakeAtWheels);
        const double wheelTorque = std::min(room, pp.coastHarvestPower / rearOmega);
        mguk = -std::min(wheelTorque / std::fabs(G), pp.mgukMaxTorque);
    }
    pt.mgukTorque = mguk;

    double engineTorque = ice + mguk;
    if (engineTorque > 0.0) engineTorque *= pp.drivelineEfficiency;

    // ---- Brakes (hydraulic share after regeneration) ------------------------------
    auto brakeFactor = [&](double temp) {
        const auto& b = P.brakes;
        double f = b.coldFactor + (1.0 - b.coldFactor) * smoothstep(airTemp_, b.tempOptimalLow, temp);
        if (temp > b.tempOptimalHigh) f *= lerp(1.0, b.fadeFactor, clamp((temp - b.tempOptimalHigh) / 300.0, 0.0, 1.0));
        return f;
    };
    const double frontEach = brakeTotal * S.brakeBias * 0.5;
    const double rearEach = std::max(0.0, rearTarget - regenAtWheels - (S.brake >= 0.02 ? engineBrakeAtWheels : 0.0)) * 0.5;
    std::array<double, 4> brakeCap = {frontEach * brakeFactor(S.wheels[FL].brakeTemp),
                                      frontEach * brakeFactor(S.wheels[FR].brakeTemp),
                                      rearEach * brakeFactor(S.wheels[RL].brakeTemp),
                                      rearEach * brakeFactor(S.wheels[RR].brakeTemp)};

    // ---- Front wheels: independent spin + brake friction ------------------------------
    for (int i = 0; i < 2; ++i) {
        auto& w = S.wheels[i];
        const double I = P.front.tyre.wheelInertia;
        double om = w.omega + dt * tyreTorque[i] / I;
        const double lambda = clamp(-om * I, -brakeCap[i] * dt, brakeCap[i] * dt);
        om += lambda / I;
        w.brakeTorque = std::fabs(lambda) / dt;
        w.omega = om;
    }

    // ---- Rear axle: engine, clutch, open diff + LSD clutch, brakes (PGS) ----------------
    const double Iw = P.rear.tyre.wheelInertia;
    const double Ie = pp.engineInertia;
    const double Ic = pp.gearboxInertia * G * G + 2.0 * Iw + 0.05;
    const double Id = 2.0 * Iw;
    double we = pt.engineOmega + dt * engineTorque / Ie;
    double wc = rearOmega + dt * (tyreTorque[RL] + tyreTorque[RR]) / Ic;
    double dl = 0.5 * (S.wheels[RL].omega - S.wheels[RR].omega) + dt * (tyreTorque[RL] - tyreTorque[RR]) / Id;

    const double inputTorque = engineTorque * G;
    const double lsdCap = pp.diffPreload + (inputTorque >= 0.0 ? pp.diffPowerLock : pp.diffCoastLock) * std::fabs(inputTorque);
    double accClutch = 0.0, accLsd = 0.0, accBL = 0.0, accBR = 0.0;
    const double kBrake = 1.0 / (1.0 / Ic + 1.0 / Id);
    for (int it = 0; it < 12; ++it) {
        if (G != 0.0 && clutchCap > 0.0) {
            const double c = we - G * wc;
            const double k = 1.0 / (1.0 / Ie + G * G / Ic);
            const double old = accClutch;
            accClutch = clamp(accClutch - c * k, -clutchCap * dt, clutchCap * dt);
            const double l = accClutch - old;
            we += l / Ie;
            wc -= G * l / Ic;
        }
        {
            const double old = accLsd;
            accLsd = clamp(accLsd - dl * Id, -2.0 * lsdCap * dt, 2.0 * lsdCap * dt);
            dl += (accLsd - old) / Id;
        }
        {
            const double c = wc + dl;
            const double old = accBL;
            accBL = clamp(accBL - c * kBrake, -brakeCap[RL] * dt, brakeCap[RL] * dt);
            const double l = accBL - old;
            wc += l / Ic;
            dl += l / Id;
        }
        {
            const double c = wc - dl;
            const double old = accBR;
            accBR = clamp(accBR - c * kBrake, -brakeCap[RR] * dt, brakeCap[RR] * dt);
            const double l = accBR - old;
            wc += l / Ic;
            dl -= l / Id;
        }
    }
    S.wheels[RL].omega = wc + dl;
    S.wheels[RR].omega = wc - dl;
    S.wheels[RL].brakeTorque = std::fabs(accBL) / dt;
    S.wheels[RR].brakeTorque = std::fabs(accBR) / dt;

    // Engine restarts itself (anti-stall) if it ever drops below stall speed.
    if (we < rpmToRad(pp.stallRpm) && pt.clutchEngagement < 0.5) we = idle;
    pt.engineOmega = std::max(we, 0.0);

    // ---- Energy bookkeeping --------------------------------------------------------------
    const double mechPower = mguk * pt.engineOmega;
    pt.mgukPower = mechPower;
    if (mechPower > 0.0) {
        pt.soc = std::max(0.0, pt.soc - mechPower / pp.mgukEfficiency * dt);
    } else if (mechPower < 0.0) {
        pt.soc = std::min(pp.batteryWindow, pt.soc - mechPower * pp.mgukEfficiency * dt);
        pt.lapHarvest -= mechPower * dt;
    }
    if (ice > 0.0) {
        const double fuelFlow = ice * pt.engineOmega / (pp.iceThermalEfficiency * pp.fuelLhv);
        pt.fuelMass = std::max(0.0, pt.fuelMass - fuelFlow * dt);
    }

    // ---- Brake disc temperatures ------------------------------------------------------------
    for (auto& w : S.wheels) {
        const auto& b = P.brakes;
        const double heat = w.brakeTorque * std::fabs(w.omega);
        const double tk = w.brakeTemp + 273.15, ta = airTemp_ + 273.15;
        const double cool = (b.coolingBase + b.coolingPerSpeed * speed) * (w.brakeTemp - airTemp_) +
                            0.9 * kStefanBoltzmann * 0.04 * (tk * tk * tk * tk - ta * ta * ta * ta);
        w.brakeTemp += dt * (heat - cool) / b.discHeatCapacity;
    }
}

}  // namespace f1sim
