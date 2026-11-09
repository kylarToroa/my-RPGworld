# my-RPGworld

以经典俯视角像素 RPG 形式呈现的个人网站。访客可以在小镇里走动、和 NPC 对话、在书架上读文章；
不想玩游戏也可以直接打开「内容库」，每篇文章都有独立网址。

## 快速开始

需要 Node.js 22+。

```bash
npm install
npm run dev        # 本地开发：打开终端里显示的网址
npm run build      # 校验配置 + 类型检查 + 构建到 dist/
npm run preview    # 预览构建结果
npm test           # 单元测试（寻路、内容索引、配置校验、存档、对话）
npm run test:e2e   # 浏览器端到端测试（需先 build，需要本机 Chromium/Chrome）
npm run validate   # 只校验 world/ 与 content/
```

## 操作方式

| | 电脑 | 手机 |
|---|---|---|
| 移动 | 方向键 / WASD，或点击地面 | 点地面 |
| 互动 | 面向目标按 E / 空格，或直接点击目标 | 点人物或物品（会自动走过去） |
| 关闭窗口 | Esc | 点 × |

## 目录

```
world/            世界配置（数据驱动）
  world.json        起始场景、网站标题
  assets.json       美术资源清单（换皮只改这里和 public/assets）
  scenes/           场景：地图、出生点
  entities/         NPC、门、书架等实体及其交互行为
  dialogues/        对话
  maps/             Tiled 地图（可用 Tiled 编辑器打开）
content/
  articles/         文章（Markdown + frontmatter）
  pages/            独立页面（如「关于」）
public/assets/    占位美术（程序生成，可整体替换）
src/game/         游戏核心：场景、移动、寻路、交互行为、存档
src/web/          HTML 界面：对话框、内容窗口
src/data/         Schema、配置解析与校验、内容构建
scripts/          校验脚本、占位美术与地图生成脚本
tests/            单元测试与浏览器测试
docs/             架构与维护文档
```

更多说明见 [docs/architecture.md](docs/architecture.md) 与 [docs/content-guide.md](docs/content-guide.md)。

## 部署

构建产物是纯静态文件，可部署到任意静态托管。仓库带有 GitHub Pages 工作流
（`.github/workflows/deploy-pages.yml`），**只在手动触发时运行**。

## 美术与版权

当前全部美术为程序绘制的原创占位图（`scripts/generate-placeholder-art.mjs`），
不使用任何商业游戏素材。
