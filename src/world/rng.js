/**
 * ตัวสุ่มแบบกำหนดค่าได้ (deterministic) — หัวใจของโลกที่สร้างซ้ำได้จาก seed เดียวกัน
 * ไม่ใช้ Math.random() ที่ไหนในระบบสร้างโลกเลย
 */

/** PRNG เร็วและกระจายตัวดี คืนฟังก์ชันที่ให้ค่า 0..1 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** แปลงข้อความ seed ที่ผู้เล่นพิมพ์เป็นเลข 32 บิต (ตัวเลขล้วนจะใช้ค่านั้นตรงๆ) */
export function seedFromString(str) {
  const text = String(str ?? '').trim();
  if (text === '') return (Math.random() * 0xffffffff) >>> 0;
  if (/^-?\d+$/.test(text)) return Math.abs(parseInt(text, 10)) >>> 0;

  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** ผสมพิกัด 2 มิติกับ seed เป็นเลข 32 บิต — ใช้เป็นเมล็ดสุ่มเฉพาะจุด */
export function hash2D(x, z, seed) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (z | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/** ค่าสุ่ม 0..1 ที่ผูกกับพิกัด — เรียกซ้ำกี่ครั้งก็ได้ค่าเดิม */
export function valueAt(x, z, seed) {
  return hash2D(x, z, seed) / 4294967296;
}
