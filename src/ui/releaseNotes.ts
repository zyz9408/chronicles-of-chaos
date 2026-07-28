export const APP_VERSION = '1.0.0';
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const CHANGELOG_DAILY_VIEW_KEY = 'coc_v2_changelog_daily_view';
export const LEGACY_RELEASE_NOTE_SEEN_KEY = 'coc_v2_seen_release_note';

export interface ReleaseNoteUpdate {
  id: string;
  time: string;
  version: string;
  title: string;
  summary: string;
  items: readonly string[];
}

export interface ReleaseNoteEntry {
  id: string;
  date: string;
  updates: readonly ReleaseNoteUpdate[];
}

export const RELEASE_NOTES: readonly ReleaseNoteEntry[] = [
  {
    id: '2026-07-27',
    date: '2026年7月27日',
    updates: [
      {
        id: '2026-07-27-v1.0.0-official-release',
        time: '13:34',
        version: 'v1.0.0',
        title: '游戏正式上线',
        summary: '《乱世风云录》是一款由大语言模型驱动、以本地结构化世界状态承接长期变化的三国乱世叙事游戏。',
        items: [
          '可以自创无名之辈，也可以扮演史实人物；世界、剧本、年代、出身、身份、地点和开局要求共同生成每局独有的起点。',
          '主剧情由大语言模型自由叙事，本地事实层持续记录人物、地点、物品、金钱、事项、关系与世界变化，让选择真正留在后续故事里。',
          'NPC 拥有可持续积累的档案、短中长期记忆、关系和远场行动；即使暂时不在场，也会依据自身处境继续生活。',
          '势力、领地、部队、资源、城市风声和历史局势会随游戏时间演化，并与玩家身份、行动和已经发生的世界线相互影响。',
          '战斗与战争由本地规则完成判定，再由主模型把确定结果写成叙事；人物状态、减员、战果和后果会继续进入世界状态。',
          '三国世界包内置 1500 条跨身份、跨时代、跨地域的通用剧情素材，并结合史实资料与当前事实选择合适内容，不强迫剧情照史实重演。',
          '支持自动存档、存档导入导出、剧情导出、可配置模型档案，以及适配桌面与手机的完整游戏界面。',
        ],
      },
    ],
  },
] as const;

interface ChangelogDailyViewRecord {
  localDate: string;
  latestUpdateId: string;
}

type ReleaseNoteStorage = Pick<Storage, 'getItem' | 'setItem'>;

function getStorage(storage?: ReleaseNoteStorage): ReleaseNoteStorage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function formatLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shouldShowDailyReleaseNotes(
  storage?: ReleaseNoteStorage,
  now = new Date(),
): boolean {
  const latestUpdateId = RELEASE_NOTES[0]?.updates[0]?.id;
  if (!latestUpdateId) return false;

  const target = getStorage(storage);
  if (!target) return false;
  try {
    const raw = target.getItem(CHANGELOG_DAILY_VIEW_KEY);
    if (!raw) return true;
    const record = JSON.parse(raw) as Partial<ChangelogDailyViewRecord>;
    return record.localDate !== formatLocalDateKey(now)
      || record.latestUpdateId !== latestUpdateId;
  } catch {
    return true;
  }
}

export function recordDailyReleaseNotesView(
  storage?: ReleaseNoteStorage,
  now = new Date(),
): void {
  const latestUpdateId = RELEASE_NOTES[0]?.updates[0]?.id;
  if (!latestUpdateId) return;

  const target = getStorage(storage);
  if (!target) return;
  try {
    target.setItem(CHANGELOG_DAILY_VIEW_KEY, JSON.stringify({
      localDate: formatLocalDateKey(now),
      latestUpdateId,
    } satisfies ChangelogDailyViewRecord));
  } catch {
    // A blocked localStorage only means the notice may be offered again later.
  }
}
