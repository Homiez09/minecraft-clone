import { CHUNK_X, CHUNK_Y, CHUNK_Z, CHUNK_AREA, voxelIndex } from '../config.js';
import { BLOCK } from '../blocks.js';

/** สถานะข้อมูล voxel ของ chunk */
export const CHUNK_STATE = { EMPTY: 0, GENERATING: 1, READY: 2 };
/** สถานะ mesh ของ chunk */
export const MESH_STATE = { NONE: 0, QUEUED: 1, BUILDING: 2, READY: 3, DIRTY: 4 };

/**
 * ก้อนโลกขนาด 16×128×16
 * เก็บแค่ข้อมูลล้วนๆ ส่วนการสร้าง mesh และการใส่เข้า scene เป็นหน้าที่ของ ChunkManager
 */
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.voxels = null;      // Uint8Array(32768)
    this.heightMap = null;   // Uint8Array(256) — ความสูงผิวดินเดิมของแต่ละคอลัมน์
    this.biomeMap = null;    // Uint8Array(256)
    this.state = CHUNK_STATE.EMPTY;
    this.meshState = MESH_STATE.NONE;
    /** THREE.Mesh ของแต่ละชั้นการเรนเดอร์ (solid / cutout / translucent) */
    this.meshes = [null, null, null];
    /** เพิ่มขึ้นทุกครั้งที่ voxel เปลี่ยน — ใช้ทิ้งผลลัพธ์ mesh ที่ล้าสมัย */
    this.version = 0;
  }

  get ready() {
    return this.state === CHUNK_STATE.READY;
  }

  setData(voxels, heightMap, biomeMap) {
    this.voxels = voxels;
    this.heightMap = heightMap;
    this.biomeMap = biomeMap;
    this.state = CHUNK_STATE.READY;
    this.version++;
  }

  getBlock(lx, ly, lz) {
    if (!this.voxels || ly < 0 || ly >= CHUNK_Y) return BLOCK.AIR;
    return this.voxels[voxelIndex(lx, ly, lz)];
  }

  setBlock(lx, ly, lz, id) {
    if (!this.voxels || ly < 0 || ly >= CHUNK_Y) return false;
    const i = voxelIndex(lx, ly, lz);
    if (this.voxels[i] === id) return false;
    this.voxels[i] = id;
    this.version++;
    return true;
  }

  /** ความสูงของบล็อกตันสูงสุดในคอลัมน์ (ใช้หาจุดวางตัวผู้เล่นตอนเกิด) */
  columnTop(lx, lz) {
    if (!this.voxels) return 0;
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      if (this.voxels[lx + lz * CHUNK_X + y * CHUNK_AREA] !== BLOCK.AIR) return y;
    }
    return 0;
  }

  /** คืนสำเนา voxel array (worker ต้องการสำเนาเพราะ main thread ยังใช้ต้นฉบับอยู่) */
  copyVoxels() {
    return this.voxels ? this.voxels.slice() : null;
  }
}

export { CHUNK_X, CHUNK_Y, CHUNK_Z };
