import { describe, expect, it } from 'vitest';
import { threeKingdomsCharacterOptions } from './characterOptions';
import { threeKingdomsStartBookmarks } from './startBookmarks';
import { threeKingdomsTimelineAnchors } from './timelineAnchors';

describe('threeKingdomsStartBookmarks', () => {
  it('provides a broad first batch of Three Kingdoms opening scripts', () => {
    expect(threeKingdomsStartBookmarks.length).toBeGreaterThanOrEqual(24);

    expect(threeKingdomsStartBookmarks.map((bookmark) => bookmark.id)).toEqual(
      expect.arrayContaining([
        'bookmark_184_yellow_turban',
        'bookmark_189_luoyang_storm',
        'bookmark_190_anti_dong',
        'bookmark_194_warlords',
        'bookmark_196_emperor_at_xu',
        'bookmark_200_guandu',
        'bookmark_201_jingzhou_refuge',
        'bookmark_207_longzhong_plan',
        'bookmark_208_red_cliff',
        'bookmark_211_entering_shu',
        'bookmark_214_yizhou',
        'bookmark_219_hanzhong_king',
        'bookmark_220_three_kingdoms',
        'bookmark_222_yiling_aftermath',
        'bookmark_223_baidi_regency',
        'bookmark_225_nanzhong_campaign',
        'bookmark_228_first_northern_expedition',
        'bookmark_229_shu_wu_renewed_alliance',
        'bookmark_231_qishan_stalemate',
        'bookmark_253_jiangwei_command',
        'bookmark_255_taoxi_victory',
        'bookmark_263_shuhan_fall',
      ]),
    );
  });

  it('keeps every opening script connected to an existing timeline anchor', () => {
    const anchorIds = new Set(threeKingdomsTimelineAnchors.map((anchor) => anchor.id));

    for (const bookmark of threeKingdomsStartBookmarks) {
      expect(bookmark.relatedTimelineAnchorIds.length, bookmark.id).toBeGreaterThan(0);
      for (const anchorId of bookmark.relatedTimelineAnchorIds) {
        expect(anchorIds.has(anchorId), `${bookmark.id} -> ${anchorId}`).toBe(true);
      }
    }
  });

  it('provides common Three Kingdoms birth origins and active identities for opening setup', () => {
    const birthLabels = threeKingdomsCharacterOptions.birthOrigins.map((option) => option.label);
    const identityLabels = threeKingdomsCharacterOptions.identities.map((option) => option.label);

    expect(birthLabels).toEqual(
      expect.arrayContaining(['宗室支脉', '世家大族', '郡县士族', '寒门士子', '边郡武家']),
    );
    expect(identityLabels).toEqual(
      expect.arrayContaining(['在野士人', '郡县小吏', '太守', '朝中重臣', '游侠', '黄巾信众']),
    );
  });
  it('provides a larger opening trait pool with stable preset rarity levels', () => {
    const traits = threeKingdomsCharacterOptions.traits ?? [];
    const allowedRarities = new Set(['white', 'green', 'blue', 'purple', 'orange', 'red']);

    expect(traits.length).toBeGreaterThanOrEqual(24);
    expect(new Set(traits.map((trait) => trait.id)).size).toBe(traits.length);
    expect(traits.every((trait) => allowedRarities.has(trait.rarity ?? ''))).toBe(true);
    expect([...new Set(traits.map((trait) => trait.rarity))]).toEqual(
      expect.arrayContaining(['white', 'green', 'blue', 'orange']),
    );
  });
});
