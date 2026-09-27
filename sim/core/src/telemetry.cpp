#include "f1sim/telemetry.hpp"

#include <cstdio>

namespace f1sim {

void TelemetryLogger::record(const VehicleState& s, double lapTime, double distance, double ffbCommand, double dt,
                             double rateHz) {
    accumulator_ += dt;
    if (!samples_.empty() && accumulator_ < 1.0 / rateHz) return;
    accumulator_ = 0.0;
    TelemetrySample t{};
    const Vec3 g = s.gForce();
    t.time = static_cast<float>(lapTime);
    t.distance = static_cast<float>(distance);
    t.x = static_cast<float>(s.pos.x);
    t.y = static_cast<float>(s.pos.y);
    t.z = static_cast<float>(s.pos.z);
    t.speedKph = static_cast<float>(s.speed() * 3.6);
    t.throttle = static_cast<float>(s.throttle * 100.0);
    t.brake = static_cast<float>(s.brake * 100.0);
    t.steerDeg = static_cast<float>(rad2deg(s.steeringWheelAngle));
    t.gear = static_cast<float>(s.pt.gear);
    t.rpm = static_cast<float>(s.rpm());
    t.gLat = static_cast<float>(g.y);
    t.gLong = static_cast<float>(g.x);
    t.yawRateDeg = static_cast<float>(rad2deg(s.angVel.z));
    t.slipAngleFront = static_cast<float>(rad2deg(0.5 * (s.wheels[FL].slipAngle + s.wheels[FR].slipAngle)));
    t.slipAngleRear = static_cast<float>(rad2deg(0.5 * (s.wheels[RL].slipAngle + s.wheels[RR].slipAngle)));
    for (int i = 0; i < 4; ++i) {
        t.slipRatio[i] = static_cast<float>(s.wheels[i].slipRatio);
        t.tyreSurface[i] = static_cast<float>(s.wheels[i].thermal.surface);
        t.tyreCarcass[i] = static_cast<float>(s.wheels[i].thermal.carcass);
        t.brakeTemp[i] = static_cast<float>(s.wheels[i].brakeTemp);
        t.fz[i] = static_cast<float>(s.wheels[i].fz);
    }
    t.socMj = static_cast<float>(s.pt.soc / 1.0e6);
    t.mgukKw = static_cast<float>(s.pt.mgukPower / 1000.0);
    t.rideFrontMm = static_cast<float>(s.rideHeightFront * 1000.0);
    t.rideRearMm = static_cast<float>(s.rideHeightRear * 1000.0);
    t.aeroMode = static_cast<float>(s.aeroMode);
    t.steeringTorque = static_cast<float>(s.steeringTorque);
    t.ffbCommand = static_cast<float>(ffbCommand);
    samples_.push_back(t);
}

bool TelemetryLogger::saveCsv(const std::string& path, std::string* error) const {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) {
        if (error) *error = "cannot write '" + path + "'";
        return false;
    }
    std::fprintf(f,
                 "Time,Distance,X,Y,Z,Speed,Throttle,Brake,SteerDeg,nGear,RPM,GLat,GLong,YawRateDeg,"
                 "SlipAngleFrontDeg,SlipAngleRearDeg,SlipRatioFL,SlipRatioFR,SlipRatioRL,SlipRatioRR,"
                 "TyreSurfFL,TyreSurfFR,TyreSurfRL,TyreSurfRR,TyreCarcFL,TyreCarcFR,TyreCarcRL,TyreCarcRR,"
                 "BrakeFL,BrakeFR,BrakeRL,BrakeRR,FzFL,FzFR,FzRL,FzRR,SocMJ,MgukKW,RideFrontMm,RideRearMm,"
                 "AeroMode,SteeringTorqueNm,FfbCommand\n");
    for (const auto& t : samples_) {
        std::fprintf(f, "%.3f,%.2f,%.2f,%.2f,%.2f,%.2f,%.1f,%.1f,%.2f,%.0f,%.0f,%.3f,%.3f,%.2f,%.3f,%.3f", t.time,
                     t.distance, t.x, t.y, t.z, t.speedKph, t.throttle, t.brake, t.steerDeg, t.gear, t.rpm, t.gLat,
                     t.gLong, t.yawRateDeg, t.slipAngleFront, t.slipAngleRear);
        for (float v : t.slipRatio) std::fprintf(f, ",%.4f", v);
        for (float v : t.tyreSurface) std::fprintf(f, ",%.1f", v);
        for (float v : t.tyreCarcass) std::fprintf(f, ",%.1f", v);
        for (float v : t.brakeTemp) std::fprintf(f, ",%.0f", v);
        for (float v : t.fz) std::fprintf(f, ",%.0f", v);
        std::fprintf(f, ",%.3f,%.1f,%.1f,%.1f,%.2f,%.3f,%.3f\n", t.socMj, t.mgukKw, t.rideFrontMm, t.rideRearMm,
                     t.aeroMode, t.steeringTorque, t.ffbCommand);
    }
    const bool ok = std::fclose(f) == 0;
    if (!ok && error) *error = "write failed for '" + path + "'";
    return ok;
}

}  // namespace f1sim
