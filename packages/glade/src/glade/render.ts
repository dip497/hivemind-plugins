/**
 * The glade's renderer on WebGL2: the still layers and the sprite atlas as textures, the frame's
 * layers (four colour targets and a depth buffer) at the art's size, and the passes of shaders.ts in
 * order. It keeps everything sized to the art and the screen, and rebuilds only on a change of size
 * or glade; a frame is a handful of small passes and one upscale.
 */
import { BLUR_FS, BRIGHT_FS, LIGHT_FS, MAX_LIGHTS, QUAD_VS, SHOW_FS, SPRITE_FS, SPRITE_VS, STILL_FS, WATER_FS } from "./shaders";
import type { Painter } from "./px";

/** One sprite drawn: 16 floats, as SPRITE_VS reads them. */
export const SPRITE_FLOATS = 16;

/** What the light, water and show passes are told, frame by frame. */
export interface Scene {
  time: number;
  wind: number;
  lights: Float32Array; // MAX_LIGHTS × 8: x, h, z, reach, r, g, b, (unused)
  lightCount: number;
  sprites: Float32Array;
  spriteCount: number;
  ripples: Float32Array; // 4 × 4
  moonDir: [number, number, number];
  moon: [number, number, number];
  skyAmb: [number, number, number];
  groundAmb: [number, number, number];
  fog: [number, number, number];
  fogK: number; fogMax: number; mist: number; wet: number; rain: number; stillGlow: number;
  rainCol: [number, number, number];
  /** The sky's colour on the water, and how bright the moon's glints on it. */
  sheen: [number, number, number, number];
  skyLift: number; stars: number; skyMix: number;
  skyTop: [number, number, number]; skyBottom: [number, number, number];
  exposure: number; glow: number; vignette: number;
  /** The picture's lightness from lo to hi, and how much of its colour is kept: 0, 1, 1 for night. */
  lo: number; hi: number; chroma: number;
  paper: [number, number, number];
  theme: boolean; darkTheme: boolean;
  page: [number, number, number]; text: [number, number, number];
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture[]; w: number; h: number }

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly progs: Record<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }> = {};
  private still: WebGLTexture[] = [];
  private atlas: WebGLTexture[] = [];
  private layers?: Target & { depth: WebGLRenderbuffer };
  private lit?: Target;
  private water?: Target;
  private glow: Target[] = [];
  /** The finished picture at the art's size, scaled up to the screen by a blit. */
  private shown?: Target;
  private readonly vao: WebGLVertexArrayObject;
  private readonly spriteBuf: WebGLBuffer;
  private art = { w: 1, h: 1 };
  private readonly lightPos = new Float32Array(MAX_LIGHTS * 4);
  private readonly lightCol = new Float32Array(MAX_LIGHTS * 4);
  private screen = { w: 1, h: 1 };

  /** `keep` keeps the last frame in the canvas, for a harness that reads it back. */
  constructor(readonly canvas: HTMLCanvasElement, keep = false) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "low-power", preserveDrawingBuffer: keep });
    if (!gl) throw new Error("WebGL2 is not available");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets are not available");
    this.gl = gl;
    this.prog("still", QUAD_VS, STILL_FS);
    this.prog("sprite", SPRITE_VS, SPRITE_FS);
    this.prog("light", QUAD_VS, LIGHT_FS);
    this.prog("water", QUAD_VS, WATER_FS);
    this.prog("bright", QUAD_VS, BRIGHT_FS);
    this.prog("blur", QUAD_VS, BLUR_FS);
    this.prog("show", QUAD_VS, SHOW_FS);
    this.vao = gl.createVertexArray()!;
    this.spriteBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, SPRITE_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  private prog(name: string, vs: string, fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
    this.progs[name] = { p, u: new Map() };
  }

  private use(name: string) {
    const pr = this.progs[name]!;
    this.gl.useProgram(pr.p);
    return (u: string) => {
      if (!pr.u.has(u)) pr.u.set(u, this.gl.getUniformLocation(pr.p, u));
      return pr.u.get(u)!;
    };
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView | null, filter: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** A painter's four layers as textures. */
  private upload(p: Painter, old: WebGLTexture[]) {
    const gl = this.gl;
    for (const t of old) gl.deleteTexture(t);
    return [
      this.texture(p.w, p.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, p.alb, gl.NEAREST),
      this.texture(p.w, p.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, p.nrm, gl.NEAREST),
      this.texture(p.w, p.h, gl.RGBA32F, gl.RGBA, gl.FLOAT, p.dat, gl.NEAREST),
      this.texture(p.w, p.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, p.emi, gl.NEAREST),
    ];
  }

  private target(w: number, h: number, formats: [number, number, number][], filter: number, old?: Target): Target {
    const gl = this.gl;
    if (old) { gl.deleteFramebuffer(old.fb); for (const t of old.tex) gl.deleteTexture(t); }
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = formats.map(([internal, format, type], i) => {
      const t = this.texture(w, h, internal, format, type, null, filter);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      return t;
    });
    gl.drawBuffers(formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return { fb, tex, w, h };
  }

  /** The art's still layers and the sprite atlas; the targets sized to the art. */
  setArt(still: Painter, atlas: Painter) {
    const gl = this.gl;
    this.still = this.upload(still, this.still);
    if (!this.atlas.length) this.atlas = this.upload(atlas, []);
    if (this.art.w !== still.w || this.art.h !== still.h || !this.layers) {
      this.art = { w: still.w, h: still.h };
      const { w, h } = this.art;
      const old = this.layers;
      if (old) gl.deleteRenderbuffer(old.depth);
      const t = this.target(w, h, [[gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE], [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE], [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT], [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]], gl.NEAREST, old);
      const depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      this.layers = { ...t, depth };
      this.lit = this.target(w, h, [[gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]], gl.NEAREST, this.lit);
      this.water = this.target(w, h, [[gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]], gl.NEAREST, this.water);
      this.shown = this.target(w, h, [[gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE]], gl.NEAREST, this.shown);
      const half = [Math.ceil(w / 2), Math.ceil(h / 2)], quarter = [Math.ceil(w / 4), Math.ceil(h / 4)];
      const old2 = this.glow;
      this.glow = [half, half, quarter, quarter].map(([gw, gh], i) => this.target(gw!, gh!, [[gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]], gl.LINEAR, old2[i]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.screen = { w, h };
  }

  private quad() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }
  private bind(textures: WebGLTexture[], names: string[], u: (n: string) => WebGLUniformLocation | null) {
    const gl = this.gl;
    textures.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u(names[i]!), i);
    });
  }

  /** Wait until the frame is drawn (for timing it). */
  finish() { const px = new Uint8Array(4); this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px); }

  draw(s: Scene) {
    const gl = this.gl, L = this.layers!, { w, h } = this.art, zMax = h * 2 + 64;
    // The frame's layers: the still ones, then the sprites by depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    let u = this.use("still");
    this.bind(this.still, ["sAlb", "sNrm", "sDat", "sEmi"], u);
    gl.uniform1f(u("uTime"), s.time);
    gl.uniform1f(u("uWind"), s.wind);
    gl.uniform2i(u("uSize"), w, h);
    gl.uniform1f(u("uZMax"), zMax);
    this.quad();
    if (s.spriteCount) {
      gl.depthFunc(gl.LEQUAL);
      u = this.use("sprite");
      this.bind(this.atlas, ["aAlb", "aNrm", "aDat", "aEmi"], u);
      gl.uniform2f(u("uSize"), w, h);
      gl.uniform1f(u("uZMax"), zMax);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.sprites.subarray(0, s.spriteCount * SPRITE_FLOATS), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.spriteCount);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.DEPTH_TEST);

    // Lit.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lit!.fb);
    u = this.use("light");
    this.bind(L.tex, ["gAlb", "gNrm", "gDat", "gEmi"], u);
    const pos = this.lightPos, col = this.lightCol;
    for (let i = 0; i < s.lightCount; i++) {
      pos.set(s.lights.subarray(i * 8, i * 8 + 4), i * 4);
      col.set(s.lights.subarray(i * 8 + 4, i * 8 + 8), i * 4);
    }
    gl.uniform1i(u("uLights"), s.lightCount);
    gl.uniform4fv(u("uLightPos"), pos);
    gl.uniform4fv(u("uLightCol"), col);
    gl.uniform3fv(u("uMoonDir"), s.moonDir);
    gl.uniform3fv(u("uMoon"), s.moon);
    gl.uniform3fv(u("uSkyAmb"), s.skyAmb);
    gl.uniform3fv(u("uGroundAmb"), s.groundAmb);
    gl.uniform3fv(u("uFog"), s.fog);
    gl.uniform3fv(u("uSkyTop"), s.skyTop);
    gl.uniform3fv(u("uSkyBottom"), s.skyBottom);
    gl.uniform1f(u("uFogK"), s.fogK);
    gl.uniform1f(u("uFogMax"), s.fogMax);
    gl.uniform1f(u("uMist"), s.mist);
    gl.uniform1f(u("uWet"), s.wet);
    gl.uniform1f(u("uStillGlow"), s.stillGlow);
    gl.uniform1f(u("uTime"), s.time);
    gl.uniform1f(u("uZFront"), h * 2);
    gl.uniform1f(u("uSkyLift"), s.skyLift);
    gl.uniform1f(u("uStars"), s.stars);
    gl.uniform1f(u("uSkyMix"), s.skyMix);
    gl.uniform1i(u("uRows"), h);
    this.quad();

    // The pond's mirror, and rain.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.water!.fb);
    u = this.use("water");
    this.bind([this.lit!.tex[0]!, L.tex[2]!], ["tLit", "gDat"], u);
    gl.uniform1f(u("uTime"), s.time);
    gl.uniform1f(u("uRain"), s.rain);
    gl.uniform4fv(u("uRipples"), s.ripples);
    gl.uniform2i(u("uSize"), w, h);
    gl.uniform3fv(u("uRainCol"), s.rainCol);
    gl.uniform4fv(u("uSheen"), s.sheen);
    this.quad();

    // The glow: bright parts at half size, blurred; again at a quarter.
    const [g1, g1b, g2, g2b] = this.glow as [Target, Target, Target, Target];
    const pass = (dst: Target, prog: string, src: WebGLTexture, set: (u: (n: string) => WebGLUniformLocation | null) => void) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      const uu = this.use(prog);
      this.bind([src], ["tSrc"], uu);
      set(uu);
      this.quad();
    };
    pass(g1, "bright", this.water!.tex[0]!, (uu) => { gl.uniform2f(uu("uTexel"), 1 / w, 1 / h); gl.uniform1f(uu("uThreshold"), 0.22); });
    pass(g1b, "blur", g1.tex[0]!, (uu) => gl.uniform2f(uu("uStep"), 1 / g1.w, 0));
    pass(g1, "blur", g1b.tex[0]!, (uu) => gl.uniform2f(uu("uStep"), 0, 1 / g1.h));
    pass(g2, "blur", g1.tex[0]!, (uu) => gl.uniform2f(uu("uStep"), 1 / g1.w, 0));
    pass(g2b, "blur", g2.tex[0]!, (uu) => gl.uniform2f(uu("uStep"), 1.5 / g2.w, 0));
    pass(g2, "blur", g2b.tex[0]!, (uu) => gl.uniform2f(uu("uStep"), 0, 1.5 / g2.h));

    // The finished picture, at the art's size; then up to the screen, each art pixel a block.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shown!.fb);
    gl.viewport(0, 0, w, h);
    u = this.use("show");
    this.bind([this.water!.tex[0]!, g1.tex[0]!, g2.tex[0]!], ["tArt", "tGlow1", "tGlow2"], u);
    gl.uniform2f(u("uArt"), w, h);
    gl.uniform1f(u("uExposure"), s.exposure);
    gl.uniform1f(u("uGlow"), s.glow);
    gl.uniform1f(u("uLo"), s.lo);
    gl.uniform1f(u("uHi"), s.hi);
    gl.uniform1f(u("uChroma"), s.chroma);
    gl.uniform1f(u("uVignette"), s.vignette);
    gl.uniform3fv(u("uPaper"), s.paper);
    gl.uniform1f(u("uTheme"), s.theme ? 1 : 0);
    gl.uniform1f(u("uDarkTheme"), s.darkTheme ? 1 : 0);
    gl.uniform3fv(u("uPage"), s.page);
    gl.uniform3fv(u("uText"), s.text);
    this.quad();
    // The art's rows run top down, the canvas's bottom up: the blit turns it over.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.shown!.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, this.screen.h, this.screen.w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }
}
