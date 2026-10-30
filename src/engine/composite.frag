#version 300 es
precision highp float;

/*
  Финальный проход. Порядок строгий:
    bloom -> ACES (fitted) с линейным носком -> linear->sRGB (точный OETF)
    -> дизер -> зерно.
  Дизер обязателен: тёмный градиент в 8 битах без него идёт кольцами.
*/

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomIntensity;
uniform float uGrain;
uniform vec2  uResolution;
uniform float uGrainScale;   // привязка размера зерна к разрешению кадра
uniform float uSeed;
uniform int   uTonemap;      // 0 — выкл (послойная выгрузка света), 1 — ACES
uniform float uSaturation;   // трим насыщенности после tonemap
uniform sampler2D uText;     // маска надписи; буквы кладутся поверх готового кадра
uniform int   uTextFace;     // 1 — класть буквы (не в слое фона и объёма)

// ACES fitted, Stephen Hill
const mat3 ACESInput = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);
const mat3 ACESOutput = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);

vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 acesFitted(vec3 color) {
  color = ACESInput * color;
  color = rrtOdtFit(color);
  color = ACESOutput * color;
  return clamp(color, 0.0, 1.0);
}

/*
  Носок кривой — линейный. У ACES fitted в тенях сильный носок: вдвое меньше
  света — втрое темнее на выходе, и мягкий заход света сжимается в горячее
  пятно у края. Ниже точки касания (0.457) кривая заменена касательной из
  нуля: тени идут линейно, как градиенты в рефах, а света и выжженное ядро
  остаются ACES. Переход — по яркости, со сглаживанием, чтобы цветной свет
  не давал шва. JS-копия — tone.ts.
*/
const float TOE_KNEE = 0.4575;
const float TOE_SLOPE = 0.7505;

vec3 tonemap(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(c * TOE_SLOPE, acesFitted(c), smoothstep(0.6 * TOE_KNEE, TOE_KNEE, l)), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92,
             1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec4 sceneTex = texture(uScene, vUv);
  vec3 scene = sceneTex.rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 color = scene + bloom * uBloomIntensity;

  if (uTonemap == 1) {
    color = tonemap(color);
  } else {
    color = clamp(color, 0.0, 1.0);
  }

  /*
    Трим насыщенности — ПОСЛЕ tonemap, как в кинематографическом конвейере.

    ACES по построению уводит яркое в белый: именно отсюда берётся выжженное
    ядро с цветной периферией. Но та же кривая съедает цвет и в полутонах,
    и на цветном фоне кадр выцветает раньше, чем хочется. Поднимать
    насыщенность ДО tonemap бессмысленно — ACES съест ровно столько же.
  */
  if (abs(uSaturation - 1.0) > 0.001) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    // В светах трим гасится. Выжженное белое ядро — это результат экспозиции,
    // и подкрашивать его нельзя: иначе вместо белого центра с цветной
    // периферией получается сплошное цветное пятно.
    float w = 1.0 - smoothstep(0.70, 1.0, luma);
    color = clamp(mix(vec3(luma), color, mix(1.0, uSaturation, w)), 0.0, 1.0);
  }

  color = linearToSrgb(color);

  /*
    Надпись — поверх готового кадра, в sRGB, как слои в Figma: сначала
    размытая копия (альфа сцены) обычным наложением белого, сверху резкие
    буквы маской как прозрачностью. Если добавлять их в линейный свет до
    тонмапа, ACES сжимает сглаженный край (10–90% покрытия) в сплошной белый,
    буквы идут лесенкой, а ореол разбухает в облако.
  */
  color = mix(color, vec3(1.0), clamp(sceneTex.a, 0.0, 1.0));
  if (uTextFace == 1) {
    float m = texture(uText, vUv).a;
    color = mix(color, vec3(0.97), m);
  }

  // Треугольный дизер, независимый белый шум.
  float r1 = hash(gl_FragCoord.xy + uSeed);
  float r2 = hash(gl_FragCoord.xy + uSeed + 71.13);
  color += (r1 - r2) / 255.0;

  // Зерно — в масштабе, привязанном к разрешению кадра, а не к пикселю.
  if (uGrain > 0.0) {
    vec2 gp = vUv * uResolution / max(uGrainScale, 1e-3);
    float n = hash(gp + uSeed) - 0.5;
    color += n * uGrain;
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
