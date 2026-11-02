/**
 * material ของบล็อกทั้ง 4 ชั้น — ทุกตัวใช้ texture atlas ผืนเดียวกัน
 *
 * แสงเงาหลักถูกอบไว้ใน vertex color ตั้งแต่ตอนสร้าง mesh แล้ว
 * ที่ยังใช้ MeshLambertMaterial เพราะอยากให้แสงพระอาทิตย์ที่เคลื่อนที่จริง
 * มีผลกับด้านที่หันรับแสง ทำให้ช่วงเช้า–เย็นรู้สึกต่างจากตอนเที่ยงชัดเจน
 */

import * as THREE from 'three';
import { LAYER, LAYER_COUNT } from '../world/mesher.js';

/** เพิ่มคลื่นให้ผิวน้ำโดยแก้ vertex shader ของ material มาตรฐาน */
function addWaterWaves(material) {
  material.userData.uTime = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.uTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */`
      #include <begin_vertex>
      // ยกเฉพาะหน้าบนของผิวน้ำให้เป็นระลอก ส่วนผนังข้างอยู่นิ่งเพื่อไม่ให้เกิดรอยแหว่ง
      if (normal.y > 0.5) {
        vec3 worldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        transformed.y += sin(worldPos.x * 0.85 + uTime * 1.7) * 0.042
                       + sin(worldPos.z * 1.25 + uTime * 1.15) * 0.032;
      }
      `
    );
  };
  return material;
}

/**
 * @param {THREE.Texture} atlas
 * @returns {THREE.Material[]} เรียงตาม LAYER
 */
export function createBlockMaterials(atlas) {
  const materials = new Array(LAYER_COUNT);

  materials[LAYER.SOLID] = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
  });

  materials[LAYER.CUTOUT] = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.5,   // ตัดพิกเซลโปร่งทิ้งไปเลย จึงไม่ต้องเรียงลำดับการวาด
    transparent: false,
    side: THREE.DoubleSide,
  });

  materials[LAYER.TRANSLUCENT] = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: true,
  });

  materials[LAYER.WATER] = addWaterWaves(new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: true,     // กันไม่ให้มองทะลุน้ำหลายชั้นซ้อนจนสีเข้มผิดปกติ
    side: THREE.DoubleSide, // ต้องเห็นผิวน้ำจากใต้น้ำด้วย
  }));

  return materials;
}

/** เดินนาฬิกาของ shader น้ำ */
export function updateMaterials(materials, elapsed) {
  const water = materials[LAYER.WATER];
  if (water?.userData?.uTime) water.userData.uTime.value = elapsed;
}

export function disposeMaterials(materials) {
  for (const m of materials) m?.dispose();
}
