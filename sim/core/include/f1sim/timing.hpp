// Lap timing with sectors, track-limit validation and a live delta to the
// best lap (the same information a driver sees on a real steering wheel).
#pragma once

#include <array>
#include <vector>

namespace f1sim {

class LapTimer {
public:
    enum class Event { None, LapStarted, LapCompleted };

    explicit LapTimer(double trackLength = 1000.0);
    void reset();
    // `allWheelsOff`: all four contact patches beyond the white lines.
    Event update(double time, double s, bool allWheelsOff);

    bool timing() const { return timing_; }
    double currentLapTime(double now) const { return timing_ ? now - lapStart_ : 0.0; }
    double lastLap() const { return lastLap_; }
    double bestLap() const { return bestLap_; }
    bool lastLapValid() const { return lastValid_; }
    bool currentLapValid() const { return valid_; }
    int lapCount() const { return lapCount_; }
    int sector() const { return sector_; }
    const std::array<double, 3>& lastSectors() const { return lastSectors_; }
    const std::array<double, 3>& bestSectors() const { return bestSectors_; }
    const std::array<double, 3>& currentSectors() const { return curSectors_; }
    // Live delta to the best valid lap at the current position [s]; NaN if none.
    double delta() const { return delta_; }
    bool newBestOnLastLap() const { return lastWasBest_; }

private:
    double length_;
    bool timing_ = false;
    bool valid_ = true;
    double lapStart_ = 0.0;
    double lastLap_ = 0.0, bestLap_ = 0.0;
    bool lastValid_ = false, lastWasBest_ = false;
    int lapCount_ = 0;
    int sector_ = 0;
    double sectorStart_ = 0.0;
    std::array<double, 3> curSectors_{}, lastSectors_{}, bestSectors_{};
    double prevS_ = -1.0;
    double progress_ = 0.0;   // distance travelled since the line
    double offTime_ = 0.0;    // debounce for track limits
    double prevTime_ = 0.0;
    double delta_;
    std::vector<double> trace_, bestTrace_;
    static constexpr double kBin = 5.0;
};

}  // namespace f1sim
