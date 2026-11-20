import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  low: { scale: 0.85, maxDpr: 1.25, ao: false, shadow: 1024, bloom: true, fxaa: true, lensflare: false, shadowSoft: false, drawDist: 600 },
  medium: { scale: 0.85, maxDpr: 1.25, ao: false, shadow: 2048, bloom: true, fxaa: true, lensflare: true, shadowSoft: true, drawDist: 900 },
  high: { scale: 1, maxDpr: 1.5, ao: true, shadow: 2048, bloom: true, fxaa: true, lensflare: true, shadowSoft: true, drawDist: 1400 },
  ultra: { scale: 1, maxDpr: 2, ao: true, shadow: 4096, bloom: true, fxaa: true, lensflare: true, shadowSoft: true, drawDist: 2000 },
};

/** Kills NaN/Inf and clamps extreme HDR values (half-float overflow from sharp speculars). */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, maxV: { value: 14.0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float maxV; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(maxV * 0.25);
      c.rgb = min(c.rgb, vec3(maxV));
      gl_FragColor = vec4(max(c.rgb, vec3(0.0)), 1.0);
    }`,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    vignette: { value: 0.28 },
    grain: { value: 0.035 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    tint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    aberration: { value: 0.0012 },
    flash: { value: 0 },
    flashColor: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution;
    uniform float vignette, grain, saturation, contrast, aberration, flash;
    uniform vec3 tint, flashColor;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * aberration * (0.5 + d * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= tint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= 1.0 - vignette * smoothstep(0.08, 0.65, d * 1.6);
      float g = hash(vUv * resolution + fract(time * 13.7)) - 0.5;
      col += g * grain * (1.0 - l * 0.6);
      col = mix(col, flashColor, flash);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.qualityName = 'high';
    this.q = QUALITY.high;
    this.dynScale = 1;
    this.frameTimes = [];
    this.autoQuality = true;
    this._adaptTimer = 0;
    this.time = 0;
    this.detectQuality();
  }

  detectQuality() {
    const gl = this.renderer.getContext();
    let name = 'high';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
      this.gpu = gpu;
      const low = /SwiftShader|llvmpipe|Mali-4|Mali-T|Adreno \(TM\) [345]|PowerVR|Intel\(R\) HD Graphics [2-5]/i.test(gpu);
      const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      if (low) name = 'low';
      else if (mobile) name = 'low';
      else if (/Intel/i.test(gpu)) name = 'medium';
    } catch (e) { /* ignore */ }
    this.detected = name;
    return name;
  }

  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x || 2, size.y || 2, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.sanitize);
    this.gtao = new GTAOPass(scene, camera, 2, 2);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    try {
      this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    } catch (e) { /* api drift */ }
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.4, 3.2);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.resize();
  }

  setQuality(name) {
    this.autoQuality = name === 'auto';
    const qn = name === 'auto' ? (this.detected || 'high') : name;
    this.qualityName = qn;
    this.q = QUALITY[qn] || QUALITY.high;
    this.dynScale = 1;
    if (this.gtao) this.gtao.enabled = this.q.ao;
    if (this.bloom) this.bloom.enabled = this.q.bloom;
    if (this.fxaa) this.fxaa.enabled = this.q.fxaa;
    this.renderer.shadowMap.type = this.q.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.onQualityChange) this.onQualityChange(this.q);
    this.resize();
  }

  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.q.maxDpr) * this.q.scale * this.dynScale;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      const W = Math.floor(w * pr), H = Math.floor(h * pr);
      this.fxaa.material.uniforms.resolution.value.set(1 / W, 1 / H);
      this.final.material.uniforms.resolution.value.set(W, H);
      if (this.gtao) this.gtao.setSize(W, H);
      this.bloom.resolution.set(Math.max(64, Math.floor(W / 2)), Math.max(64, Math.floor(H / 2)));
    }
  }

  /** Called every frame with real frame delta to adapt resolution. */
  adapt(dtReal) {
    this.frameTimes.push(dtReal);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this._adaptTimer += dtReal;
    if (this._adaptTimer < 2.0 || this.frameTimes.length < 60) return;
    this._adaptTimer = 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let changed = false;
    if (avg > 1 / 42 && this.dynScale > 0.55) { this.dynScale = Math.max(0.55, this.dynScale - 0.1); changed = true; }
    else if (avg < 1 / 70 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.05); changed = true; }
    // persistent slowness on auto: drop AO
    if (this.autoQuality && avg > 1 / 30 && this.dynScale <= 0.6 && this.gtao.enabled) { this.gtao.enabled = false; changed = true; }
    if (changed) this.resize();
  }

  render(dt) {
    this.time += dt;
    this.final.material.uniforms.time.value = this.time;
    this.composer.render(dt);
  }
}
