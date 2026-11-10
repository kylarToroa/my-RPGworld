// 键盘状态：自己监听 window 事件（而不是用 Phaser 键盘），这样内容窗口打开时游戏完全不拦截按键。
import type { Facing } from '../data/schemas';

const DIR_KEYS: Record<string, Facing> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};
const INTERACT_KEYS = new Set(['e', 'E', ' ', 'Enter']);

export class KeyboardState {
  private held: Facing[] = [];
  private tapped: Facing | null = null;
  private interact = false;

  /** 处理按下；返回 true 表示这是游戏按键 */
  keyDown(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const dir = DIR_KEYS[e.key];
    if (dir) {
      if (!this.held.includes(dir)) this.held.push(dir);
      this.tapped = dir;
      return true;
    }
    if (INTERACT_KEYS.has(e.key)) {
      if (!e.repeat) this.interact = true;
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    const dir = DIR_KEYS[e.key];
    if (dir) this.held = this.held.filter((d) => d !== dir);
  }

  /** 当前方向：最后按下且仍按住的方向优先；快速点按也会生效一次 */
  direction(): Facing | null {
    const d = this.held[this.held.length - 1] ?? this.tapped;
    this.tapped = null;
    return d;
  }

  consumeInteract(): boolean {
    const v = this.interact;
    this.interact = false;
    return v;
  }

  reset(): void {
    this.held = [];
    this.tapped = null;
    this.interact = false;
  }
}
