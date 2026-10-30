/** Owns a texture and framebuffer. Construction and resize failures free both. */
export class Fbo {
  readonly tex: WebGLTexture;
  readonly fb: WebGLFramebuffer;
  width = 0;
  height = 0;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    private readonly internalFormat: number,
    private readonly type: number,
  ) {
    const tex = gl.createTexture(),
      fb = gl.createFramebuffer();
    if (!tex || !fb) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fb);
      throw new Error('Недостаточно памяти видеокарты. Уменьшите разрешение.');
    }
    this.tex = tex;
    this.fb = fb;
    try {
      this.resize(width, height);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  resize(width: number, height: number) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return this;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      this.type,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error(
        'Не удалось создать буфер кадра. Уменьшите разрешение или перезапустите сцену. Код: 0x' +
          status.toString(16),
      );
    this.width = width;
    this.height = height;
    return this;
  }
  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb);
    this.gl.viewport(0, 0, this.width, this.height);
    return this;
  }
  dispose() {
    this.gl.deleteTexture(this.tex);
    this.gl.deleteFramebuffer(this.fb);
  }
}
