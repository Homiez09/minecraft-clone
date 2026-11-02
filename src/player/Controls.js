/**
 * รับอินพุตจากเมาส์และคีย์บอร์ด แล้วแปลงเป็นสถานะที่ระบบอื่นอ่านได้
 *
 * ใช้ Pointer Lock API โดยตรงแทน PointerLockControls ของ three
 * เพราะเราต้องคุมมุมกล้องเอง (จำกัด pitch, ค่าความไวปรับได้, ต้องรู้สถานะปุ่มค้าง)
 */

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.001;

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.locked = false;
    this.yaw = 0;      // หมุนซ้าย-ขวา (เรเดียน)
    this.pitch = 0;    // ก้ม-เงย
    this.sensitivity = MOUSE_SENSITIVITY;
    this.mouseLeft = false;
    this.mouseRight = false;
    this.wheelDelta = 0;

    /** callback ที่ระบบอื่นมาผูกไว้ */
    this.onLockChange = null;
    this.onKey = null;        // (code, event) — ยิงตอนกดลงเท่านั้น
    this.onMouseDown = null;  // (button)

    this._bind();
  }

  _bind() {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouseLeft = true;
      if (e.button === 2) this.mouseRight = true;
      this.onMouseDown?.(e.button);
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
      // ทำให้ yaw วนอยู่ในช่วง -π..π กันค่าสะสมจนเสียความละเอียดของ float
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheelDelta += e.deltaY;
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      // ปล่อยให้ช่องกรอกข้อความในเมนูทำงานได้ตามปกติ
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.onKey?.(e.code, e);
      this.keys.add(e.code);
      if (this.locked && SWALLOWED.has(e.code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // ถ้าสลับแท็บกลางคัน ให้ลืมปุ่มที่ค้างอยู่ทั้งหมด ไม่งั้นตัวละครจะเดินเองไม่หยุด
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeft = false;
      this.mouseRight = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.mouseLeft = false;
        this.mouseRight = false;
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  unlock() {
    if (this.locked) document.exitPointerLock?.();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** ทิศทางเดินหน้า/ถอยหลังและซ้าย/ขวาจากปุ่มที่กดอยู่ คืนค่า -1..1 */
  moveAxes() {
    let forward = 0, strafe = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) forward += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) forward -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) strafe += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) strafe -= 1;
    // เดินทแยงต้องไม่เร็วกว่าเดินตรง
    const len = Math.hypot(forward, strafe);
    if (len > 1) { forward /= len; strafe /= len; }
    return { forward, strafe };
  }

  /** ดึงค่าล้อเมาส์ที่สะสมไว้แล้วล้างทิ้ง คืนจำนวนขั้นที่หมุน (บวก = หมุนลง) */
  consumeWheel() {
    if (this.wheelDelta === 0) return 0;
    const steps = this.wheelDelta > 0 ? 1 : -1;
    this.wheelDelta = 0;
    return steps;
  }
}

/** ปุ่มที่ต้องกันไม่ให้เบราว์เซอร์เอาไปทำอย่างอื่นตอนกำลังเล่น */
const SWALLOWED = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Tab', 'F3', 'Slash', 'KeyE',
]);
