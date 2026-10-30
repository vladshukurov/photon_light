/*
  Маска надписи для шейдера.

  Надпись растеризуется в размер кадра: белые буквы на прозрачном, VK Sans
  Display Condensed, по центру. У текстуры есть mip-уровни — шейдер читает
  размытые уровни как карту высот и строит по ним рельеф букв, так что
  отдельный проход размытия не нужен.

  Перерисовывается только при смене текста, размера или разрешения.
*/

export const TEXT_FONT_FAMILY = 'VK Sans Display Condensed';
const font = (px: number) => `600 ${px}px "${TEXT_FONT_FAMILY}"`;

/** Что шейдеру нужно знать о надписи, кроме маски. */
export interface TextLayout {
  /** Половины ширины и высоты блока надписи в долях короткой стороны кадра. */
  half: [number, number];
  /** Кегль в пикселях текстуры — от него считается радиус свечения. */
  px: number;
}

export class TextTexture {
  readonly tex: WebGLTexture;
  private key = '';
  layout: TextLayout = { half: [0, 0], px: 1 };
  private readonly canvas = document.createElement('canvas');

  constructor(private readonly gl: WebGL2RenderingContext) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('Недостаточно памяти видеокарты.');
    this.tex = tex;
    this.upload(1, 1);
  }

  /** Возвращает true, если в кадре есть надпись. */
  update(content: string, size: number, width: number, height: number): boolean {
    if (!content) return false;
    // Шрифт мог догрузиться после первой отрисовки — тогда маску надо пересобрать.
    const ready = typeof document.fonts?.check === 'function' && document.fonts.check(font(32));
    const key = `${content}|${size}|${width}x${height}|${ready}`;
    if (key === this.key) return true;
    this.key = key;

    const c = this.canvas;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, width, height);
    const px = Math.max(8, Math.round(size * Math.min(width, height)));
    ctx.font = font(px);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = content.split('\n');
    const lead = px * 0.92;
    // Надпись не шире 86% кадра: длинная строка ужимается целиком.
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
    const fit = Math.min(1, (width * 0.86) / widest);
    if (fit < 1) ctx.font = font(Math.round(px * fit));
    const top = height / 2 - ((lines.length - 1) * lead * Math.min(1, fit)) / 2;
    lines.forEach((l, i) => ctx.fillText(l, width / 2, top + i * lead * Math.min(1, fit)));
    const short = Math.min(width, height);
    this.layout = {
      half: [(widest * fit) / 2 / short, (lines.length * lead * fit) / 2 / short],
      px: px * fit,
    };
    this.upload(width, height, c);
    return true;
  }

  private upload(width: number, height: number, source?: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  dispose() {
    this.gl.deleteTexture(this.tex);
  }
}
