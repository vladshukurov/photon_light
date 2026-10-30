/** Owns one linked program and caches active uniform locations. */
function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Не удалось выделить память для шейдера ${name}.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Шейдер ${name} не собрался:\n${log}`);
  }
  return shader;
}
export class Program {
  private readonly handle: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private unit = 0;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertex: string,
    fragment: string,
    name: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${name}.vert`);
    let fs: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    try {
      fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${name}.frag`);
      program = gl.createProgram();
      if (!program) throw new Error(`Не удалось создать программу ${name}.`);
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`Программа ${name} не слинковалась:\n${gl.getProgramInfoLog(program)}`);
      this.handle = program;
    } catch (e) {
      gl.deleteProgram(program);
      throw e;
    } finally {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    }
  }
  dispose() {
    this.gl.deleteProgram(this.handle);
  }
  use() {
    this.gl.useProgram(this.handle);
    this.unit = 0;
    return this;
  }
  private loc(name: string) {
    if (!this.locations.has(name))
      this.locations.set(name, this.gl.getUniformLocation(this.handle, name));
    return this.locations.get(name) ?? null;
  }
  int(name: string, value: number) {
    this.gl.uniform1i(this.loc(name), value);
    return this;
  }
  float(name: string, value: number) {
    this.gl.uniform1f(this.loc(name), value);
    return this;
  }
  vec2(name: string, x: number, y: number) {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }
  vec3(name: string, x: number, y: number, z: number) {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }
  floats(name: string, values: Float32List) {
    this.gl.uniform1fv(this.loc(name), values);
    return this;
  }
  ints(name: string, values: Int32List) {
    this.gl.uniform1iv(this.loc(name), values);
    return this;
  }
  vec3s(name: string, values: Float32List) {
    this.gl.uniform3fv(this.loc(name), values);
    return this;
  }
  texture(name: string, texture: WebGLTexture) {
    const location = this.loc(name);
    if (location === null) return this;
    const unit = this.unit++;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(location, unit);
    return this;
  }
}
