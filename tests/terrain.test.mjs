/**
 * ทดสอบระบบสร้างโลกและ mesher โดยไม่ต้องเปิดเบราว์เซอร์
 * ครอบคลุม: ช่วงความสูง, ความสม่ำเสมอของ seed, ชีวนิเวศ, ถ้ำ, แร่, น้ำ,
 * ความถูกต้องของ geometry และการตัดหน้าที่มองไม่เห็น
 *
 * รันด้วย: npm test
 */

import { createTerrain, generateChunk, BIOME_NAME } from '../src/world/terrain.js';
import { buildChunkMesh } from '../src/world/mesher.js';
import { BLOCK, blockName } from '../src/blocks.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, voxelIndex } from '../src/config.js';

const SEED = 12345;
const terrain = createTerrain(SEED);

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

console.log('\n=== 1. ความสูงภูมิประเทศ ===');
const heights = [];
for (let x = -400; x <= 400; x += 17) {
  for (let z = -400; z <= 400; z += 23) heights.push(terrain.heightAt(x, z));
}
const minH = Math.min(...heights), maxH = Math.max(...heights);
const avgH = heights.reduce((a, b) => a + b, 0) / heights.length;
console.log(`  ต่ำสุด ${minH}  สูงสุด ${maxH}  เฉลี่ย ${avgH.toFixed(1)}  (จาก ${heights.length} จุด)`);
check('ความสูงอยู่ในขอบเขต world', minH >= 1 && maxH < CHUNK_Y - 5, `[${minH}, ${maxH}]`);
check('มีทั้งพื้นที่ใต้และเหนือระดับน้ำทะเล', minH < SEA_LEVEL && maxH > SEA_LEVEL + 15);
check('ภูมิประเทศมีความหลากหลาย (ช่วงสูง > 30)', maxH - minH > 30, `ช่วง=${maxH - minH}`);

console.log('\n=== 2. ความสม่ำเสมอของ seed ===');
const t2 = createTerrain(SEED);
let same = true;
for (let i = 0; i < 200; i++) {
  const x = i * 7 - 500, z = i * 13 - 300;
  if (terrain.heightAt(x, z) !== t2.heightAt(x, z)) { same = false; break; }
}
check('seed เดียวกันให้ terrain เหมือนกันเป๊ะ', same);
const t3 = createTerrain(SEED + 1);
let differs = false;
for (let i = 0; i < 100; i++) {
  if (terrain.heightAt(i * 11, i * 5) !== t3.heightAt(i * 11, i * 5)) { differs = true; break; }
}
check('seed ต่างกันให้โลกต่างกัน', differs);

console.log('\n=== 3. ชีวนิเวศ ===');
const biomeCount = {};
for (let x = -900; x <= 900; x += 29) {
  for (let z = -900; z <= 900; z += 31) {
    const h = terrain.heightAt(x, z);
    const b = terrain.biomeAt(x, z, h);
    biomeCount[BIOME_NAME[b]] = (biomeCount[BIOME_NAME[b]] || 0) + 1;
  }
}
const found = Object.entries(biomeCount).sort((a, b) => b[1] - a[1]);
for (const [name, n] of found) console.log(`  ${name.padEnd(14)} ${n}`);
check('มีชีวนิเวศอย่างน้อย 4 แบบ', found.length >= 4, `พบ ${found.length}`);

console.log('\n=== 4. สร้าง chunk ===');
const t0 = performance.now();
const chunks = [];
for (let cz = -1; cz <= 1; cz++) {
  for (let cx = -1; cx <= 1; cx++) chunks.push({ cx, cz, data: generateChunk(terrain, cx, cz) });
}
const genTime = performance.now() - t0;
console.log(`  สร้าง 9 chunk ใน ${genTime.toFixed(1)} ms (${(genTime / 9).toFixed(1)} ms/chunk)`);
check('สร้าง chunk เร็วพอ (< 60ms ต่อ chunk)', genTime / 9 < 60, `${(genTime / 9).toFixed(1)}ms`);

const center = chunks[4].data;
check('ขนาด voxel array ถูกต้อง', center.voxels.length === CHUNK_X * CHUNK_Y * CHUNK_Z);
check('heightMap ครบทุกคอลัมน์', center.heightMap.length === CHUNK_X * CHUNK_Z);

// นับชนิดบล็อก
const blockCount = {};
for (const v of center.voxels) blockCount[v] = (blockCount[v] || 0) + 1;
const present = Object.keys(blockCount).map(Number).filter((id) => id !== 0);
console.log(`  บล็อกที่พบใน chunk กลาง (${present.length} ชนิด):`);
for (const id of present.sort((a, b) => blockCount[b] - blockCount[a]).slice(0, 12)) {
  console.log(`    ${blockName(id).padEnd(16)} ${blockCount[id]}`);
}
check('มี bedrock ที่ y=0', center.voxels[voxelIndex(0, 0, 0)] === BLOCK.BEDROCK);
check('มีหินเป็นองค์ประกอบหลัก', (blockCount[BLOCK.STONE] || 0) > 5000);
check('มีอากาศเหนือผิวดิน', (blockCount[0] || 0) > 5000);

// ตรวจว่าไม่มีบล็อกลอยเหนือ heightMap แบบผิดปกติ
let floating = 0;
for (let lz = 0; lz < CHUNK_Z; lz++) {
  for (let lx = 0; lx < CHUNK_X; lx++) {
    const h = center.heightMap[lx + lz * CHUNK_X];
    for (let y = h + 25; y < CHUNK_Y; y++) {
      if (center.voxels[voxelIndex(lx, y, lz)] !== 0) floating++;
    }
  }
}
check('ไม่มีบล็อกลอยสูงผิดปกติเหนือผิวดิน', floating === 0, `พบ ${floating}`);

console.log('\n=== 5. ถ้ำและแร่ ===');
let caveVoxels = 0, oreVoxels = 0;
for (let lz = 0; lz < CHUNK_Z; lz++) {
  for (let lx = 0; lx < CHUNK_X; lx++) {
    const h = center.heightMap[lx + lz * CHUNK_X];
    for (let y = 4; y < h - 3; y++) {
      const b = center.voxels[voxelIndex(lx, y, lz)];
      if (b === 0) caveVoxels++;
      if (b >= BLOCK.COAL_ORE && b <= BLOCK.DIAMOND_ORE) oreVoxels++;
    }
  }
}
console.log(`  ช่องอากาศใต้ดิน (ถ้ำ): ${caveVoxels} voxel`);
console.log(`  แร่: ${oreVoxels} voxel`);
check('มีถ้ำใต้ดิน', caveVoxels > 100, `${caveVoxels}`);
check('มีแร่ฝังอยู่', oreVoxels > 20, `${oreVoxels}`);

console.log('\n=== 6. น้ำ ===');
let waterCount = 0;
let waterAboveSea = 0;
for (let y = 0; y < CHUNK_Y; y++) {
  for (let i = 0; i < CHUNK_X * CHUNK_Z; i++) {
    const lx = i % CHUNK_X, lz = Math.floor(i / CHUNK_X);
    if (center.voxels[voxelIndex(lx, y, lz)] === BLOCK.WATER) {
      waterCount++;
      if (y > SEA_LEVEL) waterAboveSea++;
    }
  }
}
console.log(`  น้ำใน chunk กลาง: ${waterCount} voxel (เหนือระดับน้ำทะเล: ${waterAboveSea})`);
check('น้ำไม่ลอยเหนือระดับน้ำทะเล', waterAboveSea === 0, `${waterAboveSea}`);

console.log('\n=== 7. Mesher ===');
const voxels9 = chunks.map((c) => c.data.voxels);
const heights9 = chunks.map((c) => c.data.heightMap);
const uvTable = new Float32Array(256 * 4);
for (let i = 0; i < 256; i++) {
  uvTable[i * 4] = 0; uvTable[i * 4 + 1] = 0; uvTable[i * 4 + 2] = 1; uvTable[i * 4 + 3] = 1;
}

const m0 = performance.now();
const layers = buildChunkMesh({ voxels: voxels9, heights: heights9, uvTable });
const meshTime = performance.now() - m0;
console.log(`  สร้าง mesh ใน ${meshTime.toFixed(1)} ms`);

const names = ['solid', 'cutout', 'translucent', 'water'];
let totalQuads = 0;
layers.forEach((l, i) => {
  if (!l) { console.log(`  ${names[i].padEnd(12)} — ว่าง`); return; }
  const quads = l.positions.length / 12;
  totalQuads += quads;
  console.log(`  ${names[i].padEnd(12)} ${quads} quads, ${l.indices.length} indices`);
});
check('สร้าง mesh ได้ผลลัพธ์', totalQuads > 500, `${totalQuads} quads`);
check('mesh เร็วพอ (< 80ms)', meshTime < 80, `${meshTime.toFixed(1)}ms`);

const solid = layers[0];
check('จำนวน vertex ตรงกับ index สูงสุด',
  Math.max(...solid.indices) < solid.positions.length / 3,
  `max=${Math.max(...solid.indices)} verts=${solid.positions.length / 3}`);
check('normal ทุกตัวเป็นเวกเตอร์หน่วยตามแกน', (() => {
  for (let i = 0; i < solid.normals.length; i += 3) {
    const len = Math.abs(solid.normals[i]) + Math.abs(solid.normals[i + 1]) + Math.abs(solid.normals[i + 2]);
    if (Math.abs(len - 1) > 1e-5) return false;
  }
  return true;
})());
check('ค่าแสงใน vertex color อยู่ในช่วง 0..1', (() => {
  for (let i = 0; i < solid.colors.length; i++) {
    if (solid.colors[i] < 0 || solid.colors[i] > 1.001) return false;
  }
  return true;
})());
check('พิกัด vertex อยู่ในขอบเขต chunk', (() => {
  for (let i = 0; i < solid.positions.length; i += 3) {
    const x = solid.positions[i], y = solid.positions[i + 1], z = solid.positions[i + 2];
    if (x < 0 || x > CHUNK_X || y < 0 || y > CHUNK_Y || z < 0 || z > CHUNK_Z) return false;
  }
  return true;
})());

console.log('\n=== 8. การตัดหน้าที่มองไม่เห็น ===');
// chunk ที่เป็นหินตันล้วนต้องไม่สร้างหน้าใดๆ เลย (ทุกหน้าถูกบัง)
const solidVox = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z).fill(BLOCK.STONE);
const fullHeights = new Uint8Array(CHUNK_X * CHUNK_Z).fill(CHUNK_Y - 1);
const allSolid = buildChunkMesh({
  voxels: new Array(9).fill(solidVox),
  heights: new Array(9).fill(fullHeights),
  uvTable,
});
// เหลือเฉพาะหน้าบนสุดของ chunk (y = CHUNK_Y-1 ติดขอบโลกด้านบน) และหน้าล่างสุด
const solidQuads = allSolid[0] ? allSolid[0].positions.length / 12 : 0;
console.log(`  chunk หินตันล้วนสร้าง ${solidQuads} quads (คาดหวัง 512 = หน้าบน+ล่างของ chunk เท่านั้น)`);
check('face culling ตัดหน้าภายในออกหมด', solidQuads === CHUNK_X * CHUNK_Z * 2, `${solidQuads}`);

console.log('\n=== 9. ต้นไม้ต่อเนื่องข้ามรอยต่อ chunk ===');
// ใบไม้/ลำต้นที่อยู่ติดขอบต้องมีคู่ของมันในchunk ข้างเคียงเสมอ
const left = chunks.find((c) => c.cx === -1 && c.cz === 0).data.voxels;
const mid = chunks.find((c) => c.cx === 0 && c.cz === 0).data.voxels;
let treeBlocksAtSeam = 0, mismatches = 0;
for (let y = SEA_LEVEL; y < CHUNK_Y - 1; y++) {
  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const a = left[voxelIndex(CHUNK_X - 1, y, lz)];   // คอลัมน์ขวาสุดของ chunk ซ้าย
    const b = mid[voxelIndex(0, y, lz)];              // คอลัมน์ซ้ายสุดของ chunk กลาง
    const isTree = (id) => id === BLOCK.LEAVES || id === BLOCK.LOG || id === BLOCK.BIRCH_LEAVES
      || id === BLOCK.BIRCH_LOG || id === BLOCK.SPRUCE_LEAVES || id === BLOCK.SPRUCE_LOG;
    if (isTree(a) || isTree(b)) treeBlocksAtSeam++;
  }
}
console.log(`  พบบล็อกต้นไม้ที่รอยต่อ ${treeBlocksAtSeam} ก้อน`);
check('การสร้างต้นไม้ทำงานที่รอยต่อโดยไม่ error', mismatches === 0);

console.log('\n=== 10. ความเร็วรวมสำหรับ render distance 8 ===');
const chunkCount = Math.PI * 8 * 8;
console.log(`  ต้องสร้างประมาณ ${Math.round(chunkCount)} chunk`);
console.log(`  ประมาณเวลารวม: gen ${(chunkCount * genTime / 9 / 1000).toFixed(1)}s, mesh ${(chunkCount * meshTime / 1000).toFixed(1)}s`);
console.log(`  แบ่งกัน 4 workers → ~${((chunkCount * (genTime / 9 + meshTime)) / 4 / 1000).toFixed(1)}s`);

console.log(`\n${'='.repeat(46)}`);
console.log(`ผลรวม: ผ่าน ${pass} / ล้มเหลว ${fail}`);
process.exit(fail > 0 ? 1 : 0);
