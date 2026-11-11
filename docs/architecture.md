# 架构说明

## 五个概念，互相解耦

| 概念 | 位置 | 说明 |
|---|---|---|
| Scene 场景 | `world/scenes/*.json` + `world/maps/*.json` | 一张地图 + 出生点 |
| Entity 实体 | `world/entities/*.json` | NPC、门、书架、告示牌……都是实体 |
| Action 行为 | 写在实体 / 对话选项里 | 只能是已注册的类型 |
| Content 内容 | `content/**/*.md` | 与地图无关，可被多个实体引用 |
| Asset 美术 | `world/assets.json` + `public/assets/` | 换皮只改这里 |

## 行为类型（`src/game/actions.ts`）

- `dialogue` 打开对话 `{ "dialogue": "对话ID" }`
- `openContent` 打开一篇内容 `{ "content": "内容ID" }`
- `openCollection` 打开内容列表 `{ "title": "...", "category": "ai", "tag": "可选" }`（动态书架）
- `changeScene` 切换场景 `{ "scene": "场景ID", "spawn": "出生点ID" }`
- `openURL` 新标签页打开外部链接（仅 http/https）
- `openMenu` 选项菜单 `{ "title": "...", "options": [{ "label": "...", "action": {...} }] }`
- `sequence` 依次执行 `{ "actions": [...] }`

配置不能执行任意代码；新增一种行为需要在 `src/data/schemas.ts` 的 `ActionSchema` 和
`src/game/actions.ts` 中各加一处。

## 移动与寻路

- 格子移动（48×48 像素一格，与 RPG Maker 规格一致），经典日式 RPG 手感，碰撞、寻路、存档都以格子为单位，最稳定。
- 碰撞来自 Tiled 地图的 `collision` 图层（任意非空格子不可走）+ `solid` 实体。
- 点击寻路用 A*（`src/game/pathfinding.ts`）。自动寻路会绕开门/传送点，避免路过时误触发。
- 点击 NPC/物品：计算其旁边可到达的站位 → 走过去 → 面向目标 → 触发。
- 任何键盘操作都会打断自动寻路；点击新目标会取消旧路径。

## 地图与图块

- 一格 48×48 像素；地图是标准 Tiled JSON，`tilewidth/tileheight` 必须等于 48（`src/game/grid.ts` 会校验，不符合直接拒绝加载）。
- 图层固定为 `ground / decor / decor2 / above / collision`。除 `collision` 外都会被渲染；
  名字以 `above` 开头的图层固定画在角色上方。
- 地图由 `scripts/build-m2-maps.mjs` 从 ASCII 草图生成（`npm run gen:m2maps`），生成后可直接用 Tiled 手工修改。
  多格物件（大床、以后的树屋）用脚本里的 `stamps` 贴片声明。
- 大件物体（整棵树、整栋房子）优先做成**精灵实体**而不是图块：实体会按脚底 Y 自动排序，
  玩家走到它后面就会被挡住；图块做不到这一点。

## 内容双模式

构建时（`src/data/content-build.ts`，由 `vite.config.ts` 中的插件调用），每篇已发布的 Markdown 生成：

1. `data/content/<id>.json`：游戏内弹窗读取
2. `articles/<id>/index.html`（页面为 `pages/<id>/`）：可直接访问、可分享的静态页面
3. `library/index.html`：内容库；`data/content-index.json`：书架用的索引

所有链接使用相对路径（独立页面用 `<base>` 指向站点根目录），因此部署在子路径也能正常工作。

## 存档

`localStorage` 键 `rpgworld:save`，带版本号。读取时：
损坏/版本不认识 → 忽略；场景不存在 → 起始场景；位置不可站立 → 场景默认出生点 → 最近空地。
localStorage 不可用时退回内存存储。

## 校验

`npm run validate`（`build` 会先运行）检查：Schema、ID 重复、场景/出生点/对话/内容/精灵引用、
出生点是否可站立、实体是否超出地图、资源文件是否存在。
