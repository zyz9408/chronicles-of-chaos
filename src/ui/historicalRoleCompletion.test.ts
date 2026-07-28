import { describe, expect, it } from 'vitest';
import type { CharacterTrait, MapNode, OpeningCharacterOption } from '../engine/types';
import startScreenSource from './StartScreen.tsx?raw';
import {
  applyHistoricalRoleCompletion,
  buildHistoricalRoleCompletionMessages,
  parseHistoricalRoleCompletionContent,
} from './historicalRoleCompletion';

const birthOrigins: OpeningCharacterOption[] = [
  { id: 'birth_great_clan', label: '世家大族', description: '累世官宦或经学之家。' },
  { id: 'birth_border_martial', label: '边郡武家', description: '边地军旅传统。' },
];

const identities: OpeningCharacterOption[] = [
  { id: 'identity_governor', label: '太守', description: '地方军政长官。' },
  { id: 'identity_military_officer', label: '军中将校', description: '有军职或兵权线索。' },
];

const traits: CharacterTrait[] = [
  {
    id: 'trait_military_books',
    label: '熟读兵书',
    description: '读过兵法与军事旧事。',
    source: 'opening',
  },
  {
    id: 'trait_observant',
    label: '善察人心',
    description: '能从言行细节判断他人真实态度。',
    source: 'opening',
  },
];

const mapSeed: MapNode[] = [
  {
    id: 'region_yuzhou',
    name: '豫州',
    level: '州',
    mapLayer: 'region',
    summary: '中原要地。',
    connectedRegionIds: [],
    controlHint: '由剧本决定',
    tensionHint: '由剧本决定',
    subLocations: [
      {
        id: 'loc_yingchuan',
        name: '颍川郡',
        level: '郡',
        mapLayer: 'region',
        summary: '士族密集。',
        connectedRegionIds: [],
        controlHint: '由剧本决定',
        tensionHint: '由剧本决定',
        subLocations: [
          {
            id: 'place_yingchuan_yangzhai',
            name: '阳翟县城',
            level: '县城',
            mapLayer: 'place',
            summary: '颍川郡治附近。',
            connectedRegionIds: [],
            controlHint: '由剧本决定',
            tensionHint: '由剧本决定',
          },
          {
            id: 'place_yingchuan_xuxian',
            name: '许县',
            level: '县城',
            mapLayer: 'place',
            summary: '颍川东部要县。',
            connectedRegionIds: [],
            controlHint: '由剧本决定',
            tensionHint: '由剧本决定',
          },
        ],
      },
    ],
  },
  {
    id: 'region_xuzhou',
    name: '徐州',
    level: '州',
    mapLayer: 'region',
    summary: '淮泗要地。',
    connectedRegionIds: [],
    controlHint: '由剧本决定',
    tensionHint: '由剧本决定',
    subLocations: [
      {
        id: 'loc_xuzhou_xiapi',
        name: '下邳国',
        level: '国',
        mapLayer: 'region',
        summary: '徐州重镇。',
        connectedRegionIds: [],
        controlHint: '由剧本决定',
        tensionHint: '由剧本决定',
        subLocations: [
          {
            id: 'place_xuzhou_xiapi_city',
            name: '下邳城',
            level: '城邑',
            mapLayer: 'place',
            summary: '徐州要城。',
            connectedRegionIds: [],
            controlHint: '由剧本决定',
            tensionHint: '由剧本决定',
          },
          {
            id: 'place_xuzhou_si_river_port',
            name: '泗水码头',
            level: '港口',
            mapLayer: 'place',
            summary: '水路交通处。',
            connectedRegionIds: [],
            controlHint: '由剧本决定',
            tensionHint: '由剧本决定',
          },
        ],
      },
    ],
  },
];

describe('historical role completion', () => {
  it('parses a structured historical role completion and applies it to editable opening fields', () => {
    const parsed = parseHistoricalRoleCompletionContent(`\n\`\`\`json\n{
      "name": "曹操",
      "courtesyName": "孟德",
      "sex": "男",
      "age": 39,
      "appearance": "身形不高，目光锐利，衣冠简劲。",
      "personality": "机敏多疑，善断形势，临危敢决。",
      "birthOriginId": "birth_great_clan",
      "currentIdentityId": "identity_governor",
      "locationId": "place_yingchuan_yangzhai",
      "situationSummary": "曹操以东郡太守名义募兵讨董，正处在联军初合之际。",
      "abilityScores": { "武力": 70, "统率": 84, "智力": 88, "政治": 86, "魅力": 78, "机运": 62 },
      "traitIds": ["trait_military_books", "trait_observant"],
      "supplementalNotes": "应承接兖州、讨董与宗族旧部等线索，不得把后期魏王身份提前。"
    }\n\`\`\`\n`);

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '曹操',
      currentSex: '男',
      currentAge: 18,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'loc_yingchuan',
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied).toMatchObject({
      playerName: '曹操',
      historicalName: '曹操',
      courtesyName: '孟德',
      sex: '男',
      age: 39,
      appearance: '身形不高，目光锐利，衣冠简劲。',
      personality: '机敏多疑，善断形势，临危敢决。',
      selectedBirthOriginId: 'birth_great_clan',
      selectedIdentityId: 'identity_governor',
      selectedLocationId: 'place_yingchuan_yangzhai',
      situationSummary: '曹操以东郡太守名义募兵讨董，正处在联军初合之际。',
    });
    expect(applied.abilityScores).toEqual({ 武力: 70, 统率: 84, 智力: 88, 政治: 86, 魅力: 78, 机运: 62 });
    expect(applied.selectedTraitIds).toEqual(['trait_military_books', 'trait_observant']);
    expect(applied.customNotes).toContain('不得把后期魏王身份提前');
  });

  it('normalizes broad historical location choices to a concrete opening place', () => {
    const parsed = parseHistoricalRoleCompletionContent(JSON.stringify({
      name: '曹操',
      locationId: 'loc_yingchuan',
      abilityScores: { 武力: 70, 统率: 84, 智力: 88, 政治: 86, 魅力: 78, 机运: 62 },
    }));

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '曹操',
      currentSex: '男',
      currentAge: 18,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'region_yuzhou',
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied.selectedLocationId).toBe('place_yingchuan_yangzhai');
    expect(applied.selectedLocationPathIds).toEqual({
      regionId: 'region_yuzhou',
      commanderyId: 'loc_yingchuan',
      locationId: 'place_yingchuan_yangzhai',
      sceneId: '',
    });
  });

  it('resolves historical Chinese place text to the matching concrete opening place instead of keeping the current default', () => {
    const parsed = parseHistoricalRoleCompletionContent(JSON.stringify({
      name: '刘备',
      locationId: '徐州下邳',
      abilityScores: { 武力: 78, 统率: 76, 智力: 72, 政治: 74, 魅力: 86, 机运: 62 },
    }));

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '刘备',
      currentSex: '男',
      currentAge: 33,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'place_yingchuan_yangzhai',
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied.selectedLocationId).toBe('place_xuzhou_xiapi_city');
    expect(applied.selectedLocationPathIds).toEqual({
      regionId: 'region_xuzhou',
      commanderyId: 'loc_xuzhou_xiapi',
      locationId: 'place_xuzhou_xiapi_city',
      sceneId: '',
    });
  });

  it('accepts common initial location aliases returned by the model before resolving the place', () => {
    const parsed = parseHistoricalRoleCompletionContent(JSON.stringify({
      name: '刘备',
      initialLocation: {
        region: '徐州',
        commandery: '下邳国',
        place: '下邳城',
      },
      abilityScores: { 武力: 78, 统率: 76, 智力: 72, 政治: 74, 魅力: 86, 机运: 62 },
    }));

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '刘备',
      currentSex: '男',
      currentAge: 33,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'place_yingchuan_yangzhai',
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied.selectedLocationId).toBe('place_xuzhou_xiapi_city');
  });

  it('resolves historical capital aliases like Xu Du or Xu Chang to the concrete Xu County node', () => {
    const parsed = parseHistoricalRoleCompletionContent(JSON.stringify({
      name: '关羽',
      locationId: '许都',
      abilityScores: { 武力: 97, 统率: 92, 智力: 75, 政治: 62, 魅力: 94, 机运: 60 },
    }));

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '关羽',
      currentSex: '男',
      currentAge: 39,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'place_yingchuan_yangzhai',
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied.selectedLocationId).toBe('place_yingchuan_xuxian');
    expect(applied.selectedLocationPathIds).toEqual({
      regionId: 'region_yuzhou',
      commanderyId: 'loc_yingchuan',
      locationId: 'place_yingchuan_xuxian',
      sceneId: '',
    });
  });

  it('normalizes historical ability aliases and numeric strings into the six canonical ability fields', () => {
    const parsed = parseHistoricalRoleCompletionContent(JSON.stringify({
      name: '曹操',
      locationId: 'place_yingchuan_yangzhai',
      abilityScores: {
        force: '71',
        command: '86',
        intelligence: '92',
        politics: '88',
        charisma: '77',
        luck: '63',
      },
    }));

    const applied = applyHistoricalRoleCompletion(parsed, {
      currentHistoricalName: '曹操',
      currentSex: '男',
      currentAge: 18,
      currentBirthOriginId: '',
      currentIdentityId: '',
      currentLocationId: 'loc_yingchuan',
      currentAbilityScores: { 武力: 50, 统率: 50, 智力: 50, 政治: 50, 魅力: 50, 机运: 50 },
      birthOrigins,
      identities,
      traits,
      mapSeed,
    });

    expect(applied.abilityScores).toEqual({ 武力: 71, 统率: 86, 智力: 92, 政治: 88, 魅力: 77, 机运: 63 });
  });

  it('builds a JSON-only prompt with script, worldbook option ids, location ids and knowledge hints', () => {
    const messages = buildHistoricalRoleCompletionMessages({
      worldName: '乱世风云录',
      bookmarkLabel: '关东讨董',
      bookmarkStartDate: '190年01月',
      bookmarkSummary: '关东诸侯起兵讨董。',
      historicalName: '曹操',
      currentLocationId: 'place_yingchuan_yangzhai',
      birthOrigins,
      identities,
      traits,
      mapSeed,
      knowledgeHints: ['曹操此时尚非魏王，应按讨董前后身份处理。'],
    });

    const fullPrompt = messages.map((message) => message.content).join('\n');
    expect(fullPrompt).toContain('只输出一个 JSON 对象');
    expect(fullPrompt).toContain('birthOriginId');
    expect(fullPrompt).toContain('identity_governor');
    expect(fullPrompt).toContain('place_yingchuan_yangzhai');
    expect(fullPrompt).toContain('place_yingchuan_xuxian');
    expect(fullPrompt).toContain('别名：许都、许昌');
    expect(fullPrompt).toContain('界面当前默认地点 ID');
    expect(fullPrompt).toContain('locationId 优先选择县 / 城邑 / 据点等具体地点 ID');
    expect(fullPrompt).toContain('不得因为界面默认地点而保留默认地点');
    expect(fullPrompt).toContain('不要选择同郡第一个默认地点');
    expect(fullPrompt).toContain('abilityScores 的键必须使用：武力、统率、智力、政治、魅力、机运');
    expect(fullPrompt).toContain('资料库提示');
    expect(fullPrompt).toContain('曹操此时尚非魏王');
  });

  it('wires historical AI completion into structured StartScreen fields instead of only custom notes', () => {
    expect(startScreenSource).toContain('buildHistoricalRoleCompletionMessages');
    expect(startScreenSource).toContain('parseHistoricalRoleCompletionContent');
    expect(startScreenSource).toContain('applyHistoricalRoleCompletion');
    expect(startScreenSource).toContain("responseFormat: 'json_object'");
    expect(startScreenSource).toContain('setPlayerCourtesyName');
    expect(startScreenSource).toContain('setPlayerAppearance');
    expect(startScreenSource).toContain('setPlayerPersonality');
    expect(startScreenSource).toContain('setSelectedBirthOrigin');
    expect(startScreenSource).toContain('setSelectedOrigin');
    expect(startScreenSource).toContain('setSelectedLocationId');
  });
});
