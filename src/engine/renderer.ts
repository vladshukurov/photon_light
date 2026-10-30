import type { Scene } from '../domain/scene';
import { Program } from './program';
import { Fbo } from './fbo';
import { TextTexture } from './text';
import quadSource from './quad.vert?raw';
import lightSource from './light.frag?raw';
import downSource from './bloom_down.frag?raw';
import upSource from './bloom_up.frag?raw';
import compositeSource from './composite.frag?raw';
import accumSource from './accumulate.frag?raw';

/*
  Цепочка bloom живёт на СВОЁМ фиксированном разрешении, не на разрешении
  кадра. Фиксированного числа уровней мало: на мелких уровнях целочисленное
  деление ломает пропорции по-разному (960x540 даёт 15x8, а 3840x2160 —
  60x33), и превью расходится с экспортом сильнее всего у краёв кадра.
  При фиксированной базе цепочка побитово одинакова на любом разрешении,
  а экспорт в 4K вдобавок становится дешевле.

  До базы кадр доводится последовательными уменьшениями вдвое — иначе
  прыжок с 3840 сразу на 512 даст алиасинг на ярких деталях.
*/
const BLOOM_LEVELS = 6;
const BLOOM_BASE = 512;

function bloomBase(w: number, h: number) {
  const a = w / h;
  return w >= h
    ? [BLOOM_BASE, Math.max(2, Math.round(BLOOM_BASE / a))]
    : [Math.max(2, Math.round(BLOOM_BASE * a)), BLOOM_BASE];
}

const MODES = { full: 0, base: 1, light: 2, haze: 3, stack: 5 };

// Столько итераций развёрнуто в марше шейдера. Больше запрашивать нельзя:
// шаг считается как глубина / steps, и недошедший до стены марш молча темнеет.
const MAX_HAZE_STEPS = 256;

// --- рендерер ----------------------------------------------------------

export interface RenderOptions {
  mode?: keyof typeof MODES;
  hazeSteps?: number;
  target?: Fbo;
  frame?: number;
  alpha?: number;
  tonemap?: boolean;
  time?: number;
}
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject | null;
  size: [number, number] = [0, 0];
  private pScene!: Program;
  private text!: TextTexture;
  private hasText = false;
  private pDown!: Program;
  private pUp!: Program;
  private pComposite!: Program;
  private pAccum!: Program;
  private scene!: Fbo;
  private sceneFbo!: Fbo;
  private hist: Fbo[] = [];
  private histIdx = 0;
  private pre: Fbo[] = [];
  private preSteps = 0;
  private mips: Fbo[] = [];
  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 недоступен в этом браузере.');
    this.gl = gl;

    // RGBA16F как цель рендера требует расширения.
    const floatExt =
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    if (!floatExt) {
      throw new Error(
        'Нет EXT_color_buffer_float: RGBA16F-буфер недоступен, HDR-конвейер не соберётся.',
      );
    }
    gl.getExtension('OES_texture_float_linear');

    this.vao = gl.createVertexArray();
    this.size = [0, 0];
  }

  init() {
    const [vert, scene, down, up, composite, accum] = [
      quadSource,
      lightSource,
      downSource,
      upSource,
      compositeSource,
      accumSource,
    ];
    const gl = this.gl;
    this.pScene = new Program(gl, vert, scene, 'light');
    this.text = new TextTexture(gl);
    this.pDown = new Program(gl, vert, down, 'bloom_down');
    this.pUp = new Program(gl, vert, up, 'bloom_up');
    this.pComposite = new Program(gl, vert, composite, 'composite');
    this.pAccum = new Program(gl, vert, accum, 'accumulate');

    this.scene = new Fbo(gl, 4, 4, gl.RGBA16F, gl.HALF_FLOAT);
    // Пинг-понг для накопления: читать и писать одну текстуру нельзя.
    this.hist = [];
    this.hist.push(new Fbo(gl, 4, 4, gl.RGBA16F, gl.HALF_FLOAT));
    this.hist.push(new Fbo(gl, 4, 4, gl.RGBA16F, gl.HALF_FLOAT));
    this.histIdx = 0;
    // То, что читают bloom и композит. Без накопления это сам scene.
    this.sceneFbo = this.scene;
    this.pre = [];
    this.preSteps = 0;
    this.mips = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.mips.push(new Fbo(gl, 4, 4, gl.RGBA16F, gl.HALF_FLOAT));
    }
    return this;
  }

  private resize(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h) return;
    const gl = this.gl;
    this.size = [w, h];
    this.scene.resize(w, h);

    const [bw, bh] = bloomBase(w, h);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.mips[i].resize(
        Math.max(2, Math.round(bw / Math.pow(2, i))),
        Math.max(2, Math.round(bh / Math.pow(2, i))),
      );
    }

    // ступени уменьшения вдвое от кадра до базы цепочки
    const steps = [];
    let cw = w,
      ch = h;
    while (cw > bw * 2 && ch > bh * 2) {
      cw = Math.max(1, cw >> 1);
      ch = Math.max(1, ch >> 1);
      steps.push([cw, ch]);
    }
    while (this.pre.length < steps.length) {
      this.pre.push(new Fbo(gl, 4, 4, gl.RGBA16F, gl.HALF_FLOAT));
    }
    steps.forEach(([sw, sh], i) => this.pre[i].resize(sw, sh));
    this.preSteps = steps.length;
  }

  private draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private scenePass(
    p: Scene,
    w: number,
    h: number,
    mode: keyof typeof MODES,
    hazeSteps: number,
    opts: RenderOptions,
  ) {
    const gl = this.gl;
    const { light, haze } = p;
    const hasText = this.text.update(p.text.content, p.text.size, w, h);
    this.hasText = hasText;
    this.scene.bind();
    this.pScene
      .use()
      .vec2('uResolution', w, h)
      .int('uMode', MODES[mode])
      .float('uFrame', opts.frame ?? 0)
      .float('uTime', opts.time ?? p.time)
      .vec3('uLightPos', ...light.pos)
      .vec3('uLightDir', ...light.dir)
      .vec3('uLightColor', ...light.color)
      .float('uLightGain', light.gain)
      .float('uLightRadius', light.radius)
      .float('uConeHalf', light.coneHalf)
      .float('uConeSoft', light.softness)
      .vec3('uAlbedo', ...p.albedo)
      .vec3('uAmbient', ...p.ambient)
      .float('uRoughness', p.roughness)
      .float('uHazeDensity', haze.density)
      .float('uHazeG', haze.g)
      .float('uHazeDepth', haze.depth)
      .int('uHazeSteps', hazeSteps)
      .float('uNoiseAmount', haze.noise)
      .float('uNoiseScale', haze.noiseScale)
      .float('uRays', p.rays.amount)
      .float('uRayCount', p.rays.count)
      .float('uVignette', p.vignette)
      .int('uTextOn', hasText ? 1 : 0)
      .texture('uText', this.text.tex)
      .vec2('uTextTexel', 1 / w, 1 / h)
      .texture('uTextBlur1', this.text.blurred[0])
      .texture('uTextBlur2', this.text.blurred[1])
      .texture('uTextBlur3', this.text.blurred[2])
      .vec2('uTextHalf', ...this.text.layout.half)
      .float('uTextGlow', p.text.glow);
    gl.disable(gl.BLEND);
    this.draw();
  }

  private bloomPass(p: Scene) {
    const gl = this.gl;
    if (p.bloom.intensity <= 0.0001) {
      // всё равно нужен чистый буфер, чтобы композит не читал мусор
      this.mips[0].bind();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return this.mips[0];
    }

    let src = this.sceneFbo;
    // доводим кадр до базы цепочки без порога — это чистое усреднение
    for (let i = 0; i < this.preSteps; i++) {
      const dst = this.pre[i];
      dst.bind();
      this.pDown
        .use()
        .texture('uSrc', src.tex)
        .vec2('uTexel', 1 / src.width, 1 / src.height)
        .int('uPrefilter', 0);
      this.draw();
      src = dst;
    }
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const dst = this.mips[i];
      dst.bind();
      this.pDown
        .use()
        .texture('uSrc', src.tex)
        .vec2('uTexel', 1 / src.width, 1 / src.height)
        .int('uPrefilter', i === 0 ? 1 : 0)
        .float('uThreshold', p.bloom.threshold)
        .float('uKnee', Math.max(0.05, p.bloom.threshold * 0.5));
      this.draw();
      src = dst;
    }

    // апсэмпл с аддитивным смешением, радиус — в UV
    const radius = 0.0015 + p.bloom.radius * 0.01;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const dst = this.mips[i - 1];
      dst.bind();
      this.pUp.use().texture('uSrc', this.mips[i].tex).float('uRadius', radius);
      this.draw();
    }
    gl.disable(gl.BLEND);
    return this.mips[0];
  }

  private compositePass(
    p: Scene,
    w: number,
    h: number,
    bloomTex: WebGLTexture,
    target: Fbo | null,
    tonemap = true,
    textFace = false,
  ) {
    const gl = this.gl;
    if (target) {
      target.bind();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    this.pComposite
      .use()
      .texture('uScene', this.sceneFbo.tex)
      .texture('uBloom', bloomTex)
      .float('uBloomIntensity', p.bloom.intensity)
      .float('uGrain', p.grain)
      .vec2('uResolution', w, h)
      .float('uGrainScale', h / 1080)
      .float('uSeed', p.seed)
      .float('uSaturation', p.saturation)
      .int('uTonemap', tonemap ? 1 : 0)
      .texture('uText', this.text.tex)
      .int('uTextFace', textFace ? 1 : 0);
    gl.disable(gl.BLEND);
    this.draw();
  }

  /*
    Смешивает свежий кадр с историей и отдаёт буфер, который дальше читают
    bloom и композит. alpha = 1 отбрасывает историю целиком — с этого начинается
    любое накопление, потому что в буфере до первого кадра лежит мусор.
  */
  private accumPass(alpha: number) {
    /*
      Буферы истории заводятся по требованию, а не на каждом ресайзе. Без этого
      обычный экспорт в 4K тащил бы за собой две лишние RGBA16F-текстуры по
      66 МБ, которые ему не нужны вовсе: накопления там нет.

      История после смены размера — мусор, но это безопасно: накопление всегда
      начинается с alpha = 1, а любое изменение размера идёт через layout(),
      который выставляет dirty и обнуляет счётчик кадров.
    */
    const [w, h] = this.size;
    if (this.hist[0].width !== w || this.hist[0].height !== h) {
      this.hist[0].resize(w, h);
      this.hist[1].resize(w, h);
    }
    const dst = this.hist[this.histIdx ^ 1];
    dst.bind();
    this.pAccum
      .use()
      .texture('uCurrent', this.scene.tex)
      .texture('uHistory', this.hist[this.histIdx].tex)
      .float('uAlpha', alpha);
    this.gl.disable(this.gl.BLEND);
    this.draw();
    this.histIdx ^= 1;
    return dst;
  }

  /**
   * Полный кадр.
   * @param opts.mode      full | base | light | haze | stack
   * @param opts.hazeSteps число шагов марша
   * @param opts.target    Fbo или null (тогда — в канвас)
   * @param opts.frame     номер кадра: сдвигает джиттер марша
   * @param opts.alpha     доля свежего кадра при накоплении; без неё накопления нет
   */
  render(p: Scene, w: number, h: number, opts: RenderOptions = {}) {
    const mode = opts.mode || 'full';
    /*
      Цикл марша в шейдере ограничен 256 итерациями — иначе его не развернуть.
      Шаг при этом считается как span / steps, поэтому запрос БОЛЬШЕ 256 не
      «точнее»: цикл обрывается на 256-й, а до стены остаётся непройденный
      кусок, и кадр молча темнеет. Ограничиваем здесь, а не оставляем ловушку.
    */
    const steps = Math.max(1, Math.min(Math.floor(opts.hazeSteps || 32), MAX_HAZE_STEPS));
    this.resize(w, h);
    this.scenePass(p, w, h, mode, steps, opts);
    // Экспорт и замер пика идут без накопления: им нужен один честный кадр,
    // а не среднее по истории, которой у них нет.
    this.sceneFbo = opts.alpha == null ? this.scene : this.accumPass(opts.alpha);
    const bloomTex = this.bloomPass(p).tex;
    const face = this.hasText && (mode === 'full' || mode === 'light' || mode === 'stack');
    this.compositePass(p, w, h, bloomTex, opts.target ?? null, opts.tonemap !== false, face);
  }

  dispose() {
    for (const p of [this.pScene, this.pDown, this.pUp, this.pComposite, this.pAccum]) p?.dispose();
    this.text?.dispose();
    for (const f of [this.scene, ...(this.hist || []), ...(this.pre || []), ...(this.mips || [])])
      f?.dispose();
    this.gl.deleteVertexArray(this.vao);
  }

  readPixels(fbo: Fbo) {
    const gl = this.gl;
    const px = new Uint8Array(fbo.width * fbo.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }
}
