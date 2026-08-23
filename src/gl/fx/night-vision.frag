#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_gain;
uniform float u_noise;
uniform float u_scanlines;
uniform float u_vignette;
uniform vec3 u_tint;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec4 base = texture(u_input, v_texCoord);
  float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  float grain = (hash21(v_texCoord * max(u_resolution, vec2(1.0)) + floor(u_time * 24.0)) - 0.5) * 2.0;
  float scan = 0.5 + 0.5 * sin(v_texCoord.y * max(u_resolution.y, 1.0) * 3.14159265);
  vec2 centered = (v_texCoord - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float edge = 1.0 - smoothstep(0.2, 0.9, length(centered));
  float signal = clamp(luma * u_gain + grain * u_noise * 0.18, 0.0, 1.0);
  signal *= 1.0 - scan * u_scanlines * 0.22;
  signal *= mix(1.0, edge, clamp(u_vignette, 0.0, 1.0));
  fragColor = vec4(clamp(u_tint * signal, 0.0, 1.0), base.a);
}
