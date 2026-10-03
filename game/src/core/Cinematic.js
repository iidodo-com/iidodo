import * as THREE from 'three';

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * カメラ演出。キーフレーム列 [{pos, look, t(秒)}] を滑らかに補間する。
 * FollowCamera.cine にフックを差し込む方式で、release() で通常のカメラに戻る。
 */
export class Cinematic {
  constructor(game) { this.game = game; }

  /** 現在のカメラ位置から keys を辿る。Promise は最後のキーに到達した時に resolve (カメラはその位置で保持) */
  run(keys) {
    const cam = this.game.camera, fc = this.game.cam;
    const start = { pos: cam.position.clone(), look: fc.focus.clone() };
    const frames = [{ pos: start.pos, look: start.look, t: 0 }, ...keys];
    let t = 0;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    return new Promise((resolve) => {
      fc.cine = (dt) => {
        t += dt;
        let i = 0;
        while (i < frames.length - 2 && t > frames[i + 1].t) i++;
        const a = frames[i], b = frames[i + 1];
        const k = smooth(Math.min(1, Math.max(0, (t - a.t) / Math.max(0.001, b.t - a.t))));
        pos.lerpVectors(a.pos, b.pos, k); look.lerpVectors(a.look, b.look, k);
        cam.position.copy(pos); cam.lookAt(look);
        fc.focus.copy(look);
        if (t >= frames[frames.length - 1].t) { const held = { pos: pos.clone(), look: look.clone() }; fc.cine = () => { cam.position.copy(held.pos); cam.lookAt(held.look); }; resolve(); }
      };
    });
  }

  /** 中心の周りを回るキー列を生成 (a0→a1 rad、半径 r、高さ h) */
  orbitKeys(center, { r, h, a0, a1, dur, lookY = 1.5, steps = 8, t0 = 0 }) {
    const keys = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, a = a0 + (a1 - a0) * k;
      keys.push({ pos: new THREE.Vector3(center.x + Math.sin(a) * r, center.y + h, center.z + Math.cos(a) * r), look: new THREE.Vector3(center.x, center.y + lookY, center.z), t: t0 + dur * k });
    }
    return keys;
  }

  release() { this.game.cam.cine = null; this.game.cam.snapTo(this.game.player.position); }
}
