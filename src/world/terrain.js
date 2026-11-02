/**
 * การสร้างภูมิประเทศแบบ procedural
 *
 * ไฟล์นี้ถูก import ทั้งใน main thread และใน Web Worker จึงห้ามแตะ DOM หรือ three.js
 * ทุกอย่างขึ้นกับ seed ล้วนๆ — seed เดียวกันได้โลกเดียวกันเป๊ะเสมอ
 */

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { mulberry32, hash2D } from './rng.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, voxelIndex } from '../config.js';
import { BLOCK } from '../blocks.js';

// ---------- ชนิดชีวนิเวศ ----------
export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4,
  MOUNTAIN: 5, SNOWY: 6, SNOWY_PEAK: 7, SAVANNA: 8,
};

export const BIOME_NAME = {
  [BIOME.OCEAN]: 'มหาสมุทร',
  [BIOME.BEACH]: 'ชายหาด',
  [BIOME.PLAINS]: 'ทุ่งหญ้า',
  [BIOME.FOREST]: 'ป่า',
  [BIOME.DESERT]: 'ทะเลทราย',
  [BIOME.MOUNTAIN]: 'ภูเขา',
  [BIOME.SNOWY]: 'ทุ่งหิมะ',
  [BIOME.SNOWY_PEAK]: 'ยอดเขาหิมะ',
  [BIOME.SAVANNA]: 'ทุ่งสะวันนา',
};

/** ผิวดินและความหนาแน่นต้นไม้ของแต่ละชีวนิเวศ */
const BIOME_SPEC = {
  [BIOME.OCEAN]: { top: BLOCK.SAND, filler: BLOCK.SAND, trees: 0 },
  [BIOME.BEACH]: { top: BLOCK.SAND, filler: BLOCK.SAND, trees: 0 },
  [BIOME.PLAINS]: { top: BLOCK.GRASS, filler: BLOCK.DIRT, trees: 0.07 },
  [BIOME.FOREST]: { top: BLOCK.GRASS, filler: BLOCK.DIRT, trees: 0.58 },
  [BIOME.DESERT]: { top: BLOCK.SAND, filler: BLOCK.SANDSTONE, trees: 0.05, cactus: true },
  [BIOME.MOUNTAIN]: { top: BLOCK.STONE, filler: BLOCK.STONE, trees: 0.04, spruce: true },
  [BIOME.SNOWY]: { top: BLOCK.SNOW, filler: BLOCK.DIRT, trees: 0.24, spruce: true },
  [BIOME.SNOWY_PEAK]: { top: BLOCK.SNOW, filler: BLOCK.STONE, trees: 0 },
  [BIOME.SAVANNA]: { top: BLOCK.GRASS, filler: BLOCK.DIRT, trees: 0.05 },
};

/** fractal Brownian motion — ซ้อน noise หลายชั้นให้ได้รายละเอียดหลายสเกล */
function fbm(noise, x, y, octaves, persistence = 0.5, lacunarity = 2) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * สร้างชุดฟังก์ชันภูมิประเทศจาก seed
 * @param {number} seed
 */
export function createTerrain(seed) {
  // แต่ละ noise ใช้ PRNG คนละสาย จึงไม่มีความสัมพันธ์ซ้อนกันเป็นลายซ้ำ
  const continentNoise = createNoise2D(mulberry32(seed + 101));
  const erosionNoise = createNoise2D(mulberry32(seed + 202));
  const detailNoise = createNoise2D(mulberry32(seed + 303));
  const tempNoise = createNoise2D(mulberry32(seed + 404));
  const humidNoise = createNoise2D(mulberry32(seed + 505));
  const caveA = createNoise3D(mulberry32(seed + 606));
  const caveB = createNoise3D(mulberry32(seed + 707));
  const cavernNoise = createNoise3D(mulberry32(seed + 808));
  const oreNoise = createNoise3D(mulberry32(seed + 909));

  // ---------- ความสูงพื้นดิน ----------
  function heightAt(x, z) {
    // ค่าความเป็นทวีป: ต่ำ = ทะเลลึก, สูง = แผ่นดินใน
    const cont = fbm(continentNoise, x * 0.0013, z * 0.0013, 4, 0.5, 2);
    // หน้ากากเทือกเขา สเกลใหญ่ — กำหนดว่าภูเขาจะไปโผล่เป็นแนวตรงไหน
    const range = fbm(erosionNoise, x * 0.0021, z * 0.0021, 2, 0.5, 2);
    const detail = fbm(detailNoise, x * 0.016, z * 0.016, 4, 0.5, 2);

    let h;
    if (cont < -0.12) {
      // แอ่งมหาสมุทร — ยิ่ง cont ต่ำยิ่งลึก
      const t = Math.min(1, (cont + 1) / 0.88);
      h = 18 + t * 27;
    } else {
      const t = (cont + 0.12) / 1.12;             // 0..1
      h = SEA_LEVEL + 1 + Math.pow(t, 1.6) * 26;  // เนินค่อยๆ ไต่ขึ้น
    }

    // เทือกเขา: ใช้ ridged noise (1 - |n|) ซึ่งให้ "สันเขา" คมชัดแทนเนินกลมๆ
    // แล้วคูณด้วยหน้ากากสเกลใหญ่ ภูเขาจึงรวมกลุ่มเป็นเทือก ไม่ใช่โผล่กระจัดกระจาย
    const mask = Math.max(0, range - 0.02) / 0.98;
    const inland = Math.max(0, Math.min(1, (cont + 0.02) * 3));
    const ridge = fbm(erosionNoise, x * 0.0055 + 91.3, z * 0.0055 - 47.7, 4, 0.5, 2.05);
    const ridged = Math.pow(1 - Math.abs(ridge), 2.4);
    h += ridged * mask * mask * inland * 84;

    h += detail * 4.5;

    return Math.max(1, Math.min(CHUNK_Y - 6, Math.round(h)));
  }

  // ---------- ชีวนิเวศ ----------
  function biomeAt(x, z, height) {
    const h = height ?? heightAt(x, z);
    const temp = fbm(tempNoise, x * 0.0018, z * 0.0018, 2, 0.5, 2);
    const humid = fbm(humidNoise, x * 0.0023, z * 0.0023, 2, 0.5, 2);

    if (h < SEA_LEVEL - 1) return BIOME.OCEAN;
    if (h <= SEA_LEVEL + 1) return temp < -0.3 ? BIOME.SNOWY : BIOME.BEACH;
    if (h > 96) return BIOME.SNOWY_PEAK;
    if (temp < -0.28) return BIOME.SNOWY;
    if (h > 80) return BIOME.MOUNTAIN;
    if (temp > 0.22 && humid < -0.05) return BIOME.DESERT;
    if (temp > 0.1 && humid < 0.15) return BIOME.SAVANNA;
    if (humid > 0.12) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  // ---------- ถ้ำ ----------
  // ใช้เทคนิค noise คู่: จุดที่ noise ทั้งสองใกล้ศูนย์พร้อมกัน = แกนกลางของอุโมงค์
  // ได้ถ้ำเป็นทางยาวคดเคี้ยว แทนที่จะเป็นรูพรุนกระจัดกระจาย
  function isCave(x, y, z, surfaceY) {
    if (y < 3 || y > surfaceY - 2) return false;

    const a = caveA(x * 0.0135, y * 0.028, z * 0.0135);
    const b = caveB(x * 0.0135, y * 0.028, z * 0.0135);
    if (a * a + b * b < 0.0035) return true;

    // โพรงกว้างที่ระดับลึก
    if (y < 42) {
      const c = cavernNoise(x * 0.026, y * 0.05, z * 0.026);
      const depthBias = (42 - y) / 42;
      if (c > 0.62 - depthBias * 0.16) return true;
    }
    return false;
  }

  // ---------- แร่ ----------
  function oreAt(x, y, z) {
    if (y > 84 || y < 2) return 0;
    const n = oreNoise(x * 0.085, y * 0.085, z * 0.085);
    if (y < 15 && n > 0.935) return BLOCK.DIAMOND_ORE;
    if (y < 32 && n > 0.915) return BLOCK.GOLD_ORE;
    if (y < 60 && n > 0.875) return BLOCK.IRON_ORE;
    if (n > 0.83) return BLOCK.COAL_ORE;
    if (n < -0.9 && y < 55) return BLOCK.GRAVEL;
    return 0;
  }

  return { heightAt, biomeAt, isCave, oreAt, seed };
}

// ---------------------------------------------------------------- ต้นไม้

/**
 * รูปทรงต้นไม้แต่ละชนิด คืน array ของ [dx, dy, dz, blockId, overwrite]
 * overwrite = true หมายถึงเขียนทับบล็อกเดิมได้ (ลำต้น), false = เขียนเฉพาะที่เป็นอากาศ (ใบ)
 */
function buildTree(kind, rand) {
  const parts = [];
  if (kind === 'cactus') {
    const h = 2 + Math.floor(rand() * 3);
    for (let y = 0; y < h; y++) parts.push([0, y, 0, BLOCK.CACTUS, true]);
    return parts;
  }

  const isSpruce = kind === 'spruce';
  const isBirch = kind === 'birch';
  const log = isSpruce ? BLOCK.SPRUCE_LOG : isBirch ? BLOCK.BIRCH_LOG : BLOCK.LOG;
  const leaf = isSpruce ? BLOCK.SPRUCE_LEAVES : isBirch ? BLOCK.BIRCH_LEAVES : BLOCK.LEAVES;
  const trunk = isSpruce ? 7 + Math.floor(rand() * 5)
    : isBirch ? 5 + Math.floor(rand() * 4)
      : 4 + Math.floor(rand() * 4);

  for (let y = 0; y < trunk; y++) parts.push([0, y, 0, log, true]);

  if (isSpruce) {
    // ทรงกรวยเป็นชั้นๆ
    let radius = 2;
    for (let y = trunk - 1; y >= 3; y--) {
      const r = ((trunk - y) % 3 === 0) ? radius : Math.max(1, radius - 1);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
          parts.push([dx, y, dz, leaf, false]);
        }
      }
      if ((trunk - y) % 4 === 0) radius = Math.min(3, radius + 1);
    }
    parts.push([0, trunk, 0, leaf, false]);
    parts.push([0, trunk + 1, 0, leaf, false]);
  } else {
    // พุ่มทรงกลมกดแบน — ชั้นล่างกว้างสุดแล้วสอบเข้าหายอด
    const top = trunk + 1;
    const wide = rand() < 0.45 ? 2 : 1;   // บางต้นพุ่มใหญ่ บางต้นพุ่มเล็ก
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 1 + wide : dy === 0 ? wide : 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          // สุ่มตัดมุมออกให้ดูเป็นพุ่มธรรมชาติ ไม่ใช่กล่องเป๊ะ
          if (Math.abs(dx) === r && Math.abs(dz) === r && (r > 1 ? rand() < 0.75 : rand() < 0.5)) continue;
          parts.push([dx, top + dy, dz, leaf, false]);
        }
      }
    }
  }
  return parts;
}

// ---------------------------------------------------------------- สร้าง chunk

/**
 * สร้างข้อมูล voxel ของ chunk หนึ่งก้อน
 *
 * @param {object} terrain ผลจาก createTerrain()
 * @param {number} cx พิกัด chunk แกน X
 * @param {number} cz พิกัด chunk แกน Z
 * @returns {{voxels: Uint8Array, heightMap: Uint8Array, biomeMap: Uint8Array}}
 */
export function generateChunk(terrain, cx, cz) {
  const voxels = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
  const heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
  const biomeMap = new Uint8Array(CHUNK_X * CHUNK_Z);
  const originX = cx * CHUNK_X;
  const originZ = cz * CHUNK_Z;

  // ---- 1. ชั้นดิน หิน และถ้ำ ----
  for (let lz = 0; lz < CHUNK_Z; lz++) {
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const wx = originX + lx;
      const wz = originZ + lz;
      const surface = terrain.heightAt(wx, wz);
      const biome = terrain.biomeAt(wx, wz, surface);
      const spec = BIOME_SPEC[biome];
      const col = lx + lz * CHUNK_X;
      heightMap[col] = Math.min(255, surface);
      biomeMap[col] = biome;

      const dirtDepth = biome === BIOME.MOUNTAIN || biome === BIOME.SNOWY_PEAK ? 1 : 3 + (hash2D(wx, wz, terrain.seed) % 2);

      for (let y = 0; y <= surface; y++) {
        let block;
        if (y === 0) {
          block = BLOCK.BEDROCK;
        } else if (y < 3 && (hash2D(wx * 31 + y, wz * 17, terrain.seed) & 3) === 0) {
          block = BLOCK.BEDROCK; // ขอบล่างขรุขระ
        } else if (y === surface) {
          // ผิวใต้ระดับน้ำเป็นทราย/กรวดแทนหญ้า
          block = surface < SEA_LEVEL ? (biome === BIOME.OCEAN ? BLOCK.SAND : BLOCK.GRAVEL) : spec.top;
        } else if (y > surface - dirtDepth) {
          block = surface < SEA_LEVEL && biome === BIOME.OCEAN ? BLOCK.SAND : spec.filler;
        } else {
          block = BLOCK.STONE;
        }

        // เจาะถ้ำ (ยกเว้นหินฐานโลก)
        if (block !== BLOCK.BEDROCK && terrain.isCave(wx, y, wz, surface)) continue;

        // ฝังแร่ในเนื้อหิน
        if (block === BLOCK.STONE) {
          const ore = terrain.oreAt(wx, y, wz);
          if (ore) block = ore;
        }

        voxels[voxelIndex(lx, y, lz)] = block;
      }

      // ---- 2. เติมน้ำถึงระดับน้ำทะเล ----
      for (let y = surface + 1; y <= SEA_LEVEL; y++) {
        if (voxels[voxelIndex(lx, y, lz)] === BLOCK.AIR) {
          // ผิวน้ำในเขตหนาวกลายเป็นน้ำแข็ง
          const freeze = y === SEA_LEVEL && (biome === BIOME.SNOWY || biome === BIOME.SNOWY_PEAK);
          voxels[voxelIndex(lx, y, lz)] = freeze ? BLOCK.ICE : BLOCK.WATER;
        }
      }

      // ---- 3. หิมะปกคลุมยอดเขาสูง ----
      if (surface > 88 && surface >= SEA_LEVEL && voxels[voxelIndex(lx, surface, lz)] === BLOCK.STONE) {
        voxels[voxelIndex(lx, surface, lz)] = BLOCK.SNOW;
      }
    }
  }

  // ---- 4. ต้นไม้ ----
  // สแกน chunk รอบข้าง ±1 ด้วย เพื่อให้ต้นไม้ที่ปลูกใกล้ขอบยื่นกิ่งข้ามมาได้ครบ
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      plantTreesFrom(terrain, cx + dx, cz + dz, cx, cz, voxels);
    }
  }

  return { voxels, heightMap, biomeMap };
}

/**
 * ปลูกต้นไม้ที่ "เป็นของ" chunk (sx, sz) แล้วเขียนเฉพาะบล็อกที่ตกอยู่ใน chunk (cx, cz)
 * การแยกเจ้าของแบบนี้ทำให้ต้นไม้ต้นเดียวกันถูกคำนวณเหมือนกันจากทุก chunk ที่มันคาบเกี่ยว
 * จึงไม่มีต้นไม้ขาดครึ่งตรงรอยต่อ
 */
function plantTreesFrom(terrain, sx, sz, cx, cz, voxels) {
  const rand = mulberry32(hash2D(sx, sz, terrain.seed ^ 0x9e3779b9));
  const attempts = 16;
  const baseX = sx * CHUNK_X;
  const baseZ = sz * CHUNK_Z;
  const targetX = cx * CHUNK_X;
  const targetZ = cz * CHUNK_Z;

  for (let i = 0; i < attempts; i++) {
    const wx = baseX + Math.floor(rand() * CHUNK_X);
    const wz = baseZ + Math.floor(rand() * CHUNK_Z);
    const roll = rand();
    const kindRoll = rand();

    const surface = terrain.heightAt(wx, wz);
    if (surface <= SEA_LEVEL) continue;

    const biome = terrain.biomeAt(wx, wz, surface);
    const spec = BIOME_SPEC[biome];
    if (!spec.trees || roll > spec.trees) continue;

    const kind = spec.cactus ? 'cactus' : spec.spruce ? 'spruce' : (kindRoll < 0.25 ? 'birch' : 'oak');
    const parts = buildTree(kind, rand);

    for (const [dx, dy, dz, block, overwrite] of parts) {
      const bx = wx + dx - targetX;
      const bz = wz + dz - targetZ;
      const by = surface + 1 + dy;
      if (bx < 0 || bx >= CHUNK_X || bz < 0 || bz >= CHUNK_Z) continue;
      if (by < 0 || by >= CHUNK_Y) continue;
      const idx = voxelIndex(bx, by, bz);
      if (!overwrite && voxels[idx] !== BLOCK.AIR) continue;
      voxels[idx] = block;
    }

    // เปลี่ยนบล็อกใต้ลำต้นเป็นดิน (กันต้นไม้ลอยเหนือหญ้าที่ถูกทับ)
    const rx = wx - targetX;
    const rz = wz - targetZ;
    if (rx >= 0 && rx < CHUNK_X && rz >= 0 && rz < CHUNK_Z && surface < CHUNK_Y) {
      const idx = voxelIndex(rx, surface, rz);
      if (voxels[idx] === BLOCK.GRASS) voxels[idx] = BLOCK.DIRT;
    }
  }
}

export { BIOME_SPEC };
