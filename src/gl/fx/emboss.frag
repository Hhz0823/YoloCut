#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_strength;
uniform float u_angle;
uniform float u_blend;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 direction = vec2(cos(u_angle), sin(u_angle)) / max(u_resolution, vec2(1.0));
  vec4 base = texture(u_input, v_texCoord);
  vec3 positive = texture(u_input, clamp(v_texCoord + direction * 1.5, 0.0, 1.0)).rgb;
  vec3 negative = texture(u_input, clamp(v_texCoord - direction * 1.5, 0.0, 1.0)).rgb;
  float relief = dot(positive - negative, vec3(0.2126, 0.7152, 0.0722));
  vec3 embossed = vec3(clamp(0.5 + relief * u_strength, 0.0, 1.0));
  fragColor = vec4(mix(base.rgb, embossed, clamp(u_blend, 0.0, 1.0)), base.a);
}
