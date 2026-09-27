#include "f1sim/car_params.hpp"

#include "f1sim/ini.hpp"
#include "f1sim/math.hpp"

namespace f1sim {
namespace {

// Reads required values with unit conversion and collects the first error.
class Reader {
public:
    Reader(const IniFile& ini, std::string* error) : ini_(ini), error_(error) {}

    void num(const std::string& key, double* out, double scale = 1.0) {
        const auto v = ini_.getDouble(key);
        if (!v) { fail(key, ini_.has(key) ? "is not a number" : "is missing"); return; }
        *out = *v * scale;
    }
    void deg(const std::string& key, double* out) { num(key, out, kPi / 180.0); }
    void mm(const std::string& key, double* out) { num(key, out, 0.001); }
    void list(const std::string& key, std::vector<double>* out, double scale = 1.0) {
        const auto v = ini_.getList(key);
        if (!v || v->empty()) { fail(key, ini_.has(key) ? "is not a number list" : "is missing"); return; }
        out->clear();
        for (double d : *v) out->push_back(d * scale);
    }
    void positive(const std::string& key, double value) {
        if (!(value > 0.0)) fail(key, "must be > 0");
    }
    bool ok() const { return ok_; }

private:
    void fail(const std::string& key, const std::string& why) {
        if (ok_ && error_) *error_ = ini_.source() + ": '" + key + "' " + why;
        ok_ = false;
    }
    const IniFile& ini_;
    std::string* error_;
    bool ok_ = true;
};

void readTyre(Reader& r, const std::string& s, TyreParams& t) {
    r.mm(s + ".radius_mm", &t.radius);
    r.mm(s + ".width_mm", &t.width);
    r.num(s + ".wheel_inertia", &t.wheelInertia);
    r.num(s + ".vertical_stiffness_n_per_mm", &t.vertStiffness, 1000.0);
    r.num(s + ".vertical_damping", &t.vertDamping);
    r.num(s + ".nominal_load_n", &t.fz0);
    r.num(s + ".mu_lateral", &t.muY);
    r.num(s + ".mu_longitudinal", &t.muX);
    r.num(s + ".load_sensitivity_lateral", &t.loadSensY);
    r.num(s + ".load_sensitivity_longitudinal", &t.loadSensX);
    r.deg(s + ".peak_slip_angle_deg", &t.peakSlipAngle);
    r.num(s + ".peak_slip_ratio", &t.peakSlipRatio);
    r.num(s + ".peak_slip_load_growth", &t.peakSlipLoadGrowth);
    r.num(s + ".shape_lateral", &t.shapeCy);
    r.num(s + ".curvature_lateral", &t.curvEy);
    r.num(s + ".shape_longitudinal", &t.shapeCx);
    r.num(s + ".curvature_longitudinal", &t.curvEx);
    r.mm(s + ".pneumatic_trail_mm", &t.pneumaticTrail);
    r.num(s + ".trail_zero_slip", &t.trailZeroSlip);
    r.num(s + ".lateral_carcass_stiffness_n_per_mm", &t.lateralCarcassStiffness, 1000.0);
    r.num(s + ".camber_thrust", &t.camberThrust);
    r.deg(s + ".camber_optimal_deg", &t.camberOptimal);
    r.num(s + ".camber_sensitivity", &t.camberSensitivity);
    r.mm(s + ".relaxation_length_long_mm", &t.relaxLengthX);
    r.mm(s + ".relaxation_length_lat_mm", &t.relaxLengthY);
    r.num(s + ".rolling_resistance", &t.rollingResistance);
    r.num(s + ".temp_optimal_c", &t.tempOptimal);
    r.num(s + ".temp_window_c", &t.tempWindow);
    r.num(s + ".cold_grip_loss", &t.coldGripLoss);
    r.num(s + ".hot_grip_loss", &t.hotGripLoss);
    r.num(s + ".surface_temp_weight", &t.surfaceWeight);
    r.num(s + ".surface_heat_capacity", &t.surfaceHeatCapacity);
    r.num(s + ".carcass_heat_capacity", &t.carcassHeatCapacity);
    r.num(s + ".surface_to_carcass", &t.surfaceToCarcass);
    r.num(s + ".surface_to_air_base", &t.surfaceToAirBase);
    r.num(s + ".surface_to_air_per_speed", &t.surfaceToAirPerSpeed);
    r.num(s + ".surface_to_track", &t.surfaceToTrack);
    r.num(s + ".carcass_to_air", &t.carcassToAir);
    r.num(s + ".friction_heat_share", &t.frictionHeatShare);
    r.num(s + ".hysteresis_coeff", &t.hysteresisCoeff);
    r.num(s + ".cold_pressure_kpa", &t.coldPressureKpa);
    for (const auto& [key, v] : {std::pair<const char*, double>{"radius_mm", t.radius},
                                 {"nominal_load_n", t.fz0},
                                 {"peak_slip_angle_deg", t.peakSlipAngle},
                                 {"peak_slip_ratio", t.peakSlipRatio},
                                 {"relaxation_length_long_mm", t.relaxLengthX},
                                 {"relaxation_length_lat_mm", t.relaxLengthY},
                                 {"wheel_inertia", t.wheelInertia},
                                 {"surface_heat_capacity", t.surfaceHeatCapacity},
                                 {"carcass_heat_capacity", t.carcassHeatCapacity}}) {
        r.positive(s + "." + key, v);
    }
}

void readAxle(Reader& r, const std::string& s, AxleParams& a) {
    r.num(s + ".track_m", &a.track);
    r.num(s + ".unsprung_mass", &a.unsprungMass);
    r.num(s + ".spring_rate_n_per_mm", &a.springRate, 1000.0);
    r.num(s + ".heave_rate_n_per_mm", &a.heaveRate, 1000.0);
    r.mm(s + ".heave_gap_mm", &a.heaveGap);
    r.num(s + ".heave_packer_rate_n_per_mm", &a.heavePackerRate, 1000.0);
    r.num(s + ".arb_rate_n_per_mm", &a.arbRate, 1000.0);
    r.mm(s + ".bump_stop_gap_mm", &a.bumpStopGap);
    r.num(s + ".bump_stop_rate_n_per_mm", &a.bumpStopRate, 1000.0);
    r.mm(s + ".droop_travel_mm", &a.droopTravel);
    r.num(s + ".damper_bump_slow", &a.damperBumpSlow);
    r.num(s + ".damper_bump_fast", &a.damperBumpFast);
    r.num(s + ".damper_rebound_slow", &a.damperReboundSlow);
    r.num(s + ".damper_rebound_fast", &a.damperReboundFast);
    r.num(s + ".damper_knee_m_per_s", &a.damperKnee);
    r.deg(s + ".static_camber_deg", &a.staticCamber);
    r.deg(s + ".static_toe_deg", &a.staticToe);
    r.num(s + ".camber_gain_deg_per_mm", &a.camberGain, kPi / 180.0 * 1000.0);
    r.mm(s + ".roll_centre_height_mm", &a.rollCentreHeight);
    r.num(s + ".anti_geometry_tan", &a.antiTan);
    r.mm(s + ".ride_height_mm", &a.rideHeight);
    r.positive(s + ".unsprung_mass", a.unsprungMass);
    r.positive(s + ".track_m", a.track);
    r.positive(s + ".spring_rate_n_per_mm", a.springRate);
    readTyre(r, s + "_tyre", a.tyre);
}

}  // namespace

bool CarParams::load(const std::string& path, CarParams* out, std::string* error,
                     std::vector<std::string>* warnings) {
    IniFile ini;
    if (!ini.loadFile(path, error)) return false;
    return fromIni(ini, out, error, warnings);
}

bool CarParams::fromIni(const IniFile& ini, CarParams* out, std::string* error,
                        std::vector<std::string>* warnings) {
    CarParams c;
    Reader r(ini, error);
    c.name = ini.getString("car.name", "unnamed");

    auto& ch = c.chassis;
    r.num("chassis.mass_kg", &ch.mass);
    r.mm("chassis.cg_height_mm", &ch.cgHeight);
    r.num("chassis.weight_front", &ch.weightFront);
    r.mm("chassis.wheelbase_mm", &ch.wheelbase);
    r.num("chassis.inertia_roll", &ch.ixx);
    r.num("chassis.inertia_pitch", &ch.iyy);
    r.num("chassis.inertia_yaw", &ch.izz);
    r.mm("chassis.length_mm", &ch.length);
    r.mm("chassis.width_mm", &ch.width);
    r.positive("chassis.mass_kg", ch.mass);
    r.positive("chassis.wheelbase_mm", ch.wheelbase);

    readAxle(r, "front", c.front);
    readAxle(r, "rear", c.rear);

    auto& a = c.aero;
    r.num("aero.air_density", &a.airDensity);
    r.num("aero.cla_corner", &a.claCorner);
    r.num("aero.cda_corner", &a.cdaCorner);
    r.num("aero.cla_straight", &a.claStraight);
    r.num("aero.cda_straight", &a.cdaStraight);
    r.num("aero.balance_front_corner", &a.balanceFrontCorner);
    r.num("aero.balance_front_straight", &a.balanceFrontStraight);
    r.num("aero.mode_transition_s", &a.modeTransitionTime);
    r.mm("aero.ref_ride_height_mm", &a.refRideHeight);
    r.num("aero.ride_height_sensitivity_per_m", &a.rideHeightSensitivity);
    r.mm("aero.stall_ride_height_mm", &a.stallRideHeight);
    r.num("aero.stall_slope_per_m", &a.stallSlope);
    r.num("aero.rake_balance_per_m", &a.rakeBalanceSensitivity);
    r.num("aero.yaw_sensitivity", &a.yawSensitivity);
    r.mm("aero.cop_height_mm", &a.copHeight);
    r.mm("aero.front_floor_x_mm", &a.frontFloorX);
    r.mm("aero.rear_floor_x_mm", &a.rearFloorX);

    auto& p = c.powertrain;
    r.list("powertrain.ice_rpm", &p.iceRpm);
    r.list("powertrain.ice_power_kw", &p.icePowerW, 1000.0);
    r.num("powertrain.rev_limit_rpm", &p.revLimit);
    r.num("powertrain.idle_rpm", &p.idleRpm);
    r.num("powertrain.stall_rpm", &p.stallRpm);
    r.num("powertrain.engine_inertia", &p.engineInertia);
    r.num("powertrain.engine_brake_torque", &p.engineBrakeTorque);
    r.num("powertrain.engine_brake_per_rpm", &p.engineBrakePerRpm);
    r.list("powertrain.gear_ratios", &p.gearRatios);
    r.num("powertrain.final_drive", &p.finalDrive);
    r.num("powertrain.reverse_ratio", &p.reverseRatio);
    r.num("powertrain.driveline_efficiency", &p.drivelineEfficiency);
    r.num("powertrain.shift_time_s", &p.shiftTime);
    r.num("powertrain.clutch_max_torque", &p.clutchMaxTorque);
    r.num("powertrain.gearbox_inertia", &p.gearboxInertia);
    r.num("powertrain.diff_preload", &p.diffPreload);
    r.num("powertrain.diff_power_lock", &p.diffPowerLock);
    r.num("powertrain.diff_coast_lock", &p.diffCoastLock);
    r.num("powertrain.mguk_max_power_kw", &p.mgukMaxPower, 1000.0);
    r.num("powertrain.mguk_max_torque", &p.mgukMaxTorque);
    r.num("powertrain.mguk_taper_start_kph", &p.mgukTaperStartKph);
    r.num("powertrain.mguk_taper_end_kph", &p.mgukTaperEndKph);
    r.num("powertrain.battery_window_mj", &p.batteryWindow, 1.0e6);
    r.num("powertrain.harvest_per_lap_mj", &p.harvestPerLap, 1.0e6);
    r.num("powertrain.mguk_efficiency", &p.mgukEfficiency);
    r.num("powertrain.coast_harvest_kw", &p.coastHarvestPower, 1000.0);
    r.num("powertrain.fuel_kg", &p.fuelMass);
    r.num("powertrain.fuel_lhv_mj_per_kg", &p.fuelLhv, 1.0e6);
    r.num("powertrain.ice_thermal_efficiency", &p.iceThermalEfficiency);

    auto& b = c.brakes;
    r.num("brakes.max_torque_nm", &b.maxTorque);
    r.num("brakes.bias_front", &b.biasFront);
    r.num("brakes.disc_heat_capacity", &b.discHeatCapacity);
    r.num("brakes.cooling_base", &b.coolingBase);
    r.num("brakes.cooling_per_speed", &b.coolingPerSpeed);
    r.num("brakes.temp_optimal_low_c", &b.tempOptimalLow);
    r.num("brakes.temp_optimal_high_c", &b.tempOptimalHigh);
    r.num("brakes.cold_factor", &b.coldFactor);
    r.num("brakes.fade_factor", &b.fadeFactor);

    auto& s = c.steering;
    r.num("steering.ratio", &s.ratio);
    r.deg("steering.lock_deg", &s.lock);
    r.num("steering.ackermann", &s.ackermann);
    r.mm("steering.mechanical_trail_mm", &s.mechanicalTrail);
    r.mm("steering.scrub_radius_mm", &s.scrubRadius);
    r.mm("steering.weight_centering_mm", &s.weightCentering);
    r.num("steering.power_assist", &s.powerAssist);
    r.positive("steering.ratio", s.ratio);

    if (!r.ok()) return false;

    // Cross-field validation.
    if (p.iceRpm.size() != p.icePowerW.size() || p.iceRpm.size() < 2) {
        if (error) *error = ini.source() + ": ice_rpm and ice_power_kw must have the same length (>= 2)";
        return false;
    }
    for (size_t i = 1; i < p.iceRpm.size(); ++i) {
        if (p.iceRpm[i] <= p.iceRpm[i - 1]) {
            if (error) *error = ini.source() + ": ice_rpm must be strictly increasing";
            return false;
        }
    }
    if (ch.weightFront <= 0.2 || ch.weightFront >= 0.8) {
        if (error) *error = ini.source() + ": chassis.weight_front must be within (0.2, 0.8)";
        return false;
    }
    if (b.biasFront <= 0.0 || b.biasFront >= 1.0) {
        if (error) *error = ini.source() + ": brakes.bias_front must be within (0, 1)";
        return false;
    }

    // Axle positions follow from wheelbase and static weight distribution.
    c.front.x = ch.wheelbase * (1.0 - ch.weightFront);
    c.rear.x = -ch.wheelbase * ch.weightFront;

    if (warnings) {
        for (const auto& k : ini.unusedKeys()) {
            if (k.find("'car.name'") == std::string::npos) warnings->push_back("unknown key " + k);
        }
    }
    *out = c;
    return true;
}

double CarParams::icePowerAt(double rpm) const {
    const auto& x = powertrain.iceRpm;
    const auto& y = powertrain.icePowerW;
    if (rpm <= x.front()) return y.front() * clamp(rpm / x.front(), 0.0, 1.0);
    if (rpm >= x.back()) return y.back();
    for (size_t i = 1; i < x.size(); ++i) {
        if (rpm <= x[i]) {
            const double t = (rpm - x[i - 1]) / (x[i] - x[i - 1]);
            return lerp(y[i - 1], y[i], t);
        }
    }
    return y.back();
}

}  // namespace f1sim
