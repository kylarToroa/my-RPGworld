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
npm run sync:assets # 可选：从本地素材库重新生成美术（素材已在仓库里，一般用不到）
```

> 美术素材已随仓库提交，clone 后直接 `npm install && npm run build` 即可。

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
public/assets/    第三方美术（本地同步，不入库；见 sync:assets）
src/game/         游戏核心：场景、移动、寻路、交互行为、存档
src/web/          HTML 界面：对话框、内容窗口
src/data/         Schema、配置解析与校验、内容构建
scripts/          校验脚本、素材同步、地图生成脚本
tests/            单元测试与浏览器测试
docs/             架构与维护文档
```

更多说明见 [docs/architecture.md](docs/architecture.md) 与 [docs/content-guide.md](docs/content-guide.md)。

## 部署

构建产物是纯静态文件，可部署到任意静态托管。仓库带有 GitHub Pages 工作流
（`.github/workflows/deploy-pages.yml`），push 到 `main` 会自动构建并部署。

素材已入库，所以 CI 与 Pages 都能直接跑通，无需额外的密钥或私有存储。

## 美术与版权

当前美术**全部是 RPG Maker MZ 官方素材**（48×48 图块 + 48×48 行走图），项目里没有第三方素材。

官方的 GGG Products Material Terms（2026-06-22 版）Article 1 允许正版购买者把素材
用于「RPG Maker 之外的程序与其他公司游戏工具创作的作品」，**跨引擎使用是允许的**；
但同时禁止向**非正版用户分发素材本体**。

本站是个人非商业展示页，为了能直接部署，素材已纳入仓库（`.gitignore` 不再排除）。
这属于授权瑕疵，取舍与后续处理路径记录在 `public/assets/来源与授权.md` 第三节。

**署名与版权声明**写在游戏内的一本书里，不放在页脚：
`content/articles/credits.md`《制作说明：这个网站用了什么》。
游戏内从图书馆右侧「制作说明书架」打开，也可直接访问 `articles/credits/`。
内容包括 AI 与工具清单、素材逐个用途对照、完整版权与商标声明。

完整授权分析与逐文件来源见 `public/assets/来源与授权.md`。
