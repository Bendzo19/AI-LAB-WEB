#include "f1sim/ffb.hpp"
#include "f1sim/ini.hpp"
#include "f1sim/timing.hpp"
#include "harness.hpp"

using namespace f1sim;

TEST_CASE(ini_parses_and_reports_unknown_keys) {
    IniFile ini;
    std::string err;
    CHECK(ini.loadString("[a]\nx = 1.5 # c\ny = 1, 2,3\n[b]\nz = hello\ntypo = 3\n", &err));
    CHECK_NEAR(*ini.getDouble("a.x"), 1.5, 1e-12);
    CHECK(ini.getList("a.y")->size() == 3);
    CHECK(*ini.getString("b.z") == "hello");
    const auto unused = ini.unusedKeys();
    CHECK(unused.size() == 1);
    CHECK(!ini.loadString("[a]\nx = 1\nx = 2\n", &err));  // duplicate
}

TEST_CASE(car_file_rejects_missing_keys) {
    IniFile ini;
    std::string err;
    CHECK(ini.loadString("[chassis]\nmass_kg = 700\n", &err));
    CarParams c;
    CHECK(!CarParams::fromIni(ini, &c, &err, nullptr));
    CHECK(err.find("missing") != std::string::npos);
}

TEST_CASE(lap_timer_counts_laps_and_validity) {
    LapTimer t(1000.0);
    double time = 0.0;
    auto drive = [&](double from, double to, bool off) {
        for (double s = from; s < to; s += 1.0) {
            time += 0.01;
            t.update(time, std::fmod(s, 1000.0), off);
        }
    };
    drive(900.0, 1000.0, false);   // out lap end
    drive(1000.0, 2000.0, false);  // lap 1 (10 s)
    drive(2000.0, 2500.0, false);
    CHECK(t.lapCount() == 1);
    CHECK_NEAR(t.lastLap(), 10.0, 0.05);
    CHECK(t.lastLapValid());
    drive(2500.0, 2600.0, true);   // track limits
    drive(2600.0, 3000.0, false);
    drive(3000.0, 3001.0, false);
    CHECK(t.lapCount() == 2);
    CHECK(!t.lastLapValid());
    CHECK_NEAR(t.bestLap(), 10.0, 0.05);  // invalid lap cannot be best
}

TEST_CASE(ffb_scaling_clipping_and_softlock) {
    FfbProcessor p;
    FfbSettings s;
    s.filterHz = 0.0;
    s.damping = 0.0;
    s.deviceMaxTorque = 10.0;
    s.carTorqueScale = 1.0;
    auto o = p.process(5.0, 0.0, 0.0, 3.0, 0.001, s);
    CHECK_NEAR(o.command, 0.5, 1e-9);
    CHECK(!o.clipping);
    o = p.process(25.0, 0.0, 0.0, 3.0, 0.001, s);
    CHECK_NEAR(o.command, 1.0, 1e-9);
    CHECK(o.clipping);
    // Beyond the steering lock the soft lock pushes back towards centre.
    o = p.process(0.0, 3.3, 0.0, 3.0, 0.001, s);
    CHECK(o.command < 0.0);
    s.invert = true;
    o = p.process(5.0, 0.0, 0.0, 3.0, 0.001, s);
    CHECK_NEAR(o.command, -0.5, 1e-9);
}
