import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NarrativeTextView } from './NarrativeTextView';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

describe('NarrativeTextView', () => {
  it('renders narration blocks and dialogue bubbles from speaker-prefixed text', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView text={'旁白: 夜风压过宫墙。\n萧行: 「传令。」'} />,
    );

    expect(markup).toContain('narrative-segment-narration');
    expect(markup).toContain('narrative-dialogue-row');
    expect(markup).toContain('narrative-dialogue-avatar');
    expect(markup).toContain('萧行');
    expect(markup).toContain('「传令。」');
  });

  it('renders protagonist dialogue with the protagonist name', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView text={'【你】「传我的将令。」'} protagonistName="刘构" />,
    );

    expect(markup).toContain('narrative-dialogue-row-player');
    expect(markup).toContain('刘构');
    expect(markup).not.toContain('narrative-dialogue-speaker">你<');
  });

  it('keeps protagonist dialogue in the common left-side flow', async () => {
    const css = await readUiStyleSource();
    const playerRowRule = css.match(/\.narrative-dialogue-row-player\s*\{[^}]*\}/)?.[0] ?? '';
    const playerAvatarRule =
      css.match(/\.narrative-dialogue-row-player \.narrative-dialogue-avatar\s*\{[^}]*\}/)?.[0] ?? '';
    const playerContentRule =
      css.match(/\.narrative-dialogue-row-player \.narrative-dialogue-content\s*\{[^}]*\}/)?.[0] ?? '';
    const playerSpeakerRule =
      css.match(/\.narrative-dialogue-row-player \.narrative-dialogue-speaker\s*\{[^}]*\}/)?.[0] ?? '';

    expect(playerRowRule).toContain('justify-content: flex-start;');
    expect(playerRowRule).not.toContain('flex-end');
    expect(playerAvatarRule).not.toContain('order: 2');
    expect(playerContentRule).toContain('align-items: flex-start;');
    expect(playerContentRule).not.toContain('flex-end');
    expect(playerSpeakerRule).toContain('text-align: left;');
  });

  it('keeps dialogue bubble right edges aligned with narration blocks', async () => {
    const css = await readUiStyleSource();
    const contentRule = css.match(/\.narrative-dialogue-content\s*\{[^}]*\}/)?.[0] ?? '';
    const npcContentRule =
      css.match(/\.narrative-dialogue-row-npc \.narrative-dialogue-content\s*\{[^}]*\}/)?.[0] ?? '';
    const playerContentRule =
      css.match(/\.narrative-dialogue-row-player \.narrative-dialogue-content\s*\{[^}]*\}/)?.[0] ?? '';
    const bubbleRule = css.match(/\.narrative-dialogue-bubble\s*\{[^}]*\}/)?.[0] ?? '';

    expect(contentRule).toContain('width: calc(100% - 2.95rem);');
    expect(contentRule).toContain('max-width: none;');
    expect(npcContentRule).not.toContain('max-width: min(78%, 64rem)');
    expect(playerContentRule).not.toContain('max-width: min(78%, 64rem)');
    expect(bubbleRule).toContain('width: 100%;');
    expect(bubbleRule).toContain('box-sizing: border-box;');
  });

  it('keeps non-protagonist dialogue on the left', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView text={'【李丰】「诺，谨遵司马将令。」'} protagonistName="刘构" />,
    );

    expect(markup).toContain('narrative-dialogue-row-npc');
    expect(markup).toContain('李丰');
  });

  it('renders judgement cards at narrative markers instead of always after the whole narrative', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView
        text={'【旁白】刘峙递上名帖，管事的眼神微微一顿。\n[[判定:check_identity_probe]]\n【旁白】片刻之后，管事收起轻慢，转身去取登记竹简。'}
        judgementCards={[
          {
            cardId: 'ordinary:check_identity_probe',
            kind: 'ordinary',
            eyebrow: '判定',
            title: '坦露身份',
            result: '成功',
          },
        ]}
      />,
    );

    const beforeIndex = markup.indexOf('刘峙递上名帖');
    const cardIndex = markup.indexOf('turn-judgement-card');
    const afterIndex = markup.indexOf('片刻之后');

    expect(markup).not.toContain('[[判定:check_identity_probe]]');
    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThan(beforeIndex);
    expect(cardIndex).toBeLessThan(afterIndex);
  });

  it('hides judgement placeholders while judgement cards are not available yet', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView
        text={'【旁白】刘峙看透士卒愤怒底下的惶恐。\n[[判定:check_soothe_troops]]\n【刘峙】“都给我安静！”'}
      />,
    );

    expect(markup).toContain('刘峙看透士卒愤怒底下的惶恐');
    expect(markup).toContain('都给我安静');
    expect(markup).not.toContain('[[判定:check_soothe_troops]]');
    expect(markup).not.toContain('check_soothe_troops');
    expect(markup).not.toContain('turn-judgement-card');
  });

  it('strips stray inline judgement placeholders from narrative text', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView
        text={'【旁白】刘峙抬手止住喧哗，[[判定:check_soothe_troops]]士卒渐渐安静下来。'}
      />,
    );

    expect(markup).toContain('刘峙抬手止住喧哗');
    expect(markup).toContain('士卒渐渐安静下来');
    expect(markup).not.toContain('[[判定:check_soothe_troops]]');
    expect(markup).not.toContain('check_soothe_troops');
  });

  it('uses narrative clues to place unmarked judgement cards near their trigger instead of the end', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView
        text={[
          '【旁白】刘平在校场示意王冲取刀，军士退开半圈。',
          '【旁白】刘平踏前半步，木刀压住王冲肩线。',
          '【旁白】王冲收刀后抱拳，周围军士这才爆出喝彩。',
        ].join('\n')}
        judgementCards={[
          {
            cardId: 'combat:combat_yard_duel',
            kind: 'combat',
            eyebrow: '战斗判定',
            title: '校场演武切磋',
            result: '刘平取胜',
            summary: '刘平借校场切磋压住王冲，提振郡兵士气。',
          },
        ]}
      />,
    );

    const triggerIndex = markup.indexOf('刘平在校场示意王冲取刀');
    const cardIndex = markup.indexOf('校场演武切磋');
    const outcomeIndex = markup.indexOf('王冲收刀后抱拳');

    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThan(triggerIndex);
    expect(cardIndex).toBeLessThan(outcomeIndex);
  });

  it('relocates trailing judgement markers when earlier narrative already shows the trigger point', () => {
    const markup = renderToStaticMarkup(
      <NarrativeTextView
        text={[
          '【旁白】刘平先登上城楼，扶着女墙观察敌营灯火与军阵间距。',
          '【旁白】王冲在旁边追问，刘平指出敌营左翼防备薄弱。',
          '[[判定:observe_enemy_camp]]',
        ].join('\n')}
        judgementCards={[
          {
            cardId: 'ordinary:observe_enemy_camp',
            kind: 'ordinary',
            eyebrow: '判定',
            title: '洞察军阵',
            result: '成功',
            summary: '刘平看出敌军阵面虚实。',
          },
        ]}
      />,
    );

    const triggerIndex = markup.indexOf('观察敌营灯火与军阵间距');
    const cardIndex = markup.indexOf('洞察军阵');
    const consequenceIndex = markup.indexOf('敌营左翼防备薄弱');

    expect(markup).not.toContain('[[判定:observe_enemy_camp]]');
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThan(triggerIndex);
    expect(cardIndex).toBeLessThan(consequenceIndex);
  });
});
