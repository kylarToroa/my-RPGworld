/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSiteFiles, loadContent } from './src/data/content-build';

const root = process.cwd();
// 部署子路径，例如 GitHub Pages 的 /my-RPGworld/。资源本身全部使用相对路径，只有 404 页面需要它。
const basePath = process.env.BASE_PATH ?? '/';

function siteTitle(): string {
  return JSON.parse(readFileSync(join(root, 'world/world.json'), 'utf8')).title;
}

function generate(): Map<string, string> {
  const content = loadContent(join(root, 'content'));
  if (content.problems.length) throw new Error(`内容有问题：\n- ${content.problems.join('\n- ')}`);
  return buildSiteFiles(content.published, { siteTitle: siteTitle(), basePath });
}

/** 把 content/ 下的 Markdown 变成静态页面与 JSON：开发时由中间件提供，构建时输出为真实文件 */
function contentPlugin(): Plugin {
  let files = new Map<string, string>();
  return {
    name: 'rpgworld-content',
    buildStart() {
      files = generate();
      this.addWatchFile(join(root, 'content'));
    },
    configureServer(server: ViteDevServer) {
      files = generate();
      server.watcher.add(join(root, 'content'));
      server.watcher.on('all', (_event, file) => {
        if (file.startsWith(join(root, 'content'))) {
          try {
            files = generate();
            server.ws.send({ type: 'full-reload' });
          } catch (err) {
            server.config.logger.error(String(err));
          }
        }
      });
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\//, '');
        const hit = files.get(path) ?? files.get(path.endsWith('/') ? `${path}index.html` : `${path}/index.html`);
        if (hit === undefined) return next();
        if (path && !path.endsWith('/') && !path.includes('.')) {
          res.statusCode = 301;
          res.setHeader('Location', `/${path}/`);
          return res.end();
        }
        res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
        res.end(hit);
      });
    },
    generateBundle() {
      for (const [fileName, source] of files) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig({
  // 相对路径：无论部署在根目录还是子路径（GitHub Pages）都能正常加载
  base: './',
  plugins: [contentPlugin()],
  build: {
    // 地图 JSON 始终输出为独立文件（按需加载，也方便排查）
    assetsInlineLimit: (file) => (file.endsWith('.json') ? false : undefined),
    chunkSizeWarningLimit: 1600, // Phaser 本身约 1.2MB，单独分包
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
