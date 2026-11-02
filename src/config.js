/**
 * ค่าคงที่กลางของเกมทั้งหมด — แก้ที่นี่ที่เดียวแล้วมีผลทุกระบบ
 */

// ---------- Chunk / World ----------
export const CHUNK_X = 16;
export const CHUNK_Y = 128;
export const CHUNK_Z = 16;
export const CHUNK_AREA = CHUNK_X * CHUNK_Z;          // 256
export const CHUNK_VOLUME = CHUNK_X * CHUNK_Y * CHUNK_Z; // 32768

/** index ใน Uint8Array แบบแบน: x + z*16 + y*256 */
export function voxelIndex(x, y, z) {
  return x + z * CHUNK_X + y * CHUNK_AREA;
}

export const SEA_LEVEL = 48;
export const WORLD_MIN_Y = 0;
export const WORLD_MAX_Y = CHUNK_Y - 1;

// ---------- Rendering ----------
export const DEFAULT_RENDER_DISTANCE = 8;   // หน่วยเป็น chunk
export const MIN_RENDER_DISTANCE = 3;
export const MAX_RENDER_DISTANCE = 14;
export const UNLOAD_MARGIN = 2;             // chunk ที่ไกลกว่า RD + margin จะถูกปลด
export const MAX_CHUNK_UPLOADS_PER_FRAME = 2; // กันเฟรมกระตุกตอนอัปโหลด geometry
export const WORKER_COUNT = 4;
export const DEFAULT_FOV = 75;
export const NEAR_PLANE = 0.1;

// ---------- Player physics ----------
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;             // ความสูงตาจากเท้า
export const GRAVITY = 28.0;                // บล็อก/วินาที²
export const TERMINAL_VELOCITY = 55.0;
export const JUMP_VELOCITY = 9.0;
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 7.4;
export const SNEAK_SPEED = 1.9;
export const FLY_SPEED = 12.0;
export const FLY_SPRINT_SPEED = 26.0;
export const GROUND_ACCEL = 42.0;
export const AIR_ACCEL = 9.0;
export const GROUND_FRICTION = 12.0;
export const AIR_FRICTION = 0.6;
export const WATER_DRAG = 5.0;
export const WATER_SWIM_SPEED = 4.2;
export const WATER_BUOYANCY = 12.0;
export const STEP_HEIGHT = 0.55;            // ปีนขึ้นบล็อกเดียวโดยไม่ต้องกระโดด
export const REACH_DISTANCE = 5.0;
export const DOUBLE_TAP_MS = 320;           // เคาะ Space สองครั้งเพื่อบิน

// ---------- Interaction ----------
export const BREAK_COOLDOWN = 0.18;         // วินาที ระหว่างทุบต่อเนื่อง
export const PLACE_COOLDOWN = 0.2;

// ---------- Day / night ----------
export const DAY_LENGTH_SECONDS = 600;      // 1 วันในเกม = 10 นาทีจริง
export const START_TIME = 0.28;             // 0..1 (0 = เที่ยงคืน, 0.25 = รุ่งเช้า)

// ---------- Texture atlas ----------
// แต่ละ tile วาดที่ 16px แล้วล้อมด้วย gutter 8px ที่เป็นภาพเดียวกันซ้ำต่อเนื่อง
// (ทำให้ mipmap ระดับลึกยัง sample เจอแต่ pixel ของ tile ตัวเอง → ไม่มีสีรั่วข้าม tile)
export const TILE_PX = 16;
export const TILE_PAD = 8;
export const CELL_PX = TILE_PX + TILE_PAD * 2; // 32
export const ATLAS_TILES = 16;                 // 16x16 cells
export const ATLAS_PX = CELL_PX * ATLAS_TILES; // 512

// ---------- Save ----------
export const DB_NAME = 'voxelcraft';
export const DB_VERSION = 1;
export const AUTOSAVE_INTERVAL = 30;        // วินาที
