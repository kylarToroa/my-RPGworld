import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildSiteFiles, loadContent, parseContentFile, renderMarkdown } from '../src/data/content-build';
import { filterContent } from '../src/data/content-query';
import { ContentIndexSchema } from '../src/data/schemas';

const md = (fm: string, body = '正文') => `---\n${fm}\n---\n${body}`;

describe('内容解析', () => {
  it('从文件名得到 ID，并生成独立页面地址', () => {
    const item = parseContentFile(md('title: 你好\ncategory: ai\nstatus: published\ndate: 2026-01-02'), 'hello.md', 'article');
    expect(item).toMatchObject({ id: 'hello', url: 'articles/hello/', date: '2026-01-02', status: 'published', tags: [] });
  });

  it('默认状态为草稿', () => {
    expect(parseContentFile(md('title: x\ncategory: ai'), 'x.md', 'article').status).toBe('draft');
  });

  it('缺少必填字段时报错', () => {
    expect(() => parseContentFile(md('category: ai'), 'x.md', 'article')).toThrow();
  });

  it('站内绝对链接改写为相对站点根目录', () => {
    const html = renderMarkdown('[库](/library/) ![图](/media/a.png) [外](https://example.com)');
    expect(html).toContain('href="library/"');
    expect(html).toContain('src="media/a.png"');
    expect(html).toContain('href="https://example.com"');
  });
});

describe('内容索引与动态书架', () => {
  const content = loadContent(join(__dirname, '..', 'content'));

  it('仓库内容没有错误', () => {
    expect(content.problems).toEqual([]);
  });

  it('草稿不进入已发布列表', () => {
    expect(content.all.some((i) => i.status === 'draft')).toBe(true);
    expect(content.published.every((i) => i.status === 'published')).toBe(true);
  });

  it('AI 书架列出所有已发布的 ai 分类内容，按日期倒序', () => {
    const shelf = filterContent(content.published, { category: 'ai' });
    expect(shelf.map((i) => i.id)).toEqual(['ai-agent-notes', 'ai-reading-list']);
  });

  it('新增一篇 ai 文章后会自动出现在书架上（无需修改游戏逻辑）', () => {
    const extra = parseContentFile(md('title: 新文章\ncategory: ai\nstatus: published\ndate: 2030-01-01'), 'new-one.md', 'article');
    const shelf = filterContent([...content.published, extra], { category: 'ai' });
    expect(shelf.map((i) => i.id)).toContain('new-one');
  });

  it('按标签筛选', () => {
    expect(filterContent(content.published, { tag: '阅读' }).map((i) => i.id)).toEqual(['ai-reading-list']);
  });

  it('生成的静态文件包含每篇已发布内容的独立页面，不包含草稿', () => {
    const files = buildSiteFiles(content.published, { siteTitle: '测试', basePath: '/my-RPGworld/' });
    expect(files.has('articles/ai-agent-notes/index.html')).toBe(true);
    expect(files.has('pages/about/index.html')).toBe(true);
    expect(files.has('articles/ai-draft-idea/index.html')).toBe(false);
    expect(files.has('library/index.html')).toBe(true);
    expect(files.get('404.html')).toContain('<base href="/my-RPGworld/">');
    expect(files.get('articles/ai-agent-notes/index.html')).toContain('<base href="../../">');
    const index = ContentIndexSchema.parse(JSON.parse(files.get('data/content-index.json')!));
    expect(index.items.map((i) => i.id)).not.toContain('ai-draft-idea');
  });

  it('标题中的 HTML 会被转义', () => {
    const item = parseContentFile(md('title: "<script>x</script>"\ncategory: ai\nstatus: published'), 'xss.md', 'article');
    const html = buildSiteFiles([item], { siteTitle: 't', basePath: '/' }).get('articles/xss/index.html')!;
    expect(html).not.toContain('<script>x');
  });
});
