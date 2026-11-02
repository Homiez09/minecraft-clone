/**
 * นิยามบล็อกทั้งหมดในเกม
 *
 * ลำดับหน้าของบล็อก (faces) เรียงตาม: [+X, -X, +Y(บน), -Y(ล่าง), +Z, -Z]
 * ตัวเลขในนั้นคือ tile index ใน texture atlas (ดู textures.js ว่าแต่ละ index วาดอะไร)
 *
 * คุณสมบัติ:
 *   solid       — ชนได้ (ผู้เล่นเดินทะลุไม่ได้)
 *   opaque      — ทึบแสง ใช้ตัดสินว่าจะซ่อนหน้าของบล็อกข้างเคียงไหม
 *   transparent — ต้องเรนเดอร์ในกลุ่ม transparent (มี alpha หรือมองทะลุได้)
 *   liquid      — ของเหลว (ว่ายน้ำได้ แรงโน้มถ่วงเปลี่ยน)
 *   light       — ค่าแสงที่บล็อกเปล่งเอง 0..15
 *   sound       — กลุ่มเสียงตอนเดิน/ทุบ/วาง
 */

// ---------- Tile index ใน atlas ----------
export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5,
  LOG_SIDE: 6, LOG_TOP: 7, LEAVES: 8, PLANKS: 9, WATER: 10, GLASS: 11,
  SNOW: 12, SNOW_SIDE: 13, BEDROCK: 14, GRAVEL: 15,

  COAL_ORE: 16, IRON_ORE: 17, GOLD_ORE: 18, DIAMOND_ORE: 19,
  SANDSTONE_TOP: 20, SANDSTONE_SIDE: 21, BRICK: 22, STONE_BRICK: 23,
  MOSSY_COBBLE: 24, OBSIDIAN: 25, ICE: 26, GLOWSTONE: 27,
  CACTUS_SIDE: 28, CACTUS_TOP: 29, BIRCH_SIDE: 30, BIRCH_LEAVES: 31,

  WOOL_WHITE: 32, WOOL_RED: 33, WOOL_ORANGE: 34, WOOL_YELLOW: 35,
  WOOL_GREEN: 36, WOOL_CYAN: 37, WOOL_BLUE: 38, WOOL_PURPLE: 39,
  WOOL_PINK: 40, WOOL_BLACK: 41, RED_SAND: 42, CLAY: 43,
  SPRUCE_LEAVES: 44, SPRUCE_SIDE: 45, LAVA: 46, BIRCH_TOP: 47,
};

// ---------- Block ID ----------
export const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5,
  LOG: 6, LEAVES: 7, PLANKS: 8, WATER: 9, GLASS: 10, SNOW: 11,
  BEDROCK: 12, GRAVEL: 13, COAL_ORE: 14, IRON_ORE: 15, GOLD_ORE: 16,
  DIAMOND_ORE: 17, SANDSTONE: 18, BRICK: 19, STONE_BRICK: 20,
  MOSSY_COBBLE: 21, OBSIDIAN: 22, ICE: 23, GLOWSTONE: 24, CACTUS: 25,
  BIRCH_LOG: 26, BIRCH_LEAVES: 27, SPRUCE_LOG: 28, SPRUCE_LEAVES: 29,
  WOOL_WHITE: 30, WOOL_RED: 31, WOOL_ORANGE: 32, WOOL_YELLOW: 33,
  WOOL_GREEN: 34, WOOL_CYAN: 35, WOOL_BLUE: 36, WOOL_PURPLE: 37,
  WOOL_PINK: 38, WOOL_BLACK: 39, RED_SAND: 40, CLAY: 41, LAVA: 42,
};

/** ตัวช่วยสร้างนิยาม: ระบุ tile เดียวใช้ทุกหน้า หรือ {top, side, bottom} */
function faces(spec) {
  if (typeof spec === 'number') return [spec, spec, spec, spec, spec, spec];
  const { top, side, bottom = top } = spec;
  return [side, side, top, bottom, side, side];
}

function def(name, tiles, opts = {}) {
  return {
    name,
    faces: faces(tiles),
    solid: opts.solid !== false,
    opaque: opts.opaque !== false,
    transparent: opts.transparent === true,
    liquid: opts.liquid === true,
    light: opts.light || 0,
    sound: opts.sound || 'stone',
  };
}

/** ตารางนิยามบล็อก — index ตรงกับ BLOCK id */
export const BLOCKS = [];
BLOCKS[BLOCK.AIR] = { name: 'อากาศ', faces: null, solid: false, opaque: false, transparent: true, liquid: false, light: 0, sound: null };
BLOCKS[BLOCK.GRASS] = def('บล็อกหญ้า', { top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT }, { sound: 'grass' });
BLOCKS[BLOCK.DIRT] = def('ดิน', TILE.DIRT, { sound: 'grass' });
BLOCKS[BLOCK.STONE] = def('หิน', TILE.STONE);
BLOCKS[BLOCK.COBBLE] = def('หินกรวด', TILE.COBBLE);
BLOCKS[BLOCK.SAND] = def('ทราย', TILE.SAND, { sound: 'sand' });
BLOCKS[BLOCK.LOG] = def('ท่อนไม้โอ๊ก', { top: TILE.LOG_TOP, side: TILE.LOG_SIDE }, { sound: 'wood' });
BLOCKS[BLOCK.LEAVES] = def('ใบไม้โอ๊ก', TILE.LEAVES, { opaque: false, transparent: true, sound: 'grass' });
BLOCKS[BLOCK.PLANKS] = def('ไม้กระดาน', TILE.PLANKS, { sound: 'wood' });
BLOCKS[BLOCK.WATER] = def('น้ำ', TILE.WATER, { solid: false, opaque: false, transparent: true, liquid: true, sound: 'water' });
BLOCKS[BLOCK.GLASS] = def('กระจก', TILE.GLASS, { opaque: false, transparent: true, sound: 'glass' });
BLOCKS[BLOCK.SNOW] = def('บล็อกหิมะ', { top: TILE.SNOW, side: TILE.SNOW_SIDE, bottom: TILE.DIRT }, { sound: 'snow' });
BLOCKS[BLOCK.BEDROCK] = def('หินฐานโลก', TILE.BEDROCK);
BLOCKS[BLOCK.GRAVEL] = def('กรวด', TILE.GRAVEL, { sound: 'gravel' });
BLOCKS[BLOCK.COAL_ORE] = def('แร่ถ่านหิน', TILE.COAL_ORE);
BLOCKS[BLOCK.IRON_ORE] = def('แร่เหล็ก', TILE.IRON_ORE);
BLOCKS[BLOCK.GOLD_ORE] = def('แร่ทองคำ', TILE.GOLD_ORE);
BLOCKS[BLOCK.DIAMOND_ORE] = def('แร่เพชร', TILE.DIAMOND_ORE);
BLOCKS[BLOCK.SANDSTONE] = def('หินทราย', { top: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE });
BLOCKS[BLOCK.BRICK] = def('อิฐ', TILE.BRICK);
BLOCKS[BLOCK.STONE_BRICK] = def('อิฐหิน', TILE.STONE_BRICK);
BLOCKS[BLOCK.MOSSY_COBBLE] = def('หินกรวดมอส', TILE.MOSSY_COBBLE);
BLOCKS[BLOCK.OBSIDIAN] = def('ออบซิเดียน', TILE.OBSIDIAN);
BLOCKS[BLOCK.ICE] = def('น้ำแข็ง', TILE.ICE, { opaque: false, transparent: true, sound: 'glass' });
BLOCKS[BLOCK.GLOWSTONE] = def('หินเรืองแสง', TILE.GLOWSTONE, { light: 15, sound: 'glass' });
BLOCKS[BLOCK.CACTUS] = def('กระบองเพชร', { top: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE }, { sound: 'grass' });
BLOCKS[BLOCK.BIRCH_LOG] = def('ท่อนไม้เบิร์ช', { top: TILE.BIRCH_TOP, side: TILE.BIRCH_SIDE }, { sound: 'wood' });
BLOCKS[BLOCK.BIRCH_LEAVES] = def('ใบไม้เบิร์ช', TILE.BIRCH_LEAVES, { opaque: false, transparent: true, sound: 'grass' });
BLOCKS[BLOCK.SPRUCE_LOG] = def('ท่อนไม้สน', { top: TILE.LOG_TOP, side: TILE.SPRUCE_SIDE }, { sound: 'wood' });
BLOCKS[BLOCK.SPRUCE_LEAVES] = def('ใบสน', TILE.SPRUCE_LEAVES, { opaque: false, transparent: true, sound: 'grass' });
BLOCKS[BLOCK.WOOL_WHITE] = def('ขนแกะขาว', TILE.WOOL_WHITE, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_RED] = def('ขนแกะแดง', TILE.WOOL_RED, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_ORANGE] = def('ขนแกะส้ม', TILE.WOOL_ORANGE, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_YELLOW] = def('ขนแกะเหลือง', TILE.WOOL_YELLOW, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_GREEN] = def('ขนแกะเขียว', TILE.WOOL_GREEN, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_CYAN] = def('ขนแกะฟ้า', TILE.WOOL_CYAN, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_BLUE] = def('ขนแกะน้ำเงิน', TILE.WOOL_BLUE, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_PURPLE] = def('ขนแกะม่วง', TILE.WOOL_PURPLE, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_PINK] = def('ขนแกะชมพู', TILE.WOOL_PINK, { sound: 'wool' });
BLOCKS[BLOCK.WOOL_BLACK] = def('ขนแกะดำ', TILE.WOOL_BLACK, { sound: 'wool' });
BLOCKS[BLOCK.RED_SAND] = def('ทรายแดง', TILE.RED_SAND, { sound: 'sand' });
BLOCKS[BLOCK.CLAY] = def('ดินเหนียว', TILE.CLAY, { sound: 'gravel' });
BLOCKS[BLOCK.LAVA] = def('ลาวา', TILE.LAVA, { solid: false, opaque: false, transparent: true, liquid: true, light: 15, sound: 'water' });

// ---------- ตารางค้นหาแบบเร็ว (typed array — worker และ mesher ใช้ทุกเฟรม) ----------
const COUNT = BLOCKS.length;
export const IS_OPAQUE = new Uint8Array(COUNT);
export const IS_SOLID = new Uint8Array(COUNT);
export const IS_TRANSPARENT = new Uint8Array(COUNT);
export const IS_LIQUID = new Uint8Array(COUNT);
export const LIGHT_EMIT = new Uint8Array(COUNT);
/** faces แบบแบน: FACE_TILES[id * 6 + faceIndex] = tile index */
export const FACE_TILES = new Uint8Array(COUNT * 6);

for (let id = 0; id < COUNT; id++) {
  const b = BLOCKS[id];
  if (!b) continue;
  IS_OPAQUE[id] = b.opaque ? 1 : 0;
  IS_SOLID[id] = b.solid ? 1 : 0;
  IS_TRANSPARENT[id] = b.transparent ? 1 : 0;
  IS_LIQUID[id] = b.liquid ? 1 : 0;
  LIGHT_EMIT[id] = b.light;
  if (b.faces) {
    for (let f = 0; f < 6; f++) FACE_TILES[id * 6 + f] = b.faces[f];
  }
}

/** บล็อกที่ผู้เล่นหยิบใส่ hotbar ได้ (ไล่ตามลำดับในเมนูเลือก) */
export const PLACEABLE = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.SAND, BLOCK.GRAVEL,
  BLOCK.LOG, BLOCK.PLANKS, BLOCK.LEAVES, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES,
  BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES, BLOCK.SANDSTONE, BLOCK.BRICK,
  BLOCK.STONE_BRICK, BLOCK.MOSSY_COBBLE, BLOCK.OBSIDIAN, BLOCK.GLASS,
  BLOCK.GLOWSTONE, BLOCK.ICE, BLOCK.SNOW, BLOCK.CACTUS, BLOCK.CLAY,
  BLOCK.RED_SAND, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE,
  BLOCK.WOOL_WHITE, BLOCK.WOOL_RED, BLOCK.WOOL_ORANGE, BLOCK.WOOL_YELLOW,
  BLOCK.WOOL_GREEN, BLOCK.WOOL_CYAN, BLOCK.WOOL_BLUE, BLOCK.WOOL_PURPLE,
  BLOCK.WOOL_PINK, BLOCK.WOOL_BLACK, BLOCK.WATER,
];

export function blockName(id) {
  return BLOCKS[id]?.name ?? 'ไม่ทราบ';
}
