// 浏览器与 Node 共用的内容查询逻辑
import type { ContentMeta } from './schemas';

export interface ContentFilter {
  category?: string | undefined;
  tag?: string | undefined;
}

/** 按分类/标签筛选已发布内容——书架等“动态集合”都走这里 */
export function filterContent<T extends ContentMeta>(items: T[], filter: ContentFilter): T[] {
  return items.filter(
    (i) =>
      i.status === 'published' &&
      (!filter.category || i.category === filter.category) &&
      (!filter.tag || i.tags.includes(filter.tag)),
  );
}
