// GPU meshes, a procedural mesh builder and a glTF 2.0 (.gltf/.glb) loader.
//
// External models (e.g. generated with an AI 3D tool or modelled in
// Blender) are loaded through `CarModel`, configured by
// data/models/car_model.ini. Without a model file the built-in primitive car
// is used, so the art can be swapped in at any time without code changes.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "gl.hpp"
#include "mathx.hpp"

namespace app {

struct Vertex {
    float px, py, pz;
    float nx, ny, nz;
    uint8_t r, g, b, a;
    float u, v;
};

struct Mesh {
    GLuint vao = 0, vbo = 0, ebo = 0;
    GLsizei count = 0;
    GLuint texture = 0;      // 0 = untextured
    float color[4] = {1, 1, 1, 1};
    Vec3f boundsMin{0, 0, 0}, boundsMax{0, 0, 0};
    void draw() const;
    void destroy();
};

class MeshBuilder {
public:
    void clear() { v_.clear(); i_.clear(); }
    void addTriangle(const Vertex& a, const Vertex& b, const Vertex& c);
    void addQuad(const Vec3f& p0, const Vec3f& p1, const Vec3f& p2, const Vec3f& p3, const Vec3f& normal,
                 const uint8_t rgba[4]);
    void addBox(const Vec3f& mn, const Vec3f& mx, const uint8_t rgba[4]);
    // Cylinder along the y axis, centred at the origin.
    void addCylinder(float radius, float width, int segments, const uint8_t side[4], const uint8_t cap[4]);
    std::vector<Vertex>& vertices() { return v_; }
    std::vector<uint32_t>& indices() { return i_; }
    bool empty() const { return i_.empty(); }
    Mesh upload() const;

private:
    std::vector<Vertex> v_;
    std::vector<uint32_t> i_;
};

// CPU-side model data: meshes in sim axes (x forward, y left, z up).
struct CpuPart {
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    float color[4] = {1, 1, 1, 1};
    std::vector<uint8_t> texture;  // RGBA8, empty = none
    int texWidth = 0, texHeight = 0;
    bool livery = false;           // material name starts with "Livery": recoloured with the car's livery
};

struct CpuModel {
    std::vector<CpuPart> parts;
    void bounds(Vec3f* mn, Vec3f* mx) const;
    void transform(const Mat4& m);
    bool empty() const { return parts.empty(); }
};

// GPU model ready to draw.
struct Model {
    std::vector<Mesh> parts;
    bool loaded() const { return !parts.empty(); }
    void destroy();
};

struct ModelPlacement {
    std::string file;       // path relative to the data directory, empty = built-in visuals
    float scale = 0.0f;     // 0 = auto-fit (body: length, wheel: diameter)
    float yawDeg = 0.0f;
    Vec3f offset{0, 0, 0};
    bool gltfAxes = true;   // glTF convention: +Y up, model front faces +Z
};

// Loads a glTF 2.0 file (.gltf with external buffers/images, or .glb) and
// bakes node transforms and the axis conversion into the vertices.
bool loadGltf(const std::string& path, bool gltfAxes, CpuModel* out, std::string* error);
// Rotates by `yawDeg`, scales (explicit or auto-fit of `fitAxis` extent to
// `targetSize`), then moves the bounding box: x/y centred on the anchor,
// z either grounded (min z = anchor.z) or centred.
void fitModel(CpuModel* m, int fitAxis, float targetSize, float explicitScale, float yawDeg, const Vec3f& anchor,
              bool groundZ);
Model uploadModel(const CpuModel& m);

}  // namespace app
