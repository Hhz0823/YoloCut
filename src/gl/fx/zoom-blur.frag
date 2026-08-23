#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_center_x;
uniform float u_center_y;
uniform float u_amount;
uniform float u_intensity;
in vec2 v_texCoord;
out vec4 fragColor;
const int SAMPLES = 12;

void main() {
  vec2 center = vec2(u_center_x, u_center_y);
  vec2 ray = (center - v_texCoord) * u_amount * 0.16;
  vec4 base = texture(u_input, v_texCoord);
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES - 1);
    float weight = 1.0 - t * 0.45;
    sum += texture(u_input, clamp(v_texCoord + ray * t, 0.0, 1.0)) * weight;
    weightSum += weight;
  }
  vec4 blurred = sum / max(weightSum, 0.001);
  fragColor = mix(base, blurred, clamp(u_intensity, 0.0, 1.0));
}
