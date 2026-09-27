#include "f1sim/session.hpp"

namespace f1sim {

Session::Session(const CarParams& car, Track track) : car_(car), track_(std::move(track)), timer_(track_.length()) {
    vehicle_ = std::make_unique<Vehicle>(car_, &track_);
    if (!track_.isPad()) {
        // Robot-driver line: keeps a safety margin from the white lines, and
        // targets use a small grip margin because the point-mass QSS model is
        // optimistic in slow corners (load transfer, camber, diff).
        LapSimOptions opt;
        opt.edgeMargin = 1.2;
        opt.gripScale = 0.92;
        line_ = computeRacingLine(track_, opt);
        computeSpeedProfile(line_, car_, opt);
    }
    resetToStart();
}

void Session::resetToStart() {
    const double s = track_.isPad() ? 0.0 : track_.wrapS(-120.0);
    vehicle_->resetAt(s, 0.0, 0.0, 1);
    // Tyres come off blankets; brakes pre-warmed as on an out lap.
    vehicle_->setTyreTemperatures(70.0, 70.0);
    timer_.reset();
    logger_.beginLap();
    carHint_ = -1;
    carS_ = s;
}

void Session::resetRolling(double speed, double distanceBeforeLine, double offset) {
    const double s = track_.isPad() ? 0.0 : track_.wrapS(-distanceBeforeLine);
    // Pick the highest gear that keeps the engine above ~8000 rpm.
    int gear = 1;
    const auto& pp = car_.powertrain;
    for (int g = 1; g <= car_.gearCount(); ++g) {
        const double rpm = speed / car_.rear.tyre.radius * pp.gearRatios[g - 1] * pp.finalDrive * 60.0 / (2.0 * kPi);
        if (rpm > 8000.0 && rpm < pp.revLimit - 300.0) gear = g;
    }
    vehicle_->resetAt(s, offset, speed, gear);
    vehicle_->setTyreTemperatures(90.0, 85.0);
    timer_.reset();
    logger_.beginLap();
    carHint_ = -1;
    carS_ = s;
}

void Session::recoverToTrack() {
    if (track_.isPad()) {
        vehicle_->resetAt(vehicle_->state().pos.x, 0.0, 0.0, 1);
        return;
    }
    vehicle_->resetAt(carS_, 0.0, 0.0, 1);
    carHint_ = -1;
}

LapTimer::Event Session::step(const DriverInputs& in, double ffbCommand) {
    vehicle_->step(kDt, in);
    time_ += kDt;
    const auto& st = vehicle_->state();
    const GroundHit g = track_.query(st.pos, carHint_);
    if (g.segment >= 0) {
        carHint_ = g.segment;
        carS_ = g.s;
    }
    bool allOff = true;
    for (const auto& w : st.wheels) allOff = allOff && !w.onTrack;
    const auto ev = timer_.update(time_, carS_, allOff);
    if (ev != LapTimer::Event::None) {
        vehicle_->onLapLine();
        if (ev == LapTimer::Event::LapCompleted) lastLap_ = logger_;
        logger_.beginLap();
    }
    if (timer_.timing()) logger_.record(st, timer_.currentLapTime(time_), carS_, ffbCommand, kDt);
    return ev;
}

}  // namespace f1sim
