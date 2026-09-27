// Float vector / 4x4 matrix helpers for rendering (column-major, OpenGL).
#pragma once

#include <cmath>

#include "f1sim/math.hpp"

namespace app {

struct Vec3f {
    float x = 0, y = 0, z = 0;
    Vec3f() = default;
    Vec3f(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
    explicit Vec3f(const f1sim::Vec3& v) : x(float(v.x)), y(float(v.y)), z(float(v.z)) {}
    Vec3f operator+(const Vec3f& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3f operator-(const Vec3f& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3f operator*(float s) const { return {x * s, y * s, z * s}; }
};
inline float dotf(const Vec3f& a, const Vec3f& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3f crossf(const Vec3f& a, const Vec3f& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline Vec3f normalizef(const Vec3f& v) {
    const float l = std::sqrt(dotf(v, v));
    return l > 1e-12f ? v * (1.0f / l) : Vec3f{0, 0, 1};
}

struct Mat4 {
    float m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    static Mat4 identity() { return {}; }
    float& at(int row, int col) { return m[col * 4 + row]; }
    float at(int row, int col) const { return m[col * 4 + row]; }
    Mat4 operator*(const Mat4& o) const {
        Mat4 r;
        for (int c = 0; c < 4; ++c)
            for (int rr = 0; rr < 4; ++rr) {
                float s = 0;
                for (int k = 0; k < 4; ++k) s += at(rr, k) * o.at(k, c);
                r.at(rr, c) = s;
            }
        return r;
    }
    Vec3f transformPoint(const Vec3f& p) const {
        return {at(0, 0) * p.x + at(0, 1) * p.y + at(0, 2) * p.z + at(0, 3),
                at(1, 0) * p.x + at(1, 1) * p.y + at(1, 2) * p.z + at(1, 3),
                at(2, 0) * p.x + at(2, 1) * p.y + at(2, 2) * p.z + at(2, 3)};
    }
    Vec3f transformDir(const Vec3f& p) const {
        return {at(0, 0) * p.x + at(0, 1) * p.y + at(0, 2) * p.z, at(1, 0) * p.x + at(1, 1) * p.y + at(1, 2) * p.z,
                at(2, 0) * p.x + at(2, 1) * p.y + at(2, 2) * p.z};
    }
    static Mat4 translate(const Vec3f& t) {
        Mat4 r;
        r.at(0, 3) = t.x;
        r.at(1, 3) = t.y;
        r.at(2, 3) = t.z;
        return r;
    }
    static Mat4 scale(const Vec3f& s) {
        Mat4 r;
        r.at(0, 0) = s.x;
        r.at(1, 1) = s.y;
        r.at(2, 2) = s.z;
        return r;
    }
    static Mat4 rotateAxis(const Vec3f& axis, float angle) {
        const Vec3f a = normalizef(axis);
        const float c = std::cos(angle), s = std::sin(angle), t = 1 - c;
        Mat4 r;
        r.at(0, 0) = t * a.x * a.x + c;       r.at(0, 1) = t * a.x * a.y - s * a.z; r.at(0, 2) = t * a.x * a.z + s * a.y;
        r.at(1, 0) = t * a.x * a.y + s * a.z; r.at(1, 1) = t * a.y * a.y + c;       r.at(1, 2) = t * a.y * a.z - s * a.x;
        r.at(2, 0) = t * a.x * a.z - s * a.y; r.at(2, 1) = t * a.y * a.z + s * a.x; r.at(2, 2) = t * a.z * a.z + c;
        return r;
    }
    static Mat4 fromQuat(const f1sim::Quat& q) {
        Mat4 r;
        const f1sim::Vec3 x = q.rotate({1, 0, 0}), y = q.rotate({0, 1, 0}), z = q.rotate({0, 0, 1});
        r.at(0, 0) = float(x.x); r.at(1, 0) = float(x.y); r.at(2, 0) = float(x.z);
        r.at(0, 1) = float(y.x); r.at(1, 1) = float(y.y); r.at(2, 1) = float(y.z);
        r.at(0, 2) = float(z.x); r.at(1, 2) = float(z.y); r.at(2, 2) = float(z.z);
        return r;
    }
    static Mat4 perspective(float fovY, float aspect, float zn, float zf) {
        Mat4 r;
        const float f = 1.0f / std::tan(fovY * 0.5f);
        r.at(0, 0) = f / aspect;
        r.at(1, 1) = f;
        r.at(2, 2) = (zf + zn) / (zn - zf);
        r.at(2, 3) = 2 * zf * zn / (zn - zf);
        r.at(3, 2) = -1;
        r.at(3, 3) = 0;
        return r;
    }
    static Mat4 lookAt(const Vec3f& eye, const Vec3f& target, const Vec3f& up) {
        const Vec3f f = normalizef(target - eye);
        const Vec3f s = normalizef(crossf(f, up));
        const Vec3f u = crossf(s, f);
        Mat4 r;
        r.at(0, 0) = s.x; r.at(0, 1) = s.y; r.at(0, 2) = s.z; r.at(0, 3) = -dotf(s, eye);
        r.at(1, 0) = u.x; r.at(1, 1) = u.y; r.at(1, 2) = u.z; r.at(1, 3) = -dotf(u, eye);
        r.at(2, 0) = -f.x; r.at(2, 1) = -f.y; r.at(2, 2) = -f.z; r.at(2, 3) = dotf(f, eye);
        return r;
    }
    static Mat4 ortho(float l, float r_, float b, float t, float n, float f) {
        Mat4 r;
        r.at(0, 0) = 2 / (r_ - l);
        r.at(1, 1) = 2 / (t - b);
        r.at(2, 2) = -2 / (f - n);
        r.at(0, 3) = -(r_ + l) / (r_ - l);
        r.at(1, 3) = -(t + b) / (t - b);
        r.at(2, 3) = -(f + n) / (f - n);
        return r;
    }
    Mat4 inverseRigid() const;  // for rotation+translation matrices
};

inline Mat4 Mat4::inverseRigid() const {
    Mat4 r;
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) r.at(i, j) = at(j, i);
    const Vec3f t{at(0, 3), at(1, 3), at(2, 3)};
    r.at(0, 3) = -(r.at(0, 0) * t.x + r.at(0, 1) * t.y + r.at(0, 2) * t.z);
    r.at(1, 3) = -(r.at(1, 0) * t.x + r.at(1, 1) * t.y + r.at(1, 2) * t.z);
    r.at(2, 3) = -(r.at(2, 0) * t.x + r.at(2, 1) * t.y + r.at(2, 2) * t.z);
    return r;
}

}  // namespace app
