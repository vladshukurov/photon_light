/*
  Надпись для шейдера: резкая маска и три размытые копии.

  Так же, как в баннерах арт-директора (Figma 16719:174708): верхний слой букв
  резкий, под ним — та же надпись, размытая Progressive Blur'ом. Копии размыты
  настоящим гауссовым blur() канваса с тремя радиусами; шейдер плавно
  переходит между резкой маской и сильным размытием вдоль оси к источнику.

  Набор — как в макете: VK Sans Display Condensed Medium, трекинг −4%,
  интерлиньяж 87%.

  Радиусы заданы в долях кегля, поэтому свечение одинаково на холсте, в
  миниатюрах и в экспорте 4K. Перерисовка — только при смене текста, размера
  или разрешения.
*/

export const TEXT_FONT_FAMILY = 'VK Sans Display Condensed';
export const TEXT_FONT_WEIGHT = 500;
const font = (px: number) => `${TEXT_FONT_WEIGHT} ${px}px "${TEXT_FONT_FAMILY}"`;
const TRACKING = -0.04;
const LEADING = 0.87;

/*
  document.fonts.check() отвечает «да», если подходящий шрифт вообще не
  объявлен, — и маска навсегда запоминалась нарисованной системным шрифтом.
  Поэтому проверяется именно загруженное начертание VK Sans Condensed, а
  загрузка запускается, если её ещё не было.
*/
function fontLoaded() {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return true;
  for (const f of fonts)
    if (
      f.family.replace(/["']/g, '') === TEXT_FONT_FAMILY &&
      f.weight === String(TEXT_FONT_WEIGHT) &&
      f.status === 'loaded'
    )
      return true;
  void fonts.load(font(32)).catch(() => {});
  return false;
}

/*
  Радиус сильного размытия в долях кегля. В макете Layer Blur 19.4 при кегле
  140; радиус Figma — это примерно две сигмы гаусса, а blur() канваса
  принимает сигму.
*/
const BLUR_OF_FONT = 19.4 / 140 / 2;
const LEVELS = [1 / 3, 2 / 3, 1];

/** Что шейдеру нужно знать о надписи, кроме текстур. */
export interface TextLayout {
  /** Половины ширины и высоты блока надписи в долях короткой стороны кадра. */
  half: [number, number];
}

export class TextTexture {
  /** Резкая маска и три копии с растущим размытием. */
  readonly tex: WebGLTexture;
  readonly blurred: WebGLTexture[];
  layout: TextLayout = { half: [0, 0] };
  private key = '';
  private readonly sharp = document.createElement('canvas');
  private readonly soft = document.createElement('canvas');

  constructor(private readonly gl: WebGL2RenderingContext) {
    const make = () => {
      const t = gl.createTexture();
      if (!t) throw new Error('Недостаточно памяти видеокарты.');
      return t;
    };
    this.tex = make();
    this.blurred = LEVELS.map(make);
    for (const t of [this.tex, ...this.blurred]) this.upload(t);
  }

  /** Возвращает true, если в кадре есть надпись. */
  update(content: string, size: number, width: number, height: number): boolean {
    if (!content) return false;
    // Шрифт мог догрузиться после первой отрисовки — тогда маску надо пересобрать.
    const ready = fontLoaded();
    const key = `${content}|${size}|${width}x${height}|${ready}`;
    if (key === this.key) return true;
    this.key = key;

    const c = this.sharp;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, width, height);
    const short = Math.min(width, height);
    let px = Math.max(8, Math.round(size * short));
    const setFont = (size: number) => {
      ctx.font = font(size);
      // Трекинг макета; там, где canvas его не умеет, буквы чуть шире.
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(TRACKING * size).toFixed(2)}px`;
    };
    setFont(px);
    const lines = content.split('\n');
    // Надпись не шире 86% кадра: длинная строка ужимается целиком.
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
    const fit = Math.min(1, (width * 0.86) / widest);
    px = Math.max(8, Math.round(px * fit));
    const lead = px * LEADING;
    setFont(px);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const top = height / 2 - ((lines.length - 1) * lead) / 2;
    lines.forEach((l, i) => ctx.fillText(l, width / 2, top + i * lead));
    this.layout = {
      half: [(widest * fit) / 2 / short, (lines.length * lead) / 2 / short],
    };
    this.upload(this.tex, c);

    const radius = px * BLUR_OF_FONT;
    LEVELS.forEach((k, i) => this.upload(this.blurred[i], this.blur(c, radius * k)));
    return true;
  }

  /** Гауссово размытие маски. Без canvas filter — через уменьшение и плавное увеличение. */
  private blur(src: HTMLCanvasElement, radius: number) {
    const out = this.soft;
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.clearRect(0, 0, out.width, out.height);
    // Safari до 18 не умеет canvas filter — там размытие делается масштабированием.
    const hasFilter = typeof (ctx as { filter?: unknown }).filter === 'string';
    if (hasFilter) {
      ctx.filter = `blur(${radius.toFixed(1)}px)`;
      ctx.drawImage(src, 0, 0);
      ctx.filter = 'none';
    } else {
      const k = Math.max(1, radius / 2);
      const w = Math.max(1, Math.round(src.width / k)),
        h = Math.max(1, Math.round(src.height / k));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.drawImage(out, 0, 0, w, h, 0, 0, out.width, out.height);
    }
    return out;
  }

  private upload(tex: WebGLTexture, source?: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  dispose() {
    for (const t of [this.tex, ...this.blurred]) this.gl.deleteTexture(t);
  }
}
