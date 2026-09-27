// Small, dependency-free vector/quaternion math used by the physics core.
// Convention (ISO 8855 style): x forward, y left, z up. Right-handed.
#pragma once

#include <algorithm>
#include <cmath>

namespace f1sim {

constexpr double kPi = 3.14159265358979323846;
constexpr double kGravity = 9.80665;

inline double deg2rad(double d) { return d * kPi / 180.0; }
inline double rad2deg(double r) { return r * 180.0 / kPi; }
inline double clamp(double v, double lo, double hi) { return std::min(std::max(v, lo), hi); }
inline double lerp(double a, double b, double t) { return a + (b - a) * t; }
inline double sign(double v) { return (v > 0.0) - (v < 0.0); }
inline double sq(double v) { return v * v; }
inline double smoothstep(double e0, double e1, double x) {
    const double t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}
// Wraps an angle to (-pi, pi].
inline double wrapAngle(double a) {
    a = std::fmod(a + kPi, 2.0 * kPi);
    if (a < 0.0) a += 2.0 * kPi;
    return a - kPi;
}

struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;
    constexpr Vec3() = default;
    constexpr Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(double s) const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3& operator*=(double s) { x *= s; y *= s; z *= s; return *this; }
};
inline Vec3 operator*(double s, const Vec3& v) { return v * s; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double length(const Vec3& v) { return std::sqrt(dot(v, v)); }
inline Vec3 normalize(const Vec3& v) {
    const double l = length(v);
    return l > 1e-12 ? v / l : Vec3{0.0, 0.0, 0.0};
}

struct Quat {
    double w = 1.0, x = 0.0, y = 0.0, z = 0.0;
    static Quat fromAxisAngle(const Vec3& axis, double angle) {
        const Vec3 a = normalize(axis);
        const double s = std::sin(angle * 0.5);
        return {std::cos(angle * 0.5), a.x * s, a.y * s, a.z * s};
    }
    // Yaw about z, then pitch about y, then roll about x (intrinsic z-y-x).
    static Quat fromEuler(double roll, double pitch, double yaw) {
        return fromAxisAngle({0, 0, 1}, yaw) * fromAxisAngle({0, 1, 0}, pitch) *
               fromAxisAngle({1, 0, 0}, roll);
    }
    Quat operator*(const Quat& q) const {
        return {w * q.w - x * q.x - y * q.y - z * q.z, w * q.x + x * q.w + y * q.z - z * q.y,
                w * q.y - x * q.z + y * q.w + z * q.x, w * q.z + x * q.y - y * q.x + z * q.w};
    }
    Quat conjugate() const { return {w, -x, -y, -z}; }
    Quat normalized() const {
        const double n = std::sqrt(w * w + x * x + y * y + z * z);
        return {w / n, x / n, y / n, z / n};
    }
    // Rotates a body-frame vector into the world frame.
    Vec3 rotate(const Vec3& v) const {
        const Vec3 u{x, y, z};
        const Vec3 t = 2.0 * cross(u, v);
        return v + w * t + cross(u, t);
    }
    // Rotates a world-frame vector into the body frame.
    Vec3 inverseRotate(const Vec3& v) const { return conjugate().rotate(v); }
    // Integrates a body-frame angular velocity over dt.
    Quat integrated(const Vec3& omegaBody, double dt) const {
        const double ang = length(omegaBody) * dt;
        if (ang < 1e-12) return *this;
        return ((*this) * fromAxisAngle(omegaBody, ang)).normalized();
    }
    double yaw() const { return std::atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z)); }
    double pitch() const { return std::asin(clamp(2.0 * (w * y - z * x), -1.0, 1.0)); }
    double roll() const { return std::atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)); }
};

// Exact solution of dx/dt = rate * (target - x) over dt; unconditionally stable.
inline double relaxTowards(double x, double target, double rate, double dt) {
    return target + (x - target) * std::exp(-rate * dt);
}

// One-pole low-pass filter with cutoff in Hz.
struct LowPass {
    double value = 0.0;
    double update(double input, double cutoffHz, double dt) {
        if (cutoffHz <= 0.0) { value = input; return value; }
        value = relaxTowards(value, input, 2.0 * kPi * cutoffHz, dt);
        return value;
    }
};

}  // namespace f1sim
