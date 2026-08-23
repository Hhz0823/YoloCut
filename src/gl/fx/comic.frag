#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_levels;
uniform float u_edgeStrength;
uniform float u_edgeThreshold;
uniform float u_saturation;
uniform float u_intensity;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;

float lumaAt(vec2 uv) {
  return dot(texture(u_input, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec4 base = texture(u_input, v_texCoord);
  float gx = lumaAt(v_texCoord + vec2(px.x, 0.0)) - lumaAt(v_texCoord - vec2(px.x, 0.0));
  float gy = lumaAt(v_texCoord + vec2(0.0, px.y)) - lumaAt(v_texCoord - vec2(0.0, px.y));
  float edge = length(vec2(gx, gy)) * u_edgeStrength;
  float ink = 1.0 - smoothstep(u_edgeThreshold, u_edgeThreshold + 0.16, edge);
  float levels = max(2.0, floor(u_levels + 0.5));
  vec3 poster = floor(base.rgb * (levels - 1.0) + 0.5) / max(levels - 1.0, 1.0);
  float gray = dot(poster, vec3(0.2126, 0.7152, 0.0722));
  poster = mix(vec3(gray), poster, u_saturation) * ink;
  fragColor = vec4(mix(base.rgb, clamp(poster, 0.0, 1.0), clamp(u_intensity, 0.0, 1.0)), base.a);
}
