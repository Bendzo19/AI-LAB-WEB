// App-layer logic that needs no window or devices.
#include <cstdio>
#include <string>

#include "harness.hpp"
#include "settings.hpp"
#include "wheel_presets.hpp"

using namespace app;

TEST_CASE(wheel_presets_match_real_device_names) {
    struct Case { const char* name; const char* label; };
    const Case cases[] = {
        {"Logitech G29 Driving Force Racing Wheel", "Logitech G29"},
        {"Logitech G923 Racing Wheel for PlayStation and PC", "Logitech G923"},
        {"Logitech G920 Driving Force Racing Wheel USB", "Logitech G920"},
        {"Logitech G PRO Racing Wheel", "Logitech G PRO"},
        {"Thrustmaster T300RS Racing wheel", "Thrustmaster T300"},
        {"Thrustmaster TX Racing Wheel", "Thrustmaster TX"},
        {"Thrustmaster T150 Racing Wheel", "Thrustmaster T150"},
        {"FANATEC CSL DD", "Fanatec CSL DD"},
        {"Fanatec Podium Wheel Base DD1", "Fanatec Podium DD"},
        {"MOZA R5 Base", "MOZA R5"},
        {"MOZA R12 Base", "MOZA R12"},
        {"Simucube 2 Pro", "Simucube 2 Pro"},
    };
    for (const auto& c : cases) {
        const WheelPreset* p = findWheelPreset(c.name);
        CHECK(p != nullptr);
        if (p && std::string(p->label) != c.label) std::printf("    %s -> %s (expected %s)\n", c.name, p->label, c.label);
        CHECK(p && std::string(p->label) == c.label);
    }
    // Pads and unknown devices keep the generic settings.
    CHECK(findWheelPreset("Xbox Wireless Controller") == nullptr);
    CHECK(findWheelPreset("PS5 Controller") == nullptr);
    CHECK(findWheelPreset("Heusinkveld Sim Pedals Sprint") == nullptr);
}

TEST_CASE(wheel_preset_g29_values) {
    const WheelPreset* p = findWheelPreset("Logitech G29 Driving Force Racing Wheel");
    CHECK(p != nullptr);
    if (!p) return;
    Settings s;
    applyWheelPreset(*p, &s);
    CHECK_NEAR(s.ffb.deviceMaxTorque, 2.2, 1e-9);
    CHECK_NEAR(s.wheelRotationDeg, 900.0, 1e-9);
    CHECK(s.ffb.minForce > 0.0);  // gear-driven: dead-zone compensation on
    CHECK(s.wheelPreset == "Logitech G29");
}

TEST_CASE(settings_roundtrip_keeps_preset_and_content) {
    const std::string path = "f1sim_test_settings.ini";
    Settings a;
    a.carFile = "cars/f1_2026_generic.ini";
    a.trackFile = "tracks/test_circuit.trk";
    a.wheelPreset = "Logitech G29";
    a.ffb.deviceMaxTorque = 2.2;
    CHECK(a.save(path));
    Settings b;
    std::string err;
    CHECK(b.load(path, &err));
    std::remove(path.c_str());
    CHECK(b.carFile == a.carFile);
    CHECK(b.trackFile == a.trackFile);
    CHECK(b.wheelPreset == a.wheelPreset);
    CHECK_NEAR(b.ffb.deviceMaxTorque, 2.2, 1e-9);
}
