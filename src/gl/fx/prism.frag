#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_amount;
uniform float u_angle;
uniform float u_falloff;
uniform float u_intensity;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 base = texture(u_input, v_texCoord);
  vec2 direction = vec2(cos(u_angle), sin(u_angle));
  float radial = length(v_texCoord - 0.5) * 1.41421356;
  float scale = mix(1.0, smoothstep(0.0, 1.0, radial), clamp(u_falloff, 0.0, 1.0));
  vec2 offset = direction * (u_amount / max(u_resolution, vec2(1.0))) * scale;
  vec3 prism = vec3(
    texture(u_input, clamp(v_texCoord + offset, 0.0, 1.0)).r,
    base.g,
    texture(u_input, clamp(v_texCoord - offset, 0.0, 1.0)).b
  );
  fragColor = vec4(mix(base.rgb, prism, clamp(u_intensity, 0.0, 1.0)), base.a);
}
