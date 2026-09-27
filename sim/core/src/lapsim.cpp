#include "f1sim/lapsim.hpp"

#include <cmath>

namespace f1sim {

size_t RacingLine::nearest(const Vec3& p, long hint) const {
    const long n = static_cast<long>(points.size());
    if (n == 0) return 0;
    auto d2 = [&](long i) {
        const Vec3& q = points[static_cast<size_t>(((i % n) + n) % n)];
        return sq(q.x - p.x) + sq(q.y - p.y) + 0.25 * sq(q.z - p.z);
    };
    long best = 0;
    double bestD = 1e300;
    if (hint >= 0) {
        for (long k = -40; k <= 80; ++k) {
            const double d = d2(hint + k);
            if (d < bestD) { bestD = d; best = hint + k; }
        }
        if (bestD < 15.0 * 15.0) return static_cast<size_t>(((best % n) + n) % n);
    }
    for (long i = 0; i < n; ++i) {
        const double d = d2(i);
        if (d < bestD) { bestD = d; best = i; }
    }
    return static_cast<size_t>(best);
}

RacingLine computeRacingLine(const Track& track, const LapSimOptions& opt) {
    RacingLine line;
    const double step = 2.0;
    const int n = static_cast<int>(std::floor(track.length() / step));
    std::vector<TrackSample> smp(n);
    std::vector<double> lo(n), hi(n), d(n, 0.0);
    for (int i = 0; i < n; ++i) {
        smp[i] = track.sampleAt(i * track.length() / n);
        lo[i] = -smp[i].widthRight + opt.edgeMargin;
        hi[i] = smp[i].widthLeft - opt.edgeMargin;
    }
    auto pos = [&](int i) {
        const auto& s = smp[((i % n) + n) % n];
        const double dd = d[((i % n) + n) % n];
        return Vec3{s.pos.x - std::sin(s.heading) * dd, s.pos.y + std::cos(s.heading) * dd, s.pos.z};
    };
    // Minimum-curvature line: Gauss-Seidel on the sum of squared second
    // differences, p_i = (-p[i-2k] + 4p[i-k] + 4p[i+k] - p[i+2k]) / 6,
    // projected onto each sample's lateral line and clamped to the track.
    // Coarse-to-fine stencils converge on long corners quickly.
    const int levels[] = {16, 8, 4, 2, 1};
    const int perLevel = std::max(1, opt.smoothingIterations / 5);
    for (int k : levels) {
        for (int it = 0; it < perLevel; ++it) {
            for (int i = 0; i < n; ++i) {
                const Vec3 q = (pos(i - k) * 4.0 + pos(i + k) * 4.0 - pos(i - 2 * k) - pos(i + 2 * k)) / 6.0;
                const auto& s = smp[i];
                const double target = (q.x - s.pos.x) * -std::sin(s.heading) + (q.y - s.pos.y) * std::cos(s.heading);
                d[i] = clamp(d[i] + 0.8 * (target - d[i]), lo[i], hi[i]);
            }
        }
    }
    line.points.resize(n);
    line.trackS.resize(n);
    line.offset = d;
    for (int i = 0; i < n; ++i) {
        line.points[i] = pos(i);
        line.points[i].z = track.heightAt(smp[i].s, d[i]);
        line.trackS[i] = smp[i].s;
    }
    line.distance.assign(n, 0.0);
    for (int i = 1; i < n; ++i) line.distance[i] = line.distance[i - 1] + length(line.points[i] - line.points[i - 1]);
    line.length = line.distance.back() + length(line.points.front() - line.points.back());
    line.curvature.assign(n, 0.0);
    for (int i = 0; i < n; ++i) {
        const Vec3 a = line.points[(i + n - 2) % n], b = line.points[i], c = line.points[(i + 2) % n];
        const double h1 = std::atan2(b.y - a.y, b.x - a.x), h2 = std::atan2(c.y - b.y, c.x - b.x);
        const double ds = 0.5 * (std::hypot(b.x - a.x, b.y - a.y) + std::hypot(c.x - b.x, c.y - b.y));
        line.curvature[i] = wrapAngle(h2 - h1) / std::max(ds, 1e-3);
    }
    // Light smoothing: finite differences on a 2 m grid amplify residual noise.
    for (int pass = 0; pass < 2; ++pass) {
        std::vector<double> c(n);
        for (int i = 0; i < n; ++i) {
            c[i] = (line.curvature[(i + n - 2) % n] + 2.0 * line.curvature[(i + n - 1) % n] + 3.0 * line.curvature[i] +
                    2.0 * line.curvature[(i + 1) % n] + line.curvature[(i + 2) % n]) / 9.0;
        }
        line.curvature = c;
    }
    return line;
}

void computeSpeedProfile(RacingLine& line, const CarParams& car, const LapSimOptions& opt) {
    const int n = static_cast<int>(line.size());
    if (n == 0) return;
    const double m = car.totalMass();
    const double g = kGravity;
    const auto& A = car.aero;
    const auto& tf = car.front.tyre;
    const auto& tr = car.rear.tyre;
    const double rho = A.airDensity;
    const double muY0 = 0.5 * (tf.muY + tr.muY), muX0 = 0.5 * (tf.muX + tr.muX);
    const double fz0 = 0.5 * (tf.fz0 + tr.fz0);
    const double lsY = 0.5 * (tf.loadSensY + tr.loadSensY), lsX = 0.5 * (tf.loadSensX + tr.loadSensX);
    auto mu = [&](double mu0, double ls, double totalLoad) {
        const double dfz = (totalLoad / 4.0 - fz0) / fz0;
        return mu0 * clamp(1.0 + ls * dfz, 0.5, 1.4) * opt.gripScale;
    };
    const double vTop = 110.0;

    // 1) Cornering limit at each point.
    std::vector<double> vLat(n);
    for (int i = 0; i < n; ++i) {
        const double k = std::fabs(line.curvature[i]);
        double v = vTop;
        for (int it = 0; it < 30; ++it) {
            const double load = m * g + 0.5 * rho * A.claCorner * v * v;
            const double lat = mu(muY0, lsY, load) * load / m;
            const double vNew = k > 1e-6 ? std::sqrt(lat / k) : vTop;
            v = std::min(vTop, 0.5 * (v + vNew));
        }
        vLat[i] = v;
    }
    auto latUsage = [&](int i, double v) {
        const double load = m * g + 0.5 * rho * A.claCorner * v * v;
        const double latMax = mu(muY0, lsY, load) * load / m;
        const double lat = v * v * std::fabs(line.curvature[i]);
        return clamp(lat / latMax, 0.0, 1.0);
    };
    auto seg = [&](int i) { return length(line.points[(i + 1) % n] - line.points[i]); };

    const auto& pp = car.powertrain;
    double iceMax = 0.0;
    for (double p : pp.icePowerW) iceMax = std::max(iceMax, p);

    // 2) Forward (traction/power) and backward (braking) passes, twice around
    //    the lap so the start point is consistent.
    std::vector<double> v(vLat);
    int start = 0;
    for (int i = 0; i < n; ++i) if (vLat[i] < vLat[start]) start = i;
    for (int pass = 0; pass < 2; ++pass) {
        for (int k = 0; k < n; ++k) {
            const int i = (start + k) % n, j = (i + 1) % n;
            const double vi = v[i];
            const bool straight = std::fabs(line.curvature[i]) < 1.0 / 800.0;
            const double cla = straight ? A.claStraight : A.claCorner;
            const double cda = straight ? A.cdaStraight : A.cdaCorner;
            const double balRear = 1.0 - (straight ? A.balanceFrontStraight : A.balanceFrontCorner);
            const double q = 0.5 * rho * vi * vi;
            const double kph = vi * 3.6;
            const double taper = clamp((pp.mgukTaperEndKph - kph) / (pp.mgukTaperEndKph - pp.mgukTaperStartKph), 0.0, 1.0);
            const double power = (iceMax + pp.mgukMaxPower * taper) * pp.drivelineEfficiency;
            const double rearLoad = m * g * (1.0 - car.chassis.weightFront) + q * cla * balRear;
            const double traction = mu(muX0, lsX, m * g + q * cla) * rearLoad / m;
            const double ellipse = std::sqrt(std::max(0.0, 1.0 - sq(latUsage(i, vi))));
            const double a = std::min(power / (m * std::max(vi, 1.0)), traction) * ellipse - q * cda / m;
            const double vNext = std::sqrt(std::max(0.0, vi * vi + 2.0 * a * seg(i)));
            v[j] = std::min(v[j], std::max(vNext, 1.0));
        }
        for (int k = 0; k < n; ++k) {
            const int j = ((start - k) % n + n) % n, i = (j - 1 + n) % n;
            const double vj = v[j];
            const double q = 0.5 * rho * vj * vj;
            const double load = m * g + q * A.claCorner;
            const double ellipse = std::sqrt(std::max(0.0, 1.0 - sq(latUsage(j, vj))));
            const double a = mu(muX0, lsX, load) * load / m * ellipse + q * A.cdaCorner / m;
            const double vPrev = std::sqrt(vj * vj + 2.0 * a * seg(i));
            v[i] = std::min(v[i], vPrev);
        }
    }
    line.speed = v;
    double t = 0.0;
    for (int i = 0; i < n; ++i) t += seg(i) / std::max(0.5 * (v[i] + v[(i + 1) % n]), 0.5);
    line.lapTime = t;
}

}  // namespace f1sim
