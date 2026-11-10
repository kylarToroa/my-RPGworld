// 交互行为注册表。配置只能引用这里注册过的行为类型，不能执行任意代码。
// 新增一种行为：在 schemas.ts 的 ActionSchema 增加类型 → 在这里 register 处理器。
import type { Action, Dialogue } from '../data/schemas';
import type { ContentFilter } from '../data/content-query';

export type ActionType = Action['type'];
type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;
export type ActionHandler<T extends ActionType> = (action: ActionOf<T>, runner: ActionRunner) => Promise<void>;
type AnyHandler = (action: Action, runner: ActionRunner) => Promise<void>;

/** 对话框里的一句话。返回：选中的选项序号 / 'next' 继续 / 'closed' 被关闭 */
export interface SayRequest {
  speaker?: string | undefined;
  text: string;
  choices?: string[] | undefined;
}
export type SayResult = number | 'next' | 'closed';

/** 行为执行所需的外部能力（由界面层与场景层提供） */
export interface ActionHost {
  say(req: SayRequest): Promise<SayResult>;
  endDialogue(): void;
  openContent(id: string): Promise<void>;
  openCollection(title: string, filter: ContentFilter): Promise<void>;
  openURL(url: string): void;
  changeScene(scene: string, spawn: string): Promise<void>;
  getDialogue(id: string): Dialogue | undefined;
  notify(message: string): void;
}

export class ActionRunner {
  private readonly handlers = new Map<ActionType, AnyHandler>();
  private depth = 0;

  constructor(readonly host: ActionHost) {}

  register<T extends ActionType>(type: T, handler: ActionHandler<T>): this {
    this.handlers.set(type, handler as unknown as AnyHandler);
    return this;
  }

  /** 是否有行为正在执行（执行期间玩家不能移动） */
  get busy(): boolean {
    return this.depth > 0;
  }

  async run(action: Action): Promise<void> {
    const handler = this.handlers.get(action.type);
    if (!handler) {
      console.warn('未注册的行为类型', action);
      this.host.notify('这个互动暂时不可用');
      return;
    }
    this.depth++;
    try {
      await handler(action, this);
    } catch (err) {
      console.error('执行行为失败', action, err);
      this.host.notify('出了点问题，请稍后再试');
    } finally {
      this.depth--;
    }
  }
}

export async function runDialogue(dialogue: Dialogue, runner: ActionRunner): Promise<void> {
  const { host } = runner;
  let nodeId: string | undefined = dialogue.start;
  let pending: Action | undefined;
  while (nodeId) {
    const node: Dialogue['nodes'][string] | undefined = dialogue.nodes[nodeId];
    if (!node) break;
    const lines = Array.isArray(node.text) ? node.text : [node.text];
    let result: SayResult = 'next';
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      result = await host.say({ speaker: node.speaker, text: lines[i]!, choices: last ? node.choices?.map((c) => c.label) : undefined });
      if (result === 'closed') return host.endDialogue();
    }
    if (node.choices?.length && typeof result === 'number') {
      const choice: NonNullable<typeof node.choices>[number] | undefined = node.choices[result];
      if (choice?.action) {
        pending = choice.action;
        break;
      }
      nodeId = choice?.next;
    } else {
      nodeId = node.next;
    }
  }
  host.endDialogue();
  if (pending) await runner.run(pending);
}

export function createActionRunner(host: ActionHost): ActionRunner {
  return new ActionRunner(host)
    .register('dialogue', async (a, r) => {
      const d = host.getDialogue(a.dialogue);
      if (!d) return host.notify('对话丢失了');
      await runDialogue(d, r);
    })
    .register('openContent', (a) => host.openContent(a.content))
    .register('openCollection', (a) => host.openCollection(a.title, { category: a.category, tag: a.tag }))
    .register('changeScene', (a) => host.changeScene(a.scene, a.spawn))
    .register('openURL', async (a) => host.openURL(a.url))
    .register('openMenu', async (a, r) => {
      const result = await host.say({ text: a.title, choices: a.options.map((o) => o.label) });
      host.endDialogue();
      const option = typeof result === 'number' ? a.options[result] : undefined;
      if (option) await r.run(option.action);
    })
    .register('sequence', async (a, r) => {
      for (const step of a.actions) await r.run(step);
    });
}
