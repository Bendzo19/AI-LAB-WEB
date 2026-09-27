#include <cstdio>
#include <fstream>

#include "f1sim/track.hpp"
#include "harness.hpp"

using namespace f1sim;

TEST_CASE(track_test_circuit_loads_and_closes) {
    Track t;
    std::string err;
    CHECK(Track::load(th::dataPath("tracks/test_circuit.trk"), &t, &err));
    if (!err.empty()) std::printf("    %s\n", err.c_str());
    CHECK_RANGE(t.length(), 2300.0, 2800.0);
    const auto& s = t.samples();
    CHECK(s.size() > 2000);
    // Closed loop: last sample is ~1 m from the first.
    CHECK(length(s.back().pos - s.front().pos) < 2.0);
    // The start line sits on the main straight (heading ~ east).
    CHECK(std::fabs(wrapAngle(s.front().heading)) < 0.05);
}

TEST_CASE(track_query_roundtrip) {
    Track t;
    std::string err;
    CHECK(Track::load(th::dataPath("tracks/test_circuit.trk"), &t, &err));
    for (double s = 0.0; s < t.length(); s += 37.0) {
        for (double d : {-5.0, 0.0, 4.0}) {
            const Vec3 p = t.positionAt(s, d);
            const GroundHit h = t.query(p + Vec3{0, 0, 0.3});
            CHECK(h.segment >= 0);
            CHECK(std::fabs(t.deltaS(s, h.s)) < 0.6);
            CHECK(std::fabs(h.d - d) < 0.3);
            CHECK(std::fabs(h.height - p.z) < 0.02);
            CHECK(h.normal.z > 0.99);
            CHECK(h.onTrack);
        }
    }
}

TEST_CASE(track_surfaces_by_lateral_offset) {
    Track t;
    std::string err;
    CHECK(Track::load(th::dataPath("tracks/test_circuit.trk"), &t, &err));
    const auto s0 = t.sampleAt(100.0);
    Surface surf;
    t.heightAt(100.0, 0.0, &surf);
    CHECK(surf == Surface::Asphalt);
    t.heightAt(100.0, s0.widthLeft + 5.0, &surf);
    CHECK(surf == Surface::Grass);
    const GroundHit off = t.query(t.positionAt(100.0, s0.widthLeft + 5.0));
    CHECK(!off.onTrack);
    CHECK(off.grip < 0.7);
}

TEST_CASE(track_tum_csv_import) {
    // Square-ish loop in the TUM racetrack-database column order.
    const std::string path = "f1sim_test_track.csv";
    {
        std::ofstream f(path);
        f << "# x_m,y_m,w_tr_right_m,w_tr_left_m\n";
        for (int i = 0; i < 72; ++i) {
            const double a = i * 2.0 * kPi / 72.0;
            f << 300.0 * std::cos(a) << "," << 200.0 * std::sin(a) << ",6.0,7.0\n";
        }
    }
    Track t;
    std::string err;
    CHECK(Track::load(path, &t, &err));
    std::remove(path.c_str());
    CHECK_RANGE(t.length(), 1500.0, 1700.0);
    CHECK_NEAR(t.samples()[10].widthLeft, 7.0, 1e-6);
    CHECK_NEAR(t.samples()[10].widthRight, 6.0, 1e-6);
}

TEST_CASE(track_rejects_bad_files) {
    const std::string path = "f1sim_bad.trk";
    {
        std::ofstream f(path);
        f << "straight_free 100\narc 20 -90\nstraight_free 100\narc 20 -90\n";  // only 180 deg
    }
    Track t;
    std::string err;
    CHECK(!Track::load(path, &t, &err));
    CHECK(err.find("360") != std::string::npos);
    std::remove(path.c_str());
}
