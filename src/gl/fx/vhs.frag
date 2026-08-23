#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_intensity;
uniform float u_tracking;
uniform float u_chromaShift;
uniform float u_scanlines;
uniform float u_noise;
uniform float u_speed;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float time = u_time * max(0.05, u_speed);
  vec2 resolution = max(u_resolution, vec2(1.0));
  float row = floor(v_texCoord.y * resolution.y / 4.0);
  float rowNoise = hash21(vec2(row, floor(time * 18.0))) - 0.5;
  float burst = step(0.94, hash21(vec2(floor(time * 5.0), row * 0.017)));
  float wobble = sin(v_texCoord.y * 38.0 + time * 3.2) * 0.0015;
  float jitter = (wobble + rowNoise * 0.004 + burst * rowNoise * 0.025)
    * u_tracking * u_intensity;
  vec2 uv = clamp(v_texCoord + vec2(jitter, 0.0), 0.0, 1.0);
  vec2 chroma = vec2(u_chromaShift / resolution.x, 0.0) * u_intensity;
  vec4 base = texture(u_input, uv);
  vec3 split = vec3(
    texture(u_input, clamp(uv + chroma, 0.0, 1.0)).r,
    base.g,
    texture(u_input, clamp(uv - chroma, 0.0, 1.0)).b
  );
  float scan = 0.5 + 0.5 * sin(v_texCoord.y * resolution.y * 3.14159265);
  float grain = (hash21(v_texCoord * resolution + floor(time * 30.0)) - 0.5) * 2.0;
  float trackingLine = exp(-pow(fract(v_texCoord.y + time * 0.13) - 0.5, 2.0) * 1800.0);
  vec3 color = split * (1.0 - scan * u_scanlines * 0.28 * u_intensity);
  color += grain * u_noise * 0.22 * u_intensity;
  color += trackingLine * u_tracking * 0.14 * u_intensity;
  fragColor = vec4(clamp(color, 0.0, 1.0), base.a);
}
