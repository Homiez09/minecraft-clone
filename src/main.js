/**
 * VoxelCraft — เกมสร้างโลกบล็อก 3 มิติ
 *
 * ไฟล์นี้เป็นตัวประสาน: ตั้งค่า renderer, คุมสถานะของเกม (เมนู → โหลด → เล่น → หยุด)
 * และเดินลูปหลักที่เรียกอัปเดตทุกระบบตามลำดับที่ถูกต้องในแต่ละเฟรม
 */

import * as THREE from 'three';

import {
  DEFAULT_FOV, NEAR_PLANE, DEFAULT_RENDER_DISTANCE, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE,
  REACH_DISTANCE, BREAK_COOLDOWN, PLACE_COOLDOWN, DOUBLE_TAP_MS, AUTOSAVE_INTERVAL,
  START_TIME, CHUNK_X, CHUNK_Z, PLAYER_WIDTH, PLAYER_HEIGHT,
} from './config.js';
import { BLOCK, BLOCKS, IS_SOLID, IS_LIQUID, blockName } from './blocks.js';
import { buildAtlas, buildUVTable } from './textures.js';

import { World } from './world/World.js';
import { ChunkManager } from './world/ChunkManager.js';
import { seedFromString } from './world/rng.js';

import { Player } from './player/Player.js';
import { Controls } from './player/Controls.js';
import { raycastVoxel } from './player/raycast.js';

import { createBlockMaterials, updateMaterials } from './render/materials.js';
import { Sky } from './render/sky.js';
import { Clouds } from './render/clouds.js';

import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { SFX } from './audio/sfx.js';
import { Storage } from './save/storage.js';

const STATE = { MENU: 'menu', LOADING: 'loading', READY: 'ready', PLAYING: 'playing', PAUSED: 'paused' };

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = STATE.MENU;

    this.settings = {
      renderDistance: DEFAULT_RENDER_DISTANCE,
      fov: DEFAULT_FOV,
      sound: true,
    };

    this.world = null;
    this.chunks = null;
    this.player = null;
    this.clouds = null;

    this.breakTimer = 0;
    this.placeTimer = 0;
    this.autosaveTimer = 0;
    this.lastSpaceTap = 0;
    this.lastFallSpeed = 0;
    this.wasInWater = false;
    this.frameTimes = [];
    this.lastFrame = performance.now();
    this.elapsed = 0;

    this.setupRenderer();
    this.setupInput();

    this.storage = new Storage();
    this.sfx = new SFX();
    this.hud = new HUD(this.scene);
    this.menu = new Menu({
      onNewWorld: (seed) => this.startNewWorld(seed),
      onContinue: () => this.continueWorld(),
      onDelete: () => this.deleteSave(),
      onResume: () => this.resume(),
      onSaveQuit: () => this.saveAndQuit(),
      onSetting: (key, value) => this.applySetting(key, value),
    });
    this.menu.syncSettings(this.settings);

    this.storage.hasSave().then((has) => this.menu.showMain(has));

    // บันทึกอัตโนมัติเมื่อผู้เล่นปิดแท็บหรือสลับไปทำอย่างอื่น
    window.addEventListener('beforeunload', () => {
      if (this.world) this.saveGame();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    });

    // เปิดให้เรียกดูสถานะเกมจาก console ของเบราว์เซอร์ได้ (เช่น game.player.position)
    window.game = this;

    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- ตั้งค่าเครื่องเรนเดอร์

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x8ec5e8);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov, window.innerWidth / window.innerHeight, NEAR_PLANE, 2000
    );
    this.scene.add(this.camera);

    // แสงติดตัวผู้เล่น — ทำให้สำรวจถ้ำมืดได้โดยไม่ต้องทำระบบคบไฟเต็มรูปแบบ
    // ความสว่างถูกปรับตามความลึกใต้ดินใน updatePlaying() กลางแจ้งจึงแทบไม่มีผล
    this.headLamp = new THREE.PointLight(0xffe0b8, 0.25, 24, 1.0);
    this.camera.add(this.headLamp);

    this.atlas = buildAtlas();
    this.uvTable = buildUVTable();
    this.materials = createBlockMaterials(this.atlas);

    this.sky = new Sky(this.scene, START_TIME);
    this.updateCameraFar();

    window.addEventListener('resize', () => this.onResize());
  }

  updateCameraFar() {
    const viewDistance = this.settings.renderDistance * CHUNK_X;
    this.camera.far = Math.max(1400, viewDistance * 3.2);
    this.camera.updateProjectionMatrix();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------------------------------------------------------------- อินพุต

  setupInput() {
    this.controls = new Controls(this.canvas);

    this.controls.onLockChange = (locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
    };

    this.controls.onKey = (code, event) => this.onKeyPress(code, event);

    this.controls.onMouseDown = (button) => {
      // คลิกกลาง = หยิบบล็อกที่เล็งอยู่มาถือ
      if (button === 1) {
        const hit = this.raycast();
        if (hit) this.hud.pickBlock(hit.block);
      }
    };

    // คลิกที่จอเพื่อกลับเข้าโหมดเล่น (ทั้งตอนเริ่มเกมและตอนกลับจากเมนูหยุด)
    this.canvas.addEventListener('click', () => {
      if (this.state === STATE.READY) this.enterPlaying();
      else if (this.state === STATE.PLAYING && !this.controls.locked) this.controls.lock();
    });
    document.getElementById('loading').addEventListener('click', () => {
      if (this.state === STATE.READY) this.enterPlaying();
    });
  }

  onKeyPress(code, event) {
    if (this.state === STATE.PAUSED && code === 'Escape') {
      this.resume();
      return;
    }
    if (this.state !== STATE.PLAYING) return;

    // เลือกช่องไอเทมด้วยเลข 1–9
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) this.hud.setSelected(n - 1);
      return;
    }

    switch (code) {
      case 'F3':
        event.preventDefault();
        this.hud.toggleDebug();
        break;
      case 'Space': {
        // เคาะ Space สองครั้งติดกันเพื่อสลับโหมดบิน
        const now = performance.now();
        if (now - this.lastSpaceTap < DOUBLE_TAP_MS) {
          const flying = this.player.toggleFly();
          this.hud.toast(flying ? 'โหมดบิน: เปิด' : 'โหมดบิน: ปิด');
          this.lastSpaceTap = 0;
        } else {
          this.lastSpaceTap = now;
        }
        break;
      }
      case 'KeyT':
        this.sky.paused = !this.sky.paused;
        this.hud.toast(this.sky.paused ? 'หยุดเวลาในเกม' : 'เวลาเดินต่อ');
        break;
      case 'KeyN':
        this.sky.time = this.sky.isNight ? 0.3 : 0.85;
        this.hud.toast(this.sky.isNight ? 'เปลี่ยนเป็นกลางวัน' : 'เปลี่ยนเป็นกลางคืน');
        break;
    }
  }

  applySetting(key, value) {
    this.settings[key] = value;
    if (key === 'renderDistance') {
      const rd = Math.min(MAX_RENDER_DISTANCE, Math.max(MIN_RENDER_DISTANCE, value));
      this.chunks?.setRenderDistance(rd);
      this.updateCameraFar();
    } else if (key === 'fov') {
      this.camera.fov = value;
      this.camera.updateProjectionMatrix();
    } else if (key === 'sound') {
      this.sfx.setEnabled(value);
    }
  }

  // ---------------------------------------------------------------- วงจรชีวิตของโลก

  async startNewWorld(seedText) {
    const seed = seedFromString(seedText);
    this.sfx.init();
    // ต้องล้างส่วนต่างของโลกเดิมก่อน ไม่งั้นบล็อกที่เคยวางไว้ในโลกเก่า
    // จะไปโผล่ที่พิกัดเดียวกันในโลกใหม่ (เพราะ key ของ chunk เหมือนกัน)
    await this.storage.deleteAll();
    this.buildWorld(seed, null);
  }

  async continueWorld() {
    this.sfx.init();
    const data = await this.storage.load();
    if (!data) {
      this.hud.toast('ไม่พบไฟล์บันทึก');
      return;
    }
    this.buildWorld(data.meta.seed, data);
  }

  async deleteSave() {
    await this.storage.deleteAll();
    this.menu.showMain(false);
    this.hud.toast('ลบไฟล์บันทึกแล้ว');
  }

  /**
   * เตรียมโลกใหม่หรือโลกที่โหลดกลับมา แล้วเข้าสู่สถานะกำลังโหลด
   * @param {number} seed
   * @param {object|null} save ข้อมูลจาก storage.load()
   */
  buildWorld(seed, save) {
    this.teardownWorld();

    this.world = new World(seed);
    if (save) this.world.loadEdits(save.chunks);

    this.chunks = new ChunkManager(this.scene, this.world, this.materials, this.uvTable);
    this.chunks.setRenderDistance(this.settings.renderDistance);

    this.player = new Player(this.world);
    this.clouds = new Clouds(this.scene, seed);

    if (save?.meta?.player) {
      const p = save.meta.player;
      this.player.setPosition(p.x, p.y, p.z);
      this.player.flying = !!p.flying;
      this.controls.yaw = p.yaw ?? 0;
      this.controls.pitch = p.pitch ?? 0;
      this.sky.time = save.meta.time ?? START_TIME;
      if (Array.isArray(save.meta.hotbar) && save.meta.hotbar.length === 9) {
        this.hud.slots = save.meta.hotbar.slice();
        this.hud.buildHotbar();
      }
      this.spawnPoint = { x: p.x, y: p.y, z: p.z };
    } else {
      const spawn = this.world.findSpawn();
      this.player.setPosition(spawn.x, spawn.y, spawn.z);
      this.controls.yaw = 0;
      this.controls.pitch = -0.12;
      this.sky.time = START_TIME;
      this.spawnPoint = spawn;
    }

    this.autosaveTimer = 0;
    this.needsGroundSnap = true;
    this.state = STATE.LOADING;
    this.menu.showLoading('กำลังสร้างภูมิประเทศรอบตัวคุณ…');
  }

  teardownWorld() {
    if (this.chunks) { this.chunks.dispose(); this.chunks = null; }
    if (this.clouds) { this.clouds.dispose(); this.clouds = null; }
    this.world = null;
    this.player = null;
  }

  enterPlaying() {
    this.state = STATE.PLAYING;
    this.menu.enterGame();
    this.sfx.init();
    this.controls.lock();
    this.hud.showHeldName();
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.controls.unlock();
    this.menu.showPause('กำลังบันทึกอัตโนมัติ…');
    this.saveGame().then(() => {
      if (this.state === STATE.PAUSED) this.menu.pauseSub.textContent = 'บันทึกโลกเรียบร้อยแล้ว';
    });
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.menu.enterGame();
    this.controls.lock();
  }

  async saveAndQuit() {
    await this.saveGame();
    this.teardownWorld();
    this.state = STATE.MENU;
    this.menu.showMain(true);
  }

  async saveGame() {
    if (!this.world || !this.player) return;
    const meta = {
      seed: this.world.seed,
      time: this.sky.time,
      renderDistance: this.settings.renderDistance,
      hotbar: this.hud.slots.slice(),
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.controls.yaw,
        pitch: this.controls.pitch,
        flying: this.player.flying,
      },
    };
    try {
      await this.storage.save(meta, this.world.serializeEdits());
    } catch (err) {
      console.error('[VoxelCraft] บันทึกไม่สำเร็จ:', err);
      this.hud.toast('บันทึกไม่สำเร็จ');
    }
  }

  // ---------------------------------------------------------------- การเล็งและแก้บล็อก

  raycast() {
    const eye = this.player.eyePosition;
    eye.y = this.player.smoothEyeY;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return raycastVoxel(this.world, eye, dir, REACH_DISTANCE);
  }

  breakBlock(hit) {
    if (hit.block === BLOCK.BEDROCK) {
      this.hud.toast('หินฐานโลกทุบไม่ได้');
      return;
    }
    const affected = this.world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    if (!affected) return;
    this.chunks.rebuildImmediate(affected);
    this.sfx.breakBlock(BLOCKS[hit.block]?.sound);
    this.breakTimer = BREAK_COOLDOWN;
  }

  placeBlock(hit) {
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;

    const existing = this.world.getBlock(x, y, z);
    if (existing !== BLOCK.AIR && !IS_LIQUID[existing]) return;

    const id = this.hud.heldBlock;
    // ห้ามวางบล็อกทับตัวเอง
    if (IS_SOLID[id] && this.boxIntersectsPlayer(x, y, z)) {
      this.hud.toast('วางตรงนั้นไม่ได้ ตัวคุณอยู่ขวางอยู่');
      return;
    }

    const affected = this.world.setBlock(x, y, z, id);
    if (!affected) return;
    this.chunks.rebuildImmediate(affected);
    this.sfx.placeBlock(BLOCKS[id]?.sound);
    this.placeTimer = PLACE_COOLDOWN;
  }

  /** บล็อกที่ตำแหน่งนี้จะทับกล่องชนของผู้เล่นไหม */
  boxIntersectsPlayer(x, y, z) {
    const p = this.player.position;
    const half = PLAYER_WIDTH / 2;
    return (
      x + 1 > p.x - half && x < p.x + half &&
      y + 1 > p.y && y < p.y + PLAYER_HEIGHT &&
      z + 1 > p.z - half && z < p.z + half
    );
  }

  // ---------------------------------------------------------------- ลูปหลัก

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // จำกัดไม่ให้ก้าวเวลาใหญ่เกิน (เช่นตอนสลับแท็บกลับมา) ไม่งั้นฟิสิกส์จะพุ่งทะลุพื้น
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;

    this.frameTimes.push(rawDt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    switch (this.state) {
      case STATE.LOADING:
        this.updateLoading(dt);
        break;
      case STATE.PLAYING:
        this.updatePlaying(dt);
        break;
      case STATE.PAUSED:
      case STATE.READY:
        this.chunks?.update(this.player.position.x, this.player.position.z);
        break;
    }

    if (this.world) {
      this.syncCamera();
      this.sky.update(this.state === STATE.PLAYING ? dt : 0, this.camera.position, this.settings.renderDistance);
      // ย้อมเมฆด้วยสีของแสงรอบข้าง ไม่ใช่สีท้องฟ้า — เมฆจึงขาวตอนกลางวันและมืดลงตอนกลางคืน
      this.clouds?.update(this.state === STATE.PLAYING ? dt : 0, this.camera.position, this.sky.ambient.color);
      updateMaterials(this.materials, this.elapsed);
    }

    this.hud.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateLoading(dt) {
    const p = this.player.position;
    this.chunks.update(p.x, p.z);

    // พอ chunk ใต้เท้าโหลดเสร็จ ให้วางผู้เล่นลงบนผิวดินจริง (ค่าจาก noise อาจคลาดจากบล็อกจริง)
    if (this.needsGroundSnap && this.world.isLoadedAt(p.x, p.z)) {
      const surface = this.world.surfaceHeight(Math.floor(p.x), Math.floor(p.z));
      this.player.setPosition(p.x, surface + 1.2, p.z);
      this.needsGroundSnap = false;
    }

    const progress = this.chunks.loadProgress();
    const areaReady = this.chunks.isAreaReady(p.x, p.z, 1) && !this.needsGroundSnap;

    if (areaReady && progress > 0.42) {
      this.state = STATE.READY;
      this.menu.setProgress(1, 'พร้อมแล้ว — คลิกเพื่อเริ่มเล่น');
    } else {
      this.menu.setProgress(progress * 0.9, `กำลังสร้างภูมิประเทศ… ${Math.round(progress * 100)}%`);
    }
  }

  updatePlaying(dt) {
    const player = this.player;
    const wasOnGround = player.onGround;
    const fallSpeed = -player.velocity.y;

    player.update(dt, this.controls);
    this.chunks.update(player.position.x, player.position.z);

    // ---- เสียงตอบสนอง ----
    if (player.onGround && !wasOnGround && fallSpeed > 5) {
      this.sfx.land(BLOCKS[player.lastGroundBlock]?.sound, fallSpeed / 14);
      player.stepDistance = 0;
    }
    if (player.stepDistance > (player.sprinting ? 2.4 : 1.9)) {
      player.stepDistance = 0;
      if (player.onGround) this.sfx.footstep(BLOCKS[player.lastGroundBlock]?.sound);
    }
    if (player.inWater !== this.wasInWater) {
      this.sfx.splash();
      this.wasInWater = player.inWater;
    }

    // ---- มุมมองใต้น้ำ ----
    this.sky.setUnderwater(player.headInWater);
    this.hud.setUnderwater(player.headInWater);

    // ---- ไฟติดตัวสว่างขึ้นเมื่อลงไปใต้ดิน และตอนกลางคืน ----
    const surface = this.world.surfaceHeight(Math.floor(player.position.x), Math.floor(player.position.z));
    const depth = surface - player.position.y;
    const underground = THREE.MathUtils.clamp((depth - 2) / 10, 0, 1);
    const darkness = Math.max(underground, this.sky.isNight ? 0.34 : 0);
    this.headLamp.intensity = 0.15 + darkness * 3.4;

    // ---- เลือกไอเทมด้วยล้อเมาส์ ----
    const wheel = this.controls.consumeWheel();
    if (wheel) this.hud.cycleSelected(wheel);

    // ---- ทุบและวางบล็อก ----
    this.breakTimer -= dt;
    this.placeTimer -= dt;
    const hit = this.raycast();
    this.hud.setHighlight(hit);

    if (hit && this.controls.mouseLeft && this.breakTimer <= 0) this.breakBlock(hit);
    if (hit && this.controls.mouseRight && this.placeTimer <= 0) this.placeBlock(hit);

    // ---- บันทึกอัตโนมัติ ----
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0;
      this.saveGame();
    }

    this.updateDebug(hit);
  }

  syncCamera() {
    const p = this.player.position;
    this.camera.position.set(p.x, this.player.smoothEyeY, p.z);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');
  }

  updateDebug(hit) {
    if (!this.hud.debugVisible) return;

    const p = this.player.position;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    const fps = Math.round(1 / Math.max(avg, 0.0001));
    const info = this.renderer.info;
    const cx = Math.floor(p.x / CHUNK_X);
    const cz = Math.floor(p.z / CHUNK_Z);

    this.hud.updateDebug([
      `VoxelCraft — ${fps} FPS`,
      `พิกัด  X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)}  Z ${p.z.toFixed(2)}`,
      `Chunk  ${cx}, ${cz}   ชีวนิเวศ ${this.world.biomeName(p.x, p.z)}`,
      `Seed   ${this.world.seed}   เวลา ${this.sky.clockString()}`,
      `Chunk ที่แสดง ${this.chunks.visibleChunks} / โหลดไว้ ${this.world.chunks.size}`,
      `คิว  สร้าง ${this.chunks.stats.queuedGen}  ทำ mesh ${this.chunks.stats.queuedMesh}`,
      `Draw calls ${info.render.calls}   สามเหลี่ยม ${(info.render.triangles / 1000).toFixed(0)}k`,
      `หน่วยความจำ geometry ${info.memory.geometries}   texture ${info.memory.textures}`,
      `สถานะ  ${this.player.flying ? 'บิน' : this.player.inWater ? 'อยู่ในน้ำ' : this.player.onGround ? 'บนพื้น' : 'ลอยกลางอากาศ'}`,
      `เล็ง   ${hit ? `${blockName(hit.block)} (${hit.x}, ${hit.y}, ${hit.z})` : '—'}`,
      `ถือ    ${blockName(this.hud.heldBlock)}`,
      `แก้ไขบล็อกไปแล้ว ${this.world.editCount} ก้อน`,
    ]);
  }
}

new Game();
