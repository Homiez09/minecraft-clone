/**
 * เมนูหลัก หน้าจอหยุดชั่วคราว และหน้าจอกำลังโหลด
 * ทำหน้าที่แค่จัดการ DOM กับยิง callback — ตรรกะของเกมอยู่ใน main.js ทั้งหมด
 */

export class Menu {
  /**
   * @param {object} handlers
   * @param {(seed: string) => void} handlers.onNewWorld
   * @param {() => void} handlers.onContinue
   * @param {() => void} handlers.onResume
   * @param {() => void} handlers.onSaveQuit
   * @param {() => void} handlers.onDelete
   * @param {(key: string, value: any) => void} handlers.onSetting
   */
  constructor(handlers) {
    this.handlers = handlers;

    this.menuEl = document.getElementById('menu');
    this.pauseEl = document.getElementById('pause');
    this.loadingEl = document.getElementById('loading');
    this.loadingBar = document.getElementById('loading-bar');
    this.loadingStatus = document.getElementById('loading-status');
    this.pauseSub = document.getElementById('pause-sub');

    this.seedInput = document.getElementById('seed-input');
    this.btnContinue = document.getElementById('btn-continue');
    this.btnNew = document.getElementById('btn-new');
    this.btnDelete = document.getElementById('btn-delete');
    this.btnResume = document.getElementById('btn-resume');
    this.btnSaveQuit = document.getElementById('btn-save-quit');
    this.rdSlider = document.getElementById('rd-slider');
    this.rdValue = document.getElementById('rd-value');
    this.fovSlider = document.getElementById('fov-slider');
    this.fovValue = document.getElementById('fov-value');
    this.soundToggle = document.getElementById('sound-toggle');

    this.bind();
  }

  bind() {
    this.btnNew.addEventListener('click', () => this.handlers.onNewWorld(this.seedInput.value));
    this.btnContinue.addEventListener('click', () => this.handlers.onContinue());
    this.btnDelete.addEventListener('click', () => this.handlers.onDelete());
    this.btnResume.addEventListener('click', () => this.handlers.onResume());
    this.btnSaveQuit.addEventListener('click', () => this.handlers.onSaveQuit());

    // กด Enter ในช่อง seed = เริ่มโลกใหม่ทันที
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handlers.onNewWorld(this.seedInput.value);
    });

    this.rdSlider.addEventListener('input', () => {
      const value = Number(this.rdSlider.value);
      this.rdValue.textContent = String(value);
      this.handlers.onSetting('renderDistance', value);
    });

    this.fovSlider.addEventListener('input', () => {
      const value = Number(this.fovSlider.value);
      this.fovValue.textContent = String(value);
      this.handlers.onSetting('fov', value);
    });

    this.soundToggle.addEventListener('change', () => {
      this.handlers.onSetting('sound', this.soundToggle.checked);
    });
  }

  syncSettings({ renderDistance, fov, sound }) {
    if (renderDistance != null) {
      this.rdSlider.value = String(renderDistance);
      this.rdValue.textContent = String(renderDistance);
    }
    if (fov != null) {
      this.fovSlider.value = String(fov);
      this.fovValue.textContent = String(fov);
    }
    if (sound != null) this.soundToggle.checked = sound;
  }

  showMain(hasSave) {
    this.hideAll();
    this.menuEl.classList.remove('hidden');
    this.btnContinue.disabled = !hasSave;
    this.btnDelete.disabled = !hasSave;
    document.body.classList.remove('playing');
  }

  showPause(subtitle) {
    this.hideAll();
    if (subtitle) this.pauseSub.textContent = subtitle;
    this.pauseEl.classList.remove('hidden');
    document.body.classList.remove('playing');
  }

  showLoading(status = 'กำลังเตรียมภูมิประเทศ…') {
    this.hideAll();
    this.loadingEl.classList.remove('hidden');
    this.loadingStatus.textContent = status;
    this.loadingBar.style.width = '0%';
    document.body.classList.remove('playing');
  }

  setProgress(fraction, status) {
    this.loadingBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (status) this.loadingStatus.textContent = status;
  }

  hideAll() {
    this.menuEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.loadingEl.classList.add('hidden');
  }

  enterGame() {
    this.hideAll();
    document.body.classList.add('playing');
  }

  get isMenuOpen() {
    return !this.menuEl.classList.contains('hidden')
      || !this.pauseEl.classList.contains('hidden')
      || !this.loadingEl.classList.contains('hidden');
  }
}
