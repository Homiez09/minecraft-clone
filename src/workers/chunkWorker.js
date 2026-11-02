/**
 * Web Worker ที่รับผิดชอบงานหนักสองอย่าง — สร้างภูมิประเทศ และสร้าง geometry
 * ทั้งคู่ทำนอก main thread เพื่อไม่ให้เฟรมกระตุกตอนเดินเข้าพื้นที่ใหม่
 *
 * โปรโตคอลข้อความ:
 *   → { type: 'init', seed, uvTable }
 *   → { type: 'gen', id, cx, cz }                      ← ขอข้อมูล voxel
 *   ← { type: 'gen', id, cx, cz, voxels, heightMap, biomeMap }
 *   → { type: 'mesh', id, cx, cz, version, voxels[9], heights[9] }
 *   ← { type: 'mesh', id, cx, cz, version, layers }
 */

import { createTerrain, generateChunk } from '../world/terrain.js';
import { buildChunkMesh } from '../world/mesher.js';

let terrain = null;
let uvTable = null;

self.onmessage = function (e) {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      terrain = createTerrain(msg.seed);
      uvTable = msg.uvTable;
      self.postMessage({ type: 'ready' });
      break;
    }

    case 'gen': {
      const { voxels, heightMap, biomeMap } = generateChunk(terrain, msg.cx, msg.cz);
      self.postMessage(
        { type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, voxels, heightMap, biomeMap },
        [voxels.buffer, heightMap.buffer, biomeMap.buffer]
      );
      break;
    }

    case 'mesh': {
      const layers = buildChunkMesh({ voxels: msg.voxels, heights: msg.heights, uvTable });

      // ส่ง buffer กลับแบบย้ายเจ้าของ (zero-copy) — main thread นำไปใส่ BufferGeometry ได้ทันที
      const transfers = [];
      for (const layer of layers) {
        if (!layer) continue;
        transfers.push(
          layer.positions.buffer, layer.normals.buffer,
          layer.uvs.buffer, layer.colors.buffer, layer.indices.buffer
        );
      }
      self.postMessage(
        { type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, version: msg.version, layers },
        transfers
      );
      break;
    }
  }
};
