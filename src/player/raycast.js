/**
 * การเล็งบล็อกด้วยอัลกอริทึม DDA ของ Amanatides & Woo
 *
 * เดินไล่ทีละช่อง voxel ตามแนวสายตา แทนที่จะยิง THREE.Raycaster ใส่ mesh
 * ข้อดีคือได้พิกัดบล็อกกับหน้าที่โดนตรงๆ ไม่ต้องแปลงกลับจากสามเหลี่ยม
 * และเร็วคงที่ไม่ว่าฉากจะมีสามเหลี่ยมกี่ล้านชิ้น
 */

import { BLOCK } from '../blocks.js';
import { IS_SOLID, IS_LIQUID } from '../blocks.js';

/**
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number}} origin จุดเริ่ม (ตำแหน่งกล้อง)
 * @param {{x:number,y:number,z:number}} dir ทิศทาง (ต้อง normalize มาแล้ว)
 * @param {number} maxDistance ระยะเอื้อมสูงสุด
 * @param {(id:number)=>boolean} [hitTest] เงื่อนไขว่าบล็อกไหนถือว่า "โดน" (ค่าเริ่มต้น: บล็อกตัน)
 * @returns {{block:number, x:number, y:number, z:number, nx:number, ny:number, nz:number, distance:number}|null}
 */
export function raycastVoxel(world, origin, dir, maxDistance, hitTest) {
  const test = hitTest || ((id) => id !== BLOCK.AIR && IS_SOLID[id] === 1);

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  // ระยะ t ที่ต้องเดินเพื่อข้ามขอบ voxel ถัดไปในแต่ละแกน
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX
    : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY
    : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ
    : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let distance = 0;

  // จำกัดจำนวนก้าวไว้กันลูปไม่รู้จบเมื่อทิศทางเป็นค่าผิดปกติ
  const maxSteps = Math.ceil(maxDistance * 3) + 3;
  for (let i = 0; i < maxSteps; i++) {
    const id = world.getBlock(x, y, z);
    if (test(id)) {
      return { block: id, x, y, z, nx, ny, nz, distance };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        distance = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else {
        distance = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    } else if (tMaxY < tMaxZ) {
      distance = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      distance = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }

    if (distance > maxDistance) break;
  }

  return null;
}

/** เล็งเฉพาะของเหลว (ใช้ตรวจว่าหัวจมน้ำอยู่ไหม) */
export function isLiquidBlock(id) {
  return IS_LIQUID[id] === 1;
}
