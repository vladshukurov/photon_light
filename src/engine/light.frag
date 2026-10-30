#version 300 es
precision highp float;

/*
  Сцена Фотона: одна белая лампа светит вскользь по стене сквозь дымку.

  Камера ортографическая и смотрит вдоль −Z, стена — плоскость z = 0. Кадр
  складывается из трёх слагаемых, которые же уходят в послойную выгрузку:

    base  — неосвещённая стена (общий свет светлой комнаты; в тёмной — ноль);
    light — прямой свет лампы на стене;
    air   — свет, рассеянный дымкой в камеру.

  У основного VK свет белый. У сабрендов он окрашен в светлый акцент гайда;
  ядро выжигает экспозиция, и цвет живёт в спаде и в дымке.

  Выход — линейный HDR. Экспозиция, bloom, ACES и гамма — в composite.frag.
*/

in vec2 vUv;
out vec4 fragColor;

#define PI 3.14159265359

#define MODE_FULL 0
#define MODE_BASE 1
#define MODE_LIGHT 2
#define MODE_HAZE 3
#define MODE_STACK 5

uniform vec2  uResolution;
uniform int   uMode;
uniform float uFrame;
uniform float uTime;

uniform vec3  uLightPos;
uniform vec3  uLightDir;
uniform vec3  uLightColor;     // цвет света бренда, линейный, нормирован по яркости
uniform float uLightGain;
uniform float uLightRadius;
uniform float uConeHalf;
uniform float uConeSoft;      // 0 — резкий край, 1 — широкая полутень


uniform vec3  uAlbedo;
uniform vec3  uAmbient;
uniform float uRoughness;

uniform float uHazeDensity;
uniform float uHazeG;
uniform float uHazeDepth;
uniform int   uHazeSteps;
uniform float uNoiseAmount;
uniform float uNoiseScale;

uniform float uRays;          // 0 — сплошной луч, 1 — выраженные мягкие лучи
uniform float uRayCount;

uniform float uVignette;

// --- надпись -------------------------------------------------------------
uniform int       uTextOn;
uniform sampler2D uText;       // резкие белые буквы на прозрачном
uniform sampler2D uTextBlur1;  // та же надпись, гауссово размытие 1/3 радиуса
uniform sampler2D uTextBlur2;  // 2/3 радиуса
uniform sampler2D uTextBlur3;  // полный радиус
uniform vec2      uTextTexel;
uniform vec2      uTextHalf;   // половины блока надписи, доли короткой стороны
uniform float     uTextGlow;   // 1 — свечение есть (тёмная комната), 0 — нет

// --- шум ---------------------------------------------------------------

// Interleaved gradient noise (Jimenez): синий шум без текстуры, для джиттера марша.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// --- лучи ----------------------------------------------------------------

/*
  Мягкие лучи — неровная заслонка у самого прибора. Координата — угол поперёк
  оси в долях полуугла конуса, поэтому все точки одного луча лежат в плоскости
  через лампу, и на стене лучи веером сходятся к источнику.

  Рисунок — две октавы шума, а не синусы: шаг и яркость полос неровные, как у
  света сквозь листву или жалюзи с люфтом. Маска нормирована вокруг единицы —
  лучи перераспределяют свет, а не гасят кадр. С расстоянием контраст рисунка
  падает: многократное рассеяние затирает края, и лучи расплываются к концу.

  Время сдвигает рисунок медленно и с качанием — лучи переливаются, а не
  едут лентой.
*/
float rayMask(float x, float dist) {
  if (uRays <= 0.001) return 1.0;
  float drift = uTime * 0.045 + 0.35 * sin(uTime * 0.23);
  float u = x * uRayCount * 0.5 + drift;
  float n = 0.62 * vnoise1(u) + 0.38 * vnoise1(u * 2.13 + 7.7 - drift * 0.6);
  float shafts = 0.12 + 1.76 * smoothstep(0.22, 0.78, n);
  float contrast = exp(-0.28 * dist * dist);
  return mix(1.0, shafts, uRays * contrast);
}

// Освещённость от лампы в точке X (без косинуса поверхности).
vec3 spotLight(vec3 X, out vec3 L, out float dist) {
  vec3 toL = uLightPos - X;
  dist = length(toL);
  L = toL / max(dist, 1e-5);
  float r = uLightRadius;
  float atten = 1.0 / (dist * dist + r * r);

  vec3 D = uLightDir;
  vec3 d = -L;
  float tz = dot(d, D);
  vec3 side = normalize(cross(vec3(0.0, 0.0, 1.0), D) + vec3(1e-5, 0.0, 0.0));
  float across = dot(d, side);
  // atan2, а не acos: за спиной прибора угол продолжается за 90°, а не заворачивается
  float theta = atan(length(d - D * tz), tz);

  // Обобщённый гаусс: мягкость — это степень, а не ширина. Яркость центра не меняется.
  float w = max(uConeHalf + atan(r / max(dist, 1e-3)), 1e-3);
  float n = 1.0 + 4.0 * (1.0 - uConeSoft) * (1.0 - uConeSoft);
  float profile = exp(-0.693147 * pow(max(theta / w, 1e-4), 2.0 * n));

  float rays = rayMask(atan(across, max(tz, 1e-3)) / max(uConeHalf, 1e-3), dist);
  return uLightColor * (uLightGain * atten * profile * rays);
}

float hg(float cosA, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosA, 1e-4), 1.5));
}

// Вперёд — основной лепесток, назад — слабый: объём читается со всех сторон.
float phase(float cosA) {
  return mix(hg(cosA, uHazeG), hg(cosA, -0.35), 0.18);
}

/*
  Неоднородность среды: клубы дымки. Модуляция симметрична вокруг единицы,
  поэтому средняя плотность — и замкнутое пропускание до стены — те же.
  Время сносит поле медленно и в разные стороны по осям: дымка течёт.
*/
float density(vec3 X) {
  if (uNoiseAmount <= 0.001) return 1.0;
  float t = uTime;
  vec3 p = X * uNoiseScale + vec3(t * 0.11, -t * 0.045, t * 0.06);
  float n = 0.65 * vnoise3(p) + 0.35 * vnoise3(p * 2.07 + vec3(5.2, 1.3, 7.9) - t * 0.03);
  return max(1.0 + uNoiseAmount * 2.0 * (2.0 * n - 1.0), 0.0);
}

// Ослабление луча по пути от лампы: дальний конец темнеет и уходит в цвет среды.
vec3 beamTransmittance(float dist) {
  return exp(-vec3(uHazeDensity * 0.45 * dist));
}

float ggx(float NdotH, float a2) {
  float den = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * den * den);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 c = vUv - 0.5;
  if (aspect >= 1.0) c.x *= aspect; else c.y /= aspect;

  vec3 P = vec3(c, 0.0);
  const vec3 N = vec3(0.0, 0.0, 1.0);
  const vec3 V = vec3(0.0, 0.0, 1.0);

  // --- стена -------------------------------------------------------------
  vec3 L;
  float dist;
  vec3 E = spotLight(P, L, dist) * beamTransmittance(dist);
  float NdotL = max(L.z, 0.0);
  float a2 = pow(uRoughness, 4.0);
  vec3 H = normalize(L + V);
  float spec = ggx(max(H.z, 0.0), a2) * 0.04 * 0.25;
  vec3 lit = (uAlbedo / PI + spec) * NdotL * E;

  vec3 ambient = uAlbedo * uAmbient;

  /*
    Надпись — как в гайде «Работа со светом»: резкий белый слой букв поверх
    его же копии с Progressive Blur.

    Копия размыта настоящим гауссом (три радиуса готовит text.ts). Вдоль оси
    «дальний край → источник» размытие растёт от нуля до полного: у дальнего
    края копия совпадает с буквами и не видна, у источника — мягкий белый
    ореол. Ось берётся из положения лампы, поэтому свечение переезжает само.

    Лицо букв и ореол идут в альфу — мимо bloom: форма ровно как в гайде.
  */
  float textMask = 0.0;
  float textGlowA = 0.0;
  vec3 textLit = vec3(0.0);
  if (uTextOn == 1) {
    textMask = texture(uText, vUv).a;
    vec2 dirL = normalize(uLightPos.xy + vec2(1e-5));
    float extent = max(abs(dirL.x) * uTextHalf.x + abs(dirL.y) * uTextHalf.y, 1e-3);
    float along = clamp(0.5 + 0.5 * dot(c, dirL) / extent, 0.0, 1.0);
    // Progressive: 0 — резко (копия под буквами не видна), 3 — полный радиус.
    float level = along * 3.0;
    float b1 = texture(uTextBlur1, vUv).a;
    float b2 = texture(uTextBlur2, vUv).a;
    float b3 = texture(uTextBlur3, vUv).a;
    float blurred = level < 1.0 ? mix(textMask, b1, level)
                  : level < 2.0 ? mix(b1, b2, level - 1.0)
                                : mix(b2, b3, level - 2.0);
    // Копия того же белого, что буквы; видна только вокруг них.
    // Ореол яркий у края и быстро гаснет — узкое белое свечение, а не облако.
    // Сила тоже прогрессивная: к дальней половине надписи свечения нет вовсе,
    // буквы там просто резкие — как «2026» в гайде.
    float strength = smoothstep(0.35, 1.0, along);
    // Кривая с пологим началом: размытие хранится в 8 битах, и самые слабые
    // значения нельзя усиливать — иначе переход 0 → 1/255 виден как ступень.
    // Ореол лежит и под буквами: без вычитания маски у сглаженного края не
    // появляется тёмная обводка.
    textGlowA = uTextGlow * strength * pow(blurred, 1.35) * 2.3;
    if (textMask > 0.002) {
      vec3 Lt;
      float dt;
      vec3 Et = spotLight(vec3(c, 0.0), Lt, dt) * beamTransmittance(dt);
      textLit = vec3(0.85) / PI * max(Lt.z, 0.0) * Et * 0.25;
    }
  }

  // --- дымка -------------------------------------------------------------
  vec3 haze = vec3(0.0);
  vec3 T = vec3(1.0);
  if (uHazeDensity > 0.0001) {
    vec3 sigma = vec3(uHazeDensity * 0.6);
    float span = uHazeDepth;
    float dz = span / float(uHazeSteps);
    // Джиттер сдвигается по кадрам золотым сечением: накопление усредняет марш.
    float jitter = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803398875);
    T = exp(-sigma * span);

    if (uMode == MODE_FULL || uMode == MODE_HAZE) {
      vec3 tau = vec3(0.0);
      for (int s = 0; s < 256; ++s) {
        if (s >= uHazeSteps) break;
        vec3 X = vec3(c, span - (float(s) + jitter) * dz);
        float dn = uHazeDensity * density(X);

        vec3 Ls;
        float ds;
        vec3 Es = spotLight(X, Ls, ds) * beamTransmittance(ds);
        vec3 inscatter = Es * phase(Ls.z);

        // Пропускание интегрируется аналитически внутри шага — яркость
        // объёма не зависит от числа шагов превью и экспорта.
        vec3 ls = vec3(max(dn * 0.6, 1e-6));
        vec3 weight = dn * (1.0 - exp(-ls * dz)) / ls;
        haze += inscatter * weight * exp(-tau);
        tau += ls * dz;
        if (all(lessThan(exp(-tau), vec3(1e-4)))) break;
      }
    }
  }
  // Среда светится тем же общим светом, что и стена: на светлой комнате фон
  // остаётся ровно цветом гайда при любой плотности дымки.
  vec3 airlight = ambient * (1.0 - T);

  // --- спад от источника --------------------------------------------------
  float vig = 1.0;
  if (uVignette > 0.0001) {
    float r = length(c - uLightPos.xy);
    vig = mix(1.0, 1.0 / (1.0 + r * r * 0.55), uVignette);
  }

  vec3 base = ambient * T + airlight;
  // Лёгкий оттенок света бренда в ореоле.
  lit = mix(lit, textLit, textMask) + uLightColor * textGlowA * 0.06;
  lit *= T * vig;
  vec3 air = haze * vig;

  vec3 color;
  if (uMode == MODE_BASE) color = base;
  else if (uMode == MODE_LIGHT) color = lit;
  else if (uMode == MODE_HAZE) color = air;
  else if (uMode == MODE_STACK) color = base + lit;
  else color = base + lit + air;

  // Лицо надписи — часть прямого света: в слое фона его нет.
  // В альфе — ореол надписи мимо bloom. Сами буквы кладёт composite.frag
  // поверх готового кадра, по маске как по прозрачности.
  float face = (uMode == MODE_BASE || uMode == MODE_HAZE) ? 0.0 : textGlowA * T.g;
  fragColor = vec4(max(color, vec3(0.0)), face);
}
