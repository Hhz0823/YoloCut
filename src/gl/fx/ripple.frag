#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_speed;
uniform float u_decay;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 resolution = max(u_resolution, vec2(1.0));
  float aspect = resolution.x / resolution.y;
  vec2 center = vec2(u_center_x, u_center_y);
  vec2 p = (v_texCoord - center) * vec2(aspect, 1.0);
  float distanceFromCenter = length(p);
  vec2 direction = distanceFromCenter > 0.0001 ? p / distanceFromCenter : vec2(0.0);
  float wave = sin(distanceFromCenter * u_frequency - u_time * u_speed * 6.2831853);
  wave *= exp(-distanceFromCenter * max(0.0, u_decay));
  vec2 displacement = direction / vec2(aspect, 1.0)
    * wave * u_amplitude / min(resolution.x, resolution.y);
  fragColor = texture(u_input, clamp(v_texCoord + displacement, 0.0, 1.0));
}
