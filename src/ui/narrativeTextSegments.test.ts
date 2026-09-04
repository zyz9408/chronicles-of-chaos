import { describe, expect, it } from 'vitest';
import { parseNarrativeTextSegments } from './narrativeTextSegments';

describe('parseNarrativeTextSegments', () => {
  it('turns speaker-prefixed narrative into narration and dialogue segments', () => {
    const segments = parseNarrativeTextSegments([
      '旁白: 夜风穿过长秋宫外的廊道。',
      '',
      '萧行: 「上东门方向的喊杀声是怎么回事？」',
      '典韦: 「回主公，正是袁绍在突围。」',
    ].join('\n'));

    expect(segments).toEqual([
      { type: 'narration', text: '夜风穿过长秋宫外的廊道。' },
      { type: 'dialogue', speaker: '萧行', text: '「上东门方向的喊杀声是怎么回事？」', speakerSource: 'explicit' },
      { type: 'dialogue', speaker: '典韦', text: '「回主公，正是袁绍在突围。」', speakerSource: 'explicit' },
    ]);
  });

  it('keeps plain prose as narration paragraphs without inventing speakers', () => {
    const segments = parseNarrativeTextSegments([
      '寒风穿过宫门，火光映红了远处的城墙。',
      '',
      '「也许该去看看。」这念头只在心里一闪。',
    ].join('\n'));

    expect(segments).toEqual([
      { type: 'narration', text: '寒风穿过宫门，火光映红了远处的城墙。' },
      { type: 'narration', text: '「也许该去看看。」这念头只在心里一闪。' },
    ]);
  });

  it('parses bracket speaker labels from prompt-guided narrative text', () => {
    const segments = parseNarrativeTextSegments([
      '【旁白】光和七年正月四日，巳时末刻。',
      '【屯骑营军侯】“禀校尉大人！请大人训示！”',
    ].join('\n'));

    expect(segments).toEqual([
      { type: 'narration', text: '光和七年正月四日，巳时末刻。' },
      { type: 'dialogue', speaker: '屯骑营军侯', text: '“禀校尉大人！请大人训示！”', speakerSource: 'explicit' },
    ]);
  });

  it('extracts leading quoted dialogue when the speaker is clear after the quote', () => {
    const segments = parseNarrativeTextSegments('“慌什么？” 你眉头微皱，宗室子弟的威仪在这一刻不怒自威。');

    expect(segments).toEqual([
      { type: 'dialogue', speaker: '你', text: '「慌什么？」', speakerSource: 'inferred' },
      { type: 'narration', text: '你眉头微皱，宗室子弟的威仪在这一刻不怒自威。' },
    ]);
  });

  it('extracts quoted dialogue after prose speech attribution', () => {
    const segments = parseNarrativeTextSegments('李丰匆匆从营门处跑来，压低声音道：“司马，朝臣们开始入宫了。”');

    expect(segments).toEqual([
      { type: 'narration', text: '李丰匆匆从营门处跑来，压低声音道：' },
      { type: 'dialogue', speaker: '李丰', text: '「司马，朝臣们开始入宫了。」', speakerSource: 'inferred' },
    ]);
  });

  it('merges consecutive narration lines into one paragraph', () => {
    const segments = parseNarrativeTextSegments('夜色沉下。\n火光很远。\n\n刘构: 「传令。」');

    expect(segments).toEqual([
      { type: 'narration', text: '夜色沉下。\n火光很远。' },
      { type: 'dialogue', speaker: '刘构', text: '「传令。」', speakerSource: 'explicit' },
    ]);
  });

  it('keeps clock times in prose as narration instead of treating them as speakers', () => {
    const lines = [
      '巳时将尽（11:00），阳光终于穿透了薄云。',
      '将近午时（11：30），战马的嘶鸣打破了汉水大营的宁静。',
      '巳时末（10:45），青梅酒肆的木楼梯发出低响。',
    ];

    lines.forEach((line) => {
      expect(parseNarrativeTextSegments(line)).toEqual([
        { type: 'narration', text: line },
      ]);
    });
  });

  it('still parses real speaker lines after excluding clock separators', () => {
    expect(parseNarrativeTextSegments('张虎：军令已下。')).toEqual([
      { type: 'dialogue', speaker: '张虎', text: '军令已下。', speakerSource: 'explicit' },
    ]);
  });
});
