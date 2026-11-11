# my-RPGworld

以经典俯视角像素 RPG 形式呈现的个人网站。访客可以在小镇里走动、和 NPC 对话、在书架上读文章；
不想玩游戏也可以直接打开「内容库」，每篇文章都有独立网址。

## 快速开始

需要 Node.js 22+。

```bash
npm install
npm run sync:assets # 从本地素材库同步美术（首次需先配置路径，见下文）
npm run dev        # 本地开发：打开终端里显示的网址
npm run build      # 校验配置 + 类型检查 + 构建到 dist/
npm run preview    # 预览构建结果
npm test           # 单元测试（寻路、内容索引、配置校验、存档、对话）
npm run test:e2e   # 浏览器端到端测试（需先 build，需要本机 Chromium/Chrome）
npm run validate   # 只校验 world/ 与 content/
```

> 美术素材不随仓库分发（授权禁止向非正版用户再分发素材本体）。
> 新克隆的仓库必须先跑 `npm run sync:assets`，否则 `build` 会在校验阶段停下来并提示怎么做。

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
（`.github/workflows/deploy-pages.yml`），push 到 `main` 或手动触发都会运行。

**当前状态：CI 与 Pages 部署都还跑不通。** 原因是素材不入库，
`npm run build` 的第一步 `validate` 会因缺图失败。

已定方案：**仓库转私有**，然后把 13 张 PNG 纳入版本管理。执行完这一步，CI 才有可能通过
（注意私有仓库的 GitHub Pages 需要相应套餐，否则只能本地构建后另找托管）。
操作顺序见 `public/assets/来源与授权.md` 第三节。

## 美术与版权

当前美术**全部是 RPG Maker MZ 官方素材**（48×48 图块 + 48×48 行走图），项目里没有第三方素材。

官方的 GGG Products Material Terms（2026-06-22 版）Article 1 允许正版购买者把素材
用于「RPG Maker 之外的程序与其他公司游戏工具创作的作品」，**跨引擎使用是允许的**；
但同时禁止向**非正版用户分发素材本体**。

所以 `public/assets/tilesets/*.png` 与 `public/assets/sprites/*.png` 被 `.gitignore` 排除：
公开仓库等于给所有人提供原文件下载。换机器时按下面方式恢复：

```bash
cp asset-library.example.json asset-library.local.json   # 填上素材库路径
npm run sync:assets
```

只复制 `assets.manifest.json` 里登记的文件，素材库原文件只读，缺文件会明确报错。

**署名与版权声明**写在游戏内的一本书里，不放在页脚：
`content/articles/credits.md`《制作说明：这个网站用了什么》。
游戏内从图书馆右侧「制作说明书架」打开，也可直接访问 `articles/credits/`。
内容包括 AI 与工具清单、素材逐个用途对照、完整版权与商标声明。

完整授权分析与逐文件来源见 `public/assets/来源与授权.md`。

> 仓库转私有后，可以把这 13 张 PNG 纳入版本管理（先转私有、再提交，顺序不能反）。
> 截至当前，仓库仍是公开状态，所以还没有提交素材。
