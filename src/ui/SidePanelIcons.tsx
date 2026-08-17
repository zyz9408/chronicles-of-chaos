import React from 'react';

/* 轻量 inline SVG 图标，16px 视图，stroke="currentColor" 继承按钮色，无外部依赖 */

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

/** 局势 — Compass / 罗盘 */
const WorldIcon = () => icon('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v5M12 17v5M2 12h5M17 12h5');

/** 地图 — MapPin / 地图标记 */
const MapIcon = () => icon('M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z');

/** 人物志 — Contact / IdCard */
const NpcsIcon = () => icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8');

/** 羁绊 — Link / 连接环 */
const BondsIcon = () => icon('M10 13a5 5 0 0 0 7.5.5l.5-.5M14 11a5 5 0 0 0-7.5-.5l-.5.5M8.5 8.5l-1 1a4 4 0 0 0 5.6 5.6l1-1M15.5 15.5l1-1a4 4 0 0 0-5.6-5.6l-1 1');

/** 红颜 — Heart / 心形 */
const HeroinesIcon = () => icon('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z');

/** 书信 — Letter / 封函 */
const CorrespondenceIcon = () => icon('M3 6h18v12H3V6zm1 1 8 6 8-6M4 17l5-5M20 17l-5-5');

/** 背包 — Backpack / 箱包 */
const BackpackIcon = () => icon('M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6l2-4zm0 4h12M8 2v4M16 2v4M12 12v4');

/** 绝艺 — Sparkles / 星芒 */
const UniqueArtsIcon = () => icon('M12 2l1.8 5.5H19l-4.2 3 1.6 4.9L12 12.5l-4.4 3 1.6-4.9L5 7.5h5.2z');

/** 势力 — Flag / 旗帜 */
const FactionsIcon = () => icon('M4 15s0-9 3-9h12l-3 4 3 4H7v7H4v-6zM4 2v4');

/** 领地 — Building / 城楼 */
const HoldingsIcon = () => icon('M3 21h18M5 21V7l4-3 6 3 4 3v11M9 21v-6h6v6M9 9h2M13 9h2');

/** 部队 — Shield / 盾兵 */
const TroopsIcon = () => icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM8 11h3M13 11h3M10 14h4');

/** 战事 — SwordsCross / 交叉剑 */
const BattlesIcon = () => icon('M14.5 17.5 19 22M5 5l4.5 4.5M18 2l-6.5 6.5M6 13.5l-4 4M19.5 2l-3 3M4.5 19l3-3');

/** 战斗 — Sword / 单剑 */
const CombatsIcon = () => icon('M14.5 17.5 19 22M5 5l4.5 4.5M18 7l-7 7a4 4 0 0 1-5.7 0l-.3-.3a4 4 0 0 1 0-5.7L12 1l6 6z');

/** 回忆 — Scroll / 史卷 */
const MemoriesIcon = () => icon('M6 3h12a2 2 0 0 1 2 2v14H8a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2zm2 4h8M8 11h8M8 15h5M4 15a4 4 0 0 1 4-4');

export const sidePanelIconMap: Record<string, React.ReactElement> = {
  dynamics:   <WorldIcon />,
  map:        <MapIcon />,
  npcs:       <NpcsIcon />,
  bonds:      <BondsIcon />,
  heroines:   <HeroinesIcon />,
  correspondence: <CorrespondenceIcon />,
  backpack:   <BackpackIcon />,
  uniqueArts: <UniqueArtsIcon />,
  factions:   <FactionsIcon />,
  holdings:   <HoldingsIcon />,
  troops:     <TroopsIcon />,
  battles:    <BattlesIcon />,
  combats:    <CombatsIcon />,
  memories:   <MemoriesIcon />,
};
