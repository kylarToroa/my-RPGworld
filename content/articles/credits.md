---
title: 制作说明：这个网站用了什么
category: meta
tags: [制作说明, 版权, 工具]
status: published
date: 2026-11-11
summary: 这个像素世界的 AI、工具与美术素材分别来自哪里，以及各自的使用许可。
---

这本书不写故事，写的是「它是怎么被做出来的」。
如果以后有人想知道画面里的树、房子、人物从哪来，答案都在这一页。

## 代码与 AI

- **AI 编程助手**：WorkBuddy。它负责大部分代码、地图生成脚本、素材整理与自动化测试，
  也负责把自然语言需求翻译成工程改动。
- **需求与验收**：由站长本人用自然语言提出，并靠实际试玩与截图逐版验收。
- AI 只参与「写代码、查资料、做检查」，不参与绘制像素画。

## 工具链

| 用途 | 工具 |
|---|---|
| 游戏引擎 | Phaser 3（WebGL / Canvas） |
| 语言与构建 | TypeScript、Vite、Node.js |
| 地图数据 | Tiled（标准 JSON 格式，格子 48×48） |
| 单元测试 | Vitest |
| 浏览器测试 | Playwright（驱动本机 Chrome） |
| 内容 | Markdown + frontmatter，构建时生成 JSON 与独立页面 |

## 美术素材与出处

当前所有图块、角色行走图与物件，均来自 **RPG Maker MZ 官方素材**
（Gotcha Gotcha Games 出品，站长本人通过官方渠道购买的正版产品）。

- 版权声明：©Gotcha Gotcha Games Inc./YOJI OJIMA 2020
- RPG MAKER 是 Gotcha Gotcha Games Inc. 的注册商标。
- 本作品使用 RPG Maker MZ 素材制作，但**不是**由 Gotcha Gotcha Games 开发或发行，
  与官方无隶属关系。
- 素材的使用范围遵循 GGG Products Material Terms（2026-06-22 版）：
  正版购买者可将其用于 RPG Maker 之外的程序，因此这里用 Phaser 呈现。

具体到每张图：

| 游戏内用途 | 原始文件 |
|---|---|
| 地面、草地、土路 | `Outside_A5` |
| 墙体、门窗、树石花草 | `Outside_A4`、`Outside_B` |
| 屋顶（木瓦） | `Outside_A3` |
| 室内地板、家具、书架、床 | `Inside_A4`、`Inside_A5`、`Inside_B` |
| 主角、村民、图书管理员 | `Actor1`、`People1` |

## 没有使用的东西

- 不使用任何商业游戏的成品美术（未从其他游戏里提取图片）。
- 不使用需要单独授权的第三方素材包。
- 早期版本曾试用过一张论坛作者（Avery）的木屋顶，因授权仅限 RPG Maker 引擎、
  且禁止再分发，已在 M2.1-C 替换为官方 `Outside_A3` 的木瓦屋顶，项目内不再保留该文件。

## 关于再分发

素材本体不随本站源码公开分发——这是授权条款的要求（不得向未购买者提供素材文件）。
所以你在这个网站里看到的是「游戏成品中的素材」，而不是可以拿走再用的素材包。
