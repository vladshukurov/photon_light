#version 300 es
precision highp float;

// Апсэмпл тентовым фильтром 3x3. Радиус задаётся В UV, а не в пикселях,
// поэтому превью и экспорт в 4K дают одинаковую картинку.

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform float uRadius;   // в UV

void main() {
  float r = uRadius;
  vec2 uv = vUv;

  vec3 s = texture(uSrc, uv + vec2(-r,  r)).rgb * 1.0
         + texture(uSrc, uv + vec2( 0.0, r)).rgb * 2.0
         + texture(uSrc, uv + vec2( r,  r)).rgb * 1.0
         + texture(uSrc, uv + vec2(-r,  0.0)).rgb * 2.0
         + texture(uSrc, uv).rgb * 4.0
         + texture(uSrc, uv + vec2( r,  0.0)).rgb * 2.0
         + texture(uSrc, uv + vec2(-r, -r)).rgb * 1.0
         + texture(uSrc, uv + vec2( 0.0,-r)).rgb * 2.0
         + texture(uSrc, uv + vec2( r, -r)).rgb * 1.0;

  fragColor = vec4(s / 16.0, 1.0);
}
