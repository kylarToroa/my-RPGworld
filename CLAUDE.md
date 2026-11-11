# 项目约定（给 AI 开发者）

- 与站长（项目负责人）始终用简体中文交流；站长不写代码，所有技术工作由 AI 完成。
- 数据驱动：新增 NPC / 门 / 文章 / 场景优先只改 `world/` 和 `content/`，不改游戏代码。
  只有全新的行为类型才改 `src/`。详见 `docs/architecture.md`、`docs/content-guide.md`。
- 配置不允许执行任意代码；行为类型必须在 `src/data/schemas.ts` 与 `src/game/actions.ts` 注册。
- 重要内容不能只存在于 Canvas 里：内容都通过 HTML 展示，并有独立页面。
- 美术与逻辑分离：资源路径只写在 `world/assets.json`。
- **网格固定 48×48**（M2 起）。地图 `tilewidth/tileheight` 不是 48 会直接加载失败；
  图块与行走图都用 48px 规格（行走图是 144×192 的 3 列 × 4 行）。
- **美术授权**：当前素材来自 RPG Maker（仅限引擎内 + 非商业私人使用，禁止再分发）。
  `public/assets/tilesets|sprites/*.png` 已被 .gitignore 排除，**不要提交进仓库**。
  对外公开发布前必须换成明确允许网页使用的素材。
- 大件物体（整棵树、整栋屋）用**精灵实体**，不要用图块拼：实体按脚底 Y 排序才能正确遮挡。
- 不做战斗、升级、装备、账号、后端。

## 开发流程

1. 在开发分支工作，`main` 保持稳定；通过 Pull Request 交付。
2. 提交前必须实际运行并通过：`npm run build`、`npm test`、`npm run test:e2e`。
   未运行的测试不得写成通过；无法测试的部分要明确说明需人工试玩。
3. 修改地图/配置后运行 `npm run validate`。
4. 未经站长确认：不合并 main、不正式部署、不引入付费服务、不删除重要数据。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run build` | 校验 + 类型检查 + 构建 |
| `npm test` | 单元测试（vitest） |
| `npm run test:e2e` | 浏览器测试（需先 build；`CHROME_PATH` 指定浏览器） |
| `npm run gen:m2maps` | 生成 48px 正式地图（`scripts/build-m2-maps.mjs`） |
| `npm run gen:art` / `gen:maps` | ⚠️ 旧占位素材/16px 地图，会覆盖正式美术，需显式 `-- --force` |

## 代码风格

TypeScript 严格模式；注释用中文、简短；与周边代码保持一致。
