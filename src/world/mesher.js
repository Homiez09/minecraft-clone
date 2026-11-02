/**
 * แปลงข้อมูล voxel เป็น geometry
 *
 * ใช้ face culling: สร้างเฉพาะหน้าบล็อกที่มีโอกาสมองเห็น (ไม่ได้ติดกับบล็อกทึบ)
 * แสงเงาคำนวณตอนสร้าง mesh แล้วอบลงใน vertex color — ตอนเรนเดอร์จึงไม่ต้องใช้ dynamic light เลย:
 *   1. Ambient occlusion จากบล็อกเพื่อนบ้าน 3 ตัวรอบมุม (เงาตามซอกมุม)
 *   2. ความสว่างตามทิศของหน้า (บนสว่างสุด ล่างมืดสุด — ทำให้รูปทรงอ่านง่าย)
 *   3. ความมืดตามความลึกจากผิวดิน (ในถ้ำมืด บนดินสว่าง) คำนวณจาก heightMap
 *      ซึ่งต่อเนื่องข้าม chunk จึงไม่เกิดเส้นรอยต่อระหว่าง chunk
 *
 * ไฟล์นี้ทำงานได้ทั้งใน main thread และ worker — ห้าม import three.js หรือแตะ DOM
 */

import { CHUNK_X, CHUNK_Y, CHUNK_Z, CHUNK_AREA } from '../config.js';
import { IS_OPAQUE, IS_TRANSPARENT, FACE_TILES, LIGHT_EMIT, BLOCK } from '../blocks.js';

/**
 * ชั้นการเรนเดอร์ — แต่ละชั้นใช้ material คนละตัว
 *   SOLID       บล็อกทึบทั่วไป
 *   CUTOUT      มีรูโปร่งใสสนิท (ใบไม้ กระจก) ใช้ alphaTest ไม่ต้องเรียงลำดับ
 *   TRANSLUCENT โปร่งแสงบางส่วนแต่ไม่ไหว (น้ำแข็ง)
 *   WATER       แยกออกมาเพราะมี shader ทำคลื่นเฉพาะตัว
 */
export const LAYER = { SOLID: 0, CUTOUT: 1, TRANSLUCENT: 2, WATER: 3 };
export const LAYER_COUNT = 4;

/** บล็อกไหนอยู่ชั้นไหน */
const BLOCK_LAYER = new Uint8Array(256);
for (let i = 0; i < 256; i++) BLOCK_LAYER[i] = LAYER.SOLID;
BLOCK_LAYER[BLOCK.LEAVES] = LAYER.CUTOUT;
BLOCK_LAYER[BLOCK.BIRCH_LEAVES] = LAYER.CUTOUT;
BLOCK_LAYER[BLOCK.SPRUCE_LEAVES] = LAYER.CUTOUT;
BLOCK_LAYER[BLOCK.GLASS] = LAYER.CUTOUT;
BLOCK_LAYER[BLOCK.ICE] = LAYER.TRANSLUCENT;
BLOCK_LAYER[BLOCK.WATER] = LAYER.WATER;

/**
 * ความสว่างของหน้าตามทิศ: [+X, -X, +Y, -Y, +Z, -Z]
 * ค่าค่อนข้างอ่อนเพราะยังมีแสงจาก DirectionalLight ของดวงอาทิตย์ซ้อนอีกชั้น
 */
const FACE_LIGHT = [0.86, 0.86, 1.0, 0.65, 0.76, 0.76];

/** ระดับความสว่างตามค่า AO 0..3 */
const AO_LEVELS = [0.46, 0.66, 0.84, 1.0];

// ---------------------------------------------------------------- ตารางหน้า

/**
 * แต่ละหน้า: normal + มุมทั้ง 4 (offset 0/1 จากมุมล่างซ้ายหน้าของบล็อก)
 * ลำดับมุมเรียงทวนเข็มเมื่อมองจากด้านนอก และคู่กับ UV (0,0) (1,0) (1,1) (0,1)
 */
const FACE_DEFS = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },   // +X
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },  // -X
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },   // +Y
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },  // -Y
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },   // +Z
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },  // -Z
];

/**
 * คำนวณล่วงหน้าว่าแต่ละมุมของแต่ละหน้าต้องดูบล็อกไหนบ้างเพื่อหา ambient occlusion
 * มุมหนึ่งดู 3 ตัว: ด้านข้าง 2 ตัวและมุมทแยง 1 ตัว (ทั้งหมดอยู่ในระนาบถัดจากหน้าออกไป)
 */
for (const face of FACE_DEFS) {
  const axis = face.n.findIndex((v) => v !== 0);
  const [b, c] = [0, 1, 2].filter((i) => i !== axis);
  face.ao = face.corners.map((corner) => {
    const db = corner[b] === 1 ? 1 : -1;
    const dc = corner[c] === 1 ? 1 : -1;
    const make = (useB, useC) => {
      const o = [0, 0, 0];
      o[axis] = face.n[axis];
      if (useB) o[b] = db;
      if (useC) o[c] = dc;
      return o;
    };
    return [make(true, false), make(false, true), make(true, true)];
  });
}

const UV_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---------------------------------------------------------------- ตัวสะสม vertex

class Builder {
  constructor(initialQuads = 2048) {
    this.alloc(initialQuads);
    this.quads = 0;
  }

  alloc(quads) {
    this.cap = quads;
    this.pos = new Float32Array(quads * 12);
    this.norm = new Float32Array(quads * 12);
    this.uv = new Float32Array(quads * 8);
    this.col = new Float32Array(quads * 12);
    this.idx = new Uint32Array(quads * 6);
  }

  grow() {
    const old = { pos: this.pos, norm: this.norm, uv: this.uv, col: this.col, idx: this.idx };
    const n = this.cap * 2;
    this.alloc(n);
    this.pos.set(old.pos); this.norm.set(old.norm);
    this.uv.set(old.uv); this.col.set(old.col); this.idx.set(old.idx);
  }

  /**
   * @param {number[]} verts   พิกัด 4 มุม (12 ค่า)
   * @param {number[]} n       normal
   * @param {number[]} uvRect  [u0, v0, u1, v1] ของ tile
   * @param {number[]} light   ความสว่างของแต่ละมุม 4 ค่า
   * @param {boolean} flip     กลับทิศเส้นทแยงของสี่เหลี่ยม (กัน AO บิดเบี้ยว)
   */
  quad(verts, n, uvRect, light, flip) {
    if (this.quads >= this.cap) this.grow();
    const q = this.quads;
    const vo = q * 12, uo = q * 8, io = q * 6, base = q * 4;

    for (let i = 0; i < 4; i++) {
      this.pos[vo + i * 3] = verts[i * 3];
      this.pos[vo + i * 3 + 1] = verts[i * 3 + 1];
      this.pos[vo + i * 3 + 2] = verts[i * 3 + 2];
      this.norm[vo + i * 3] = n[0];
      this.norm[vo + i * 3 + 1] = n[1];
      this.norm[vo + i * 3 + 2] = n[2];
      const l = light[i];
      this.col[vo + i * 3] = l;
      this.col[vo + i * 3 + 1] = l;
      this.col[vo + i * 3 + 2] = l;
      const [cu, cv] = UV_CORNERS[i];
      this.uv[uo + i * 2] = cu ? uvRect[2] : uvRect[0];
      this.uv[uo + i * 2 + 1] = cv ? uvRect[3] : uvRect[1];
    }

    if (flip) {
      this.idx[io] = base + 1; this.idx[io + 1] = base + 2; this.idx[io + 2] = base + 3;
      this.idx[io + 3] = base + 1; this.idx[io + 4] = base + 3; this.idx[io + 5] = base;
    } else {
      this.idx[io] = base; this.idx[io + 1] = base + 1; this.idx[io + 2] = base + 2;
      this.idx[io + 3] = base; this.idx[io + 4] = base + 2; this.idx[io + 5] = base + 3;
    }
    this.quads++;
  }

  finish() {
    if (this.quads === 0) return null;
    const v = this.quads * 12, u = this.quads * 8, i = this.quads * 6;
    return {
      positions: this.pos.slice(0, v),
      normals: this.norm.slice(0, v),
      uvs: this.uv.slice(0, u),
      colors: this.col.slice(0, v),
      indices: this.idx.slice(0, i),
    };
  }
}

// ---------------------------------------------------------------- ตัวสร้างหลัก

/**
 * สร้าง geometry ของ chunk หนึ่งก้อน
 *
 * @param {object} args
 * @param {Uint8Array[]} args.voxels  ข้อมูล voxel 9 ก้อนเรียงแบบ 3×3 (index 4 = ก้อนกลาง)
 *                                     เรียงลำดับ (dz + 1) * 3 + (dx + 1)
 * @param {Uint8Array[]} args.heights heightMap 9 ก้อน เรียงลำดับเดียวกัน
 * @param {Float32Array} args.uvTable ตาราง UV ของ atlas (4 ค่าต่อ tile)
 * @returns {object[]} geometry ของแต่ละชั้น (null ถ้าชั้นนั้นไม่มีหน้าเลย)
 */
export function buildChunkMesh({ voxels, heights, uvTable }) {
  const center = voxels[4];
  const builders = [new Builder(4096), new Builder(512), new Builder(256), new Builder(512)];

  /** อ่านบล็อกที่พิกัด local ซึ่งอาจล้นออกนอก chunk ไป 1 ช่อง */
  function voxelAt(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR;
    if (x >= 0 && x < CHUNK_X && z >= 0 && z < CHUNK_Z) {
      return center[x + z * CHUNK_X + y * CHUNK_AREA];
    }
    const nx = x < 0 ? 0 : x >= CHUNK_X ? 2 : 1;
    const nz = z < 0 ? 0 : z >= CHUNK_Z ? 2 : 1;
    const arr = voxels[nz * 3 + nx];
    if (!arr) return BLOCK.AIR;
    const lx = ((x % CHUNK_X) + CHUNK_X) % CHUNK_X;
    const lz = ((z % CHUNK_Z) + CHUNK_Z) % CHUNK_Z;
    return arr[lx + lz * CHUNK_X + y * CHUNK_AREA];
  }

  /** ความสูงผิวดินที่คอลัมน์นั้น (ใช้ประเมินว่าจุดนั้นอยู่ลึกใต้ดินแค่ไหน) */
  function heightAt(x, z) {
    let arr = heights[4], lx = x, lz = z;
    if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z) {
      const nx = x < 0 ? 0 : x >= CHUNK_X ? 2 : 1;
      const nz = z < 0 ? 0 : z >= CHUNK_Z ? 2 : 1;
      arr = heights[nz * 3 + nx];
      if (!arr) return 0;
      lx = ((x % CHUNK_X) + CHUNK_X) % CHUNK_X;
      lz = ((z % CHUNK_Z) + CHUNK_Z) % CHUNK_Z;
    }
    return arr[lx + lz * CHUNK_X];
  }

  /** ความสว่างจากท้องฟ้า: ยิ่งอยู่ลึกใต้ผิวดินยิ่งมืด */
  function skyLight(x, y, z) {
    const h = heightAt(x, z);
    if (y >= h) return 1;
    return Math.max(0.3, 1 - (h - y) * 0.085);
  }

  const isOccluder = (id) => IS_OPAQUE[id];

  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const id = center[x + z * CHUNK_X + y * CHUNK_AREA];
        if (id === BLOCK.AIR) continue;

        const layer = BLOCK_LAYER[id];
        const builder = builders[layer];
        const isWater = id === BLOCK.WATER;

        for (let f = 0; f < 6; f++) {
          const face = FACE_DEFS[f];
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          const neighbor = voxelAt(nx, ny, nz);

          // ตัดสินว่าต้องสร้างหน้านี้ไหม
          if (neighbor !== BLOCK.AIR) {
            if (IS_OPAQUE[neighbor]) continue;         // ถูกบล็อกทึบบัง
            if (neighbor === id) continue;             // บล็อกโปร่งชนิดเดียวกันชิดกัน
            if (IS_TRANSPARENT[id] && !IS_TRANSPARENT[neighbor]) continue;
          }

          // ผิวน้ำเตี้ยลงเล็กน้อยให้เห็นเป็นระลอกและเดินลุยแล้วดูจม
          const waterTop = isWater && f !== 3 && voxelAt(x, y + 1, z) !== BLOCK.WATER;
          const shrink = waterTop ? 0.12 : 0;

          const tile = FACE_TILES[id * 6 + f];
          const uvRect = [
            uvTable[tile * 4], uvTable[tile * 4 + 1],
            uvTable[tile * 4 + 2], uvTable[tile * 4 + 3],
          ];

          // บล็อกที่เปล่งแสงเองสว่างเต็มที่เสมอ ไม่ถูกความมืดของถ้ำหรือ AO กด
          const emissive = LIGHT_EMIT[id] > 0;
          const baseLight = emissive ? 1 : FACE_LIGHT[f] * skyLight(nx, ny, nz);
          const verts = new Array(12);
          const light = new Array(4);

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            let vy = y + corner[1];
            if (shrink && corner[1] === 1) vy -= shrink;
            verts[c * 3] = x + corner[0];
            verts[c * 3 + 1] = vy;
            verts[c * 3 + 2] = z + corner[2];

            // ambient occlusion จากเพื่อนบ้าน 3 ตัวรอบมุมนี้
            const [o1, o2, o3] = face.ao[c];
            const s1 = isOccluder(voxelAt(x + o1[0], y + o1[1], z + o1[2])) ? 1 : 0;
            const s2 = isOccluder(voxelAt(x + o2[0], y + o2[1], z + o2[2])) ? 1 : 0;
            const s3 = isOccluder(voxelAt(x + o3[0], y + o3[1], z + o3[2])) ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            light[c] = emissive ? baseLight : baseLight * AO_LEVELS[ao];
          }

          // ถ้ามุมตรงข้ามมืดไม่เท่ากัน ให้พลิกเส้นทแยงเพื่อไม่ให้เงาบิด
          const flip = light[0] + light[2] < light[1] + light[3];
          builder.quad(verts, face.n, uvRect, light, flip);
        }
      }
    }
  }

  return builders.map((b) => b.finish());
}

export { BLOCK_LAYER };
