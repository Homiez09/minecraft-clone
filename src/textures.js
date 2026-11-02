/**
 * สร้าง texture atlas แบบ procedural ด้วย Canvas API
 * ไม่มีการโหลดไฟล์ภาพจากภายนอกเลย — ทุกลายวาดจากโค้ดตอนเกมเริ่ม
 *
 * แต่ละ tile วาดที่ 16×16 px แล้ววางลง atlas พร้อม gutter 8px รอบด้าน
 * ที่เป็นภาพเดิมซ้ำต่อเนื่อง (ใช้ CanvasPattern) เพื่อกัน texture bleeding ตอน mipmap ย่อ
 */

import * as THREE from 'three';
import { TILE_PX, TILE_PAD, CELL_PX, ATLAS_TILES, ATLAS_PX } from './config.js';
import { TILE } from './blocks.js';

// ---------------------------------------------------------------- utilities

/** PRNG แบบกำหนดค่าได้ (mulberry32) — texture จึงเหมือนเดิมทุกครั้งที่รัน */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ระยะที่สั้นที่สุดบนแกนที่วนรอบ (ทำให้ลายต่อกันได้แบบไร้รอยต่อ) */
function wrapDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

/** ผืนผ้าใบ 16×16 พร้อมเครื่องมือวาด pixel */
class Tile {
  constructor(seed) {
    this.size = TILE_PX;
    this.data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
    this.rand = makeRng(seed);
  }

  set(x, y, r, g, b, a = 255) {
    const s = this.size;
    x = ((x % s) + s) % s;
    y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }

  get(x, y) {
    const s = this.size;
    x = ((x % s) + s) % s;
    y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** เติมสีพื้นทั้ง tile พร้อม noise สุ่มเล็กน้อยให้ดูมีเนื้อผิว */
  fill([r, g, b], amp = 0, a = 255) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const n = amp ? (this.rand() * 2 - 1) * amp : 0;
        this.set(x, y, r + n, g + n, b + n, a);
      }
    }
  }

  /** โรยจุดสีแบบสุ่ม */
  speckle(color, count, sizeRange = [1, 1], alpha = 255) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.rand() * this.size);
      const y = Math.floor(this.rand() * this.size);
      const w = sizeRange[0] + Math.floor(this.rand() * (sizeRange[1] - sizeRange[0] + 1));
      for (let dy = 0; dy < w; dy++) {
        for (let dx = 0; dx < w; dx++) {
          this.set(x + dx, y + dy, color[0], color[1], color[2], alpha);
        }
      }
    }
  }

  rect(x0, y0, w, h, [r, g, b], a = 255) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(x, y, r, g, b, a);
    }
  }

  /** คูณความสว่างของพิกเซล (ใช้ทำเงา/ไฮไลต์) */
  shade(x, y, factor) {
    const [r, g, b, a] = this.get(x, y);
    this.set(x, y, r * factor, g * factor, b * factor, a);
  }

  /**
   * ลายก้อนแบบ Worley/cellular — ใช้ทำหินกรวด, กรวด, ดินเหนียว
   * cb(x, y, cellValue, edgeDistance) เรียกทุกพิกเซล
   */
  cells(count, cb) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      pts.push([this.rand() * this.size, this.rand() * this.size, this.rand()]);
    }
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let d1 = Infinity, d2 = Infinity, val = 0;
        for (let i = 0; i < pts.length; i++) {
          const dx = wrapDelta(x + 0.5 - pts[i][0], this.size);
          const dy = wrapDelta(y + 0.5 - pts[i][1], this.size);
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; val = pts[i][2]; }
          else if (d < d2) { d2 = d; }
        }
        cb(x, y, val, Math.sqrt(d2) - Math.sqrt(d1));
      }
    }
  }

  toCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const ctx = c.getContext('2d');
    ctx.putImageData(new ImageData(this.data, this.size, this.size), 0, 0);
    return c;
  }
}

// ---------------------------------------------------------------- ลายแต่ละบล็อก

const C = {
  grass: [104, 158, 62], grassDark: [78, 124, 44],
  dirt: [134, 96, 67], dirtDark: [106, 74, 50],
  stone: [128, 128, 128], stoneDark: [98, 98, 98], stoneLight: [152, 152, 152],
  sand: [219, 209, 160], sandDark: [196, 184, 134],
  redSand: [190, 102, 55],
  wood: [122, 92, 52], woodDark: [92, 68, 38], woodLight: [148, 114, 68],
  planks: [162, 128, 78], planksDark: [126, 97, 56],
  leaf: [62, 128, 44], leafDark: [42, 96, 30],
  birchLeaf: [122, 168, 74], spruceLeaf: [40, 84, 52],
  birch: [214, 210, 196], birchDark: [176, 172, 158],
  spruce: [86, 62, 38], spruceDark: [62, 44, 26],
  water: [58, 120, 200],
  lava: [214, 86, 24],
  snow: [246, 250, 252],
  bedrock: [72, 72, 76],
  gravel: [136, 130, 126],
  clay: [160, 166, 178],
  brick: [148, 76, 60], mortar: [178, 172, 165],
  obsidian: [26, 20, 38],
  ice: [150, 200, 240],
  glow: [242, 208, 118],
  cactus: [58, 128, 58], cactusDark: [40, 96, 40],
  coal: [30, 30, 32],
  iron: [200, 160, 124],
  gold: [244, 206, 78],
  diamond: [110, 232, 226],
  wool: {
    white: [232, 236, 236], red: [180, 52, 48], orange: [216, 126, 48],
    yellow: [224, 200, 60], green: [92, 156, 48], cyan: [72, 168, 184],
    blue: [58, 82, 172], purple: [128, 62, 176], pink: [224, 138, 172],
    black: [36, 36, 40],
  },
};

/** ตารางฟังก์ชันวาด: tile index → ฟังก์ชัน */
const PAINTERS = {};

// --- ดิน/หญ้า ---
PAINTERS[TILE.GRASS_TOP] = (t) => {
  t.fill(C.grass, 16);
  t.speckle(C.grassDark, 26, [1, 2]);
  t.speckle([126, 178, 78], 18, [1, 1]);
};

PAINTERS[TILE.DIRT] = (t) => {
  t.fill(C.dirt, 18);
  t.speckle(C.dirtDark, 22, [1, 2]);
  t.speckle([154, 116, 84], 12);
};

PAINTERS[TILE.GRASS_SIDE] = (t) => {
  PAINTERS[TILE.DIRT](t);
  // แถบหญ้าด้านบนที่มีขอบล่างหยักไม่เท่ากัน
  for (let x = 0; x < t.size; x++) {
    const depth = 3 + Math.floor(t.rand() * 3);
    for (let y = 0; y < depth; y++) {
      const n = (t.rand() * 2 - 1) * 14;
      const c = y === depth - 1 && t.rand() < 0.5 ? C.grassDark : C.grass;
      t.set(x, y, c[0] + n, c[1] + n, c[2] + n);
    }
  }
};

PAINTERS[TILE.SNOW] = (t) => {
  t.fill(C.snow, 6);
  t.speckle([226, 236, 244], 14, [1, 2]);
};

PAINTERS[TILE.SNOW_SIDE] = (t) => {
  PAINTERS[TILE.DIRT](t);
  for (let x = 0; x < t.size; x++) {
    const depth = 3 + Math.floor(t.rand() * 3);
    for (let y = 0; y < depth; y++) {
      const n = (t.rand() * 2 - 1) * 6;
      t.set(x, y, C.snow[0] + n, C.snow[1] + n, C.snow[2] + n);
    }
  }
};

// --- หิน ---
PAINTERS[TILE.STONE] = (t) => {
  t.fill(C.stone, 14);
  t.speckle(C.stoneDark, 20, [1, 2]);
  t.speckle(C.stoneLight, 14, [1, 1]);
};

PAINTERS[TILE.COBBLE] = (t) => {
  t.cells(7, (x, y, v, edge) => {
    if (edge < 0.9) {
      const c = 62 + v * 12;
      t.set(x, y, c, c, c + 2);
    } else {
      const base = 108 + v * 46 + (t.rand() * 2 - 1) * 12;
      t.set(x, y, base, base, base + 2);
    }
  });
};

PAINTERS[TILE.MOSSY_COBBLE] = (t) => {
  PAINTERS[TILE.COBBLE](t);
  // แต้มมอสเขียวทับบางส่วน
  t.cells(5, (x, y, v) => {
    if (v > 0.45 && t.rand() < 0.7) {
      const [r, g, b] = t.get(x, y);
      t.set(x, y, r * 0.55 + 30, g * 0.55 + 74, b * 0.5 + 26);
    }
  });
};

PAINTERS[TILE.GRAVEL] = (t) => {
  t.cells(11, (x, y, v, edge) => {
    const base = 96 + v * 62;
    const e = edge < 0.6 ? 0.72 : 1;
    t.set(x, y, base * e, base * e * 0.97, base * e * 0.94);
  });
};

PAINTERS[TILE.CLAY] = (t) => {
  t.fill(C.clay, 10);
  t.cells(6, (x, y, v, edge) => {
    if (edge < 0.5) t.shade(x, y, 0.88);
    else if (v > 0.7) t.shade(x, y, 1.06);
  });
};

PAINTERS[TILE.BEDROCK] = (t) => {
  t.fill(C.bedrock, 26);
  t.cells(9, (x, y, v) => {
    const c = 40 + v * 62;
    t.set(x, y, c, c, c + 4);
  });
  t.speckle([22, 22, 24], 18, [1, 2]);
};

PAINTERS[TILE.STONE_BRICK] = (t) => {
  t.fill([122, 122, 122], 10);
  const mortar = [94, 94, 94];
  // อิฐ 2 แถว สลับรอยต่อ
  for (let y = 0; y < t.size; y++) {
    for (let x = 0; x < t.size; x++) {
      const row = Math.floor(y / 8);
      const offset = row % 2 === 0 ? 0 : 4;
      const inX = (x + offset) % 8;
      const inY = y % 8;
      if (inX === 0 || inY === 0) t.set(x, y, mortar[0], mortar[1], mortar[2]);
      else if (inX === 1 || inY === 1) t.shade(x, y, 1.1);
      else if (inX === 7 || inY === 7) t.shade(x, y, 0.9);
    }
  }
};

PAINTERS[TILE.BRICK] = (t) => {
  t.fill(C.mortar, 6);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const offset = row % 2 === 0 ? 0 : 4;
    for (let i = 0; i < 2; i++) {
      const x0 = offset + i * 8;
      for (let y = y0 + 1; y < y0 + 4; y++) {
        for (let x = x0 + 1; x < x0 + 8; x++) {
          const n = (t.rand() * 2 - 1) * 12;
          t.set(x, y, C.brick[0] + n, C.brick[1] + n, C.brick[2] + n);
        }
      }
    }
  }
};

PAINTERS[TILE.OBSIDIAN] = (t) => {
  t.fill(C.obsidian, 8);
  t.cells(6, (x, y, v, edge) => {
    if (edge < 0.5) t.shade(x, y, 1.9);
  });
  t.speckle([76, 52, 116], 10, [1, 1]);
};

// --- แร่ ---
function orePainter(oreColor, highlight) {
  return (t) => {
    PAINTERS[TILE.STONE](t);
    const blobs = 4 + Math.floor(t.rand() * 3);
    for (let i = 0; i < blobs; i++) {
      const cx = 2 + Math.floor(t.rand() * 12);
      const cy = 2 + Math.floor(t.rand() * 12);
      const r = 1.2 + t.rand() * 1.4;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const edge = dx * dx + dy * dy > (r - 1) * (r - 1);
          const c = edge ? oreColor : highlight;
          const n = (t.rand() * 2 - 1) * 10;
          t.set(cx + dx, cy + dy, c[0] + n, c[1] + n, c[2] + n);
        }
      }
    }
  };
}
PAINTERS[TILE.COAL_ORE] = orePainter(C.coal, [58, 58, 62]);
PAINTERS[TILE.IRON_ORE] = orePainter([176, 132, 96], C.iron);
PAINTERS[TILE.GOLD_ORE] = orePainter([206, 168, 48], C.gold);
PAINTERS[TILE.DIAMOND_ORE] = orePainter([76, 196, 192], C.diamond);

// --- ทราย ---
PAINTERS[TILE.SAND] = (t) => {
  t.fill(C.sand, 12);
  t.speckle(C.sandDark, 20, [1, 1]);
  t.speckle([236, 228, 186], 14);
};

PAINTERS[TILE.RED_SAND] = (t) => {
  t.fill(C.redSand, 14);
  t.speckle([164, 84, 44], 20, [1, 1]);
  t.speckle([212, 126, 74], 12);
};

PAINTERS[TILE.SANDSTONE_TOP] = (t) => {
  t.fill([224, 214, 168], 8);
  t.speckle([206, 194, 148], 16, [1, 2]);
};

PAINTERS[TILE.SANDSTONE_SIDE] = (t) => {
  t.fill([222, 212, 166], 6);
  // ชั้นตะกอนแนวนอน
  for (let y = 0; y < t.size; y++) {
    const band = Math.sin(y * 0.9) * 8 + (t.rand() * 2 - 1) * 5;
    for (let x = 0; x < t.size; x++) t.shade(x, y, 1 + band / 100);
  }
  t.rect(0, 0, 16, 1, [200, 188, 142]);
  t.rect(0, 15, 16, 1, [200, 188, 142]);
};

// --- ไม้ ---
function logSide(base, dark, light) {
  return (t) => {
    t.fill(base, 10);
    for (let x = 0; x < t.size; x++) {
      const r = t.rand();
      if (r < 0.28) {
        for (let y = 0; y < t.size; y++) t.set(x, y, dark[0], dark[1], dark[2]);
      } else if (r < 0.42) {
        for (let y = 0; y < t.size; y++) t.set(x, y, light[0], light[1], light[2]);
      }
      // ปมไม้สั้นๆ
      if (t.rand() < 0.25) {
        const y0 = Math.floor(t.rand() * 12);
        for (let y = y0; y < y0 + 2 + Math.floor(t.rand() * 3); y++) t.shade(x, y, 0.82);
      }
    }
  };
}
PAINTERS[TILE.LOG_SIDE] = logSide(C.wood, C.woodDark, C.woodLight);
PAINTERS[TILE.SPRUCE_SIDE] = logSide(C.spruce, C.spruceDark, [110, 80, 48]);

PAINTERS[TILE.BIRCH_SIDE] = (t) => {
  t.fill(C.birch, 8);
  // ขีดดำแนวนอนแบบไม้เบิร์ช
  for (let i = 0; i < 7; i++) {
    const y = Math.floor(t.rand() * 16);
    const x0 = Math.floor(t.rand() * 16);
    const len = 2 + Math.floor(t.rand() * 4);
    for (let x = x0; x < x0 + len; x++) {
      t.set(x, y, 62, 60, 56);
      if (t.rand() < 0.4) t.set(x, y + 1, 92, 88, 82);
    }
  }
  t.speckle(C.birchDark, 10, [1, 1]);
};

function logTop(base, ring) {
  return (t) => {
    t.fill(base, 8);
    const cx = 7.5, cy = 7.5;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const band = Math.sin(d * 2.1) * 0.5 + 0.5;
        const f = 0.82 + band * 0.34;
        const c = d > 7 ? ring : base;
        t.set(x, y, c[0] * f, c[1] * f, c[2] * f);
      }
    }
  };
}
PAINTERS[TILE.LOG_TOP] = logTop(C.woodLight, C.woodDark);
PAINTERS[TILE.BIRCH_TOP] = logTop([206, 196, 168], [156, 148, 128]);

PAINTERS[TILE.PLANKS] = (t) => {
  t.fill(C.planks, 10);
  for (let y = 0; y < t.size; y++) {
    if (y % 4 === 0) {
      for (let x = 0; x < t.size; x++) t.set(x, y, C.planksDark[0], C.planksDark[1], C.planksDark[2]);
    } else {
      for (let x = 0; x < t.size; x++) {
        const n = (t.rand() * 2 - 1) * 12;
        t.set(x, y, C.planks[0] + n, C.planks[1] + n, C.planks[2] + n);
      }
    }
  }
  // รอยต่อแนวตั้งสลับแถว
  for (let row = 0; row < 4; row++) {
    const x = row % 2 === 0 ? 5 : 11;
    for (let y = row * 4 + 1; y < row * 4 + 4; y++) t.shade(x, y, 0.78);
  }
};

// --- ใบไม้ (มีรูโปร่งเล็กน้อยแบบ fancy leaves) ---
function leafPainter(base, dark) {
  return (t) => {
    for (let y = 0; y < t.size; y++) {
      for (let x = 0; x < t.size; x++) {
        const r = t.rand();
        if (r < 0.06) {
          t.set(x, y, 0, 0, 0, 0); // รูโปร่งใส
        } else {
          const c = r < 0.45 ? dark : base;
          const n = (t.rand() * 2 - 1) * 20;
          t.set(x, y, c[0] + n, c[1] + n, c[2] + n, 255);
        }
      }
    }
  };
}
PAINTERS[TILE.LEAVES] = leafPainter(C.leaf, C.leafDark);
PAINTERS[TILE.BIRCH_LEAVES] = leafPainter(C.birchLeaf, [92, 138, 56]);
PAINTERS[TILE.SPRUCE_LEAVES] = leafPainter(C.spruceLeaf, [28, 62, 38]);

// --- ของเหลว / โปร่งแสง ---
PAINTERS[TILE.WATER] = (t) => {
  for (let y = 0; y < t.size; y++) {
    for (let x = 0; x < t.size; x++) {
      const wave = Math.sin((x + y * 0.6) * 0.8) * 12 + Math.sin(y * 1.3) * 8;
      const n = (t.rand() * 2 - 1) * 6;
      t.set(x, y, C.water[0] + wave + n, C.water[1] + wave + n, C.water[2] + wave * 0.5 + n, 190);
    }
  }
};

PAINTERS[TILE.LAVA] = (t) => {
  for (let y = 0; y < t.size; y++) {
    for (let x = 0; x < t.size; x++) {
      const blob = Math.sin(x * 0.9) * Math.cos(y * 0.7) * 40;
      const n = (t.rand() * 2 - 1) * 18;
      t.set(x, y, C.lava[0] + blob + n, C.lava[1] + blob * 0.8 + n, C.lava[2] + n, 255);
    }
  }
  t.speckle([252, 224, 100], 8, [1, 2]);
};

PAINTERS[TILE.GLASS] = (t) => {
  // กระจกเป็นแบบ cutout: ตรงกลางโปร่งใสสนิท เหลือแต่กรอบและประกายแสง
  t.fill([210, 234, 244], 0, 0);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, 236, 248, 252, 255);
    t.set(i, 15, 236, 248, 252, 255);
    t.set(0, i, 236, 248, 252, 255);
    t.set(15, i, 236, 248, 252, 255);
  }
  for (let i = 1; i < 15; i++) {
    if (i % 3 === 0) {
      t.set(i, 1, 214, 232, 242, 255);
      t.set(1, i, 214, 232, 242, 255);
    }
  }
  // ประกายแสงทแยงมุมบนซ้าย
  for (let i = 3; i < 7; i++) t.set(i, 9 - i + 3, 255, 255, 255, 255);
};

PAINTERS[TILE.ICE] = (t) => {
  t.fill(C.ice, 10, 200);
  t.cells(5, (x, y, v, edge) => {
    if (edge < 0.55) {
      const [r, g, b] = t.get(x, y);
      t.set(x, y, r * 1.12, g * 1.1, b * 1.06, 215);
    }
  });
};

PAINTERS[TILE.GLOWSTONE] = (t) => {
  t.fill([196, 152, 66], 14);
  t.cells(8, (x, y, v) => {
    if (v > 0.4) {
      const f = 0.8 + v * 0.6;
      t.set(x, y, C.glow[0] * f, C.glow[1] * f, C.glow[2] * f * 0.9);
    }
  });
  t.speckle([255, 244, 190], 10, [1, 2]);
};

// --- กระบองเพชร ---
PAINTERS[TILE.CACTUS_SIDE] = (t) => {
  t.fill(C.cactus, 10);
  for (let x = 0; x < 16; x++) {
    if (x < 1 || x > 14) for (let y = 0; y < 16; y++) t.set(x, y, C.cactusDark[0], C.cactusDark[1], C.cactusDark[2]);
  }
  // หนามเรียงเป็นแถว
  for (let y = 1; y < 16; y += 4) {
    for (const x of [4, 11]) {
      t.set(x, y, 226, 226, 190);
      t.set(x, y + 1, 200, 200, 160);
    }
  }
};

PAINTERS[TILE.CACTUS_TOP] = (t) => {
  t.fill(C.cactus, 8);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) t.shade(x, y, 0.78);
      else if (d < 3) t.shade(x, y, 1.14);
    }
  }
};

// --- ขนแกะ ---
function woolPainter(color) {
  return (t) => {
    t.fill(color, 10);
    // ลายถักเป็นปุยเล็กๆ
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(t.rand() * 16);
      const y = Math.floor(t.rand() * 16);
      const f = t.rand() < 0.5 ? 0.88 : 1.1;
      t.shade(x, y, f);
      t.shade(x + 1, y, f);
      t.shade(x, y + 1, f);
    }
  };
}
PAINTERS[TILE.WOOL_WHITE] = woolPainter(C.wool.white);
PAINTERS[TILE.WOOL_RED] = woolPainter(C.wool.red);
PAINTERS[TILE.WOOL_ORANGE] = woolPainter(C.wool.orange);
PAINTERS[TILE.WOOL_YELLOW] = woolPainter(C.wool.yellow);
PAINTERS[TILE.WOOL_GREEN] = woolPainter(C.wool.green);
PAINTERS[TILE.WOOL_CYAN] = woolPainter(C.wool.cyan);
PAINTERS[TILE.WOOL_BLUE] = woolPainter(C.wool.blue);
PAINTERS[TILE.WOOL_PURPLE] = woolPainter(C.wool.purple);
PAINTERS[TILE.WOOL_PINK] = woolPainter(C.wool.pink);
PAINTERS[TILE.WOOL_BLACK] = woolPainter(C.wool.black);

// ---------------------------------------------------------------- ประกอบ atlas

let atlasCanvas = null;
let atlasTexture = null;
/** เก็บ canvas ของแต่ละ tile ไว้ใช้วาดไอคอนใน hotbar */
const tileCanvases = new Map();

/**
 * สร้าง atlas ทั้งผืน (เรียกครั้งเดียวตอนเริ่มเกม)
 * @returns {THREE.Texture}
 */
export function buildAtlas() {
  if (atlasTexture) return atlasTexture;

  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS_PX;
  const ctx = atlasCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const indices = Object.keys(PAINTERS).map(Number).sort((a, b) => a - b);
  for (const idx of indices) {
    const tile = new Tile(idx * 9871 + 12345);
    PAINTERS[idx](tile);
    const canvas = tile.toCanvas();
    tileCanvases.set(idx, canvas);

    const cx = (idx % ATLAS_TILES) * CELL_PX;
    const cy = Math.floor(idx / ATLAS_TILES) * CELL_PX;

    // วางภาพซ้ำต่อเนื่องเต็ม cell — tile จริงจะพอดีอยู่กลาง cell ที่ offset = TILE_PAD
    const pattern = ctx.createPattern(canvas, 'repeat');
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, CELL_PX, CELL_PX);
    ctx.clip();
    ctx.translate(cx + TILE_PAD - TILE_PX, cy + TILE_PAD - TILE_PX);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, CELL_PX + TILE_PX * 2, CELL_PX + TILE_PX * 2);
    ctx.restore();
  }

  atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestMipmapLinearFilter;
  atlasTexture.generateMipmaps = true;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.needsUpdate = true;
  return atlasTexture;
}

/** พิกัด UV ของ tile ในรูป [u0, v0, u1, v1] (แกน V ของ Three กลับหัวกับ canvas) */
export function tileUV(index) {
  const cx = index % ATLAS_TILES;
  const cy = Math.floor(index / ATLAS_TILES);
  const u0 = (cx * CELL_PX + TILE_PAD) / ATLAS_PX;
  const u1 = (cx * CELL_PX + TILE_PAD + TILE_PX) / ATLAS_PX;
  const vTop = 1 - (cy * CELL_PX + TILE_PAD) / ATLAS_PX;
  const vBottom = 1 - (cy * CELL_PX + TILE_PAD + TILE_PX) / ATLAS_PX;
  return [u0, vBottom, u1, vTop];
}

/** ตาราง UV แบบแบนสำหรับส่งให้ worker (4 ค่าต่อ tile) */
export function buildUVTable() {
  const total = ATLAS_TILES * ATLAS_TILES;
  const table = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    const [u0, v0, u1, v1] = tileUV(i);
    table[i * 4] = u0; table[i * 4 + 1] = v0;
    table[i * 4 + 2] = u1; table[i * 4 + 3] = v1;
  }
  return table;
}

/** canvas ขนาด 16×16 ของ tile หนึ่งๆ — ใช้วาดไอคอนบล็อกใน hotbar */
export function getTileCanvas(index) {
  return tileCanvases.get(index) || null;
}
