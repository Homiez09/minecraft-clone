/**
 * ตัวผู้เล่น: ฟิสิกส์ การชน และการเคลื่อนที่
 *
 * กล่องชนเป็น AABB ขนาด 0.6 × 1.8 × 0.6 โดย position คือจุดกึ่งกลาง "ฝ่าเท้า"
 * การแก้การชนทำทีละแกน (X → Z → Y) ซึ่งเพียงพอสำหรับโลกที่ทุกอย่างเป็นกล่องเรียงกริด
 * และไม่มีอาการติดมุมเหมือนการแก้พร้อมกันทุกแกน
 */

import * as THREE from 'three';
import {
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE, GRAVITY, TERMINAL_VELOCITY,
  JUMP_VELOCITY, WALK_SPEED, SPRINT_SPEED, SNEAK_SPEED, FLY_SPEED, FLY_SPRINT_SPEED,
  GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, AIR_FRICTION,
  WATER_DRAG, WATER_SWIM_SPEED, WATER_BUOYANCY, CHUNK_Y,
} from '../config.js';
import { IS_SOLID, IS_LIQUID, BLOCK } from '../blocks.js';

const HALF = PLAYER_WIDTH / 2;
const EPS = 1e-3;
const STEP_UP = 1.02;      // ปีนขึ้นบล็อกเดียวได้เองโดยไม่ต้องกระโดด
const MAX_SUBSTEP = 0.35;  // ระยะสูงสุดต่อการขยับหนึ่งครั้ง (กันทะลุกำแพงตอนเฟรมตก)

export class Player {
  constructor(world) {
    this.world = world;
    this.position = new THREE.Vector3(0, 80, 0);
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sneaking = false;
    this.sprinting = false;
    /** ความสูงตาที่หน่วงตามจริง — กันภาพกระตุกตอนปีนขึ้นบล็อก */
    this.smoothEyeY = this.position.y + PLAYER_EYE;
    /** ระยะทางที่เดินสะสม ใช้จับจังหวะเสียงฝีเท้าและการโยกกล้อง */
    this.stepDistance = 0;
    this.lastGroundBlock = BLOCK.AIR;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER_EYE, this.position.z);
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.smoothEyeY = y + PLAYER_EYE;
  }

  // ---------------------------------------------------------------- การชน

  /** มีบล็อกตันทับกล่องผู้เล่นที่ตำแหน่งนี้ไหม */
  collidesAt(x, y, z) {
    const minX = Math.floor(x - HALF + EPS);
    const maxX = Math.floor(x + HALF - EPS);
    const minY = Math.floor(y + EPS);
    const maxY = Math.floor(y + PLAYER_HEIGHT - EPS);
    const minZ = Math.floor(z - HALF + EPS);
    const maxZ = Math.floor(z + HALF - EPS);

    for (let by = minY; by <= maxY; by++) {
      if (by < 0 || by >= CHUNK_Y) continue;
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (IS_SOLID[this.world.getBlock(bx, by, bz)]) return true;
        }
      }
    }
    return false;
  }

  /** ของเหลวแตะกล่องผู้เล่นในช่วงความสูง [y0, y1] ไหม */
  liquidAt(y0, y1) {
    const { x, z } = this.position;
    const minX = Math.floor(x - HALF + EPS);
    const maxX = Math.floor(x + HALF - EPS);
    const minZ = Math.floor(z - HALF + EPS);
    const maxZ = Math.floor(z + HALF - EPS);
    for (let by = Math.floor(y0); by <= Math.floor(y1); by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (IS_LIQUID[this.world.getBlock(bx, by, bz)]) return true;
        }
      }
    }
    return false;
  }

  /** ขยับตามแกนเดียวแล้วดันกลับให้ชิดขอบบล็อกถ้าชน คืน true เมื่อชน */
  moveAxis(axis, delta) {
    if (delta === 0) return false;
    const p = this.position;
    const before = p[axis];
    p[axis] += delta;

    if (!this.collidesAt(p.x, p.y, p.z)) return false;

    // ชน — วางให้ชิดหน้าบล็อกพอดี
    if (axis === 'y') {
      p.y = delta > 0
        ? Math.floor(p.y + PLAYER_HEIGHT) - PLAYER_HEIGHT - EPS
        : Math.floor(p.y) + 1 + EPS;
    } else {
      p[axis] = delta > 0
        ? Math.floor(p[axis] + HALF) - HALF - EPS
        : Math.floor(p[axis] - HALF) + 1 + HALF + EPS;
    }

    // ถ้ายังชนอยู่ (เช่นอยู่ในบล็อกตั้งแต่ต้น) ให้ถอยกลับที่เดิมแทนที่จะดันทะลุ
    if (this.collidesAt(p.x, p.y, p.z)) p[axis] = before;
    return true;
  }

  /** ขยับแนวนอน พร้อมพยายามปีนขึ้นบล็อกเดียวอัตโนมัติเมื่อชนกำแพงเตี้ย */
  moveHorizontal(dx, dz) {
    const startY = this.position.y;
    const hitX = this.moveAxis('x', dx);
    const hitZ = this.moveAxis('z', dz);

    if ((hitX || hitZ) && (this.onGround || this.inWater)) {
      const p = this.position;
      const testY = startY + STEP_UP;
      // ยกขึ้นได้ก็ต่อเมื่อที่ระดับใหม่ไม่ติดอะไร ทั้งจุดเดิมและจุดปลายทาง
      if (!this.collidesAt(p.x, testY, p.z)) {
        const savedX = p.x, savedZ = p.z;
        p.y = testY;
        if (hitX) this.moveAxis('x', dx);
        if (hitZ) this.moveAxis('z', dz);
        if (p.x === savedX && p.z === savedZ) {
          p.y = startY;  // ปีนแล้วก็ยังไปต่อไม่ได้ — คืนค่าเดิม
        } else if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }
    }

    if (hitX) this.velocity.x = 0;
    if (hitZ) this.velocity.z = 0;
  }

  // ---------------------------------------------------------------- อัปเดตต่อเฟรม

  /**
   * @param {number} dt เวลาที่ผ่านไป (วินาที)
   * @param {import('./Controls.js').Controls} controls
   */
  update(dt, controls) {
    const feetY = this.position.y;
    this.inWater = this.liquidAt(feetY, feetY + 0.9);
    this.headInWater = this.liquidAt(feetY + PLAYER_EYE - 0.1, feetY + PLAYER_EYE);

    this.sneaking = controls.isDown('ShiftLeft') || controls.isDown('ShiftRight');
    const sprintKey = controls.isDown('ControlLeft') || controls.isDown('ControlRight');
    const { forward, strafe } = controls.moveAxes();
    const moving = forward !== 0 || strafe !== 0;
    this.sprinting = sprintKey && moving && !this.sneaking;

    // ทิศทางที่ต้องการเดิน (อยู่ในระนาบแนวนอน อิงมุมกล้อง)
    const sin = Math.sin(controls.yaw);
    const cos = Math.cos(controls.yaw);
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;

    if (this.flying) {
      this.updateFly(dt, controls, wishX, wishZ);
    } else if (this.inWater) {
      this.updateSwim(dt, controls, wishX, wishZ);
    } else {
      this.updateWalk(dt, controls, wishX, wishZ);
    }

    this.applyMotion(dt);
    this.updateGroundState();

    // ความสูงตาไล่ตามตำแหน่งจริงแบบนุ่มนวล
    const targetEye = this.position.y + PLAYER_EYE - (this.sneaking && this.onGround ? 0.22 : 0);
    const lerp = 1 - Math.pow(0.0001, dt);
    this.smoothEyeY += (targetEye - this.smoothEyeY) * lerp;
    if (Math.abs(targetEye - this.smoothEyeY) < 0.002) this.smoothEyeY = targetEye;
  }

  updateWalk(dt, controls, wishX, wishZ) {
    const maxSpeed = this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const friction = this.onGround ? GROUND_FRICTION : AIR_FRICTION;
    const v = this.velocity;

    // แรงเสียดทานก่อน แล้วค่อยเร่งไปทางที่ต้องการ
    const damp = Math.max(0, 1 - friction * dt);
    v.x *= damp;
    v.z *= damp;

    v.x += wishX * accel * dt;
    v.z += wishZ * accel * dt;

    const speed = Math.hypot(v.x, v.z);
    if (speed > maxSpeed) {
      v.x = (v.x / speed) * maxSpeed;
      v.z = (v.z / speed) * maxSpeed;
    }

    v.y -= GRAVITY * dt;
    if (v.y < -TERMINAL_VELOCITY) v.y = -TERMINAL_VELOCITY;

    if (controls.isDown('Space') && this.onGround) {
      v.y = JUMP_VELOCITY;
      this.onGround = false;
    }
  }

  updateSwim(dt, controls, wishX, wishZ) {
    const v = this.velocity;
    const damp = Math.max(0, 1 - WATER_DRAG * dt);
    v.x *= damp;
    v.z *= damp;
    v.y *= damp;

    v.x += wishX * WATER_SWIM_SPEED * 2.4 * dt;
    v.z += wishZ * WATER_SWIM_SPEED * 2.4 * dt;

    const speed = Math.hypot(v.x, v.z);
    if (speed > WATER_SWIM_SPEED) {
      v.x = (v.x / speed) * WATER_SWIM_SPEED;
      v.z = (v.z / speed) * WATER_SWIM_SPEED;
    }

    // จมช้าๆ แต่กด Space เพื่อว่ายขึ้น
    v.y -= GRAVITY * 0.16 * dt;
    if (controls.isDown('Space')) v.y += WATER_BUOYANCY * dt;
    if (this.sneaking) v.y -= WATER_BUOYANCY * 0.7 * dt;
    v.y = THREE.MathUtils.clamp(v.y, -3.2, 4.2);
  }

  updateFly(dt, controls, wishX, wishZ) {
    const v = this.velocity;
    const maxSpeed = this.sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
    const damp = Math.max(0, 1 - 9 * dt);
    v.multiplyScalar(damp);

    v.x += wishX * maxSpeed * 6 * dt;
    v.z += wishZ * maxSpeed * 6 * dt;
    if (controls.isDown('Space')) v.y += maxSpeed * 6 * dt;
    if (this.sneaking) v.y -= maxSpeed * 6 * dt;

    const speed = v.length();
    if (speed > maxSpeed) v.multiplyScalar(maxSpeed / speed);
  }

  /** ขยับจริงตามความเร็ว โดยซอยเป็นก้าวย่อยไม่ให้ทะลุบล็อกเมื่อเฟรมตก */
  applyMotion(dt) {
    let dx = this.velocity.x * dt;
    let dy = this.velocity.y * dt;
    let dz = this.velocity.z * dt;

    const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
    dx /= steps; dy /= steps; dz /= steps;

    const before = this.position.clone();
    for (let i = 0; i < steps; i++) {
      this.moveHorizontal(dx, dz);
      const hitY = this.moveAxis('y', dy);
      if (hitY) {
        if (dy < 0) this.onGround = true;
        this.velocity.y = 0;
        dy = 0;
      }
    }

    if (this.onGround || this.inWater) {
      this.stepDistance += Math.hypot(this.position.x - before.x, this.position.z - before.z);
    }
  }

  updateGroundState() {
    const p = this.position;
    // ยืนอยู่บนอะไรบางอย่างไหม (ตรวจใต้เท้าเล็กน้อย)
    const grounded = this.collidesAt(p.x, p.y - 0.08, p.z);
    this.onGround = grounded && this.velocity.y <= 0.001;
    if (this.onGround) {
      this.lastGroundBlock = this.world.getBlock(
        Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z)
      );
    }
    // กันตกทะลุพื้นโลก
    if (p.y < -8) {
      const surface = this.world.surfaceHeight(Math.floor(p.x), Math.floor(p.z));
      this.setPosition(p.x, surface + 2.5, p.z);
    }
  }

  toggleFly() {
    this.flying = !this.flying;
    if (this.flying) this.velocity.y = 0;
    return this.flying;
  }
}
