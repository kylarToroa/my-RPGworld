// 构建期内容管线（仅在 Node 中运行）：
// content/*.md → 校验 → ① 游戏弹窗用的 JSON  ② 可直接访问的静态页面（同一份源文件）
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { Marked } from 'marked';
import {
  ContentFrontmatterSchema,
  type ContentIndex,
  type ContentItem,
  type ContentKind,
  type ContentMeta,
} from './schemas';

const KIND_DIRS: Record<ContentKind, { dir: string; urlPrefix: string }> = {
  article: { dir: 'articles', urlPrefix: 'articles' },
  page: { dir: 'pages', urlPrefix: 'pages' },
};

export interface LoadedContent {
  /** 所有内容（含草稿） */
  all: ContentItem[];
  /** 仅已发布 */
  published: ContentItem[];
  problems: string[];
}

const marked = new Marked({ gfm: true });

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  // 文章里以 / 开头的站内链接/图片，统一改写为“相对站点根目录”的路径，
  // 这样游戏弹窗（站点根目录）和独立页面（<base> 指向站点根目录）都能正确解析。
  return html.replace(/(\s(?:src|href)=")\/(?!\/)/g, '$1');
}

export function parseContentFile(source: string, fileName: string, kind: ContentKind): ContentItem {
  const { data, content } = matter(source);
  const fm = ContentFrontmatterSchema.parse(data);
  const id = fm.id ?? basename(fileName, '.md');
  return {
    id,
    kind,
    title: fm.title,
    category: fm.category,
    tags: fm.tags,
    status: fm.status,
    date: fm.date ? fm.date.toISOString().slice(0, 10) : undefined,
    summary: fm.summary,
    url: `${KIND_DIRS[kind].urlPrefix}/${id}/`,
    html: renderMarkdown(content),
  };
}

export function loadContent(root: string): LoadedContent {
  const all: ContentItem[] = [];
  const problems: string[] = [];
  for (const kind of Object.keys(KIND_DIRS) as ContentKind[]) {
    const dir = join(root, KIND_DIRS[kind].dir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      try {
        all.push(parseContentFile(readFileSync(join(dir, file), 'utf8'), file, kind));
      } catch (err) {
        problems.push(`content/${KIND_DIRS[kind].dir}/${file}: ${formatError(err)}`);
      }
    }
  }
  const seen = new Set<string>();
  for (const item of all) {
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(item.id)) problems.push(`内容 ID "${item.id}" 只能包含小写字母、数字、- 和 _`);
    if (seen.has(item.id)) problems.push(`内容 ID 重复：${item.id}`);
    seen.add(item.id);
  }
  const published = all.filter((i) => i.status === 'published').sort(compareItems);
  return { all, published, problems };
}

function compareItems(a: ContentMeta, b: ContentMeta): number {
  return (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title, 'zh-CN');
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)) {
    return err.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join('.')} ${i.message}`).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

export function toMeta(item: ContentItem): ContentMeta {
  const { html: _html, ...meta } = item;
  return meta;
}

// ---------- 静态站点文件 ----------

export interface SiteOptions {
  siteTitle: string;
  /** 部署的子路径，例如 /my-RPGworld/；只用于 404 页面 */
  basePath: string;
}

/** 生成所有内容相关的静态文件：路径（相对站点根目录）→ 文件内容 */
export function buildSiteFiles(published: ContentItem[], opts: SiteOptions): Map<string, string> {
  const files = new Map<string, string>();
  const index: ContentIndex = { items: published.map(toMeta) };
  files.set('data/content-index.json', JSON.stringify(index));
  for (const item of published) {
    files.set(`data/content/${item.id}.json`, JSON.stringify(item));
    files.set(`${item.url}index.html`, renderItemPage(item, opts));
  }
  files.set('library/index.html', renderLibraryPage(published, opts));
  files.set('404.html', render404(opts));
  return files;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(opts: { title: string; description?: string | undefined; base: string; body: string; siteTitle: string }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${opts.base}">
<title>${escapeHtml(opts.title)}</title>
${opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}">` : ''}
<meta property="og:title" content="${escapeHtml(opts.title)}">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="stylesheet" href="site.css">
</head>
<body class="static-page">
${siteNav(opts.siteTitle)}
<main class="page-main">
${opts.body}
</main>
</body>
</html>
`;
}

/** 站点导航（静态页面与游戏页共用同一结构） */
export function siteNav(siteTitle: string): string {
  return `<header class="site-nav">
  <a class="site-title" href="./">${escapeHtml(siteTitle)}</a>
  <nav aria-label="网站导航">
    <a href="./">探索世界</a>
    <a href="library/">内容库</a>
    <a href="pages/about/">关于</a>
  </nav>
</header>`;
}

function metaLine(item: ContentMeta): string {
  const parts = [item.date, item.category, ...item.tags.map((t) => `#${t}`)].filter(Boolean) as string[];
  return parts.map(escapeHtml).join(' · ');
}

function baseFor(url: string): string {
  return '../'.repeat(url.split('/').filter(Boolean).length) || './';
}

function renderItemPage(item: ContentItem, opts: SiteOptions): string {
  return layout({
    title: `${item.title} · ${opts.siteTitle}`,
    description: item.summary,
    base: baseFor(item.url),
    siteTitle: opts.siteTitle,
    body: `<article class="reader">
  <h1>${escapeHtml(item.title)}</h1>
  <p class="meta">${metaLine(item)}</p>
  <div class="prose">${item.html}</div>
</article>
<p class="page-actions"><a href="library/">← 返回内容库</a><a href="./?open=${encodeURIComponent(item.id)}">在游戏世界中打开</a></p>`,
  });
}

export function renderLibraryPage(published: ContentMeta[], opts: SiteOptions): string {
  const byCategory = new Map<string, ContentMeta[]>();
  for (const item of published) byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
  const sections = [...byCategory]
    .map(
      ([cat, items]) => `<section>
  <h2>${escapeHtml(cat)}</h2>
  <ul class="item-list">
${items.map((i) => `    <li><a href="${i.url}">${escapeHtml(i.title)}</a>${i.summary ? `<p>${escapeHtml(i.summary)}</p>` : ''}<span class="meta">${metaLine(i)}</span></li>`).join('\n')}
  </ul>
</section>`,
    )
    .join('\n');
  return layout({
    title: `内容库 · ${opts.siteTitle}`,
    description: '全部文章与页面',
    base: '../',
    siteTitle: opts.siteTitle,
    body: `<div class="reader"><h1>内容库</h1><p>不想玩游戏？这里可以直接浏览全部内容。</p>${sections || '<p>还没有已发布的内容。</p>'}</div>`,
  });
}

function render404(opts: SiteOptions): string {
  // GitHub Pages 会在任意路径下返回 404.html，相对路径不可靠，所以这里用部署子路径的绝对地址
  return layout({
    title: `找不到页面 · ${opts.siteTitle}`,
    base: opts.basePath,
    siteTitle: opts.siteTitle,
    body: `<div class="reader"><h1>找不到这个页面</h1><p>它可能被移动或删除了。</p><p><a href="./">回到首页</a> · <a href="library/">去内容库看看</a></p></div>`,
  });
}
