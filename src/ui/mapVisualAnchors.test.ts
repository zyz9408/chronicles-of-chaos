import { describe, expect, it } from 'vitest';

import { projectLonLatToMapPercent } from './mapProjection';
import { hasMapVisualAnchor, listMapVisualAnchors, resolveMapVisualPoint } from './mapVisualAnchors';

describe('mapVisualAnchors', () => {
  it('returns fixed coordinates for known strategic places', () => {
    const point = resolveMapVisualPoint({
      id: 'place_jingzhou_xiangyang',
      parentId: 'region_jingzhou',
      mapLayer: 'place',
    });

    expect(point).not.toBeNull();
    expect(point).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      anchored: true,
      anchorId: 'place_jingzhou_xiangyang',
    });
    expect(point?.x).toBeGreaterThan(0);
    expect(point?.x).toBeLessThan(100);
    expect(point?.y).toBeGreaterThan(0);
    expect(point?.y).toBeLessThan(100);
  });

  it('places dynamic children near the nearest anchored parent', () => {
    const parent = resolveMapVisualPoint({
      id: 'place_jingzhou_xiangyang',
      parentId: 'region_jingzhou',
      mapLayer: 'place',
    });
    const child = resolveMapVisualPoint({
      id: 'dynamic_scene_xiangyang_east_camp',
      parentId: 'place_jingzhou_xiangyang',
      mapLayer: 'scene',
    });

    expect(parent).not.toBeNull();
    expect(child).not.toBeNull();
    expect(child?.anchored).toBe(false);
    expect(child?.anchorId).toBe('place_jingzhou_xiangyang');
    expect(Math.abs((child?.x ?? 0) - (parent?.x ?? 0))).toBeLessThanOrEqual(1.6);
    expect(Math.abs((child?.y ?? 0) - (parent?.y ?? 0))).toBeLessThanOrEqual(1.6);
  });

  it('uses deterministic offsets for the same dynamic node id', () => {
    const first = resolveMapVisualPoint({
      id: 'runtime_place_newye_market',
      parentId: 'place_jingzhou_xinye',
      mapLayer: 'place',
    });
    const second = resolveMapVisualPoint({
      id: 'runtime_place_newye_market',
      parentId: 'place_jingzhou_xinye',
      mapLayer: 'place',
    });

    expect(first).toEqual(second);
  });

  it('exposes bounded national anchors for the strategic map surface', () => {
    const anchors = listMapVisualAnchors();

    expect(anchors.length).toBeGreaterThan(20);
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'region_jingzhou', mapLayer: 'region' }),
      expect.objectContaining({ id: 'place_sili_luoyang', mapLayer: 'place' }),
      expect.objectContaining({ id: 'place_jingzhou_xiangyang', mapLayer: 'place' }),
      expect.objectContaining({ id: 'place_yizhou_chengdu', mapLayer: 'place' }),
      expect.objectContaining({ id: 'place_yangzhou_jianye', mapLayer: 'place' }),
    ]));

    for (const anchor of anchors) {
      expect(anchor.x).toBeGreaterThanOrEqual(0);
      expect(anchor.x).toBeLessThanOrEqual(100);
      expect(anchor.y).toBeGreaterThanOrEqual(0);
      expect(anchor.y).toBeLessThanOrEqual(100);
      expect(hasMapVisualAnchor(anchor.id)).toBe(true);
    }
  });

  it('keeps source longitude and latitude for calibrated strategic anchors', () => {
    const anchorById = new Map(listMapVisualAnchors().map((anchor) => [anchor.id, anchor]));

    expect(anchorById.get('place_sili_luoyang')).toMatchObject({
      lon: expect.closeTo(112.45, 0.1),
      lat: expect.closeTo(34.62, 0.1),
    });
    expect(anchorById.get('place_jingzhou_xiangyang')).toMatchObject({
      lon: expect.closeTo(112.14, 0.1),
      lat: expect.closeTo(32.04, 0.1),
    });
    expect(anchorById.get('place_yizhou_chengdu')).toMatchObject({
      lon: expect.closeTo(104.06, 0.1),
      lat: expect.closeTo(30.67, 0.1),
    });
  });

  it('calibrates strategic anchors to the full-domain base map geography', () => {
    const anchorById = new Map(listMapVisualAnchors().map((anchor) => [anchor.id, anchor]));
    const expectAnchorProjectsFromGeo = (id: string, lon: number, lat: number) => {
      const anchor = anchorById.get(id);
      expect(anchor, id).toBeDefined();
      const projected = projectLonLatToMapPercent({ lon, lat });
      expect(anchor?.x, `${id}.x`).toBeCloseTo(projected.x, 3);
      expect(anchor?.y, `${id}.y`).toBeCloseTo(projected.y, 3);
    };

    expectAnchorProjectsFromGeo('place_sili_changan', 108.94, 34.34);
    expectAnchorProjectsFromGeo('place_sili_luoyang', 112.45, 34.62);
    expectAnchorProjectsFromGeo('place_nanyang_wan', 112.53, 32.99);
    expectAnchorProjectsFromGeo('place_jingzhou_xinye', 112.36, 32.52);
    expectAnchorProjectsFromGeo('place_jingzhou_xiangyang', 112.14, 32.04);
    expectAnchorProjectsFromGeo('place_jingzhou_jiangling', 112.42, 30.04);
    expectAnchorProjectsFromGeo('place_yizhou_hanzhong', 107.03, 33.07);
    expectAnchorProjectsFromGeo('place_yizhou_chengdu', 104.06, 30.67);
    expectAnchorProjectsFromGeo('place_yangzhou_shouchun', 116.79, 32.57);
    expectAnchorProjectsFromGeo('place_xuzhou_xiapi', 118.34, 34.37);
    expectAnchorProjectsFromGeo('place_yangzhou_jianye', 118.79, 32.06);

    expect(anchorById.get('place_sili_changan')?.x).toBeLessThan(anchorById.get('place_sili_luoyang')?.x ?? 0);
    expect(anchorById.get('place_nanyang_wan')?.y).toBeLessThan(anchorById.get('place_jingzhou_xinye')?.y ?? 0);
    expect(anchorById.get('place_jingzhou_xinye')?.y).toBeLessThan(anchorById.get('place_jingzhou_xiangyang')?.y ?? 0);
    expect(anchorById.get('place_jingzhou_xiangyang')?.y).toBeLessThan(anchorById.get('place_jingzhou_jiangling')?.y ?? 0);
    expect(anchorById.get('place_yizhou_hanzhong')?.y).toBeLessThan(anchorById.get('place_yizhou_chengdu')?.y ?? 0);
    expect(anchorById.get('place_yangzhou_shouchun')?.x).toBeLessThan(anchorById.get('place_yangzhou_jianye')?.x ?? 0);
  });

  it('keeps the Jingzhou corridor visually separated on the calibrated base map', () => {
    const anchorById = new Map(listMapVisualAnchors().map((anchor) => [anchor.id, anchor]));
    const wan = anchorById.get('place_nanyang_wan');
    const xinye = anchorById.get('place_jingzhou_xinye');
    const xiangyang = anchorById.get('place_jingzhou_xiangyang');
    const jiangling = anchorById.get('place_jingzhou_jiangling');

    expect(wan).toBeDefined();
    expect(xinye).toBeDefined();
    expect(xiangyang).toBeDefined();
    expect(jiangling).toBeDefined();
    expect((xinye?.y ?? 0) - (wan?.y ?? 0)).toBeGreaterThanOrEqual(0.6);
    expect((xiangyang?.y ?? 0) - (xinye?.y ?? 0)).toBeGreaterThanOrEqual(0.6);
    expect((jiangling?.y ?? 0) - (xiangyang?.y ?? 0)).toBeGreaterThanOrEqual(3);
    expect(Math.abs((xinye?.x ?? 0) - (xiangyang?.x ?? 0))).toBeLessThanOrEqual(0.6);
  });

  it('keeps Luoyang approaches and Changshe on stable historical sides of the capital', () => {
    const anchorById = new Map(listMapVisualAnchors().map((anchor) => [anchor.id, anchor]));
    const luoyang = anchorById.get('place_sili_luoyang');
    const hulao = anchorById.get('place_sili_hulao_pass');
    const hangu = anchorById.get('place_sili_hangu_pass');
    const mengjin = anchorById.get('place_sili_mengjin');
    const yique = anchorById.get('place_sili_yique_pass');
    const huanyuan = anchorById.get('place_sili_huanyuan_pass');
    const changshe = anchorById.get('place_yingchuan_changshe');
    const xuxian = anchorById.get('place_yingchuan_xuxian');

    for (const anchor of [luoyang, hulao, hangu, mengjin, yique, huanyuan, changshe, xuxian]) {
      expect(anchor).toBeDefined();
    }

    expect(hulao?.x).toBeGreaterThan(luoyang?.x ?? 0);
    expect(hangu?.x).toBeLessThan(luoyang?.x ?? 0);
    expect(mengjin?.y).toBeLessThan(luoyang?.y ?? 0);
    expect(yique?.y).toBeGreaterThan(luoyang?.y ?? 0);
    expect(huanyuan?.x).toBeGreaterThan(luoyang?.x ?? 0);
    expect(huanyuan?.y).toBeGreaterThan(luoyang?.y ?? 0);
    expect(changshe?.x).toBeGreaterThan(luoyang?.x ?? 0);
    expect(changshe?.y).toBeGreaterThan(luoyang?.y ?? 0);
    expect(Math.abs((changshe?.x ?? 0) - (xuxian?.x ?? 0))).toBeLessThan(0.5);
    expect(Math.abs((changshe?.y ?? 0) - (xuxian?.y ?? 0))).toBeLessThan(0.7);
  });
});
