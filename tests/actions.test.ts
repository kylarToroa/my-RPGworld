import { describe, expect, it, vi } from 'vitest';
import { createActionRunner, type ActionHost, type SayRequest, type SayResult } from '../src/game/actions';
import type { Dialogue } from '../src/data/schemas';

function host(answers: SayResult[], dialogues: Dialogue[] = []) {
  const said: SayRequest[] = [];
  const h: ActionHost = {
    say: vi.fn(async (r: SayRequest) => {
      said.push(r);
      return answers.shift() ?? 'closed';
    }),
    endDialogue: vi.fn(),
    openContent: vi.fn(async () => {}),
    openCollection: vi.fn(async () => {}),
    openURL: vi.fn(),
    changeScene: vi.fn(async () => {}),
    getDialogue: (id) => dialogues.find((d) => d.id === id),
    notify: vi.fn(),
  };
  return { h, said };
}

const librarian: Dialogue = {
  id: 'lib',
  start: 'a',
  nodes: {
    a: {
      speaker: '馆员',
      text: ['你好', '想看什么？'],
      choices: [
        { label: '研究笔记', action: { type: 'openCollection', title: 'AI', category: 'ai' } },
        { label: '再聊聊', next: 'b' },
        { label: '再见' },
      ],
    },
    b: { text: '好的', next: 'c' },
    c: { text: '结束' },
  },
};

describe('对话', () => {
  it('选择带行为的选项：关闭对话后打开内容列表', async () => {
    const { h, said } = host(['next', 0], [librarian]);
    await createActionRunner(h).run({ type: 'dialogue', dialogue: 'lib' });
    expect(said.map((s) => s.text)).toEqual(['你好', '想看什么？']);
    expect(said[0]!.choices).toBeUndefined();
    expect(said[1]!.choices).toEqual(['研究笔记', '再聊聊', '再见']);
    expect(h.endDialogue).toHaveBeenCalled();
    expect(h.openCollection).toHaveBeenCalledWith('AI', { category: 'ai', tag: undefined });
  });

  it('选项分支跳转并沿 next 继续', async () => {
    const { h, said } = host(['next', 1, 'next', 'next'], [librarian]);
    await createActionRunner(h).run({ type: 'dialogue', dialogue: 'lib' });
    expect(said.map((s) => s.text)).toEqual(['你好', '想看什么？', '好的', '结束']);
    expect(h.openCollection).not.toHaveBeenCalled();
  });

  it('中途按 Esc 关闭对话', async () => {
    const { h, said } = host(['closed'], [librarian]);
    await createActionRunner(h).run({ type: 'dialogue', dialogue: 'lib' });
    expect(said).toHaveLength(1);
    expect(h.endDialogue).toHaveBeenCalled();
  });
});

describe('行为', () => {
  it('sequence 依次执行', async () => {
    const { h } = host([]);
    const order: string[] = [];
    h.changeScene = vi.fn(async () => void order.push('scene'));
    h.openContent = vi.fn(async () => void order.push('content'));
    await createActionRunner(h).run({
      type: 'sequence',
      actions: [
        { type: 'changeScene', scene: 'a', spawn: 'b' },
        { type: 'openContent', content: 'c' },
      ],
    });
    expect(order).toEqual(['scene', 'content']);
  });

  it('openMenu 执行所选选项', async () => {
    const { h } = host([1]);
    await createActionRunner(h).run({
      type: 'openMenu',
      title: '菜单',
      options: [
        { label: 'A', action: { type: 'openContent', content: 'a' } },
        { label: 'B', action: { type: 'openURL', url: 'https://example.com' } },
      ],
    });
    expect(h.openURL).toHaveBeenCalledWith('https://example.com');
    expect(h.openContent).not.toHaveBeenCalled();
  });

  it('执行期间 busy 为 true，结束后恢复', async () => {
    const { h } = host([]);
    let resolve!: () => void;
    h.openContent = () => new Promise<void>((r) => (resolve = r));
    const runner = createActionRunner(h);
    const p = runner.run({ type: 'openContent', content: 'x' });
    expect(runner.busy).toBe(true);
    resolve();
    await p;
    expect(runner.busy).toBe(false);
  });

  it('处理器出错时提示而不是崩溃', async () => {
    const { h } = host([]);
    h.openContent = async () => { throw new Error('boom'); };
    const runner = createActionRunner(h);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runner.run({ type: 'openContent', content: 'x' });
    expect(h.notify).toHaveBeenCalled();
    expect(runner.busy).toBe(false);
  });
});
