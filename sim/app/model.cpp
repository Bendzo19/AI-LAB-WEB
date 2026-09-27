#include "model.hpp"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstddef>

#include "cgltf.h"
#include "stb_image.h"

namespace app {

// ---- Mesh ----------------------------------------------------------------

void Mesh::draw() const {
    if (!vao) return;
    gl::BindVertexArray(vao);
    gl::DrawElements(GL_TRIANGLES, count, GL_UNSIGNED_INT, nullptr);
}

void Mesh::destroy() {
    if (ebo) gl::DeleteBuffers(1, &ebo);
    if (vbo) gl::DeleteBuffers(1, &vbo);
    if (vao) gl::DeleteVertexArrays(1, &vao);
    if (texture) gl::DeleteTextures(1, &texture);
    vao = vbo = ebo = texture = 0;
    count = 0;
}

static Mesh uploadArrays(const std::vector<Vertex>& v, const std::vector<uint32_t>& idx) {
    Mesh m;
    if (idx.empty()) return m;
    gl::GenVertexArrays(1, &m.vao);
    gl::BindVertexArray(m.vao);
    gl::GenBuffers(1, &m.vbo);
    gl::BindBuffer(GL_ARRAY_BUFFER, m.vbo);
    gl::BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(v.size() * sizeof(Vertex)), v.data(), GL_STATIC_DRAW);
    gl::GenBuffers(1, &m.ebo);
    gl::BindBuffer(GL_ELEMENT_ARRAY_BUFFER, m.ebo);
    gl::BufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(idx.size() * sizeof(uint32_t)), idx.data(),
                   GL_STATIC_DRAW);
    const GLsizei stride = sizeof(Vertex);
    gl::EnableVertexAttribArray(0);
    gl::VertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<void*>(offsetof(Vertex, px)));
    gl::EnableVertexAttribArray(1);
    gl::VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<void*>(offsetof(Vertex, nx)));
    gl::EnableVertexAttribArray(2);
    gl::VertexAttribPointer(2, 4, GL_UNSIGNED_BYTE, GL_TRUE, stride, reinterpret_cast<void*>(offsetof(Vertex, r)));
    gl::EnableVertexAttribArray(3);
    gl::VertexAttribPointer(3, 2, GL_FLOAT, GL_FALSE, stride, reinterpret_cast<void*>(offsetof(Vertex, u)));
    gl::BindVertexArray(0);
    m.count = static_cast<GLsizei>(idx.size());
    Vec3f mn{FLT_MAX, FLT_MAX, FLT_MAX}, mx{-FLT_MAX, -FLT_MAX, -FLT_MAX};
    for (const auto& p : v) {
        mn = {std::min(mn.x, p.px), std::min(mn.y, p.py), std::min(mn.z, p.pz)};
        mx = {std::max(mx.x, p.px), std::max(mx.y, p.py), std::max(mx.z, p.pz)};
    }
    m.boundsMin = mn;
    m.boundsMax = mx;
    return m;
}

// ---- MeshBuilder -------------------------------------------------------------

void MeshBuilder::addTriangle(const Vertex& a, const Vertex& b, const Vertex& c) {
    const auto base = static_cast<uint32_t>(v_.size());
    v_.push_back(a);
    v_.push_back(b);
    v_.push_back(c);
    i_.insert(i_.end(), {base, base + 1, base + 2});
}

void MeshBuilder::addQuad(const Vec3f& p0, const Vec3f& p1, const Vec3f& p2, const Vec3f& p3, const Vec3f& n,
                          const uint8_t c[4]) {
    const auto base = static_cast<uint32_t>(v_.size());
    for (const Vec3f* p : {&p0, &p1, &p2, &p3}) {
        v_.push_back({p->x, p->y, p->z, n.x, n.y, n.z, c[0], c[1], c[2], c[3], 0.0f, 0.0f});
    }
    i_.insert(i_.end(), {base, base + 1, base + 2, base, base + 2, base + 3});
}

void MeshBuilder::addBox(const Vec3f& a, const Vec3f& b, const uint8_t c[4]) {
    const Vec3f p[8] = {{a.x, a.y, a.z}, {b.x, a.y, a.z}, {b.x, b.y, a.z}, {a.x, b.y, a.z},
                        {a.x, a.y, b.z}, {b.x, a.y, b.z}, {b.x, b.y, b.z}, {a.x, b.y, b.z}};
    addQuad(p[0], p[3], p[2], p[1], {0, 0, -1}, c);
    addQuad(p[4], p[5], p[6], p[7], {0, 0, 1}, c);
    addQuad(p[0], p[1], p[5], p[4], {0, -1, 0}, c);
    addQuad(p[2], p[3], p[7], p[6], {0, 1, 0}, c);
    addQuad(p[1], p[2], p[6], p[5], {1, 0, 0}, c);
    addQuad(p[3], p[0], p[4], p[7], {-1, 0, 0}, c);
}

void MeshBuilder::addCylinder(float r, float w, int seg, const uint8_t side[4], const uint8_t cap[4]) {
    const float h = w * 0.5f;
    for (int i = 0; i < seg; ++i) {
        const float a0 = 2.0f * float(f1sim::kPi) * i / seg, a1 = 2.0f * float(f1sim::kPi) * (i + 1) / seg;
        const float x0 = std::cos(a0) * r, z0 = std::sin(a0) * r, x1 = std::cos(a1) * r, z1 = std::sin(a1) * r;
        const Vec3f n = normalizef({std::cos((a0 + a1) * 0.5f), 0, std::sin((a0 + a1) * 0.5f)});
        addQuad({x0, -h, z0}, {x1, -h, z1}, {x1, h, z1}, {x0, h, z0}, n, side);
        // Caps as fans; alternate shading on the outer cap reads as spokes when spinning.
        const uint8_t capAlt[4] = {uint8_t(cap[0] * 0.8f), uint8_t(cap[1] * 0.8f), uint8_t(cap[2] * 0.8f), cap[3]};
        const uint8_t* cc = (i % 2) ? cap : capAlt;
        Vertex c0{0, h, 0, 0, 1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        Vertex e0{x0, h, z0, 0, 1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        Vertex e1{x1, h, z1, 0, 1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        addTriangle(c0, e1, e0);
        Vertex d0{0, -h, 0, 0, -1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        Vertex f0{x0, -h, z0, 0, -1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        Vertex f1{x1, -h, z1, 0, -1, 0, cc[0], cc[1], cc[2], cc[3], 0, 0};
        addTriangle(d0, f0, f1);
    }
}

Mesh MeshBuilder::upload() const { return uploadArrays(v_, i_); }

// ---- CPU model utilities ------------------------------------------------------------

void CpuModel::bounds(Vec3f* mn, Vec3f* mx) const {
    *mn = {FLT_MAX, FLT_MAX, FLT_MAX};
    *mx = {-FLT_MAX, -FLT_MAX, -FLT_MAX};
    for (const auto& p : parts) {
        for (const auto& v : p.vertices) {
            *mn = {std::min(mn->x, v.px), std::min(mn->y, v.py), std::min(mn->z, v.pz)};
            *mx = {std::max(mx->x, v.px), std::max(mx->y, v.py), std::max(mx->z, v.pz)};
        }
    }
}

void CpuModel::transform(const Mat4& m) {
    for (auto& p : parts) {
        for (auto& v : p.vertices) {
            const Vec3f pos = m.transformPoint({v.px, v.py, v.pz});
            const Vec3f n = normalizef(m.transformDir({v.nx, v.ny, v.nz}));
            v.px = pos.x; v.py = pos.y; v.pz = pos.z;
            v.nx = n.x; v.ny = n.y; v.nz = n.z;
        }
    }
}

void fitModel(CpuModel* m, int fitAxis, float targetSize, float explicitScale, float yawDeg, const Vec3f& anchor,
              bool groundZ) {
    if (m->empty()) return;
    if (yawDeg != 0.0f) m->transform(Mat4::rotateAxis({0, 0, 1}, yawDeg * float(f1sim::kPi) / 180.0f));
    Vec3f mn, mx;
    m->bounds(&mn, &mx);
    const float ext[3] = {mx.x - mn.x, mx.y - mn.y, mx.z - mn.z};
    float s = explicitScale;
    if (s <= 0.0f) s = ext[fitAxis] > 1e-6f ? targetSize / ext[fitAxis] : 1.0f;
    const Vec3f centre{(mn.x + mx.x) * 0.5f, (mn.y + mx.y) * 0.5f, (mn.z + mx.z) * 0.5f};
    const float zRef = groundZ ? mn.z : centre.z;
    // p' = (p - ref) * s + anchor
    const Mat4 t = Mat4::translate(anchor) * Mat4::scale({s, s, s}) * Mat4::translate({-centre.x, -centre.y, -zRef});
    m->transform(t);
}

Model uploadModel(const CpuModel& cm) {
    Model m;
    for (const auto& p : cm.parts) {
        Mesh mesh = uploadArrays(p.vertices, p.indices);
        std::copy(p.color, p.color + 4, mesh.color);
        if (!p.texture.empty()) {
            gl::GenTextures(1, &mesh.texture);
            gl::BindTexture(GL_TEXTURE_2D, mesh.texture);
            gl::PixelStorei(GL_UNPACK_ALIGNMENT, 1);
            gl::TexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, p.texWidth, p.texHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                           p.texture.data());
            gl::GenerateMipmap(GL_TEXTURE_2D);
            gl::TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
            gl::TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            gl::TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
            gl::TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
        }
        if (mesh.vao) m.parts.push_back(mesh);
    }
    return m;
}

void Model::destroy() {
    for (auto& p : parts) p.destroy();
    parts.clear();
}

// ---- glTF --------------------------------------------------------------------------------

namespace {

bool loadImage(const cgltf_image* img, const std::string& baseDir, CpuPart* part) {
    int w = 0, h = 0, n = 0;
    stbi_uc* px = nullptr;
    if (img->buffer_view && img->buffer_view->buffer->data) {
        const auto* bytes = static_cast<const stbi_uc*>(img->buffer_view->buffer->data) + img->buffer_view->offset;
        px = stbi_load_from_memory(bytes, static_cast<int>(img->buffer_view->size), &w, &h, &n, 4);
    } else if (img->uri && std::string(img->uri).rfind("data:", 0) != 0) {
        std::string uri = img->uri;
        cgltf_decode_uri(uri.data());
        uri.resize(std::char_traits<char>::length(uri.c_str()));
        px = stbi_load((baseDir + uri).c_str(), &w, &h, &n, 4);
    }
    if (!px) return false;
    part->texture.assign(px, px + static_cast<size_t>(w) * h * 4);
    part->texWidth = w;
    part->texHeight = h;
    stbi_image_free(px);
    return true;
}

void addPrimitive(const cgltf_primitive& prim, const float world[16], bool gltfAxes, const std::string& baseDir,
                  CpuModel* out) {
    if (prim.type != cgltf_primitive_type_triangles) return;
    const cgltf_accessor *pos = nullptr, *nrm = nullptr, *uv = nullptr;
    for (size_t a = 0; a < prim.attributes_count; ++a) {
        const auto& at = prim.attributes[a];
        if (at.type == cgltf_attribute_type_position) pos = at.data;
        else if (at.type == cgltf_attribute_type_normal) nrm = at.data;
        else if (at.type == cgltf_attribute_type_texcoord && at.index == 0) uv = at.data;
    }
    if (!pos) return;
    Mat4 M;
    std::copy(world, world + 16, M.m);
    // glTF (+Y up, front +Z, left +X) -> sim (x forward, y left, z up).
    Mat4 C;
    if (gltfAxes) {
        C.m[0] = 0; C.m[4] = 0; C.m[8] = 1;   // x' = z
        C.m[1] = 1; C.m[5] = 0; C.m[9] = 0;   // y' = x
        C.m[2] = 0; C.m[6] = 1; C.m[10] = 0;  // z' = y
    }
    const Mat4 T = C * M;
    const float det = T.at(0, 0) * (T.at(1, 1) * T.at(2, 2) - T.at(1, 2) * T.at(2, 1)) -
                      T.at(0, 1) * (T.at(1, 0) * T.at(2, 2) - T.at(1, 2) * T.at(2, 0)) +
                      T.at(0, 2) * (T.at(1, 0) * T.at(2, 1) - T.at(1, 1) * T.at(2, 0));

    CpuPart part;
    const size_t n = pos->count;
    part.vertices.resize(n);
    for (size_t i = 0; i < n; ++i) {
        float p[3] = {0, 0, 0}, q[3] = {0, 0, 1}, t[2] = {0, 0};
        cgltf_accessor_read_float(pos, i, p, 3);
        if (nrm) cgltf_accessor_read_float(nrm, i, q, 3);
        if (uv) cgltf_accessor_read_float(uv, i, t, 2);
        const Vec3f wp = T.transformPoint({p[0], p[1], p[2]});
        const Vec3f wn = normalizef(T.transformDir({q[0], q[1], q[2]}));
        part.vertices[i] = {wp.x, wp.y, wp.z, wn.x, wn.y, wn.z, 255, 255, 255, 255, t[0], t[1]};
    }
    if (prim.indices) {
        part.indices.resize(prim.indices->count);
        for (size_t i = 0; i < prim.indices->count; ++i) {
            part.indices[i] = static_cast<uint32_t>(cgltf_accessor_read_index(prim.indices, i));
        }
    } else {
        part.indices.resize(n);
        for (size_t i = 0; i < n; ++i) part.indices[i] = static_cast<uint32_t>(i);
    }
    if (det < 0.0f) {
        for (size_t i = 0; i + 2 < part.indices.size(); i += 3) std::swap(part.indices[i + 1], part.indices[i + 2]);
    }
    if (!nrm) {  // flat normals from faces
        for (size_t i = 0; i + 2 < part.indices.size(); i += 3) {
            auto& a = part.vertices[part.indices[i]];
            auto& b = part.vertices[part.indices[i + 1]];
            auto& c = part.vertices[part.indices[i + 2]];
            const Vec3f fn = normalizef(crossf(Vec3f{b.px - a.px, b.py - a.py, b.pz - a.pz},
                                               Vec3f{c.px - a.px, c.py - a.py, c.pz - a.pz}));
            for (Vertex* v : {&a, &b, &c}) { v->nx = fn.x; v->ny = fn.y; v->nz = fn.z; }
        }
    }
    if (prim.material && prim.material->has_pbr_metallic_roughness) {
        const auto& pbr = prim.material->pbr_metallic_roughness;
        std::copy(pbr.base_color_factor, pbr.base_color_factor + 4, part.color);
        if (pbr.base_color_texture.texture && pbr.base_color_texture.texture->image) {
            if (!loadImage(pbr.base_color_texture.texture->image, baseDir, &part)) {
                SDL_Log("model: could not load a base colour texture (%s)", stbi_failure_reason());
            }
        }
    }
    out->parts.push_back(std::move(part));
}

void addNode(const cgltf_node* node, bool gltfAxes, const std::string& baseDir, CpuModel* out) {
    if (node->mesh) {
        float world[16];
        cgltf_node_transform_world(node, world);
        for (size_t p = 0; p < node->mesh->primitives_count; ++p) {
            addPrimitive(node->mesh->primitives[p], world, gltfAxes, baseDir, out);
        }
    }
    for (size_t c = 0; c < node->children_count; ++c) addNode(node->children[c], gltfAxes, baseDir, out);
}

}  // namespace

bool loadGltf(const std::string& path, bool gltfAxes, CpuModel* out, std::string* error) {
    cgltf_options opt{};
    cgltf_data* data = nullptr;
    if (cgltf_parse_file(&opt, path.c_str(), &data) != cgltf_result_success) {
        if (error) *error = "cannot parse glTF '" + path + "'";
        return false;
    }
    if (cgltf_load_buffers(&opt, data, path.c_str()) != cgltf_result_success) {
        cgltf_free(data);
        if (error) *error = "cannot load buffers of '" + path + "'";
        return false;
    }
    const auto slash = path.find_last_of("/\\");
    const std::string baseDir = slash == std::string::npos ? "" : path.substr(0, slash + 1);
    CpuModel m;
    const cgltf_scene* scene = data->scene ? data->scene : (data->scenes_count ? &data->scenes[0] : nullptr);
    if (scene) {
        for (size_t i = 0; i < scene->nodes_count; ++i) addNode(scene->nodes[i], gltfAxes, baseDir, &m);
    } else {
        for (size_t i = 0; i < data->nodes_count; ++i) {
            if (!data->nodes[i].parent) addNode(&data->nodes[i], gltfAxes, baseDir, &m);
        }
    }
    cgltf_free(data);
    if (m.empty()) {
        if (error) *error = "'" + path + "' contains no triangle meshes";
        return false;
    }
    *out = std::move(m);
    return true;
}

}  // namespace app
