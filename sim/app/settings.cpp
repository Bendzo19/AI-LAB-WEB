#include "settings.hpp"

#include "f1sim/ini.hpp"

namespace app {

const char* const kAppIds[] = {"timing", "dashboard", "tyres", "energy", "inputs", "delta",
                               "gmeter", "telemetry", "map", "chassis", "session"};
const int kAppCount = static_cast<int>(sizeof(kAppIds) / sizeof(kAppIds[0]));

namespace {

void readAxis(const f1sim::IniFile& ini, const std::string& name, AxisBinding* b) {
    b->device = ini.getString("controls." + name + "_device", b->device);
    b->deviceName = ini.getString("controls." + name + "_device_name", b->deviceName);
    b->axis = static_cast<int>(ini.getDouble("controls." + name + "_axis", b->axis));
    b->rest = static_cast<int>(ini.getDouble("controls." + name + "_rest", b->rest));
    b->full = static_cast<int>(ini.getDouble("controls." + name + "_full", b->full));
}
void writeAxis(f1sim::IniFile& ini, const std::string& name, const AxisBinding& b) {
    ini.set("controls." + name + "_device", b.device);
    ini.set("controls." + name + "_device_name", b.deviceName);
    ini.set("controls." + name + "_axis", b.axis);
    ini.set("controls." + name + "_rest", b.rest);
    ini.set("controls." + name + "_full", b.full);
}
void readButton(const f1sim::IniFile& ini, const std::string& name, ButtonBinding* b) {
    b->device = ini.getString("controls." + name + "_device", b->device);
    b->deviceName = ini.getString("controls." + name + "_device_name", b->deviceName);
    b->button = static_cast<int>(ini.getDouble("controls." + name + "_button", b->button));
}
void writeButton(f1sim::IniFile& ini, const std::string& name, const ButtonBinding& b) {
    ini.set("controls." + name + "_device", b.device);
    ini.set("controls." + name + "_device_name", b.deviceName);
    ini.set("controls." + name + "_button", b.button);
}

}  // namespace

bool Settings::load(const std::string& path, std::string* error) {
    f1sim::IniFile ini;
    if (!ini.loadFile(path, error)) return false;
    carFile = ini.getString("content.car", carFile);
    trackFile = ini.getString("content.track", trackFile);
    carModelFile = ini.getString("content.car_model", carModelFile);
    windowWidth = static_cast<int>(ini.getDouble("graphics.width", windowWidth));
    windowHeight = static_cast<int>(ini.getDouble("graphics.height", windowHeight));
    fullscreen = ini.getBool("graphics.fullscreen", fullscreen);
    vsync = ini.getBool("graphics.vsync", vsync);
    msaa = static_cast<int>(ini.getDouble("graphics.msaa", msaa));
    fovDeg = ini.getDouble("graphics.fov_deg", fovDeg);
    camera = static_cast<int>(ini.getDouble("graphics.camera", camera));

    ffbEnabled = ini.getBool("ffb.enabled", ffbEnabled);
    ffb.gain = ini.getDouble("ffb.gain", ffb.gain);
    ffb.deviceMaxTorque = ini.getDouble("ffb.device_max_torque_nm", ffb.deviceMaxTorque);
    ffb.carTorqueScale = ini.getDouble("ffb.car_torque_scale", ffb.carTorqueScale);
    ffb.filterHz = ini.getDouble("ffb.filter_hz", ffb.filterHz);
    ffb.damping = ini.getDouble("ffb.damping", ffb.damping);
    ffb.minForce = ini.getDouble("ffb.min_force", ffb.minForce);
    ffb.softLockStiffness = ini.getDouble("ffb.soft_lock_nm_per_rad", ffb.softLockStiffness);
    ffb.invert = ini.getBool("ffb.invert", ffb.invert);
    ffbRateHz = static_cast<int>(ini.getDouble("ffb.rate_hz", ffbRateHz));

    wheelRotationDeg = ini.getDouble("controls.wheel_rotation_deg", wheelRotationDeg);
    wheelPreset = ini.getString("controls.wheel_preset", wheelPreset);
    brakeGamma = ini.getDouble("controls.brake_gamma", brakeGamma);
    pedalDeadzone = ini.getDouble("controls.pedal_deadzone", pedalDeadzone);
    keyboardSteerSpeed = ini.getDouble("controls.keyboard_steer_speed", keyboardSteerSpeed);
    readAxis(ini, "steer", &steer);
    readAxis(ini, "throttle", &throttle);
    readAxis(ini, "brake", &brake);
    readAxis(ini, "clutch", &clutch);
    readButton(ini, "shift_up", &shiftUp);
    readButton(ini, "shift_down", &shiftDown);
    readButton(ini, "aero", &aero);
    readButton(ini, "reset", &reset);
    readButton(ini, "ers_mode", &ersMode);

    for (int i = 0; i < kAppCount; ++i) {
        const auto v = ini.getString(std::string("apps.") + kAppIds[i]);
        if (v) apps[kAppIds[i]] = *v;
    }
    airTempC = ini.getDouble("session.air_temp_c", airTempC);
    trackTempC = ini.getDouble("session.track_temp_c", trackTempC);
    saveTelemetry = ini.getBool("session.save_telemetry", saveTelemetry);
    return true;
}

bool Settings::save(const std::string& path) const {
    f1sim::IniFile ini;
    ini.set("content.car", carFile);
    ini.set("content.track", trackFile);
    ini.set("content.car_model", carModelFile);
    ini.set("graphics.width", windowWidth);
    ini.set("graphics.height", windowHeight);
    ini.set("graphics.fullscreen", fullscreen ? "true" : "false");
    ini.set("graphics.vsync", vsync ? "true" : "false");
    ini.set("graphics.msaa", msaa);
    ini.set("graphics.fov_deg", fovDeg);
    ini.set("graphics.camera", camera);
    ini.set("ffb.enabled", ffbEnabled ? "true" : "false");
    ini.set("ffb.gain", ffb.gain);
    ini.set("ffb.device_max_torque_nm", ffb.deviceMaxTorque);
    ini.set("ffb.car_torque_scale", ffb.carTorqueScale);
    ini.set("ffb.filter_hz", ffb.filterHz);
    ini.set("ffb.damping", ffb.damping);
    ini.set("ffb.min_force", ffb.minForce);
    ini.set("ffb.soft_lock_nm_per_rad", ffb.softLockStiffness);
    ini.set("ffb.invert", ffb.invert ? "true" : "false");
    ini.set("ffb.rate_hz", ffbRateHz);
    ini.set("controls.wheel_rotation_deg", wheelRotationDeg);
    ini.set("controls.wheel_preset", wheelPreset);
    ini.set("controls.brake_gamma", brakeGamma);
    ini.set("controls.pedal_deadzone", pedalDeadzone);
    ini.set("controls.keyboard_steer_speed", keyboardSteerSpeed);
    writeAxis(ini, "steer", steer);
    writeAxis(ini, "throttle", throttle);
    writeAxis(ini, "brake", brake);
    writeAxis(ini, "clutch", clutch);
    writeButton(ini, "shift_up", shiftUp);
    writeButton(ini, "shift_down", shiftDown);
    writeButton(ini, "aero", aero);
    writeButton(ini, "reset", reset);
    writeButton(ini, "ers_mode", ersMode);
    for (const auto& [id, v] : apps) ini.set("apps." + id, v);
    ini.set("session.air_temp_c", airTempC);
    ini.set("session.track_temp_c", trackTempC);
    ini.set("session.save_telemetry", saveTelemetry ? "true" : "false");
    return ini.saveFile(path,
                        "f1sim settings. Edit while the game is closed, or use the in-game setup (F2).\n"
                        "ffb.*: filled from a preset when a known wheel is bound (controls.wheel_preset); edit freely.\n"
                        "ffb.device_max_torque_nm: peak torque of your wheel base (e.g. G29 2.2, CSL DD 8, DD Pro 8, DD1 20).\n"
                        "controls.wheel_rotation_deg must match the rotation set in your wheel driver.");
}

}  // namespace app
