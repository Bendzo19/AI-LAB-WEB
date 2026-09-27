// Tiny self-contained test harness (no external dependencies).
#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

#include "f1sim/car_params.hpp"

namespace th {

struct Case { const char* name; std::function<void()> fn; };
inline std::vector<Case>& registry() { static std::vector<Case> r; return r; }
inline int& failures() { static int f = 0; return f; }
struct Registrar { Registrar(const char* n, std::function<void()> f) { registry().push_back({n, std::move(f)}); } };

inline void fail(const char* file, int line, const std::string& msg) {
    std::printf("    FAIL %s:%d: %s\n", file, line, msg.c_str());
    ++failures();
}

inline f1sim::CarParams loadCar() {
    f1sim::CarParams car;
    std::string err;
    std::vector<std::string> warnings;
    if (!f1sim::CarParams::load(std::string(F1SIM_DATA_DIR) + "/cars/f1_2026_generic.ini", &car, &err, &warnings)) {
        std::printf("cannot load car: %s\n", err.c_str());
        std::abort();
    }
    for (const auto& w : warnings) std::printf("    car warning: %s\n", w.c_str());
    return car;
}

inline std::string dataPath(const std::string& rel) { return std::string(F1SIM_DATA_DIR) + "/" + rel; }

}  // namespace th

#define TEST_CASE(name)                                               \
    static void name();                                               \
    static th::Registrar name##_registrar(#name, name);               \
    static void name()

#define CHECK(cond)                                                   \
    do { if (!(cond)) th::fail(__FILE__, __LINE__, #cond); } while (0)

#define CHECK_RANGE(value, lo, hi)                                    \
    do {                                                              \
        const double v_ = (value);                                    \
        if (!(v_ >= (lo) && v_ <= (hi))) {                            \
            char b_[256];                                             \
            std::snprintf(b_, sizeof(b_), "%s = %g not in [%g, %g]", #value, v_, (double)(lo), (double)(hi)); \
            th::fail(__FILE__, __LINE__, b_);                         \
        }                                                             \
    } while (0)

#define CHECK_NEAR(a, b, tol) CHECK_RANGE((a), (b) - (tol), (b) + (tol))
