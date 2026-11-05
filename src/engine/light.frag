#version 300 es
precision highp float;

/*
  Сцена Света: прожектор светит вскользь по стене сквозь дымку.

  Камера ортографическая и смотрит вдоль −Z, стена — плоскость z = 0. Кадр
  складывается из трёх слагаемых, которые же уходят в послойную выгрузку:

    base  — неосвещённая стена (общий свет светлой комнаты; в тёмной — ноль);
    light — прямой свет лампы на стене;
    air   — свет, рассеянный дымкой в камеру.

  Источников два, как на баннерах арт-директора: сама лампа (uKey) — узкий
  луч, падающий в кадр клином, — и ореол луча (uBounce) по той же оси,
  широкий и мягкий, без своего пятна. У VK луч почти белый, у сабрендов —
  цвета бренда; свечение источника у края почти белое у всех. В ч/б версии
  VK ореол слабый и белый.

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

// На стене рисунок лучей слабее, чем в воздухе.
#define WALL_RAYS 0.35

uniform vec2  uResolution;
uniform int   uMode;
uniform float uFrame;
uniform float uTime;

struct Lamp {
  vec3  pos;
  vec3  dir;
  vec3  color;     // линейный, нормирован по яркости
  float gain;
  float radius;    // размер излучателя: чем больше, тем мягче пятно у края
  float decay;     // затухание по пути: свет не доходит до дальнего края кадра
  float coneHalf;
  float edge;      // степень края конуса: 1 — гаусс, больше — резче, меньше — длинные хвосты
  float fan;       // раскрытие с расстоянием: за fanFrom конус шире на fan за единицу пути
  float fanFrom;
};
uniform Lamp uKey;
uniform Lamp uBounce;

// Свечение источника: мягкое круглое пятно прибора у края кадра.
uniform vec2  uGlowPos;
uniform vec3  uGlowColor;
uniform float uGlowGain;
uniform float uGlowRadius;

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
uniform vec2  uRayOrigin;     // проекция лампы на кадр: лучи расходятся из неё
uniform vec2  uRayAxis;       // направление луча в кадре

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
  Лучи — свет сквозь неровную заслонку у прибора, как сквозь листву или
  щели в ставнях. Лампа почти лежит на стене, поэтому на кадре каждый луч —
  прямая из проекции лампы. Координата рисунка — угол вокруг этой точки:
  и на стене, и в дымке луч лежит на одной прямой.

  Чтобы лучи читались как свет, а не как нарисованный гребень:
  — рисунок из трёх октав шума: пара сильных лучей, средние и тонкие
    волокна между ними, с неровным шагом и разной яркостью;
  — у источника тени заслонки резкие, дальше полутень растёт: край лучей
    расплывается, а тонкие волокна гаснут первыми;
  — каждый луч гаснет на своей длине: яркость вдоль луча плавает медленным
    шумом, как в неоднородной дымке, поэтому лучи разной длины;
  — у самого источника лучи сливаются в свечение;
  — маска нормирована вокруг единицы: лучи перераспределяют свет, а щели
    между ними не проваливаются в чёрное.
  На стене рисунок слабее, чем в воздухе: стена освещена ещё и светом дымки.

  Живой свет — как свет сквозь листву в дымке: рисунок не едет лентой,
  каждый луч живёт сам. Щель то раскрывается, то прикрывается, вразнобой с
  соседями; лучи чуть покачиваются — соседние вместе, как ветка; по лучу от
  источника идёт дымка, и свет вдоль него переливается. Всё это — отклонение
  от рисунка в нулевой момент, поэтому кадр в 0 совпадает со статикой.
*/

// Жизнь луча во времени: медленный шум по углу рисунка, ноль в момент 0.
float rayTime(float u, float t, float speed, float seed) {
  return vnoise3(vec3(u, t * speed, seed)) - vnoise3(vec3(u, 0.0, seed));
}

float rayMask(vec3 X, float weight) {
  if (uRays <= 0.001) return 1.0;
  vec2 rel = X.xy - uRayOrigin;
  float r = length(rel);
  float a = atan(uRayAxis.x * rel.y - uRayAxis.y * rel.x, dot(uRayAxis, rel));
  float t = uTime;
  // Качание: соседние лучи — вместе, медленно и чуть-чуть.
  float u = a * uRayCount + 0.5 * rayTime(a * uRayCount * 0.3, t, 0.18, 41.0);

  // Полутень: 0 у источника, 1 — далеко. Тонкие волокна гаснут первыми.
  float far = smoothstep(0.1, 1.6, r);
  float n = 0.6 * vnoise1(u)
          + 0.28 * vnoise1(u * 2.31 + 7.7)
          + 0.12 * (1.0 - far) * vnoise1(u * 5.7 + 3.1);
  n /= 0.88 + 0.12 * (1.0 - far);
  // Щель раскрывается и прикрывается: каждый луч в своём темпе.
  n += 0.6 * (0.65 * rayTime(u, t, 0.35, 3.7) + 0.35 * rayTime(u * 2.3 + 5.0, t, 0.8, 8.1));
  // Край тени: резкий у источника, мягкий вдали.
  float soft = mix(0.16, 0.42, far);
  float lit = smoothstep(0.5 - soft, 0.5 + soft, n);

  // Своя длина у каждого луча: яркость вдоль него плавает медленным шумом.
  // Дымка идёт по лучу от источника — свет вдоль него переливается.
  float along = vnoise3(vec3(u * 0.8 + 11.0, r * 1.3 - t * 0.2, 0.5 + t * 0.08));
  lit *= mix(0.55, 1.25, along);

  float shafts = mix(0.25, 1.75, lit);
  // У источника лучи сливаются в свечение, вдали — расплываются в дымке.
  float contrast = smoothstep(0.04, 0.45, r) * exp(-0.1 * r * r);
  return mix(1.0, shafts, uRays * contrast * weight);
}

// Освещённость от лампы в точке X (без косинуса поверхности).
// rays — сила рисунка лучей в этой точке: 0 — без лучей, 1 — в дымке.
vec3 lampAt(Lamp lamp, vec3 X, float rays, out vec3 L, out float dist) {
  vec3 toL = lamp.pos - X;
  dist = length(toL);
  L = toL / max(dist, 1e-5);
  float r = lamp.radius;
  // Обратные квадраты дают степенной хвост, и свет растекается по всему кадру.
  // На рефах спад экспоненциальный — свет гаснет по пути, как в плотном
  // воздухе, — поэтому сверху ещё exp(−decay·dist).
  float atten = exp(-lamp.decay * dist) / (dist * dist + r * r);

  vec3 D = lamp.dir;
  vec3 d = -L;
  float tz = dot(d, D);
  // atan2, а не acos: за спиной прибора угол продолжается за 90°, а не заворачивается
  float theta = atan(length(d - D * tz), tz);

  // Обобщённый гаусс: мягкость — это степень, а не ширина. Яркость центра не меняется.
  // Дальше входа в кадр луч расходится шире — ложится треугольником.
  float cone = lamp.coneHalf * (1.0 + lamp.fan * max(dist - lamp.fanFrom, 0.0));
  float w = max(cone + atan(r / max(dist, 1e-3)), 1e-3);
  float n = lamp.edge;
  // Раскрываясь, луч не прибавляет света, а расходится: тот же свет на большую ширину.
  float profile = exp(-0.693147 * pow(max(theta / w, 1e-4), 2.0 * n)) * lamp.coneHalf / max(cone, 1e-4);

  float mask = rays > 0.0 ? rayMask(X, rays) : 1.0;
  return lamp.color * (lamp.gain * atten * profile * mask);
}

float hg(float cosA, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosA, 1e-4), 1.5));
}

// Вперёд — основной лепесток, назад — слабый: объём читается со всех сторон.
float phase(float cosA) {
  return mix(hg(cosA, uHazeG), hg(cosA, -0.35), 0.18);
}

// Отлив приходит от большой стены, а не из точки: рассеяние почти изотропно.
float phaseSoft(float cosA) {
  return hg(cosA, 0.2);
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
  bool bounce = uBounce.gain > 0.0;
  vec3 L;
  float dist;
  vec3 E = lampAt(uKey, P, WALL_RAYS, L, dist) * beamTransmittance(dist);
  float NdotL = max(L.z, 0.0);
  float a2 = pow(uRoughness, 4.0);
  vec3 H = normalize(L + V);
  float spec = ggx(max(H.z, 0.0), a2) * 0.04 * 0.25;
  vec3 lit = (uAlbedo / PI + spec) * NdotL * E;
  if (bounce) {
    vec3 Lb;
    float db;
    vec3 Eb = lampAt(uBounce, P, 0.0, Lb, db) * beamTransmittance(db);
    lit += uAlbedo / PI * max(Lb.z, 0.0) * Eb;
  }

  vec3 ambient = uAlbedo * uAmbient;

  /*
    Надпись — как в баннерах арт-директора (Figma 16719:174708): резкий белый
    слой букв поверх его же копии с Progressive Blur.

    Копия размыта настоящим гауссом (три радиуса готовит text.ts). Вдоль оси
    «дальний край → источник» размытие растёт от нуля до полного: до середины
    надписи копия совпадает с буквами и не видна, у края со стороны света —
    тонкий яркий ореол. Начало и конец прогрессии — из макета (размытие 0 на
    0.49 этой оси, полное — на 0.91). Ось берётся из положения лампы, поэтому
    свечение переезжает само.

    Ореол идёт в альфу и кладётся в composite.frag обычным наложением белого,
    как слой в Figma, — без усиления и мимо bloom.
  */
  float textMask = 0.0;
  float textGlowA = 0.0;
  vec3 textLit = vec3(0.0);
  if (uTextOn == 1) {
    textMask = texture(uText, vUv).a;
    vec2 dirL = normalize(uKey.pos.xy + vec2(1e-5));
    float extent = max(abs(dirL.x) * uTextHalf.x + abs(dirL.y) * uTextHalf.y, 1e-3);
    float along = clamp(0.5 + 0.5 * dot(c, dirL) / extent, 0.0, 1.0);
    // Progressive: 0 — резко (копия под буквами не видна), 3 — полный радиус.
    float level = clamp((along - 0.49) / 0.42, 0.0, 1.0) * 3.0;
    float b1 = texture(uTextBlur1, vUv).a;
    float b2 = texture(uTextBlur2, vUv).a;
    float b3 = texture(uTextBlur3, vUv).a;
    float blurred = level < 1.0 ? mix(textMask, b1, level)
                  : level < 2.0 ? mix(b1, b2, level - 1.0)
                                : mix(b2, b3, level - 2.0);
    // Копия того же белого, что буквы, — её прозрачность и есть ореол.
    // Ореол лежит и под буквами: без вычитания маски у сглаженного края не
    // появляется тёмная обводка.
    textGlowA = uTextGlow * blurred;
    if (textMask > 0.002) {
      vec3 Lt;
      float dt;
      vec3 Et = lampAt(uKey, vec3(c, 0.0), WALL_RAYS, Lt, dt) * beamTransmittance(dt);
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
        vec3 Es = lampAt(uKey, X, 1.0, Ls, ds) * beamTransmittance(ds);
        vec3 inscatter = Es * phase(Ls.z);
        if (bounce) {
          vec3 Eb = lampAt(uBounce, X, 0.0, Ls, ds) * beamTransmittance(ds);
          inscatter += Eb * phaseSoft(Ls.z);
        }

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
    float r = length(c - uKey.pos.xy);
    vig = mix(1.0, 1.0 / (1.0 + r * r * 0.55), uVignette);
  }

  /*
    Свечение источника — как в макете баннера (Figma 16944:36): у края кадра
    круглое мягкое пятно самого прибора, из которого выходит луч. Это
    светящийся воздух у лампы, поэтому оно идёт в слой дымки. Спад гауссов:
    пятно компактное, без длинного хвоста вбок, и луч под ним остаётся уже.
  */
  if (uGlowGain > 0.0) {
    float q = length(c - uGlowPos) / uGlowRadius;
    haze += uGlowColor * (uGlowGain * exp(-q * q));
  }

  vec3 base = ambient * T + airlight;
  // Лёгкий оттенок света бренда в ореоле.
  lit = mix(lit, textLit, textMask);
  lit *= T * vig;
  vec3 air = haze * vig;

  vec3 color;
  if (uMode == MODE_BASE) color = base;
  else if (uMode == MODE_LIGHT) color = lit;
  else if (uMode == MODE_HAZE) color = air;
  else if (uMode == MODE_STACK) color = base + lit;
  else color = base + lit + air;

  // Лицо надписи — часть прямого света: в слое фона его нет.
  // В альфе — ореол надписи: composite.frag кладёт его и сами буквы поверх
  // готового кадра, как слои в Figma.
  float face = (uMode == MODE_BASE || uMode == MODE_HAZE) ? 0.0 : textGlowA * T.g;
  fragColor = vec4(max(color, vec3(0.0)), face);
}
