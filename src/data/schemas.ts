// 所有配置的运行时 Schema。world/ 与 content/ 下的数据都必须通过这里的校验。
import { z } from 'zod';

export const FacingSchema = z.enum(['up', 'down', 'left', 'right']);
export type Facing = z.infer<typeof FacingSchema>;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-_]*$/, 'ID 只能包含小写字母、数字、- 和 _');

// ---------- 交互行为 Action ----------
// 只允许这里列出的行为类型；新增类型需要在 src/game/actions.ts 中注册处理器。
export type Action =
  | { type: 'dialogue'; dialogue: string }
  | { type: 'openContent'; content: string }
  | { type: 'openCollection'; title: string; category?: string | undefined; tag?: string | undefined }
  | { type: 'changeScene'; scene: string; spawn: string }
  | { type: 'openURL'; url: string }
  | { type: 'openMenu'; title: string; options: { label: string; action: Action }[] }
  | { type: 'sequence'; actions: Action[] };

export const ActionSchema: z.ZodType<Action> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('dialogue'), dialogue: Id }),
    z.object({ type: z.literal('openContent'), content: Id }),
    z.object({
      type: z.literal('openCollection'),
      title: z.string().min(1),
      category: z.string().optional(),
      tag: z.string().optional(),
    }),
    z.object({ type: z.literal('changeScene'), scene: Id, spawn: Id }),
    z.object({ type: z.literal('openURL'), url: z.url({ protocol: /^https?$/ }) }),
    z.object({
      type: z.literal('openMenu'),
      title: z.string().min(1),
      options: z.array(z.object({ label: z.string().min(1), action: ActionSchema })).min(1),
    }),
    z.object({ type: z.literal('sequence'), actions: z.array(ActionSchema).min(1) }),
  ]),
);

export const ACTION_TYPES = ['dialogue', 'openContent', 'openCollection', 'changeScene', 'openURL', 'openMenu', 'sequence'] as const;

// ---------- 世界 ----------
export const WorldConfigSchema = z.object({
  title: z.string(),
  startScene: Id,
  startSpawn: Id,
});
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

export const SpawnSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  facing: FacingSchema.default('down'),
});
export type Spawn = z.infer<typeof SpawnSchema>;

export const SceneSchema = z.object({
  id: Id,
  name: z.string(),
  /** world/maps/ 下的 Tiled 地图文件名（不含 .json） */
  map: Id,
  defaultSpawn: Id,
  spawns: z.record(Id, SpawnSchema),
});
export type SceneConfig = z.infer<typeof SceneSchema>;

// ---------- 实体（NPC、门、书架、告示牌……） ----------
export const EntitySchema = z.object({
  id: Id,
  name: z.string(),
  scene: Id,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  /** 占用的格子数（例如 4 格宽的书架） */
  width: z.number().int().positive().default(1),
  height: z.number().int().positive().default(1),
  /** world/assets.json 中的精灵 key；不填则不绘制（由地图图块表现外观） */
  sprite: z.string().optional(),
  facing: FacingSchema.default('down'),
  /** 是否阻挡行走 */
  solid: z.boolean().default(true),
  /** interact：靠近后按键/点击触发；step：踩上去触发（门、传送点） */
  trigger: z.enum(['interact', 'step']).default('interact'),
  /** 交互距离（格），仅对 interact 生效 */
  range: z.number().int().min(1).max(3).default(1),
  action: ActionSchema,
});
export type Entity = z.infer<typeof EntitySchema>;
export const EntityFileSchema = z.array(EntitySchema);

// ---------- 对话 ----------
export const DialogueChoiceSchema = z.object({
  label: z.string().min(1),
  /** 跳到哪个对话节点；不填且无 action 时结束对话 */
  next: Id.optional(),
  /** 选择后关闭对话并执行该行为 */
  action: ActionSchema.optional(),
});
export const DialogueNodeSchema = z.object({
  speaker: z.string().optional(),
  text: z.union([z.string(), z.array(z.string()).min(1)]),
  next: Id.optional(),
  choices: z.array(DialogueChoiceSchema).optional(),
});
export const DialogueSchema = z.object({
  id: Id,
  start: Id,
  nodes: z.record(Id, DialogueNodeSchema),
});
export type Dialogue = z.infer<typeof DialogueSchema>;
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

// ---------- 美术资源清单 ----------
export const AssetManifestSchema = z.object({
  tilesets: z.record(z.string(), z.string()),
  sprites: z.record(
    z.string(),
    z.object({ url: z.string(), frameWidth: z.number().int().positive(), frameHeight: z.number().int().positive() }),
  ),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

// ---------- 内容 ----------
export const ContentFrontmatterSchema = z.object({
  id: Id.optional(),
  title: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  date: z.coerce.date().optional(),
  summary: z.string().optional(),
});

export const ContentKindSchema = z.enum(['article', 'page']);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const ContentMetaSchema = z.object({
  id: Id,
  kind: ContentKindSchema,
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  status: z.enum(['draft', 'published']),
  date: z.string().optional(),
  summary: z.string().optional(),
  /** 相对站点根目录的独立页面地址，例如 articles/hello/ */
  url: z.string(),
});
export type ContentMeta = z.infer<typeof ContentMetaSchema>;
export const ContentIndexSchema = z.object({ items: z.array(ContentMetaSchema) });
export type ContentIndex = z.infer<typeof ContentIndexSchema>;
export const ContentItemSchema = ContentMetaSchema.extend({ html: z.string() });
export type ContentItem = z.infer<typeof ContentItemSchema>;

// ---------- 本地存档 ----------
// v2：网格从 16px 改为 48px，坐标含义变了。
// v1 存档由 save.ts 的 MIGRATIONS 升级：保留场景与朝向，位置重置到该场景出生点。
export const SAVE_VERSION = 2;
export const SaveSchema = z.object({
  version: z.number().int(),
  scene: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  facing: FacingSchema,
});
export type SaveData = z.infer<typeof SaveSchema>;
