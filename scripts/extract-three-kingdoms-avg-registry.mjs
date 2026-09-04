import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = process.argv[2];
const outputPath = resolve(process.argv[3] ?? 'src/engine/avg/ThreeKingdomsAvgRegistry.generated.json');
if (!sourcePath) {
  throw new Error('用法：node scripts/extract-three-kingdoms-avg-registry.mjs <反格式化入口文件> [输出文件]');
}

const source = await readFile(resolve(sourcePath), 'utf8');

function extractJsonParseLiteral(name) {
  const marker = `const ${name} = JSON.parse(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const literalStart = source.indexOf("'", start + marker.length);
  let literalEnd = source.indexOf("',\r\n);", literalStart + 1);
  if (literalEnd < 0) literalEnd = source.indexOf("',\n);", literalStart + 1);
  if (literalEnd < 0) literalEnd = source.indexOf("'\r\n);", literalStart + 1);
  if (literalEnd < 0) literalEnd = source.indexOf("'\n);", literalStart + 1);
  if (literalStart < 0 || literalEnd < 0) throw new Error(`${name} 字面量不完整`);
  const literal = source.slice(literalStart, literalEnd + 1);
  // The input is a locally checked-out, trusted deployment artifact. Evaluating only
  // the isolated string literal preserves its escaping without executing bundle code.
  return JSON.parse(Function(`"use strict"; return (${literal});`)());
}

function safeAssetFileName(assetId) {
  const value = assetId.replace(/[^a-zA-Z0-9._-]+/gu, '--').replace(/^-+|-+$/gu, '');
  if (!value) throw new Error(`assetId 无法转换为文件名：${assetId}`);
  return `${value}.webp`;
}

function toAsset(metadata, kind, resourceId, variant) {
  if (!metadata.runtimeWebpSha256
    || !metadata.runtimeWebpBytes
    || !metadata.runtimeWebpWidth
    || !metadata.runtimeWebpHeight
    || metadata.runtimeMediaType !== 'image/webp') {
    throw new Error(`资源缺少已验收 WebP 元数据：${metadata.assetId}`);
  }
  const directory = kind === 'scene'
    ? 'scenes'
    : kind === 'fixed-portrait'
      ? 'portraits/fixed'
      : 'portraits/generic';
  return {
    assetId: metadata.assetId,
    path: `assets/${directory}/${safeAssetFileName(metadata.assetId)}`,
    mediaType: 'image/webp',
    byteLength: metadata.runtimeWebpBytes,
    width: metadata.runtimeWebpWidth,
    height: metadata.runtimeWebpHeight,
    sha256: metadata.runtimeWebpSha256.toUpperCase(),
    kind,
    resourceId,
    ...(variant ? { variant } : {}),
  };
}

const fixedPortraitSets = extractJsonParseLiteral('fixedPortraitSets');
const genericPortraitSets = extractJsonParseLiteral('genericPortraitSets');
const scenes = extractJsonParseLiteral('scenes');
const assets = [
  ...fixedPortraitSets.flatMap((set) => Object.entries(set.variants)
    .filter(([, metadata]) => Boolean(metadata))
    .map(([variant, metadata]) => toAsset(metadata, 'fixed-portrait', set.portraitSetId, variant))),
  ...genericPortraitSets.flatMap((set) => Object.entries(set.variants)
    .filter(([, metadata]) => Boolean(metadata))
    .map(([variant, metadata]) => toAsset(metadata, 'generic-portrait', set.portraitSetId, variant))),
  ...scenes.map((scene) => toAsset(scene, 'scene', scene.sceneResourceId)),
];

if (assets.length !== 1122) throw new Error(`预期 1122 项，实际 ${assets.length} 项`);

const registry = {
  worldBookId: 'threeKingdoms',
  registryManifestId: 'avg:threeKingdoms:accepted-resources:portrait-922-scene-200:2026-08-24',
  fixedPortraitSets: fixedPortraitSets.map((set) => ({
    portraitSetId: set.portraitSetId,
    canonicalId: set.canonicalId,
    label: set.label,
    runtimeRoleAliases: set.runtimeRoleAliases,
    defaultVariant: set.defaultVariant,
    profile: set.profile,
  })),
  genericPortraitSets: genericPortraitSets.map((set) => ({
    portraitSetId: set.portraitSetId,
    canonicalId: set.canonicalId,
    label: set.label,
    runtimeRoleAliases: set.runtimeRoleAliases,
    defaultVariant: set.defaultVariant,
    profile: set.profile,
  })),
  scenes: scenes.map((scene) => ({
    sceneResourceId: scene.sceneResourceId,
    runtimeSceneIds: scene.runtimeSceneIds,
    runtimePlaceIds: scene.runtimePlaceIds,
    aliases: scene.aliases,
    semanticProfile: scene.semanticProfile,
  })),
  assets,
};
await writeFile(outputPath, `${JSON.stringify(registry)}\n`, 'utf8');
console.log(`已写入 ${outputPath}（${assets.length} 项）`);
