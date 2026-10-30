#version 300 es
precision highp float;

// Даунсэмпл по Карису: 13 отсчётов, четыре группы по 4.
// На первом уровне (uPrefilter == 1) включается порог с мягким коленом
// и усреднение по обратной яркости — иначе одиночные яркие пиксели
// дают фейерверки при апсэмпле.

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2  uTexel;      // 1 / размер источника
uniform int   uPrefilter;
uniform float uThreshold;
uniform float uKnee;

float karisWeight(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return 1.0 / (1.0 + luma);
}

vec3 fetch(vec2 uv) {
  return texture(uSrc, uv).rgb;
}

void main() {
  vec2 t = uTexel;
  vec2 uv = vUv;

  vec3 a = fetch(uv + t * vec2(-2.0,  2.0));
  vec3 b = fetch(uv + t * vec2( 0.0,  2.0));
  vec3 c = fetch(uv + t * vec2( 2.0,  2.0));
  vec3 d = fetch(uv + t * vec2(-2.0,  0.0));
  vec3 e = fetch(uv);
  vec3 f = fetch(uv + t * vec2( 2.0,  0.0));
  vec3 g = fetch(uv + t * vec2(-2.0, -2.0));
  vec3 h = fetch(uv + t * vec2( 0.0, -2.0));
  vec3 i = fetch(uv + t * vec2( 2.0, -2.0));
  vec3 j = fetch(uv + t * vec2(-1.0,  1.0));
  vec3 k = fetch(uv + t * vec2( 1.0,  1.0));
  vec3 l = fetch(uv + t * vec2(-1.0, -1.0));
  vec3 m = fetch(uv + t * vec2( 1.0, -1.0));

  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;

  vec3 res;
  if (uPrefilter == 1) {
    float w0 = karisWeight(g0) * 0.5;
    float w1 = karisWeight(g1) * 0.125;
    float w2 = karisWeight(g2) * 0.125;
    float w3 = karisWeight(g3) * 0.125;
    float w4 = karisWeight(g4) * 0.125;
    float wsum = w0 + w1 + w2 + w3 + w4;
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(wsum, 1e-5);

    // мягкое колено
    float luma = dot(res, vec3(0.2126, 0.7152, 0.0722));
    float soft = clamp(luma - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / max(4.0 * uKnee, 1e-4);
    float contrib = max(soft, luma - uThreshold) / max(luma, 1e-5);
    res *= contrib;
  } else {
    res = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }

  fragColor = vec4(res, 1.0);
}
