/**
 * ท้องฟ้าและวงจรกลางวัน–กลางคืน
 *
 * ประกอบด้วยโดมไล่สี, ดวงอาทิตย์, ดวงจันทร์, ดาว, แสงในฉาก และหมอกที่ขอบระยะมองเห็น
 * ทุกอย่างขับด้วยค่าเดียวคือ timeOfDay (0..1: 0 = เที่ยงคืน, 0.25 = ตะวันขึ้น, 0.5 = เที่ยงวัน)
 *
 * หมอกใช้สีเดียวกับขอบฟ้าเสมอ ทำให้ chunk ที่ยังโหลดไม่เสร็จค่อยๆ จางหายไปกับท้องฟ้า
 * แทนที่จะเห็นเป็นขอบโลกตัดขาด
 */

import * as THREE from 'three';
import { DAY_LENGTH_SECONDS, CHUNK_X } from '../config.js';

// ---------- จานสีของแต่ละช่วงเวลา ----------
const PALETTE = {
  night: {
    top: new THREE.Color(0x050a1c), mid: new THREE.Color(0x0d1430), bottom: new THREE.Color(0x131a2e),
    ambient: new THREE.Color(0x3a4a70), ambientIntensity: 0.42,
    sun: new THREE.Color(0x9fb4e0), sunIntensity: 0.16,
    fog: new THREE.Color(0x0c1226),
  },
  dawn: {
    top: new THREE.Color(0x2f5a92), mid: new THREE.Color(0xd98a52), bottom: new THREE.Color(0xf0a868),
    ambient: new THREE.Color(0x8a8ab0), ambientIntensity: 0.62,
    sun: new THREE.Color(0xffb070), sunIntensity: 0.5,
    fog: new THREE.Color(0xd39468),
  },
  day: {
    top: new THREE.Color(0x4c92dc), mid: new THREE.Color(0x9ccbf0), bottom: new THREE.Color(0xd4e8f7),
    ambient: new THREE.Color(0xdfeaf5), ambientIntensity: 0.86,
    sun: new THREE.Color(0xfff4dc), sunIntensity: 0.52,
    fog: new THREE.Color(0xbcd9f0),
  },
  dusk: {
    top: new THREE.Color(0x27407a), mid: new THREE.Color(0xc46a4a), bottom: new THREE.Color(0xe08a52),
    ambient: new THREE.Color(0x8a7ea8), ambientIntensity: 0.58,
    sun: new THREE.Color(0xff9050), sunIntensity: 0.44,
    fog: new THREE.Color(0xc07a58),
  },
};

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 bottomColor;
  varying vec3 vDir;

  void main() {
    float h = vDir.y;
    vec3 color;
    if (h > 0.0) {
      color = mix(midColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
    } else {
      color = mix(midColor, bottomColor, pow(clamp(-h, 0.0, 1.0), 0.45));
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** สร้าง texture วงกลมเรืองแสงแบบง่ายๆ สำหรับดวงอาทิตย์/ดวงจันทร์ */
function discTexture(inner, outer, craters = false) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.42, inner);
  grad.addColorStop(0.55, outer);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  if (craters) {
    ctx.fillStyle = 'rgba(150, 160, 185, 0.55)';
    const spots = [[52, 46, 9], [78, 62, 6], [58, 82, 7], [86, 88, 4], [44, 70, 4]];
    for (const [x, y, r] of spots) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sky {
  /**
   * @param {THREE.Scene} scene
   * @param {number} startTime เวลาเริ่มต้น 0..1
   */
  constructor(scene, startTime = 0.28) {
    this.scene = scene;
    this.time = startTime;
    this.paused = false;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.horizonColor = new THREE.Color(0x9ccbf0);

    // ---- โดมท้องฟ้า ----
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      midColor: { value: new THREE.Color() },
      bottomColor: { value: new THREE.Color() },
    };
    const domeGeo = new THREE.SphereGeometry(1, 32, 20);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // ---- ดวงอาทิตย์และดวงจันทร์ ----
    // depthTest ต้องเปิดไว้ ไม่งั้นดวงอาทิตย์/ดวงจันทร์จะถูกวาดทับภูเขาที่บังมันอยู่
    // (three วาดวัตถุโปร่งแสงทีหลังวัตถุทึบเสมอ การปิด depthTest จึงเท่ากับให้มันลอยอยู่หน้าสุด)
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture('rgba(255,250,225,1)', 'rgba(255,214,140,0.65)'),
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunSprite.renderOrder = -900;
    scene.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture('rgba(232,238,255,1)', 'rgba(190,205,240,0.5)', true),
      transparent: true, depthWrite: false, depthTest: true, fog: false,
    }));
    this.moonSprite.renderOrder = -900;
    scene.add(this.moonSprite);

    // ---- ดาว ----
    this.stars = this.createStars(1400);
    scene.add(this.stars);

    // ---- แสง ----
    this.ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.sunLight.position.set(80, 140, 60);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // ---- หมอก ----
    // ใช้หมอกแบบเชิงเส้นเพราะกำหนดได้ว่าจะ "เริ่ม" ที่ระยะเท่าไร
    // ภูมิประเทศครึ่งใกล้จึงคมชัดเต็มที่ แล้วค่อยจางหายพอดีตรงขอบระยะมองเห็น
    // (FogExp2 เริ่มทึบตั้งแต่หน้ากล้อง ทำให้วิวใกล้ๆ ขุ่นไปหมด)
    this.fog = new THREE.Fog(0xbcd9f0, 60, 130);
    scene.fog = this.fog;
    this.underwater = false;

    this.update(0, new THREE.Vector3(), 8);
  }

  createStars(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // กระจายสม่ำเสมอบนผิวทรงกลม
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(u) * 0.98 + 0.02; // ให้อยู่ครึ่งบนของฟ้า
      positions[i * 3 + 2] = r * Math.sin(theta);
      sizes[i] = Math.random() < 0.12 ? 2.6 : 1.3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = -950;
    return points;
  }

  /** ผสมสองจานสีตามน้ำหนัก */
  static blend(a, b, t, out) {
    out.top.copy(a.top).lerp(b.top, t);
    out.mid.copy(a.mid).lerp(b.mid, t);
    out.bottom.copy(a.bottom).lerp(b.bottom, t);
    out.ambient.copy(a.ambient).lerp(b.ambient, t);
    out.fog.copy(a.fog).lerp(b.fog, t);
    out.sun.copy(a.sun).lerp(b.sun, t);
    out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
    out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
    return out;
  }

  /**
   * @param {number} dt วินาทีที่ผ่านไป
   * @param {THREE.Vector3} cameraPosition ใช้ย้ายโดม/ดวงอาทิตย์ให้ตามกล้องไปตลอด
   * @param {number} renderDistance ระยะมองเห็นปัจจุบัน (chunk) — กำหนดความหนาหมอก
   */
  update(dt, cameraPosition, renderDistance) {
    if (!this.paused) {
      this.time = (this.time + dt / DAY_LENGTH_SECONDS) % 1;
    }

    // ---- ตำแหน่งดวงอาทิตย์ ----
    const angle = (this.time - 0.25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(angle), Math.sin(angle), 0.32).normalize();
    const elevation = this.sunDirection.y;

    // ---- เลือกและผสมจานสีจากมุมเงยของดวงอาทิตย์ ----
    const scratch = this._scratch || (this._scratch = {
      top: new THREE.Color(), mid: new THREE.Color(), bottom: new THREE.Color(),
      ambient: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(),
      ambientIntensity: 0, sunIntensity: 0,
    });

    const twilight = this.time < 0.5 ? PALETTE.dawn : PALETTE.dusk;
    let mixed;
    if (elevation > 0.22) {
      mixed = Sky.blend(twilight, PALETTE.day, Math.min(1, (elevation - 0.22) / 0.26), scratch);
    } else if (elevation > -0.16) {
      mixed = Sky.blend(PALETTE.night, twilight, Math.min(1, (elevation + 0.16) / 0.34), scratch);
    } else {
      mixed = Sky.blend(PALETTE.night, PALETTE.night, 0, scratch);
    }

    this.uniforms.topColor.value.copy(mixed.top);
    this.uniforms.midColor.value.copy(mixed.mid);
    this.uniforms.bottomColor.value.copy(mixed.bottom);
    this.horizonColor.copy(mixed.mid);

    this.ambient.color.copy(mixed.ambient);
    this.ambient.intensity = mixed.ambientIntensity;
    this.sunLight.color.copy(mixed.sun);
    this.sunLight.intensity = mixed.sunIntensity;

    // ---- หมอกให้กลืนกับขอบฟ้าและพอดีกับระยะมองเห็น ----
    const viewDistance = renderDistance * CHUNK_X;
    if (this.underwater) {
      this.fog.color.setHex(0x1c4a78);
      this.fog.near = 0.5;
      this.fog.far = 22;
    } else {
      this.fog.color.copy(mixed.fog);
      // เริ่มจางที่ 62% ของระยะมองเห็น แล้วทึบสนิทพอดีตรงขอบ chunk วงสุดท้าย
      this.fog.near = viewDistance * 0.62;
      this.fog.far = viewDistance * 1.02;
    }

    // ---- วางวัตถุบนฟ้าให้ตามกล้อง (ท้องฟ้าอยู่ไกลเสมอ) ----
    const cam = cameraPosition;
    this.dome.position.copy(cam);
    this.dome.scale.setScalar(Math.max(600, viewDistance * 2.2));
    this.stars.position.copy(cam);
    this.stars.scale.setScalar(Math.max(560, viewDistance * 2));

    const orbit = Math.max(500, viewDistance * 1.7);
    this.sunSprite.position.copy(cam).addScaledVector(this.sunDirection, orbit);
    this.sunSprite.scale.setScalar(orbit * 0.13);
    this.moonSprite.position.copy(cam).addScaledVector(this.sunDirection, -orbit);
    this.moonSprite.scale.setScalar(orbit * 0.1);

    this.sunSprite.material.opacity = THREE.MathUtils.clamp((elevation + 0.14) / 0.2, 0, 1);
    this.moonSprite.material.opacity = THREE.MathUtils.clamp((-elevation + 0.1) / 0.2, 0, 1);
    this.stars.material.opacity = THREE.MathUtils.clamp((-elevation - 0.02) / 0.25, 0, 1) * 0.9;

    // แสงพระอาทิตย์ส่องมาจากทิศของดวงอาทิตย์ (หรือดวงจันทร์ตอนกลางคืน)
    const lightDir = elevation > -0.05 ? this.sunDirection : this.sunDirection.clone().negate();
    this.sunLight.position.copy(cam).addScaledVector(lightDir, 120);
    this.sunLight.target.position.copy(cam);
    this.sunLight.target.updateMatrixWorld();
  }

  setUnderwater(value) {
    this.underwater = value;
  }

  /** เวลาในเกมแบบ 24 ชั่วโมงสำหรับแสดงผล */
  clockString() {
    const totalMinutes = Math.floor(this.time * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get isNight() {
    return this.sunDirection.y < -0.05;
  }
}
