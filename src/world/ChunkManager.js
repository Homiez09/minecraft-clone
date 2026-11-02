/**
 * ตัวสตรีมโลก: ตัดสินใจว่า chunk ไหนต้องสร้าง สร้าง mesh หรือปลดทิ้ง
 * และเป็นเจ้าของ worker pool กับ mesh ทั้งหมดใน scene
 *
 * ลำดับงานของ chunk หนึ่งก้อน:
 *   EMPTY → (worker: gen) → READY → (worker: mesh เมื่อเพื่อนบ้านครบ 8 ทิศ) → มี mesh ใน scene
 *
 * ที่ต้องรอเพื่อนบ้านครบก่อน mesh เพราะการตัดหน้าและ ambient occlusion ต้องอ่านบล็อกข้าง chunk
 * จึงสร้างข้อมูลเผื่อไว้ 1 วงแหวนรอบระยะมองเห็นเสมอ
 */

import * as THREE from 'three';
import {
  CHUNK_X, CHUNK_Z, WORKER_COUNT, MAX_CHUNK_UPLOADS_PER_FRAME,
  UNLOAD_MARGIN, DEFAULT_RENDER_DISTANCE,
} from '../config.js';
import { CHUNK_STATE, MESH_STATE } from './Chunk.js';
import { World } from './World.js';
import { buildChunkMesh, LAYER_COUNT } from './mesher.js';

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [0, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export class ChunkManager {
  /**
   * @param {THREE.Scene} scene
   * @param {World} world
   * @param {THREE.Material[]} materials material ของแต่ละชั้น (solid/cutout/translucent)
   * @param {Float32Array} uvTable
   */
  constructor(scene, world, materials, uvTable) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.uvTable = uvTable;
    this.renderDistance = DEFAULT_RENDER_DISTANCE;

    this.genQueue = [];
    this.meshQueue = [];
    this.uploads = [];
    this.nextJobId = 1;
    this.lastCx = null;
    this.lastCz = null;
    this.dirty = true;

    this.stats = { generated: 0, meshed: 0, queuedGen: 0, queuedMesh: 0 };

    this.workers = [];
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(new URL('../workers/chunkWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => this.onWorkerMessage(worker, e.data);
      worker.postMessage({ type: 'init', seed: world.seed, uvTable });
      this.workers.push({ worker, job: null });
    }
  }

  dispose() {
    for (const w of this.workers) w.worker.terminate();
    this.workers.length = 0;
    for (const chunk of this.world.chunks.values()) this.disposeMeshes(chunk);
    this.world.chunks.clear();
    this.genQueue.length = 0;
    this.meshQueue.length = 0;
    this.uploads.length = 0;
  }

  setRenderDistance(rd) {
    this.renderDistance = rd;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- วงจรหลัก

  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_X);
    const pcz = Math.floor(playerZ / CHUNK_Z);

    if (pcx !== this.lastCx || pcz !== this.lastCz || this.dirty) {
      this.lastCx = pcx;
      this.lastCz = pcz;
      this.dirty = false;
      this.rescan(pcx, pcz);
    }

    this.dispatch();
    this.flushUploads();

    this.stats.queuedGen = this.genQueue.length;
    this.stats.queuedMesh = this.meshQueue.length;
  }

  /** สำรวจว่าต้องสร้าง/ทิ้ง chunk ไหนบ้าง แล้วจัดคิวใหม่เรียงตามระยะจากผู้เล่น */
  rescan(pcx, pcz) {
    const rd = this.renderDistance;
    const genRadius = rd + 1;   // สร้างข้อมูลเผื่อ 1 วงแหวนเพื่อให้ mesh ขอบในถูกต้อง
    const dropRadius = rd + 1 + UNLOAD_MARGIN;

    this.genQueue.length = 0;
    this.meshQueue.length = 0;

    for (let dz = -genRadius; dz <= genRadius; dz++) {
      for (let dx = -genRadius; dx <= genRadius; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > genRadius) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const chunk = this.world.getOrCreateChunk(cx, cz);

        if (chunk.state === CHUNK_STATE.EMPTY) {
          this.genQueue.push({ cx, cz, dist });
        } else if (chunk.state === CHUNK_STATE.READY && dist <= rd) {
          if (chunk.meshState === MESH_STATE.NONE || chunk.meshState === MESH_STATE.DIRTY) {
            if (this.neighborsReady(cx, cz)) this.meshQueue.push({ cx, cz, dist });
          }
        }
      }
    }

    this.genQueue.sort((a, b) => a.dist - b.dist);
    this.meshQueue.sort((a, b) => a.dist - b.dist);

    // ปลด chunk ที่ไกลเกินไปเพื่อคืนหน่วยความจำ
    for (const chunk of [...this.world.chunks.values()]) {
      const dist = Math.hypot(chunk.cx - pcx, chunk.cz - pcz);
      if (dist > dropRadius) {
        this.disposeMeshes(chunk);
        this.world.removeChunk(chunk.cx, chunk.cz);
      }
    }
  }

  neighborsReady(cx, cz) {
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const n = this.world.getChunk(cx + dx, cz + dz);
      if (!n || n.state !== CHUNK_STATE.READY) return false;
    }
    return true;
  }

  /** ส่งงานที่คิวไว้ให้ worker ที่ว่าง (งานสร้างข้อมูลมาก่อนเสมอ เพราะ mesh ต้องรอมันอยู่ดี) */
  dispatch() {
    for (const slot of this.workers) {
      if (slot.job) continue;

      let job = null;
      while (this.genQueue.length && !job) {
        const item = this.genQueue.shift();
        const chunk = this.world.getChunk(item.cx, item.cz);
        if (chunk && chunk.state === CHUNK_STATE.EMPTY) {
          chunk.state = CHUNK_STATE.GENERATING;
          job = { type: 'gen', id: this.nextJobId++, cx: item.cx, cz: item.cz };
        }
      }

      while (this.meshQueue.length && !job) {
        const item = this.meshQueue.shift();
        job = this.makeMeshJob(item.cx, item.cz);
      }

      if (!job) break;
      slot.job = job;
      slot.worker.postMessage(job);
    }
  }

  /** เตรียมข้อมูล voxel ของ chunk และเพื่อนบ้านทั้ง 9 ก้อนไปให้ worker */
  makeMeshJob(cx, cz) {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk || chunk.state !== CHUNK_STATE.READY) return null;
    if (chunk.meshState === MESH_STATE.BUILDING) return null;
    if (!this.neighborsReady(cx, cz)) return null;

    const voxels = new Array(9).fill(null);
    const heights = new Array(9).fill(null);
    for (let i = 0; i < 9; i++) {
      const [dx, dz] = NEIGHBOR_OFFSETS[i];
      const n = this.world.getChunk(cx + dx, cz + dz);
      // ส่งสำเนาไป เพราะ main thread ยังต้องใช้ต้นฉบับสำหรับฟิสิกส์และการเล็งบล็อก
      voxels[i] = n.voxels.slice();
      heights[i] = n.heightMap;
    }

    chunk.meshState = MESH_STATE.BUILDING;
    return {
      type: 'mesh', id: this.nextJobId++, cx, cz,
      version: chunk.version, voxels, heights,
    };
  }

  // ---------------------------------------------------------------- ข้อความจาก worker

  onWorkerMessage(worker, msg) {
    const slot = this.workers.find((s) => s.worker === worker);
    if (msg.type === 'ready') return;
    if (slot) slot.job = null;

    if (msg.type === 'gen') {
      const chunk = this.world.getChunk(msg.cx, msg.cz);
      if (!chunk) return;                       // ผู้เล่นเดินไปไกลจน chunk ถูกปลดไปแล้ว
      chunk.setData(msg.voxels, msg.heightMap, msg.biomeMap);
      this.world.applyEdits(chunk);
      this.stats.generated++;
      // chunk ใหม่ทำให้ตัวมันเองและเพื่อนบ้านอาจ mesh ได้แล้ว
      this.considerMeshing(msg.cx, msg.cz);
      for (const [dx, dz] of NEIGHBOR_OFFSETS) this.considerMeshing(msg.cx + dx, msg.cz + dz);
    } else if (msg.type === 'mesh') {
      const chunk = this.world.getChunk(msg.cx, msg.cz);
      if (!chunk) return;
      if (chunk.version !== msg.version) {
        // บล็อกถูกแก้ระหว่างที่ worker ทำงาน → ผลลัพธ์นี้ล้าสมัย ขอใหม่
        chunk.meshState = MESH_STATE.DIRTY;
        this.considerMeshing(msg.cx, msg.cz);
        return;
      }
      this.uploads.push({ chunk, layers: msg.layers });
    }

    this.dispatch();
  }

  /** ถ้า chunk นี้อยู่ในระยะและพร้อม ก็ใส่คิวสร้าง mesh */
  considerMeshing(cx, cz) {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk || chunk.state !== CHUNK_STATE.READY) return;
    if (chunk.meshState === MESH_STATE.BUILDING || chunk.meshState === MESH_STATE.QUEUED) return;
    if (chunk.meshState === MESH_STATE.READY) return;
    if (this.lastCx === null) return;
    if (Math.hypot(cx - this.lastCx, cz - this.lastCz) > this.renderDistance) return;
    if (!this.neighborsReady(cx, cz)) return;

    chunk.meshState = MESH_STATE.QUEUED;
    this.meshQueue.push({ cx, cz, dist: Math.hypot(cx - this.lastCx, cz - this.lastCz) });
    this.meshQueue.sort((a, b) => a.dist - b.dist);
  }

  // ---------------------------------------------------------------- อัปโหลดเข้า scene

  /** ใส่ geometry ที่ worker ส่งมาเข้า scene โดยจำกัดจำนวนต่อเฟรมกันเฟรมกระตุก */
  flushUploads() {
    let count = 0;
    while (this.uploads.length && count < MAX_CHUNK_UPLOADS_PER_FRAME) {
      const { chunk, layers } = this.uploads.shift();
      if (!this.world.getChunk(chunk.cx, chunk.cz)) continue;
      this.applyMesh(chunk, layers);
      count++;
    }
  }

  applyMesh(chunk, layers) {
    this.disposeMeshes(chunk);
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      const data = layers[layer];
      if (!data) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeBoundingSphere();

      const mesh = new THREE.Mesh(geo, this.materials[layer]);
      mesh.position.set(chunk.cx * CHUNK_X, 0, chunk.cz * CHUNK_Z);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = layer;
      this.scene.add(mesh);
      chunk.meshes[layer] = mesh;
    }
    chunk.meshState = MESH_STATE.READY;
    this.stats.meshed++;
  }

  disposeMeshes(chunk) {
    for (let i = 0; i < LAYER_COUNT; i++) {
      const mesh = chunk.meshes[i];
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      chunk.meshes[i] = null;
    }
    if (chunk.meshState === MESH_STATE.READY) chunk.meshState = MESH_STATE.NONE;
  }

  // ---------------------------------------------------------------- แก้บล็อกทันที

  /**
   * สร้าง mesh ใหม่ทันทีบน main thread หลังผู้เล่นทุบหรือวางบล็อก
   * ทำแบบ synchronous เพราะต้องเห็นผลในเฟรมเดียวกัน (ไม่งั้นรู้สึกหน่วง)
   */
  rebuildImmediate(keys) {
    for (const key of keys) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = this.world.getChunk(cx, cz);
      if (!chunk || chunk.state !== CHUNK_STATE.READY) continue;
      if (!this.neighborsReady(cx, cz)) {
        chunk.meshState = MESH_STATE.DIRTY;
        continue;
      }

      const voxels = new Array(9).fill(null);
      const heights = new Array(9).fill(null);
      for (let i = 0; i < 9; i++) {
        const [dx, dz] = NEIGHBOR_OFFSETS[i];
        const n = this.world.getChunk(cx + dx, cz + dz);
        voxels[i] = n.voxels;
        heights[i] = n.heightMap;
      }

      const layers = buildChunkMesh({ voxels, heights, uvTable: this.uvTable });
      this.applyMesh(chunk, layers);
    }
  }

  /** จำนวน chunk ที่มี mesh อยู่ใน scene แล้ว */
  get visibleChunks() {
    let n = 0;
    for (const chunk of this.world.chunks.values()) {
      if (chunk.meshState === MESH_STATE.READY) n++;
    }
    return n;
  }

  /** true เมื่อ chunk รอบตัวผู้เล่นพร้อมพอที่จะเริ่มเล่นได้อย่างปลอดภัย */
  isAreaReady(px, pz, radius = 1) {
    const pcx = Math.floor(px / CHUNK_X);
    const pcz = Math.floor(pz / CHUNK_Z);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunk = this.world.getChunk(pcx + dx, pcz + dz);
        if (!chunk || chunk.state !== CHUNK_STATE.READY) return false;
      }
    }
    return true;
  }

  /** สัดส่วนความคืบหน้าของการโหลดพื้นที่เริ่มต้น 0..1 */
  loadProgress() {
    const rd = this.renderDistance;
    let total = 0, done = 0;
    for (let dz = -rd; dz <= rd; dz++) {
      for (let dx = -rd; dx <= rd; dx++) {
        if (Math.hypot(dx, dz) > rd) continue;
        total++;
        const chunk = this.world.getChunk((this.lastCx ?? 0) + dx, (this.lastCz ?? 0) + dz);
        if (chunk && chunk.meshState === MESH_STATE.READY) done++;
      }
    }
    return total ? done / total : 0;
  }
}
