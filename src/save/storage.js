/**
 * บันทึกและโหลดเกมด้วย IndexedDB
 *
 * เราไม่เก็บบล็อกทั้งโลก (โลกไม่มีที่สิ้นสุด จะเก็บหมดไม่ได้อยู่แล้ว)
 * แต่เก็บแค่ seed กับ "ส่วนต่าง" คือบล็อกที่ผู้เล่นทุบหรือวางเท่านั้น
 * ตอนโหลดกลับมา ภูมิประเทศถูกสร้างใหม่จาก seed แล้วเอาส่วนต่างทาบทับลงไป
 * ทำให้ไฟล์เซฟเล็กมาก แม้เดินสำรวจไปไกลแค่ไหนก็ตาม
 */

import { DB_NAME, DB_VERSION } from '../config.js';

const STORE_WORLD = 'world';
const STORE_CHUNKS = 'chunks';
const WORLD_KEY = 'current';

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class Storage {
  constructor() {
    this.db = null;
    this.available = typeof indexedDB !== 'undefined';
  }

  async open() {
    if (this.db || !this.available) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_WORLD)) db.createObjectStore(STORE_WORLD, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }

  async hasSave() {
    if (!this.available) return false;
    try {
      await this.open();
      const tx = this.db.transaction(STORE_WORLD, 'readonly');
      const record = await promisify(tx.objectStore(STORE_WORLD).get(WORLD_KEY));
      return !!record;
    } catch {
      return false;
    }
  }

  /**
   * @param {object} meta { seed, time, player: {x,y,z,yaw,pitch,flying}, hotbar, renderDistance }
   * @param {Array} chunkEdits ผลจาก World.serializeEdits()
   */
  async save(meta, chunkEdits) {
    if (!this.available) return false;
    await this.open();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_WORLD, STORE_CHUNKS], 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);

      tx.objectStore(STORE_WORLD).put({ id: WORLD_KEY, savedAt: Date.now(), ...meta });

      const chunkStore = tx.objectStore(STORE_CHUNKS);
      for (const rec of chunkEdits) chunkStore.put(rec);
    });
  }

  async load() {
    if (!this.available) return null;
    await this.open();

    const tx = this.db.transaction([STORE_WORLD, STORE_CHUNKS], 'readonly');
    const meta = await promisify(tx.objectStore(STORE_WORLD).get(WORLD_KEY));
    if (!meta) return null;
    const chunks = await promisify(tx.objectStore(STORE_CHUNKS).getAll());
    return { meta, chunks: chunks || [] };
  }

  async deleteAll() {
    if (!this.available) return;
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_WORLD, STORE_CHUNKS], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_WORLD).clear();
      tx.objectStore(STORE_CHUNKS).clear();
    });
  }

  /** ขนาดเซฟโดยประมาณเป็น KB (ใช้แสดงในแผงดีบัก) */
  static estimateSize(chunkEdits) {
    let bytes = 0;
    for (const rec of chunkEdits) bytes += rec.indices.byteLength + rec.blocks.byteLength + rec.key.length * 2;
    return bytes / 1024;
  }
}
