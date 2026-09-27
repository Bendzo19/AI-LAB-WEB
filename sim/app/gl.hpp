// Minimal OpenGL 3.3 core function loader (via SDL_GL_GetProcAddress).
// Functions live in namespace gl without the "gl" prefix to avoid clashing
// with system headers, e.g. gl::Clear(...).
#pragma once

#include <SDL3/SDL_opengl.h>

namespace gl {

bool load();  // call after the context is current; false if anything is missing

#define F1SIM_GL_FUNCS(X)                                                                          \
    X(void, Viewport, GLint, GLint, GLsizei, GLsizei)                                              \
    X(void, ClearColor, GLfloat, GLfloat, GLfloat, GLfloat)                                        \
    X(void, Clear, GLbitfield)                                                                     \
    X(void, Enable, GLenum)                                                                        \
    X(void, Disable, GLenum)                                                                       \
    X(void, BlendFunc, GLenum, GLenum)                                                             \
    X(void, DepthFunc, GLenum)                                                                     \
    X(void, DepthMask, GLboolean)                                                                  \
    X(void, CullFace, GLenum)                                                                      \
    X(void, FrontFace, GLenum)                                                                     \
    X(void, PolygonOffset, GLfloat, GLfloat)                                                       \
    X(void, ReadPixels, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*)                     \
    X(void, PixelStorei, GLenum, GLint)                                                            \
    X(GLenum, GetError, void)                                                                      \
    X(const GLubyte*, GetString, GLenum)                                                           \
    X(GLuint, CreateShader, GLenum)                                                                \
    X(void, ShaderSource, GLuint, GLsizei, const GLchar* const*, const GLint*)                     \
    X(void, CompileShader, GLuint)                                                                 \
    X(void, GetShaderiv, GLuint, GLenum, GLint*)                                                   \
    X(void, GetShaderInfoLog, GLuint, GLsizei, GLsizei*, GLchar*)                                  \
    X(void, DeleteShader, GLuint)                                                                  \
    X(GLuint, CreateProgram, void)                                                                 \
    X(void, AttachShader, GLuint, GLuint)                                                          \
    X(void, LinkProgram, GLuint)                                                                   \
    X(void, GetProgramiv, GLuint, GLenum, GLint*)                                                  \
    X(void, GetProgramInfoLog, GLuint, GLsizei, GLsizei*, GLchar*)                                 \
    X(void, UseProgram, GLuint)                                                                    \
    X(void, DeleteProgram, GLuint)                                                                 \
    X(GLint, GetUniformLocation, GLuint, const GLchar*)                                            \
    X(void, Uniform1i, GLint, GLint)                                                               \
    X(void, Uniform1f, GLint, GLfloat)                                                             \
    X(void, Uniform2f, GLint, GLfloat, GLfloat)                                                    \
    X(void, Uniform3f, GLint, GLfloat, GLfloat, GLfloat)                                           \
    X(void, Uniform4f, GLint, GLfloat, GLfloat, GLfloat, GLfloat)                                  \
    X(void, UniformMatrix4fv, GLint, GLsizei, GLboolean, const GLfloat*)                           \
    X(void, GenVertexArrays, GLsizei, GLuint*)                                                     \
    X(void, BindVertexArray, GLuint)                                                               \
    X(void, DeleteVertexArrays, GLsizei, const GLuint*)                                            \
    X(void, GenBuffers, GLsizei, GLuint*)                                                          \
    X(void, BindBuffer, GLenum, GLuint)                                                            \
    X(void, BufferData, GLenum, GLsizeiptr, const void*, GLenum)                                   \
    X(void, DeleteBuffers, GLsizei, const GLuint*)                                                 \
    X(void, EnableVertexAttribArray, GLuint)                                                       \
    X(void, VertexAttribPointer, GLuint, GLint, GLenum, GLboolean, GLsizei, const void*)           \
    X(void, VertexAttrib4f, GLuint, GLfloat, GLfloat, GLfloat, GLfloat)                            \
    X(void, VertexAttrib2f, GLuint, GLfloat, GLfloat)                                              \
    X(void, DisableVertexAttribArray, GLuint)                                                      \
    X(void, DrawArrays, GLenum, GLint, GLsizei)                                                    \
    X(void, DrawElements, GLenum, GLsizei, GLenum, const void*)                                    \
    X(void, GenTextures, GLsizei, GLuint*)                                                         \
    X(void, BindTexture, GLenum, GLuint)                                                           \
    X(void, ActiveTexture, GLenum)                                                                 \
    X(void, TexImage2D, GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*) \
    X(void, TexParameteri, GLenum, GLenum, GLint)                                                  \
    X(void, GenerateMipmap, GLenum)                                                                \
    X(void, DeleteTextures, GLsizei, const GLuint*)

#define F1SIM_GL_DECLARE(ret, name, ...) \
    using PFN_##name = ret(APIENTRY*)(__VA_ARGS__); \
    extern PFN_##name name;
F1SIM_GL_FUNCS(F1SIM_GL_DECLARE)
#undef F1SIM_GL_DECLARE

}  // namespace gl
