// 3D scene renderer (OpenGL 3.3 core): sky, terrain, track surface with
// kerbs/lines, barriers, braking boards, scenery, and the car - either the
// built-in primitive car or external glTF models (see data/models/).
#pragma once

#include <string>
#include <vector>

#include "f1sim/car_params.hpp"
#include "f1sim/lapsim.hpp"
#include "f1sim/track.hpp"
#include "mathx.hpp"
#include "model.hpp"
#include "snapshot.hpp"

namespace app {

enum class CameraMode { Cockpit = 0, Helmet, TCam, Nose, Side, Rear, ChaseNear, ChaseFar, TV, Count };
const char* cameraName(CameraMode m);

class Renderer {
public:
    bool init(const f1sim::Track& track, const f1sim::CarParams& car, const f1sim::RacingLine& line,
              const std::string& dataDir, const std::string& modelConfig, std::string* error);
    void render(const Snapshot& s, int width, int height, CameraMode cam, float fovDeg, float dt);
    void shutdown();
    const std::string& modelStatus() const { return modelStatus_; }

private:
    bool buildShaders(std::string* error);
    void buildTrack(const f1sim::Track& track, const f1sim::RacingLine& line);
    void buildCar(const f1sim::CarParams& car, const std::string& dataDir, const std::string& modelConfig);
    void drawMesh(const Mesh& m, const Mat4& model, const float tint[4], bool procedural = false);
    void drawCar(const Snapshot& s, CameraMode cam);

    GLuint lit_ = 0, sky_ = 0, skyVao_ = 0;
    struct {
        GLint viewProj, model, tint, useTex, tex, sunDir, camPos, fogColor, fogDensity, procedural, spec;
    } u_{};
    struct {
        GLint camRight, camUp, camFwd, tanHalf, aspect, sunDir;
    } us_{};

    Mesh track_, scenery_;
    // Built-in car
    Mesh body_, flap_, wheelFront_, wheelRear_, steeringWheel_, unitBox_;
    // External models
    Model bodyModel_, wheelModelFront_, wheelModelRear_;
    bool bodyIncludesWheels_ = false, mirrorRightWheels_ = true;
    std::string modelStatus_ = "built-in primitive car";

    f1sim::CarParams car_;
    Mat4 viewProj_;
    Vec3f camPos_;
    Vec3f chaseEye_;                     // chase cams: smoothed heading direction
    bool chaseInit_ = false;
    Vec3f headOffset_{0, 0, 0};          // helmet cam: smoothed g-force head motion
    std::vector<Vec3f> tvCams_;          // trackside camera positions
    int tvCurrent_ = -1;
    Vec3f sunDir_ = normalizef({0.35f, -0.45f, 0.82f});
};

}  // namespace app
