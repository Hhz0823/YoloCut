#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_grain;
uniform float u_scratches;
uniform float u_flicker;
uniform float u_sepia;
uniform float u_speed;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec4 base = texture(u_input, v_texCoord);
  float time = u_time * max(0.05, u_speed);
  vec2 resolution = max(u_resolution, vec2(1.0));
  float noise = (hash21(v_texCoord * resolution + floor(time * 18.0)) - 0.5) * 2.0;
  float column = floor(v_texCoord.x * resolution.x * 0.45);
  float scratchSeed = hash21(vec2(column, floor(time * 1.7)));
  float scratchMask = step(1.0 - u_scratches * 0.035, scratchSeed);
  float scratchShape = pow(max(0.0, sin(v_texCoord.x * resolution.x * 1.8 + scratchSeed * 9.0)), 18.0);
  float scratch = scratchMask * scratchShape;
  float flicker = 1.0 + (hash21(vec2(floor(time * 12.0), 9.0)) - 0.5) * u_flicker * 0.24;
  vec3 sepia = vec3(
    dot(base.rgb, vec3(0.393, 0.769, 0.189)),
    dot(base.rgb, vec3(0.349, 0.686, 0.168)),
    dot(base.rgb, vec3(0.272, 0.534, 0.131))
  );
  vec3 color = mix(base.rgb, sepia, clamp(u_sepia, 0.0, 1.0));
  color = color * flicker + noise * u_grain * 0.22 + scratch * u_scratches * 0.38;
  fragColor = vec4(clamp(color, 0.0, 1.0), base.a);
}
