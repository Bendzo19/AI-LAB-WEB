#include "f1sim/timing.hpp"

#include <cmath>
#include <limits>

namespace f1sim {

LapTimer::LapTimer(double trackLength) : length_(trackLength), delta_(std::numeric_limits<double>::quiet_NaN()) {
    reset();
}

void LapTimer::reset() {
    timing_ = false;
    valid_ = true;
    lapCount_ = 0;
    sector_ = 0;
    prevS_ = -1.0;
    progress_ = 0.0;
    offTime_ = 0.0;
    curSectors_ = {};
    delta_ = std::numeric_limits<double>::quiet_NaN();
    trace_.assign(static_cast<size_t>(length_ / kBin) + 2, -1.0);
}

LapTimer::Event LapTimer::update(double time, double s, bool allWheelsOff) {
    Event ev = Event::None;
    const double dtime = prevS_ < 0.0 ? 0.0 : time - prevTime_;
    prevTime_ = time;
    if (prevS_ < 0.0) {
        prevS_ = s;
        return ev;
    }
    double ds = s - prevS_;
    if (ds < -0.5 * length_) ds += length_;
    if (ds > 0.5 * length_) ds -= length_;
    progress_ += ds;
    const bool crossed = ds > 0.0 && s < prevS_ && (prevS_ - s) > 0.5 * length_;
    prevS_ = s;

    // Track limits: all four wheels beyond the white line for > 50 ms.
    offTime_ = allWheelsOff ? offTime_ + dtime : 0.0;
    if (timing_ && offTime_ > 0.05) valid_ = false;

    if (crossed && (progress_ > 0.9 * length_ || !timing_)) {
        if (timing_) {
            const double lap = time - lapStart_;
            curSectors_[2] = time - sectorStart_;
            lastLap_ = lap;
            lastValid_ = valid_;
            lastSectors_ = curSectors_;
            lastWasBest_ = false;
            ++lapCount_;
            if (valid_ && (bestLap_ <= 0.0 || lap < bestLap_)) {
                bestLap_ = lap;
                bestSectors_ = curSectors_;
                bestTrace_ = trace_;
                lastWasBest_ = true;
            }
            ev = Event::LapCompleted;
        } else {
            ev = Event::LapStarted;
        }
        timing_ = true;
        valid_ = true;
        lapStart_ = time;
        sectorStart_ = time;
        sector_ = 0;
        progress_ = 0.0;
        curSectors_ = {};
        trace_.assign(static_cast<size_t>(length_ / kBin) + 2, -1.0);
    }
    if (!timing_) return ev;

    // Sectors at thirds of the lap.
    const int sec = std::min(2, static_cast<int>(s / (length_ / 3.0)));
    if (sec > sector_ && sec <= 2) {
        curSectors_[sector_] = time - sectorStart_;
        sectorStart_ = time;
        sector_ = sec;
    }
    const double t = time - lapStart_;
    const size_t bin = static_cast<size_t>(s / kBin);
    if (bin < trace_.size() && trace_[bin] < 0.0) trace_[bin] = t;
    if (!bestTrace_.empty() && bin + 1 < bestTrace_.size() && bestTrace_[bin] >= 0.0 && bestTrace_[bin + 1] >= 0.0) {
        const double u = (s - bin * kBin) / kBin;
        const double ref = bestTrace_[bin] + (bestTrace_[bin + 1] - bestTrace_[bin]) * u;
        delta_ = t - ref;
    }
    return ev;
}

}  // namespace f1sim
