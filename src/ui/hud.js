/**
 * ส่วนติดต่อผู้ใช้ระหว่างเล่น: แถบไอเทม กรอบเล็งบล็อก และแผงข้อมูลดีบัก
 *
 * ไอคอนบล็อกวาดสดจาก texture atlas เป็นภาพ isometric สามหน้า
 * จึงได้ไอคอนของบล็อกทุกชนิดโดยไม่ต้องมีไฟล์ภาพแยก
 */

import * as THREE from 'three';
import { BLOCKS, PLACEABLE, blockName, FACE_TILES } from '../blocks.js';
import { getTileCanvas } from '../textures.js';

const ICON_SIZE = 40;

/**
 * วาดบล็อกเป็นภาพ isometric ลงบน canvas
 * ใช้ setTransform บิดภาพ texture ให้กลายเป็นหน้าสามด้านของลูกบาศก์
 */
function drawBlockIcon(canvas, blockId) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const def = BLOCKS[blockId];
  if (!def || !def.faces) return;

  const topTile = getTileCanvas(FACE_TILES[blockId * 6 + 2]);   // หน้าบน
  const sideTile = getTileCanvas(FACE_TILES[blockId * 6 + 4]);  // หน้าข้าง (+Z)
  if (!topTile || !sideTile) return;

  const faces = [
    // [texture, transform, ความมืด]
    [topTile, [w / 32, h / 64, -w / 32, h / 64, w / 2, 0], 0],
    [sideTile, [w / 32, h / 64, 0, h / 32, 0, h / 4], 0.3],
    [sideTile, [w / 32, -h / 64, 0, h / 32, w / 2, h / 2], 0.15],
  ];

  for (const [tex, m, shade] of faces) {
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(tex, 0, 0);
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(0, 0, 16, 16);
    }
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export class HUD {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.hotbarEl = document.getElementById('hotbar');
    this.debugEl = document.getElementById('debug');
    this.heldNameEl = document.getElementById('held-name');
    this.underwaterEl = document.getElementById('underwater');
    this.toastEl = document.getElementById('toast');

    /** บล็อกที่อยู่ในแถบไอเทมทั้ง 9 ช่อง */
    this.slots = PLACEABLE.slice(0, 9);
    this.selected = 0;
    this.debugVisible = false;
    this.heldNameTimer = 0;
    this.toastTimer = 0;

    this.buildHotbar();
    this.highlight = this.createHighlight();
    scene.add(this.highlight);
  }

  // ---------------------------------------------------------------- แถบไอเทม

  buildHotbar() {
    this.hotbarEl.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === this.selected ? ' active' : '');

      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ICON_SIZE;
      drawBlockIcon(canvas, this.slots[i]);
      slot.appendChild(canvas);

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      slot.appendChild(num);

      this.hotbarEl.appendChild(slot);
      this.slotEls.push({ slot, canvas });
    }
  }

  refreshSlot(index) {
    drawBlockIcon(this.slotEls[index].canvas, this.slots[index]);
  }

  setSelected(index) {
    const next = ((index % 9) + 9) % 9;
    if (next === this.selected) return;
    this.slotEls[this.selected].slot.classList.remove('active');
    this.selected = next;
    this.slotEls[next].slot.classList.add('active');
    this.showHeldName();
  }

  cycleSelected(delta) {
    this.setSelected(this.selected + delta);
  }

  get heldBlock() {
    return this.slots[this.selected];
  }

  /** ใส่บล็อกที่เล็งอยู่ลงช่องปัจจุบัน (ปุ่มคลิกกลาง — เหมือนการ "ก๊อปบล็อก") */
  pickBlock(blockId) {
    const existing = this.slots.indexOf(blockId);
    if (existing >= 0) {
      this.setSelected(existing);
      return;
    }
    this.slots[this.selected] = blockId;
    this.refreshSlot(this.selected);
    this.showHeldName();
  }

  showHeldName() {
    this.heldNameEl.textContent = blockName(this.heldBlock);
    this.heldNameEl.style.opacity = '1';
    this.heldNameTimer = 1.6;
  }

  toast(message, duration = 2) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    this.toastTimer = duration;
  }

  // ---------------------------------------------------------------- กรอบเล็งบล็อก

  createHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.55, depthTest: true, fog: false,
    });
    const lines = new THREE.LineSegments(edges, mat);
    lines.visible = false;
    lines.renderOrder = 999;
    geo.dispose();
    return lines;
  }

  setHighlight(target) {
    if (!target) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }

  setUnderwater(value) {
    this.underwaterEl.classList.toggle('show', value);
  }

  // ---------------------------------------------------------------- แผงดีบัก

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('show', this.debugVisible);
  }

  updateDebug(lines) {
    if (!this.debugVisible) return;
    this.debugEl.textContent = lines.join('\n');
  }

  update(dt) {
    if (this.heldNameTimer > 0) {
      this.heldNameTimer -= dt;
      if (this.heldNameTimer <= 0) this.heldNameEl.style.opacity = '0';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
