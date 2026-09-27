#include "wheel_presets.hpp"

#include <algorithm>
#include <cctype>

namespace app {
namespace {

// First match wins, so specific names come before generic ones
// ("G PRO" before "G29", "CSL DD" before "Fanatec").
// Torque values are the manufacturers' published peak torques; the scale is
// chosen so a 5 g corner at ~30 Nm column torque stays below clipping.
const WheelPreset kPresets[] = {
    // Logitech gear-driven wheels: weak and notchy, so a small dead-zone
    // compensation and a lower filter hide the gear rattle.
    {"g pro", "Logitech G PRO", 11.0, 900, 0.30, 0.00, 120, 0.02, "G HUB: 900 deg, centering spring off, TRUEFORCE off"},
    {"pro racing wheel", "Logitech G PRO", 11.0, 900, 0.30, 0.00, 120, 0.02, "G HUB: 900 deg, centering spring off, TRUEFORCE off"},
    {"g923", "Logitech G923", 2.2, 900, 0.12, 0.07, 60, 0.00, "G HUB: 900 deg, centering spring off, TRUEFORCE off"},
    {"g920", "Logitech G920", 2.2, 900, 0.12, 0.07, 60, 0.00, "G HUB: 900 deg, centering spring off"},
    {"g29", "Logitech G29", 2.2, 900, 0.12, 0.07, 60, 0.00, "G HUB: 900 deg, centering spring off, sensitivity 50"},
    {"g27", "Logitech G27", 2.2, 900, 0.12, 0.08, 60, 0.00, "Logitech Profiler: 900 deg, centering spring off"},
    {"g25", "Logitech G25", 2.2, 900, 0.12, 0.08, 60, 0.00, "Logitech Profiler: 900 deg, centering spring off"},
    {"driving force", "Logitech Driving Force", 2.0, 900, 0.11, 0.08, 60, 0.00, "G HUB: 900 deg, centering spring off"},
    // Thrustmaster belt wheels.
    {"t818", "Thrustmaster T818", 10.0, 900, 0.30, 0.00, 120, 0.02, "Control Panel: 900 deg, FFB 100%"},
    {"t-gt", "Thrustmaster T-GT", 6.0, 900, 0.20, 0.02, 90, 0.01, "Control Panel: 900 deg, FFB 100%"},
    {"ts-pc", "Thrustmaster TS-PC", 6.0, 900, 0.20, 0.02, 90, 0.01, "Control Panel: 900 deg, FFB 100%"},
    {"ts-xw", "Thrustmaster TS-XW", 6.0, 900, 0.20, 0.02, 90, 0.01, "Control Panel: 900 deg, FFB 100%"},
    {"t300", "Thrustmaster T300", 3.9, 900, 0.15, 0.04, 80, 0.01, "Control Panel: 900 deg, FFB 100%, auto-center off"},
    {"t248", "Thrustmaster T248", 3.5, 900, 0.14, 0.05, 70, 0.01, "Control Panel: 900 deg, auto-center off"},
    {"tx", "Thrustmaster TX", 3.9, 900, 0.15, 0.04, 80, 0.01, "Control Panel: 900 deg, FFB 100%, auto-center off"},
    {"t150", "Thrustmaster T150", 2.0, 900, 0.11, 0.07, 60, 0.00, "Control Panel: 900 deg, auto-center off"},
    {"tmx", "Thrustmaster TMX", 2.0, 900, 0.11, 0.07, 60, 0.00, "Control Panel: 900 deg, auto-center off"},
    {"t128", "Thrustmaster T128", 1.8, 900, 0.10, 0.08, 60, 0.00, "Control Panel: 900 deg, auto-center off"},
    // Direct drive.
    {"csl dd", "Fanatec CSL DD", 8.0, 900, 0.25, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100, NDP 0, NFR 0, INT 0"},
    {"gt dd pro", "Fanatec GT DD Pro", 8.0, 900, 0.25, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100"},
    {"dd pro", "Fanatec DD Pro", 8.0, 900, 0.25, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100"},
    {"clubsport dd", "Fanatec ClubSport DD", 12.0, 900, 0.35, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100"},
    {"podium", "Fanatec Podium DD", 20.0, 900, 0.50, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100"},
    {"csl elite", "Fanatec CSL Elite", 6.0, 900, 0.20, 0.02, 100, 0.01, "Fanatec driver: SEN 900, FF 100"},
    {"csw", "Fanatec ClubSport Wheel", 8.0, 900, 0.25, 0.02, 100, 0.01, "Fanatec driver: SEN 900, FF 100"},
    {"fanatec", "Fanatec (generic)", 8.0, 900, 0.25, 0.00, 150, 0.02, "Fanatec driver: SEN AUT or 900, FF 100"},
    {"moza r21", "MOZA R21", 21.0, 900, 0.55, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%, natural damping low"},
    {"moza r16", "MOZA R16", 16.0, 900, 0.45, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%, natural damping low"},
    {"moza r12", "MOZA R12", 12.0, 900, 0.35, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%"},
    {"moza r9", "MOZA R9", 9.0, 900, 0.28, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%"},
    {"moza r5", "MOZA R5", 5.5, 900, 0.20, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%"},
    {"moza r3", "MOZA R3", 3.9, 900, 0.15, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%"},
    {"moza", "MOZA (generic)", 9.0, 900, 0.28, 0.00, 150, 0.02, "Pit House: 900 deg, game FFB 100%"},
    {"simucube 2 ultimate", "Simucube 2 Ultimate", 32.0, 900, 0.80, 0.00, 150, 0.02, "True Drive: 900 deg, strength to taste"},
    {"simucube 2 pro", "Simucube 2 Pro", 25.0, 900, 0.65, 0.00, 150, 0.02, "True Drive: 900 deg"},
    {"simucube 2 sport", "Simucube 2 Sport", 17.0, 900, 0.50, 0.00, 150, 0.02, "True Drive: 900 deg"},
    {"simucube", "Simucube", 17.0, 900, 0.50, 0.00, 150, 0.02, "True Drive: 900 deg"},
    {"asetek", "Asetek SimSports", 15.0, 900, 0.45, 0.00, 150, 0.02, "RaceHub: 900 deg"},
    {"simagic", "Simagic", 10.0, 900, 0.30, 0.00, 150, 0.02, "SimPro Manager: 900 deg"},
    {"cammus", "Cammus", 10.0, 900, 0.30, 0.00, 150, 0.02, "Driver: 900 deg"},
};

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

// Key must start a word ("t300" matches "T300RS", "tx" does not match "atx").
bool startsWord(const std::string& hay, const std::string& key) {
    for (size_t pos = hay.find(key); pos != std::string::npos; pos = hay.find(key, pos + 1)) {
        if (pos == 0 || !std::isalnum(static_cast<unsigned char>(hay[pos - 1]))) return true;
    }
    return false;
}

}  // namespace

const WheelPreset* findWheelPreset(const std::string& deviceName) {
    const std::string name = lower(deviceName);
    for (const auto& p : kPresets) {
        if (startsWord(name, p.match)) return &p;  // table is ordered specific -> generic
    }
    return nullptr;
}

void applyWheelPreset(const WheelPreset& p, Settings* s) {
    s->ffb.deviceMaxTorque = p.maxTorqueNm;
    s->ffb.carTorqueScale = p.carTorqueScale;
    s->ffb.minForce = p.minForce;
    s->ffb.filterHz = p.filterHz;
    s->ffb.damping = p.damping;
    s->wheelRotationDeg = p.rotationDeg;
    s->wheelPreset = p.label;
}

}  // namespace app
