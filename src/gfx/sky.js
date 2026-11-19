import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';
import { softSprite, canvasTexture } from './textures.js';

const tmpColor = new THREE.Color();
const C = (h) => new THREE.Color(h);

// Key colours over the day (by sun elevation, -1..1 sin)
const FOG_DAY = C(0xd9cbb3), FOG_GOLD = C(0xe0a06a), FOG_DUSK = C(0x5a4a66), FOG_NIGHT = C(0x0d1424);
const HEMI_SKY_DAY = C(0xbfd4ff), HEMI_SKY_NIGHT = C(0x24345a), HEMI_GND_DAY = C(0x8c7a68), HEMI_GND_NIGHT = C(0x15110e);
const SUN_NOON = C(0xfff3e0), SUN_LOW = C(0xff9a4a), MOON = C(0x8fa8d8);

/**
 * Sky dome, sun/moon light with player-following shadows, fog, stars and
 * a PMREM environment map regenerated from the procedural sky.
 */
export class DayNight {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 7;
    this.weather = { clouds: 0.25, dust: 0, wind: 1 };
    this.targetWeather = { ...this.weather };

    this.sky = new Sky();
    this.sky.scale.setScalar(1400);
    // Tame the visible sky's HDR range so bloom only catches the sun disc
    this.sky.material.uniforms.skyScale = { value: 0.42 };
    this.sky.material.fragmentShader = this.sky.material.fragmentShader
      .replace('uniform float time;', 'uniform float time;\nuniform float skyScale;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min(texColor * skyScale, vec3(40.0)), 1.0 );');
    this.scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.cloudScale.value = 0.00025; u.cloudSpeed.value = 0.00003; u.cloudCoverage.value = 0.25; u.cloudDensity.value = 0.45; u.cloudElevation.value = 0.6;

    // environment scene (sky + ground disk) for reflections
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(50);
    // no sun disc in the reflection environment (the directional light is the sun)
    this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envSky.material.uniforms.skyScale = { value: 0.75 };
    this.envSky.material.fragmentShader = this.envSky.material.fragmentShader
      .replace('uniform float time;', 'uniform float time;\nuniform float skyScale;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min(texColor * skyScale, vec3(8.0)), 1.0 );');
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: 0x8a6a4a }));
    this.envGround.rotation.x = -Math.PI / 2; this.envGround.position.y = -2;
    this.envScene.add(this.envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this._envTimer = 999;
    this._lastEnvSun = new THREE.Vector3(0, -1, 0);

    // sun / moon directional light
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.setShadowSize(quality ? quality.shadow : 2048);
    const sc = this.sun.shadow.camera;
    this.shadowExtent = 42;
    sc.left = -this.shadowExtent; sc.right = this.shadowExtent; sc.top = this.shadowExtent; sc.bottom = -this.shadowExtent;
    sc.near = 1; sc.far = 260;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x9a7454, 0.6);
    this.scene.add(this.hemi);

    this.scene.fog = new THREE.FogExp2(0xd9cbb3, 0.0011);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const N = 2200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection(); if (v.y < 0) v.y = -v.y * 0.7 + 0.02;
      v.multiplyScalar(1300); pos.set([v.x, v.y, v.z], i * 3);
      const b = 0.4 + Math.random() * 0.6, warm = Math.random();
      col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.2)], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);

    // moon
    const moonTex = canvasTexture(128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.22, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(240,240,255,1)'); g.addColorStop(0.32, 'rgba(220,230,255,0.9)'); g.addColorStop(0.36, 'rgba(160,180,255,0.25)'); g.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      ctx.fillStyle = 'rgba(150,150,170,0.35)';
      [[0.44, 0.42, 0.06], [0.56, 0.55, 0.05], [0.5, 0.36, 0.035]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x * w, y * w, r * w, 0, 7); ctx.fill(); });
    });
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, color: 0xffffff }));
    this.moon.scale.setScalar(110);
    this.scene.add(this.moon);

    // sun glare sprite
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite(128, 0, 0.5), color: 0xffe6b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glare.scale.setScalar(260);
    this.scene.add(this.glare);

    this.sunDir = new THREE.Vector3();
    this.nightFactor = 0;
    this.dayFactor = 1;
    this.followTarget = new THREE.Vector3();
  }

  setShadowSize(s) {
    this.sun.shadow.mapSize.set(s, s);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  setWeather(kind) {
    if (kind === 'cloudy') this.targetWeather = { clouds: 0.62, dust: 0.1, wind: 1.4 };
    else if (kind === 'dust') this.targetWeather = { clouds: 0.4, dust: 1, wind: 2.6 };
    else this.targetWeather = { clouds: 0.18 + Math.random() * 0.15, dust: 0, wind: 1 };
    this.weatherName = kind;
  }

  /** Sun direction for a given hour (sunrise 5:45, sunset 20:15). */
  computeSun(hour, out) {
    const t = (hour - 5.75) / 14.5;
    const phi = Math.PI * t;
    const elev = Math.sin(Math.PI * t) * THREE.MathUtils.degToRad(68);
    const ce = Math.cos(elev);
    out.set(Math.cos(phi) * ce, Math.sin(elev), -Math.sin(phi) * ce * 0.85 - 0.25 * ce);
    if (t < 0 || t > 1) { // below horizon: continue moving under the ground
      const u = Math.min(0.5, t < 0 ? -t : t - 1);
      out.y = -Math.sin(Math.PI * u) * 0.9 - 0.02;
    }
    return out.normalize();
  }

  update(dt, hour, playerPos, renderer) {
    this.hour = hour;
    // ease weather
    const w = this.weather, tw = this.targetWeather, k = 1 - Math.exp(-dt * 0.15);
    w.clouds = lerp(w.clouds, tw.clouds, k); w.dust = lerp(w.dust, tw.dust, k); w.wind = lerp(w.wind, tw.wind, k);

    const s = this.computeSun(hour, this.sunDir);
    const elev = s.y;
    this.dayFactor = smoothstep(-0.12, 0.12, elev);
    this.nightFactor = 1 - smoothstep(-0.2, 0.02, elev);
    const golden = 1 - smoothstep(0.05, 0.35, elev);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(s).multiplyScalar(1000);
    u.turbidity.value = lerp(3.5, 9, w.dust) + golden * 2;
    u.rayleigh.value = lerp(1.3, 3.0, golden * this.dayFactor) + w.dust * 1.5;
    u.cloudCoverage.value = w.clouds;
    u.time.value += dt * (0.6 + w.wind);
    const eu = this.envSky.material.uniforms;
    for (const key of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudScale', 'cloudDensity', 'cloudElevation']) {
      if (eu[key].value && eu[key].value.copy) eu[key].value.copy(u[key].value); else eu[key].value = u[key].value;
    }

    // directional light: sun by day, moon by night
    const isSun = elev > -0.05;
    const lightDir = isSun ? s : this._moonDir || (this._moonDir = new THREE.Vector3());
    if (!isSun) this._moonDir.set(-s.x * 0.6, Math.max(0.35, -s.y), -s.z * 0.6 + 0.3).normalize();
    const sunCol = tmpColor.copy(SUN_LOW).lerp(SUN_NOON, smoothstep(0.02, 0.45, elev));
    if (isSun) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.0 * smoothstep(-0.03, 0.12, elev) * (1 - w.dust * 0.55) * (1 - w.clouds * 0.25);
    } else {
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.32 * this.nightFactor;
    }
    // shadow camera follows player, snapped to texels
    const ext = this.shadowExtent;
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    this.followTarget.set(Math.round(playerPos.x / texel) * texel, 0, Math.round(playerPos.z / texel) * texel);
    this.sun.target.position.copy(this.followTarget);
    this.sun.position.copy(this.followTarget).addScaledVector(lightDir, 120);
    this.sun.target.updateMatrixWorld();

    // hemisphere ambient
    this.hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, this.dayFactor);
    this.hemi.groundColor.copy(HEMI_GND_NIGHT).lerp(HEMI_GND_DAY, this.dayFactor);
    this.hemi.intensity = lerp(0.35, 0.7, this.dayFactor) + w.clouds * 0.15;

    // fog
    const fog = this.scene.fog;
    if (elev > 0.25) fog.color.copy(FOG_DAY);
    else if (elev > 0.0) fog.color.copy(FOG_GOLD).lerp(FOG_DAY, elev / 0.25);
    else if (elev > -0.15) fog.color.copy(FOG_DUSK).lerp(FOG_GOLD, (elev + 0.15) / 0.15);
    else fog.color.copy(FOG_NIGHT).lerp(FOG_DUSK, clamp((elev + 0.4) / 0.25, 0, 1));
    if (w.dust > 0.01) fog.color.lerp(C(0xc9925e), w.dust * 0.7 * this.dayFactor + w.dust * 0.2);
    fog.density = lerp(0.0009, 0.0016, golden) + w.dust * 0.012;
    this.envGround.material.color.copy(HEMI_GND_NIGHT).lerp(C(0xa07a56), this.dayFactor).multiplyScalar(0.5 + this.dayFactor * 0.6);

    // stars & moon
    this.stars.material.opacity = this.nightFactor * (1 - w.clouds * 0.7);
    this.stars.position.copy(playerPos);
    this.stars.rotation.y = hour * 0.02;
    const md = this._moonDir || this.sunDir;
    this.moon.position.copy(playerPos).addScaledVector(isSun ? tmpV.set(-s.x, -s.y, -s.z) : md, 1200);
    this.moon.material.opacity = this.nightFactor;
    this.moon.visible = this.nightFactor > 0.01;
    this.glare.position.copy(playerPos).addScaledVector(s, 1200);
    this.glare.material.opacity = smoothstep(-0.05, 0.1, elev) * 0.55 * (1 - w.clouds * 0.6) * (1 - w.dust * 0.6);
    this.glare.material.color.copy(sunCol);
    this.glare.visible = this.glare.material.opacity > 0.01;
    this.sky.position.copy(playerPos);

    // exposure: brighter at night for readability (tone mapped)
    renderer.toneMappingExposure = lerp(1.2, 0.8, this.dayFactor) + golden * this.dayFactor * 0.08;

    // regenerate environment map periodically
    this._envTimer += dt;
    if (this._envTimer > 1.5 && (this._lastEnvSun.distanceTo(s) > 0.015 || Math.abs(this._lastClouds - w.clouds) > 0.05 || !this.envRT)) {
      this._envTimer = 0; this._lastEnvSun.copy(s); this._lastClouds = w.clouds;
      this.regenEnv();
    }
  }

  regenEnv() {
    const old = this.envRT;
    this.envSky.position.set(0, 0, 0);
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(0.12, 1.0, this.dayFactor);
    if (old) old.dispose();
  }
}

const tmpV = new THREE.Vector3();
