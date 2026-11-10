# 内容维护指南

## 新增一篇文章

在 `content/articles/` 下新建 `my-article.md`（文件名即 ID，只用小写字母、数字、`-`）：

```markdown
---
title: 文章标题
category: ai          # 分类：AI 书架会自动列出 category 为 ai 的文章
tags: [标签1, 标签2]
status: published     # draft 草稿不会出现在任何地方
date: 2026-11-09
summary: 一句话简介（显示在列表里）
---

正文，支持标准 Markdown。站内链接写成 /library/ 这种形式即可。
```

构建后它会自动出现在对应书架、内容库，并获得独立网址 `articles/my-article/`。

## 新增一个 NPC

在 `world/entities/<场景>.json` 中加一项，并在 `world/dialogues/` 中新建对话：

```json
{
  "id": "gardener",
  "name": "园丁",
  "scene": "town",
  "x": 8, "y": 15,
  "sprite": "villager",
  "facing": "down",
  "action": { "type": "dialogue", "dialogue": "gardener" }
}
```

## 新增一个书架 / 告示牌 / 电视

实体可以没有 `sprite`（外观由地图图块表现），`width`/`height` 指定占几格：

```json
{ "id": "project-shelf", "name": "项目书架", "scene": "library", "x": 9, "y": 1, "width": 4,
  "action": { "type": "openCollection", "title": "项目", "category": "project" } }
```

## 新增一个场景

1. 用 Tiled 新建地图（图块 16×16，嵌入图块集 `placeholder`），图层：`ground`、`decor`、
   `collision`（任意非空格子 = 不可走；名字以 `above` 开头的图层会画在角色上方），保存到 `world/maps/<id>.json`
2. 新建 `world/scenes/<id>.json`，写出生点
3. 在两个场景各放一个 `"trigger": "step"` 的门实体，`changeScene` 互相指向

修改后运行 `npm run validate`，所有引用问题都会列出。
