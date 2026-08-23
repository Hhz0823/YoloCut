#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_refraction;
uniform float u_scale;
uniform float u_speed;
uniform float u_chromatic;
uniform float u_highlight;
uniform float u_mix;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 resolution = max(u_resolution, vec2(1.0));
  float aspect = resolution.x / resolution.y;
  vec2 p = (v_texCoord - 0.5) * vec2(aspect, 1.0);
  float time = u_time * u_speed;
  float scale = max(0.5, u_scale);
  float waveA = sin((p.x * 1.15 + p.y * 0.85) * scale + time * 1.7);
  float waveB = cos((p.x * -0.7 + p.y * 1.35) * scale * 1.27 - time * 1.3);
  vec2 normal = vec2(
    cos((p.x * 1.15 + p.y * 0.85) * scale + time * 1.7),
    -sin((p.x * -0.7 + p.y * 1.35) * scale * 1.27 - time * 1.3)
  );
  normal *= 0.5 + 0.25 * (waveA + waveB);
  vec2 offset = normal * u_refraction / min(resolution.x, resolution.y);
  vec4 base = texture(u_input, v_texCoord);
  vec2 chroma = normal * u_chromatic / min(resolution.x, resolution.y);
  vec3 refracted = vec3(
    texture(u_input, clamp(v_texCoord + offset + chroma, 0.0, 1.0)).r,
    texture(u_input, clamp(v_texCoord + offset, 0.0, 1.0)).g,
    texture(u_input, clamp(v_texCoord + offset - chroma, 0.0, 1.0)).b
  );
  float caustic = pow(clamp(0.5 + 0.5 * (waveA * waveB), 0.0, 1.0), 5.0) * u_highlight;
  refracted += caustic * vec3(0.55, 0.72, 1.0);
  fragColor = vec4(mix(base.rgb, clamp(refracted, 0.0, 1.0), clamp(u_mix, 0.0, 1.0)), base.a);
}
