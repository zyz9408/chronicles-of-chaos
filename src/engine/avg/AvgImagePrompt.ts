export type AvgImageSafetyMode = 'adult-actor' | 'non-adult-actor' | 'scene';
export interface AvgImagePromptDraft { draft: string; structuredDraft: string; adultDirectionAvailable: boolean; safetyMode: AvgImageSafetyMode }

const NON_ADULT_GUARD = '强制安全护栏（不可编辑）：仅生成中性、非性化、合宜服装的人物立绘；禁止强调身体曲线或成人吸引力，禁止性感姿态、暴露服装或任何性化表达。';
const ADULT_GUARD = '强制安全护栏（不可编辑）：人物必须保持完整服装；禁止裸体、露骨性行为或露骨性内容。';
const SCENE_GUARD = '强制场景护栏（不可编辑）：仅生成无人物场景背景；保持无人物、无文字、无水印、无拼贴。';
export const AVG_ART_DIRECTION = '统一美术风格：三国志式历史策略游戏手绘插画，东汉末年与三国时代服饰建筑，精细笔触、厚涂质感、沉稳古典配色；人物采用游戏武将立绘，场景采用绘制背景。禁止真人摄影、照片写实、影视剧照、摄影镜头效果和现代元素。';

function clean(value: string | undefined, limit: number): string { return (value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit); }

export function buildAvgActorImagePrompt(input: { name: string; sex?: string; age?: number; ageBand?: string; identity?: string; occupation?: string; appearance?: string; outfit?: { name: string; note?: string } }): AvgImagePromptDraft {
  const bands: Record<string, string> = { child: '儿童', teen: '明确未满18岁', young_adult: '明确成年且年轻', adult: '明确成年', middle_aged: '明确成年且成熟', elderly: '明确成年且年长' };
  const ageBand = input.age === undefined ? bands[input.ageBand ?? ''] ?? '年龄未知' : input.age < 18 ? '明确未满18岁' : input.age < 40 ? '明确成年' : input.age < 60 ? '明确成年且成熟' : '明确成年且年长';
  const adult = input.age !== undefined ? Number.isFinite(input.age) && input.age >= 18 : ['young_adult', 'adult', 'middle_aged', 'elderly'].includes(input.ageBand ?? '');
  const lines = [`为单人游戏人物立绘生成一张完整候选图。人物：${clean(input.name, 80) || '当前人物'}。`, `结构化特征：${input.sex === '女' || input.sex === 'female' ? '女性' : input.sex === '男' || input.sex === 'male' ? '男性' : '性别未知'}，${ageBand}。`];
  if (clean(input.identity, 160)) lines.push(`公开身份：${clean(input.identity, 160)}。`);
  if (clean(input.occupation, 160)) lines.push(`公开职业或职务：${clean(input.occupation, 160)}。`);
  if (clean(input.appearance, 500)) lines.push(`公开外观摘要：${clean(input.appearance, 500)}。`);
  if (input.outfit && clean(input.outfit.name, 80)) lines.push(`当前玩家自定义造型：${clean(input.outfit.name, 80)}${clean(input.outfit.note, 240) ? `；视觉备注：${clean(input.outfit.note, 240)}` : ''}。`);
  if (!adult) lines.push('年龄未明确成年：保持中性、非性化、合宜服装，不强调身体曲线或成人吸引力。');
  lines.push('适合叠加在 AVG 背景上的人物立绘，单人全身或膝上完整构图，优先透明背景，否则简洁纯色背景，人物轮廓完整清晰。');
  lines.push('单人、完整构图、无文字、无水印、无拼贴、无多余人物、无裸体、无露骨性行为。');
  lines.push(AVG_ART_DIRECTION);
  const draft = lines.join('\n'); return { draft, structuredDraft: draft, adultDirectionAvailable: adult, safetyMode: adult ? 'adult-actor' : 'non-adult-actor' };
}

export function buildAvgSceneImagePrompt(input: { name: string; environment?: 'indoor' | 'outdoor'; publicFunction?: string; signature?: string; tags?: string[] }): AvgImagePromptDraft {
  const lines = [`为游戏 AVG 生成一张无人物场景背景。场景：${clean(input.name, 120) || '当前结构化场景'}。`];
  if (input.environment) lines.push(`环境：${input.environment === 'indoor' ? '室内' : '室外'}。`);
  if (clean(input.publicFunction, 120)) lines.push(`结构化用途：${clean(input.publicFunction, 120)}。`);
  if (clean(input.signature, 160)) lines.push(`结构化地点特征：${clean(input.signature, 160)}。`);
  const tags = [...new Set((input.tags ?? []).map((tag) => clean(tag, 40)).filter(Boolean))].slice(0, 12); if (tags.length) lines.push(`公开视觉标签：${tags.join('、')}。`);
  lines.push('宽幅背景构图、环境叙事、无人物、无文字、无水印、无拼贴。');
  lines.push(AVG_ART_DIRECTION);
  const draft = lines.join('\n'); return { draft, structuredDraft: draft, adultDirectionAvailable: false, safetyMode: 'scene' };
}

export function finalizeAvgImagePrompt(input: AvgImagePromptDraft & { editedDraft: string; supplement: string; boldNonExplicit: boolean }): string {
  const edited = input.editedDraft.trim(); const structured = input.structuredDraft.trim(); const supplement = input.supplement.trim();
  if (!edited || edited.length > 4000) throw new Error('可编辑提示词必须在 1 到 4000 个字符之间。');
  if (supplement.length > 2000) throw new Error('补充要求不能超过 2000 个字符。');
  if (input.safetyMode === 'non-adult-actor') {
    if (edited !== structured || supplement || input.boldNonExplicit) throw new Error('年龄未明确成年，提示词已锁定为结构化安全默认值；不能编辑提示词、补充要求或成年美术方向。');
    return `${structured}\n${NON_ADULT_GUARD}\n${AVG_ART_DIRECTION}`;
  }
  return [edited, input.boldNonExplicit && input.adultDirectionAvailable ? '美术方向：大胆但不露骨，增强成年角色的视觉吸引力；仍保持完整服装并禁止裸体或露骨内容。' : '', supplement ? `玩家补充要求：${supplement}` : '', input.safetyMode === 'adult-actor' ? ADULT_GUARD : SCENE_GUARD, AVG_ART_DIRECTION].filter(Boolean).join('\n');
}
