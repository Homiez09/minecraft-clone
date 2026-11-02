/**
 * เก็บข้อมูล voxel ของโลกทั้งหมดที่โหลดอยู่ และเป็นตัวกลางในการอ่าน/เขียนบล็อกด้วยพิกัดโลก
 *
 * ไฟล์นี้ไม่ยุ่งกับการเรนเดอร์เลย (ไม่ import three.js) — ChunkManager เป็นคนต่อยอดไปเป็น mesh
 * ทุกการแก้บล็อกของผู้เล่นถูกจดไว้ใน this.edits เพื่อเซฟลงดิสก์เป็น "ส่วนต่าง" จากโลกต้นฉบับ
 */

import { CHUNK_X, CHUNK_Y, CHUNK_Z, voxelIndex, SEA_LEVEL } from '../config.js';
import { BLOCK, IS_SOLID, IS_LIQUID } from '../blocks.js';
import { Chunk, CHUNK_STATE } from './Chunk.js';
import { createTerrain, BIOME, BIOME_NAME } from './terrain.js';

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.terrain = createTerrain(this.seed);
    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
    /** บล็อกที่ผู้เล่นแก้ไข: chunkKey → Map(voxelIndex → blockId) */
    this.edits = new Map();
  }

  static key(cx, cz) {
    return `${cx},${cz}`;
  }

  getChunk(cx, cz) {
    return this.chunks.get(World.key(cx, cz)) || null;
  }

  getOrCreateChunk(cx, cz) {
    const key = World.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  removeChunk(cx, cz) {
    const key = World.key(cx, cz);
    const chunk = this.chunks.get(key);
    if (chunk) this.chunks.delete(key);
    return chunk;
  }

  // ---------------------------------------------------------------- อ่าน/เขียนบล็อก

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(World.key(cx, cz));
    if (!chunk || !chunk.voxels) return BLOCK.AIR;
    return chunk.voxels[voxelIndex(x - cx * CHUNK_X, y, z - cz * CHUNK_Z)];
  }

  /**
   * วางหรือลบบล็อกที่พิกัดโลก
   * @returns {string[]|null} รายการ key ของ chunk ที่ต้องสร้าง mesh ใหม่ (รวม chunk ข้างเคียงถ้าแก้ติดขอบ)
   */
  setBlock(x, y, z, id, { track = true } = {}) {
    if (y < 0 || y >= CHUNK_Y) return null;
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(World.key(cx, cz));
    if (!chunk || chunk.state !== CHUNK_STATE.READY) return null;

    const lx = x - cx * CHUNK_X;
    const lz = z - cz * CHUNK_Z;
    if (!chunk.setBlock(lx, y, lz, id)) return null;

    if (track) {
      const key = chunk.key;
      let map = this.edits.get(key);
      if (!map) { map = new Map(); this.edits.set(key, map); }
      map.set(voxelIndex(lx, y, lz), id);
    }

    // chunk ที่ต้อง mesh ใหม่: ตัวมันเอง + เพื่อนบ้านที่หน้าบล็อกอาจเปลี่ยน
    const affected = [chunk.key];
    if (lx === 0) affected.push(World.key(cx - 1, cz));
    if (lx === CHUNK_X - 1) affected.push(World.key(cx + 1, cz));
    if (lz === 0) affected.push(World.key(cx, cz - 1));
    if (lz === CHUNK_Z - 1) affected.push(World.key(cx, cz + 1));
    // มุมทแยง — จำเป็นเพราะ ambient occlusion อ่านบล็อกทแยงมุมด้วย
    if (lx === 0 && lz === 0) affected.push(World.key(cx - 1, cz - 1));
    if (lx === 0 && lz === CHUNK_Z - 1) affected.push(World.key(cx - 1, cz + 1));
    if (lx === CHUNK_X - 1 && lz === 0) affected.push(World.key(cx + 1, cz - 1));
    if (lx === CHUNK_X - 1 && lz === CHUNK_Z - 1) affected.push(World.key(cx + 1, cz + 1));
    return affected;
  }

  /** นำส่วนต่างที่ผู้เล่นเคยแก้ไว้มาทับลงบน chunk ที่เพิ่งสร้างเสร็จ */
  applyEdits(chunk) {
    const map = this.edits.get(chunk.key);
    if (!map || !chunk.voxels) return;
    for (const [index, id] of map) chunk.voxels[index] = id;
    chunk.version++;
  }

  // ---------------------------------------------------------------- ตัวช่วยสำหรับฟิสิกส์

  isSolid(x, y, z) {
    return IS_SOLID[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;
  }

  isLiquid(x, y, z) {
    return IS_LIQUID[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;
  }

  /** chunk ที่ครอบพิกัดนี้โหลดข้อมูลแล้วหรือยัง (ใช้กันผู้เล่นตกทะลุโลกที่ยังไม่โหลด) */
  isLoadedAt(x, z) {
    const chunk = this.getChunk(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z));
    return !!chunk && chunk.state === CHUNK_STATE.READY;
  }

  // ---------------------------------------------------------------- ข้อมูลภูมิประเทศ

  /** ความสูงของบล็อกตันสูงสุด — ถ้า chunk ยังไม่โหลดจะคำนวณจาก noise แทน */
  surfaceHeight(x, z) {
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(World.key(cx, cz));
    if (chunk && chunk.voxels) {
      return chunk.columnTop(x - cx * CHUNK_X, z - cz * CHUNK_Z);
    }
    return this.terrain.heightAt(Math.floor(x), Math.floor(z));
  }

  biomeAt(x, z) {
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const chunk = this.chunks.get(World.key(cx, cz));
    if (chunk && chunk.biomeMap) {
      const lx = Math.floor(x) - cx * CHUNK_X;
      const lz = Math.floor(z) - cz * CHUNK_Z;
      return chunk.biomeMap[lx + lz * CHUNK_X];
    }
    return this.terrain.biomeAt(Math.floor(x), Math.floor(z));
  }

  biomeName(x, z) {
    return BIOME_NAME[this.biomeAt(x, z)] ?? '-';
  }

  /**
   * หาจุดเกิดที่ปลอดภัย: เดินหาตำแหน่งบนบกที่สูงกว่าระดับน้ำทะเลใกล้จุด (0,0)
   * ใช้ noise ล้วน จึงเรียกได้ก่อน chunk ใดๆ จะโหลด
   */
  findSpawn() {
    for (let r = 0; r < 96; r += 6) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const h = this.terrain.heightAt(x, z);
        const biome = this.terrain.biomeAt(x, z, h);
        if (h > SEA_LEVEL + 1 && biome !== BIOME.OCEAN) {
          return { x: x + 0.5, y: h + 2.2, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: SEA_LEVEL + 12, z: 0.5 };
  }

  // ---------------------------------------------------------------- การเซฟ

  /** แปลงส่วนต่างทั้งหมดเป็นรูปแบบที่เก็บลง IndexedDB ได้ */
  serializeEdits() {
    const out = [];
    for (const [key, map] of this.edits) {
      if (map.size === 0) continue;
      const indices = new Uint16Array(map.size);
      const blocks = new Uint8Array(map.size);
      let i = 0;
      for (const [index, id] of map) {
        indices[i] = index;
        blocks[i] = id;
        i++;
      }
      out.push({ key, indices, blocks });
    }
    return out;
  }

  /** โหลดส่วนต่างกลับเข้ามา (เรียกก่อนเริ่มสร้าง chunk) */
  loadEdits(records) {
    this.edits.clear();
    for (const rec of records || []) {
      const map = new Map();
      for (let i = 0; i < rec.indices.length; i++) map.set(rec.indices[i], rec.blocks[i]);
      this.edits.set(rec.key, map);
    }
  }

  get editCount() {
    let n = 0;
    for (const map of this.edits.values()) n += map.size;
    return n;
  }
}

export { BIOME, BIOME_NAME };
