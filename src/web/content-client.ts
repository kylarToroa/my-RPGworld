// 读取构建时生成的内容 JSON（data/ 目录），带缓存
import { ContentIndexSchema, type ContentIndex, ContentItemSchema, type ContentItem } from '../data/schemas';

export class ContentClient {
  private index?: Promise<ContentIndex>;
  private readonly items = new Map<string, Promise<ContentItem>>();

  constructor(private readonly baseUrl = './') {}

  getIndex(): Promise<ContentIndex> {
    this.index ??= this.fetchJson('data/content-index.json').then((d) => ContentIndexSchema.parse(d));
    this.index.catch(() => (this.index = undefined)); // 失败后允许重试
    return this.index;
  }

  getItem(id: string): Promise<ContentItem> {
    let p = this.items.get(id);
    if (!p) {
      p = this.fetchJson(`data/content/${encodeURIComponent(id)}.json`).then((d) => ContentItemSchema.parse(d));
      p.catch(() => this.items.delete(id));
      this.items.set(id, p);
    }
    return p;
  }

  /** 独立页面的完整地址 */
  pageUrl(item: { url: string }): string {
    return new URL(this.baseUrl + item.url, document.baseURI).href;
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(this.baseUrl + path);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
}
