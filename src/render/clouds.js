/**
 * เมฆก้อนเหลี่ยมลอยเหนือโลก
 *
 * สร้างเป็น mesh เดียวจากตารางเซลล์ที่สุ่มด้วย noise แล้วตัดหน้าที่ติดกันออก
 * (เทคนิคเดียวกับการสร้าง mesh ของ chunk แต่แบนราบและมีชั้นเดียว)
 * ทั้งก้อนเลื่อนไปตามลมเรื่อยๆ และวาร์ปกลับเมื่อเลื่อนครบหนึ่งเซลล์ จึงดูลอยไม่รู้จบ
 */

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../world/rng.js';

const GRID = 48;         // จำนวนเซลล์ต่อด้าน
const CELL = 12;         // ขนาดเซลล์ (บล็อก)
const THICKNESS = 4;     // ความหนาของก้อนเมฆ
const ALTITUDE = 138;    // ความสูงที่เมฆลอย (สูงกว่ายอดเขาสูงสุดพอสมควร)
const WIND_SPEED = 0.9;  // บล็อกต่อวินาที

export class Clouds {
  constructor(scene, seed) {
    this.scene = scene;
    this.offset = 0;
    this.enabled = true;

    const geometry = buildCloudGeometry(seed);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPosition
   * @param {THREE.Color} tint สีแสงปัจจุบัน (เมฆเปลี่ยนสีตามเวลาของวัน)
   */
  update(dt, cameraPosition, tint) {
    this.offset = (this.offset + WIND_SPEED * dt) % CELL;

    // จับตำแหน่งเมฆให้เกาะกริดตามกล้อง เพื่อให้ก้อนเมฆดูอยู่กับที่ในโลกไม่ใช่ติดหัวผู้เล่น
    const snapX = Math.floor(cameraPosition.x / CELL) * CELL;
    const snapZ = Math.floor(cameraPosition.z / CELL) * CELL;
    this.mesh.position.set(snapX, ALTITUDE, snapZ + this.offset);

    // เมฆเป็นสีขาวเป็นหลัก แล้วเจือสีของแสงรอบข้างเข้าไปเล็กน้อย
    // (ตอนพลบค่ำจะอมส้ม ตอนกลางคืนจะเป็นเงามืด)
    if (tint) this.mesh.material.color.setRGB(1, 1, 1).lerp(tint, 0.55).multiplyScalar(1.25);
  }

  setVisible(v) {
    this.mesh.visible = v;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** สร้าง geometry ของกลุ่มเมฆทั้งผืนหนึ่งครั้ง แล้วใช้ซ้ำตลอดเกม */
function buildCloudGeometry(seed) {
  const noise = createNoise2D(mulberry32(seed + 4242));
  const half = GRID / 2;

  // 1. ตัดสินว่าเซลล์ไหนเป็นเมฆ
  const cells = new Uint8Array(GRID * GRID);
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      // ใช้พิกัดบนวงกลมเพื่อให้ลายต่อกันได้แบบไร้รอยต่อเมื่อวนซ้ำ
      const ax = (x / GRID) * Math.PI * 2;
      const az = (z / GRID) * Math.PI * 2;
      const n =
        noise(Math.cos(ax) * 2.2, Math.sin(ax) * 2.2 + Math.cos(az) * 2.2) * 0.6 +
        noise(Math.sin(az) * 4.4, Math.cos(ax) * 4.4) * 0.4;
      // ค่า threshold นี้กำหนดว่าท้องฟ้าจะมีเมฆปกคลุมหนาแค่ไหน — ยิ่งสูงเมฆยิ่งโปร่ง
      cells[x + z * GRID] = n > 0.34 ? 1 : 0;
    }
  }

  const at = (x, z) => (x < 0 || x >= GRID || z < 0 || z >= GRID ? 0 : cells[x + z * GRID]);

  // 2. สร้างหน้าเฉพาะด้านที่ไม่ได้ติดกับเซลล์เมฆอื่น
  const positions = [];
  const normals = [];
  const indices = [];
  let vertexCount = 0;

  const addQuad = (verts, n) => {
    for (const v of verts) {
      positions.push(v[0], v[1], v[2]);
      normals.push(n[0], n[1], n[2]);
    }
    indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
    vertexCount += 4;
  };

  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      if (!at(x, z)) continue;
      const x0 = (x - half) * CELL, x1 = x0 + CELL;
      const z0 = (z - half) * CELL, z1 = z0 + CELL;
      const y0 = 0, y1 = THICKNESS;

      addQuad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);   // บน
      addQuad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);  // ล่าง
      if (!at(x + 1, z)) addQuad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
      if (!at(x - 1, z)) addQuad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
      if (!at(x, z + 1)) addQuad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
      if (!at(x, z - 1)) addQuad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
