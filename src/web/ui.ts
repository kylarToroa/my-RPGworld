// 叠加在游戏画面上的 HTML 界面：对话框、内容窗口（同一时间只开一个）、提示条
import type { SayRequest, SayResult } from '../game/actions';
import { filterContent, type ContentFilter } from '../data/content-query';
import type { ContentItem, ContentMeta } from '../data/schemas';
import type { ContentClient } from './content-client';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const ADVANCE_KEYS = new Set(['Enter', ' ', 'e', 'E']);

export class GameUI {
  private readonly dialogue = el('div', { class: 'dialogue', role: 'dialog', 'aria-live': 'polite', hidden: '' });
  private readonly modal = el('div', { class: 'modal-backdrop', hidden: '' });
  private readonly toast = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  private readonly hint = el('div', { class: 'hint' });

  private sayResolve?: (r: SayResult) => void;
  private choiceButtons: HTMLButtonElement[] = [];
  private modalResolve?: () => void;
  private modalBody!: HTMLElement;
  private modalTitle!: HTMLElement;
  private modalLink!: HTMLAnchorElement;
  private modalBack!: HTMLButtonElement;
  private restoreFocus: Element | null = null;
  private toastTimer = 0;
  private openedAt = 0;

  constructor(
    stage: HTMLElement,
    private readonly content: ContentClient,
  ) {
    stage.append(this.hint, this.dialogue, this.modal, this.toast);
    this.buildModal();
    this.dialogue.addEventListener('click', (e) => {
      if (!(e.target instanceof HTMLButtonElement) && this.choiceButtons.length === 0) this.finishSay('next');
    });
  }

  /** 对话或窗口打开时，游戏暂停接收操作 */
  get blocking(): boolean {
    return !this.dialogue.hidden || !this.modal.hidden;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  notify(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 2600);
  }

  // ---------- 对话 ----------

  say(req: SayRequest): Promise<SayResult> {
    this.finishSay('closed');
    this.openedAt = performance.now();
    this.dialogue.replaceChildren();
    if (req.speaker) this.dialogue.append(el('div', { class: 'speaker' }, req.speaker));
    this.dialogue.append(el('p', { class: 'line' }, req.text));
    this.choiceButtons = (req.choices ?? []).map((label, i) => {
      const b = el('button', { type: 'button', class: 'choice' }, `${i + 1}. ${label}`);
      b.addEventListener('click', () => this.finishSay(i));
      return b;
    });
    if (this.choiceButtons.length) {
      const list = el('div', { class: 'choices' });
      list.append(...this.choiceButtons);
      this.dialogue.append(list);
    } else {
      this.dialogue.append(el('div', { class: 'continue', 'aria-hidden': 'true' }, '▼'));
    }
    this.dialogue.hidden = false;
    if (this.choiceButtons.length) {
      if (!document.activeElement || document.activeElement === document.body || this.dialogue.contains(document.activeElement)) {
        this.choiceButtons[0]!.focus({ preventScroll: true });
      }
    }
    return new Promise((resolve) => (this.sayResolve = resolve));
  }

  endDialogue(): void {
    this.finishSay('closed');
    this.dialogue.hidden = true;
    this.choiceButtons = [];
    if (this.dialogue.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  private finishSay(r: SayResult): void {
    const resolve = this.sayResolve;
    this.sayResolve = undefined;
    resolve?.(r);
  }

  // ---------- 内容窗口 ----------

  private buildModal(): void {
    const win = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' });
    const header = el('div', { class: 'modal-header' });
    this.modalBack = el('button', { type: 'button', class: 'modal-back', hidden: '' }, '← 返回');
    this.modalTitle = el('h2', { id: 'modal-title' });
    this.modalLink = el('a', { class: 'modal-link', target: '_blank', rel: 'noopener', hidden: '' }, '独立页面 ↗');
    const close = el('button', { type: 'button', class: 'modal-close', 'aria-label': '关闭' }, '×');
    close.addEventListener('click', () => this.closeModal());
    header.append(this.modalBack, this.modalTitle, this.modalLink, close);
    this.modalBody = el('div', { class: 'modal-body', tabindex: '0' });
    this.modalBody.addEventListener('click', (e) => {
      const a = (e.target as Element).closest?.('a');
      if (a && a.origin !== location.origin) a.target = '_blank';
    });
    win.append(header, this.modalBody);
    this.modal.append(win);
    this.modal.addEventListener('click', (e) => e.target === this.modal && this.closeModal());
  }

  /** 打开窗口；已打开时替换内容（始终只有一个窗口）。返回的 Promise 在窗口关闭时完成。 */
  private showModal(title: string): Promise<void> {
    this.modalTitle.textContent = title;
    this.modalBody.replaceChildren(el('p', { class: 'loading-text' }, '加载中…'));
    this.modalLink.hidden = true;
    this.modalBack.hidden = true;
    if (this.modal.hidden) {
      this.restoreFocus = document.activeElement;
      this.modal.hidden = false;
      this.modal.querySelector<HTMLButtonElement>('.modal-close')!.focus({ preventScroll: true });
    }
    return new Promise((resolve) => {
      const prev = this.modalResolve;
      this.modalResolve = () => {
        prev?.();
        resolve();
      };
    });
  }

  closeModal(): void {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    this.modalBody.replaceChildren();
    const resolve = this.modalResolve;
    this.modalResolve = undefined;
    if (this.restoreFocus instanceof HTMLElement) this.restoreFocus.focus({ preventScroll: true });
    resolve?.();
  }

  openContent(id: string): Promise<void> {
    const closed = this.showModal('加载中…');
    this.content.getItem(id).then(
      (item) => this.renderItem(item),
      () => this.renderError('内容加载失败，请检查网络后重试。'),
    );
    return closed;
  }

  openCollection(title: string, filter: ContentFilter): Promise<void> {
    const closed = this.showModal(title);
    this.content.getIndex().then(
      (index) => this.renderList(title, filterContent(index.items, filter)),
      () => this.renderError('列表加载失败，请检查网络后重试。'),
    );
    return closed;
  }

  private renderList(title: string, items: ContentMeta[]): void {
    this.modalTitle.textContent = title;
    this.modalBack.hidden = true;
    this.modalLink.hidden = true;
    if (!items.length) {
      this.modalBody.replaceChildren(el('p', {}, '这里还没有内容。'));
      return;
    }
    const list = el('ul', { class: 'item-list' });
    for (const item of items) {
      const li = el('li');
      const btn = el('button', { type: 'button', class: 'item-button' }, item.title);
      btn.addEventListener('click', () => {
        this.modalBody.replaceChildren(el('p', { class: 'loading-text' }, '加载中…'));
        this.content.getItem(item.id).then(
          (full) => {
            this.renderItem(full);
            this.modalBack.hidden = false;
            this.modalBack.textContent = `← ${title}`;
            this.modalBack.onclick = () => this.renderList(title, items);
          },
          () => this.renderError('文章加载失败，请检查网络后重试。'),
        );
      });
      li.append(btn);
      if (item.summary) li.append(el('p', {}, item.summary));
      const meta = [item.date, ...item.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ');
      if (meta) li.append(el('span', { class: 'meta' }, meta));
      list.append(li);
    }
    this.modalBody.replaceChildren(list);
    this.modalBody.scrollTop = 0;
  }

  private renderItem(item: ContentItem): void {
    this.modalTitle.textContent = item.title;
    this.modalLink.href = this.content.pageUrl(item);
    this.modalLink.hidden = false;
    const article = el('article', { class: 'reader' });
    const meta = [item.date, item.category, ...item.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ');
    if (meta) article.append(el('p', { class: 'meta' }, meta));
    const prose = el('div', { class: 'prose' });
    prose.innerHTML = item.html; // 构建时由站长自己的 Markdown 生成的可信 HTML
    article.append(prose);
    this.modalBody.replaceChildren(article);
    this.modalBody.scrollTop = 0;
  }

  private renderError(message: string): void {
    this.modalBody.replaceChildren(el('p', { class: 'error-text' }, message));
  }

  // ---------- 键盘 ----------

  /** 返回 true 表示按键已被界面处理，游戏不应再响应 */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.modal.hidden) {
      if (e.key === 'Escape') this.closeModal();
      return true; // 其余按键保留浏览器默认行为（滚动、Tab 等）
    }
    if (!this.dialogue.hidden) {
      // 刚打开时忽略按住不放产生的重复按键，避免一闪而过
      if (e.repeat || performance.now() - this.openedAt < 150) return true;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishSay('closed');
        return true;
      }
      if (this.choiceButtons.length) {
        const idx = this.choiceButtons.indexOf(document.activeElement as HTMLButtonElement);
        const n = Number(e.key);
        if (n >= 1 && n <= this.choiceButtons.length) this.finishSay(n - 1);
        else if (['ArrowDown', 's', 'S', 'ArrowUp', 'w', 'W'].includes(e.key)) {
          const delta = ['ArrowDown', 's', 'S'].includes(e.key) ? 1 : -1;
          const next = (Math.max(idx, 0) + delta + this.choiceButtons.length) % this.choiceButtons.length;
          this.choiceButtons[next]!.focus({ preventScroll: true });
        } else if (ADVANCE_KEYS.has(e.key)) this.finishSay(Math.max(idx, 0));
        else return true;
        e.preventDefault();
        return true;
      }
      if (ADVANCE_KEYS.has(e.key)) {
        e.preventDefault();
        this.finishSay('next');
      }
      return true;
    }
    return false;
  }
}
