#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_intensity;
in vec2 v_texCoord;
out vec4 fragColor;

vec3 thermalPalette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(vec3(0.015, 0.0, 0.12), vec3(0.0, 0.12, 0.8), t * 4.0);
  if (t < 0.5) return mix(vec3(0.0, 0.12, 0.8), vec3(0.0, 0.85, 0.75), (t - 0.25) * 4.0);
  if (t < 0.75) return mix(vec3(0.0, 0.85, 0.75), vec3(1.0, 0.72, 0.02), (t - 0.5) * 4.0);
  return mix(vec3(1.0, 0.72, 0.02), vec3(1.0, 0.98, 0.9), (t - 0.75) * 4.0);
}

void main() {
  vec4 base = texture(u_input, v_texCoord);
  float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
  float temperature = clamp((luma - 0.5) * u_contrast + 0.5 + u_brightness, 0.0, 1.0);
  vec3 thermal = thermalPalette(temperature);
  fragColor = vec4(mix(base.rgb, thermal, clamp(u_intensity, 0.0, 1.0)), base.a);
}
