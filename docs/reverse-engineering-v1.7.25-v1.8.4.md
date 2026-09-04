# v1.7.25–v1.8.4 发布包逆向说明

## 结论

仓库 `main` 中的可编辑源码停在 `v1.7.24`，另有提交 `c896152` 的装备锻造写回补丁。`gh-pages` 提交 `31af137` 是正式 `v1.8.4` 构建；当前部署头 `919b189` 只在该构建的主入口中关闭不可用的统计心跳，没有改变游戏规则或 AVG 行为。部署分支只包含压缩后的 JavaScript、CSS 和静态资源，没有 source map，也没有对应 TypeScript/React 源码。

因此，下文区分两种结果：

- **确定恢复**：可从构建产物直接读出的常量、枚举、字段、提示文本、分支条件和界面行为。
- **推定模块**：利用 `v1.7.24` 本地构建的 source map，将新版代码附近仍未变化的字面量映射回现有源码文件。文件归属可靠，但不能保证与作者原始拆分完全一致。

不能从压缩产物恢复原始变量名、注释、测试、提交历史和未进入最终构建的代码。若要重建源码，应以本说明作为行为规范重新实现，而不应把反格式化的发布包冒充原始源码。

## 本仓库重建状态

本分支已按上述行为规范完成一套可编辑源码重建，并将应用版本统一提升到 `1.8.4`。它不是作者遗失源码的逐字还原，但以下发布行为已接入实际运行路径，而非只停留在说明或类型定义中：

- v1.7.25–v1.7.29 的持续事项投影、NPC 近况与后台演化排除、确定性疲劳恢复、记忆检索轨迹和亲密叙事约束。
- AVG 经典/自动/演出显示设置、按回合冻结的场景与说话人绑定、一次性批量展示身份补齐、播放前资源预检、场景/人物资源回退、本地视觉覆盖和自定义造型。
- AVG 视觉分区随存档 ZIP 导出、导入、删除和全清理；外部美术包按部署版协议流式读取，限制压缩包 3 GiB、解压总量 4 GiB、单文件 96 MiB、图片 5000 项，并在摘要、WebP 结构、尺寸和完整清单通过后原子切换。
- 状态写回失败证据胶囊、来源回合锚定、完整性/谱系预检以及不改正文和时间的应用合同。
- 五类功能的 `bundledMain | dedicated` 配置、旧设置迁移、同轮冻结计划、32,000 字符裁剪、NPC 完整集合校验、世界演化提交前复核和请求前记忆任务冻结。
- v1.8.3 的稳定说话人沿用与 v1.8.4 的 NPC 轨迹诊断、人物志长期准入证据和可关闭的本回合提示。

重建后的验收基线为：TypeScript/ESLint 静态检查通过、生产构建通过、全量 Vitest 测试通过。部署包没有 source map，因此“完成”在这里表示可观察合同与失败边界已重建并受测试保护，不表示能够恢复原作者的内部命名、文件拆分或未发布代码。

## 构建证据

| 项目 | v1.7.24 / `084806d` | v1.8.4 / `31af137` + 部署热修 `919b189` |
| --- | --- | --- |
| 应用版本 | `1.7.24` | `1.8.4` |
| 主入口 | `index-CakKd3Jq.js` | `index-DTKbBbd4.js` |
| 游戏界面块 | `GameScreen-CWhJfGDn.js` | `GameScreen-DWtvignY.js` |
| 更新日志范围 | 至 `v1.7.24` | 至 `v1.8.4` |
| source map | 发布包无；可由 1.7.24 源码重建 | 无 |

本地 `npm run build` 生成的 v1.7.24 文件名与 `084806d` 完全一致，说明旧发布包可以作为可信基线。

`919b189` 相对 `31af137` 只修改 `assets/index-DTKbBbd4.js` 一处统计心跳开关，因此逆向游戏行为时以 `31af137` 为发布基线、以 `919b189` 为当前线上包装，两者并不矛盾。

## 按版本反推

### v1.7.25：持续事项与军需事实

确定恢复的行为：

- 新增四个稳定标签：
  - `continuity:ongoing_agreement`
  - `continuity:external_supply`
  - `continuity:unresolved_disposition`
  - `continuity:scheduled_agreed_action`
- 只投影仍处于开放状态、并带上述标签的事项。
- 常驻投影独立于普通相关性检索，固定上限为 6 条、总文本 1400 字符、单值 160 字符。
- 排序依次考虑优先级、是否到期、期限、最近更新时间和稳定事项 ID。
- 投影保留 NPC、势力、部队、领地和地点的稳定关联 ID，并在诊断中逐类输出。
- 主提示明确声明：当前事项及实体账本是真值，NPC/势力记忆只作辅助回忆。
- 新建或实质改变外部军需协议时，若已有明确关联部队，必须同步写回部队的 `upkeepSource`：上级全额承担为 `superior_provision`，玩家补足缺口为 `mixed`。

主要推定模块：

- `src/engine/state/selectPromptContext.ts`
- `src/engine/turn/PromptComposer.ts`
- 新的持续事项投影模块
- 部队账本命令校验与 reducer
- 回合诊断投影

### v1.7.26：NPC 近况与关系后台演化

确定恢复的行为：

- 人物近况统一合并：回合亲历事件、红颜/羁绊进展和里程碑、公开或玩家已知的后台活动、远场近况。
- 默认只显示最近 5 条；按游戏时间倒序、来源优先级、稳定 ID 排序。
- 摘要经 NFKC、大小写和标点归一化后去重。
- 本回合直接在场人物标记为 `same_turn_present`，仅参与事件但不在场者标记为 `same_turn_involved`，两类人物不会在同回合重复跑后台演化。
- 缺失或损坏 `dueAt` 的进行中关系活动进入 `selfHeal`，诊断原因是 `invalid_due_at_self_heal` 或 `missing_due_at`，允许重新规划下一次推进时间。
- 直接互动本身不再制造异地消息未读标记；真正的远场更新仍可提示未读。

主要推定模块：

- `src/ui/npcPanelModel.ts`
- `src/engine/worldEvolution/RelationshipWorldEvolution.ts`
- `src/engine/npc/NpcIntentSimulation.ts`
- 关系事项的到期判定与恢复辅助模块

### v1.7.27：非战争疲劳确定性恢复

确定恢复的数据合同：

- 部队新增 `activityTempo`：`resting | stationary_duty | training | marching | combat | unknown`。
- 部队新增 `lastDeterministicFatigueRecoveryAt`，防止同一游戏时点重复恢复。
- 连续休整门槛为 480 分钟。
- 每 1440 分钟恢复 8 点疲劳，按实际推进分钟数向下取整。
- 补给数值必须至少为 40。
- 只处理活跃、具有作战账本、玩家实际控制、地点明确且 `activityTempo=resting` 的部队。
- 移动状态仅允许 `none`、`arrived` 或 `cancelled`；本回合参战部队明确排除。
- 恢复同时更新精确值 `warFatiguePercent` 和显示档位 `fatigue`。
- 情报级部队、生命周期未知、非玩家控制、行军/执勤/训练/战斗、补给不足及旧档缺少结构化节奏时均不推断恢复。

主要推定模块：

- 新的确定性疲劳恢复模块
- 部队类型定义、迁移、命令校验与 reducer
- `src/engine/turn/PromptComposer.ts`
- `src/engine/turn/TurnOrchestrator.ts`

### v1.7.28：记忆检索轨迹

确定恢复的轨迹合同：

- 检索状态为 `vector | localFallback | failedFallback`。
- 轨迹记录 `totalHitCount`、`vectorHitCount`、`localHitCount`。
- 服务未失败时额外记录 `candidateCount`、`indexDeltaCount`、`indexEmbeddedCount`。
- 检索阶段只显示真实的向量输入 token，不显示没有意义的输出 0 token。
- UI 区分“向量召回”“本地召回”“本地回退”，并显示总命中、分类命中、候选数、索引新增/更新或索引无更新。

主要推定模块：

- `src/engine/turn/turnProcessingAttempt.ts`
- `src/engine/turn/TurnOrchestrator.ts`
- `src/ui/TurnProcessingTrace.tsx`

### v1.7.29：叙事提示词优化

确定恢复的行为：

- 亲密场景从已成立的姿势、距离、衣物、接触、情绪与关系状态继续，不重置现场。
- 默认一回合只推进一个有意义阶段；只有玩家明确要求加速/完成/进入某阶段，或剧情已经处于该阶段时才加快。
- 每次升级采用“动作或试探—对方可观察回应—据此调整—形成身体、情绪、边界或关系后果”的连续结构。
- 感官描写只服务当前动作，不做重复检查表；回合结束保留当前阶段余波，不擅自替整个场景收尾。

主要推定模块：

- `src/engine/turn/PromptContentTemplates.ts`

### v1.8.0：AVG 演出与安全写回恢复

这是跨度最大的版本，发布包中出现了一整套 `main` 不存在的子系统。

确定恢复的 AVG 合同：

- 正文显示模式存储键为 `coc_v2_narrative_presentation`，值为 `auto | classic | avg`，默认 `auto`。
- 主角立绘模式存储键为 `coc_v2_avg_player_portrait_mode`，值为 `hidden | show`，默认 `hidden`。
- 演出数据包含稳定说话人绑定、分帧、说话人、场景锚点、资源状态、回退原因和播放进度。
- 说话人事实以最终展示分段的 `segmentIndex` 为索引，包含 `speakerActorId`、`speakerLabel`、`identitySource`、`sex`，以及可选年龄段、职业/角色族与社会层级标签。
- `identitySource` 接受 `player | full_npc | known_actor | presentation_only`；仅展示身份不进入人物志或世界事实。
- 已知人物保持稳定 actor ID；未知、冲突、群体、广播和匿名说话人使用中性剪影，不从姓名或台词猜身份。
- 场景优先精确结构化场景，其次精确地点，再使用受控空间原型；歧义或无证据时回退。
- 三国 AVG 清单 ID 为 `avg:threeKingdoms:accepted-resources:portrait-922-scene-200:2026-08-24`，包含 319 组具名人物、603 组一般人物和 200 个场景，共 1122 项视觉资源元数据；运行时对每项资源的路径、类型、尺寸、字节数、SHA-256、集合和变体逐项比对内置信任注册表。
- 具名人物依据结构化 actor 与接受注册表标签精确匹配；一般人物按性别和结构化角色特征在合法集合内稳定选择。场景先匹配 runtime scene/place ID，再使用唯一受接受别名；冲突时不猜测。

确定恢复的本地视觉数据行为：

- 新增独立 IndexedDB 仓库，按视觉分区保存人物覆盖、场景覆盖、自定义造型、当前造型选择、造型专属图和图片 blob；舞台优先显示已选造型，并可在演出中创建、选用、换图、删除或恢复基础立绘。
- 外置美术包的大体积二进制资源优先写入 OPFS，不可用时回退 IndexedDB；临时命名空间全部验证通过后才原子更新元数据和当前选择。
- 本地图片按摘要、尺寸、媒体类型和归属校验；资源缺失、损坏、跨分区引用和重复记录均拒绝。
- 存档 ZIP 新增 `avg-visuals/` 分区归档和清单摘要，导入前完整预检，成功后原子替换；旧格式导入不删除现有视觉资源。
- 删除单个存档时只清理不再被其他存档或当前会话引用的视觉分区；清空全部存档会同时清除所有本地 AVG 图片和自定义造型。
- 图片生成档案与 API Key 分别保存在独立 IndexedDB 表中；档案列表、存档和视觉 ZIP 都不回显或携带完整密钥。兼容端点固定为 `<Base URL>/images/generations`，只允许 HTTPS（`localhost`/`127.0.0.1` 调试可用 HTTP）。
- AI 图片只在玩家明确点击“生成候选图”后请求；响应仅接受受限 base64 或经过逐跳校验的安全 URL，下载和解码上限 32 MiB，并再次校验 PNG/JPEG/WebP 魔数、尺寸与摘要。完成后先独立预览，只有“应用此图”才写入本地视觉仓库。
- 人物候选提示词由结构化身份、年龄、职业和公开外观组成；未成年或年龄未知时提示词和补充要求均锁定为中性、非性化、合宜服装版本，明确成年人也始终附加完整服装与禁止露骨内容的不可编辑护栏。场景候选始终限制为无人物背景。
- 桌面沉浸入口提供“页面沉浸 / 浏览器全屏”选择；全屏不支持或被拒绝时仍保留页面沉浸。沉浸状态下左右边缘可悬停打开、点击固定人物与功能侧栏，Esc 先关闭侧栏、再次退出沉浸。
- AVG 只有在外置包和当前所需画面均安全就绪时替换原正文；资源读取、图片缺失或校验失败期间完整保留原正文。生成回合则使用独立准备舞台，并对阶段文本中的凭据片段脱敏。

确定恢复的安全写回行为：

- 状态写回从“整批失败”改为依赖域隔离，域包括移动、本地情势、资源装备、军事、势力动作、NPC 关系、人物身份、领地、私产工程、绝艺、NPC 记忆、NPC 在场/后台活动和其他状态。
- 同域或同实体依赖存在非法补丁时原子隔离该域，其余合法域仍提交。
- 失败回合保存 `stateWritebackRecovery` 恢复胶囊；恢复协议使用 `state-writeback-recovery:v2` 和完整性摘要。
- 恢复必须匹配原始已提交回合、世界状态头和槽位身份/顺序；不重写正文、不推进时间，不允许新增、删除、合并或重排原槽位。
- 恢复状态包括 `ready | applied | already_applied | stale_lineage | corrupt_evidence | legacy_unavailable`。
- 界面仅在证据完整且谱系未变时提供“重新整理本回合写回”；最多两次有界 API 修复，预览确认后才原子保存。遭遇投影和记忆维护等提交前后处理完成后，恢复证据才绑定实际将持久化的状态头。

主要推定模块：

- `src/ui/GameScreen.tsx`
- `src/ui/NarrativeTextView.tsx`
- `src/ui/TurnProcessingTrace.tsx`
- `src/engine/settings/DisplaySettings.ts`
- `src/ui/StartScreen.tsx`
- `src/ui/ApiSettingsPanel.tsx`
- `src/engine/turn/PromptComposer.ts`
- `src/engine/turn/TurnOrchestrator.ts`
- `src/engine/turn/NarratorResponseParser.ts`
- `src/engine/save/SaveManager.ts`
- `src/engine/save/SaveArchiveZip.ts`
- `src/engine/state/RuntimeStateMigration.ts`
- 新的 AVG 合同、绑定、场景解析、资源清单、资源包、视觉覆盖仓库和演出模型模块
- 主界面及游戏界面 CSS

### v1.8.1：AVG 美术包下载入口

确定恢复的行为：

- 官方下载地址：`https://pan.quark.cn/s/8f2ec2b76069`。
- 链接在新标签打开，并使用 `noopener noreferrer` 与 `no-referrer`。
- UI 明确说明应用不自动下载；下载 ZIP 后由用户本地导入，浏览器完整校验且不上传。
- 包说明为 319 组具名人物、603 组一般人物、200 个场景，约 345 MiB。

### v1.8.2：功能 API 合并与诊断

确定恢复的数据合同：

- 新存储键 `coc_v2_api_feature_execution_modes`，导出字段名 `featureExecutionModes`。
- 五个功能均可选择 `bundledMain | dedicated`：
  - `stateWriteback`
  - `npcCompletion`
  - `npcSimulation`
  - `worldEvolution`
  - `memorySummary`
- 默认全部为 `bundledMain`；旧配置中已有独立路由的功能迁移为 `dedicated`。
- 同轮封装协议版本为 `coc.v2.bundledMain.v1`，提示字符预算 32000，附属结果预算 4096 tokens。
- `npcSimulation` 必须原样返回 `expectedCount`、`frozenTargetIds`，并为每个目标恰好返回一行；重复、未知、缺失或数量不符即只隔离该模块。
- `worldEvolution` 只接受请求前冻结候选，写回后再次验证是否仍到期、仍不在前台。
- `memorySummary` 只处理请求前已经到期的冻结来源，本回合新达到阈值的内容延期。
- 任一附属模块缺失或非法时不触发第二次主请求、repair 或 fallback；正文及其他合法模块继续提交。

主要推定模块：

- `src/engine/settings/ApiConfigManager.ts`
- `src/ui/ApiSettingsPanel.tsx`
- `src/engine/turn/NarratorResponseParser.ts`
- `src/engine/turn/TurnOrchestrator.ts`
- `src/engine/worldEvolution/RelationshipWorldEvolution.ts`
- NPC 模拟、记忆摘要和回合展示元数据模块

### v1.8.3：AVG 说话人绑定稳定性

确定恢复的行为：

- 已有结构化人物即使响应省略部分展示字段，也继续沿用稳定 actor 和立绘。
- 只有确实冲突、未知、歧义、已删除、群体、广播和匿名角色才回退中性显示。
- 必要时可进行一次批量展示身份补齐，但只能补 `presentationSpeakerFacts`；不得改正文、主写回、人物志、关系、位置、记忆或世界事实。
- 补齐目标按精确 `segmentIndex + speakerLabel` 冻结；证据不足必须省略，禁止按姓名、措辞或职业刻板印象推断。
- 合并模式 NPC 结果增加完整冻结骨架与提交前自检提示。

### v1.8.4：NPC 人物志与提示稳定性

确定恢复的行为：

- NPC 模拟诊断区分冻结集合缺失、数量不符、重复 ID、未知 ID、结构非法和协议版本陈旧。
- 本回合提示可由用户关闭；关闭只影响显示，不影响已提交正文、地图或合法状态，后续新回合同类问题仍会重新出现。
- NPC 建档引入“长期准入证据”边界：结构化准入已经确认但完整档案缺失时可进入有界补档；缺少明确证据、身份歧义或冲突者延期。
- 补档必须逐字复用冻结候选的 `npcId`、`name`、`persistenceReason` 和 `persistenceEvidence`，不得从正文自行推断或修改本轮未确认的既有人物。
- 合法人物志完成后，同回合已经合法的记忆、关系和在场信息可以继续采用。

主要推定模块：

- `src/engine/turn/TurnOrchestrator.ts`
- `src/engine/npc/NpcProfileCompliance.ts`
- NPC 模拟合同与诊断模块
- `src/ui/GameScreen.tsx`
- 回合通知文本模块

## 重建验收矩阵

下表把发布行为、可编辑实现和回归保护对应起来。它用于证明每项行为已接入运行路径；测试名称只列代表性入口，完整结果以全量测试为准。

| 版本 | 已接入的实现入口 | 代表性回归保护 |
| --- | --- | --- |
| v1.7.25 | `continuityMatterProjection.ts`、`selectPromptContext.ts`、部队军需命令/reducer | `continuityMatterProjection.test.ts`、`PromptComposer.test.ts` |
| v1.7.26 | `NpcRecentActivity.ts`、`RelationshipWorldEvolution.ts`、`NpcIntentSimulation.ts` | `NpcRecentActivity.test.ts`、`RelationshipWorldEvolution.test.ts`、`NpcIntentSimulation.test.ts` |
| v1.7.27 | `TroopFatigueRecovery.ts`、部队类型与回合提交路径 | `TroopFatigueRecovery.test.ts` |
| v1.7.28 | 回合检索轨迹与 `TurnProcessingTrace.tsx` | `TurnProcessingTrace.test.tsx`、`turnDisplay.test.ts` |
| v1.7.29 | `PromptContentTemplates.ts` 与提示注册表 | `PromptRegistry.test.ts`、`PromptComposer.test.ts` |
| v1.8.0 AVG | `AvgPresentationMaterializer.ts`、`AvgPlaybackPreflight.ts`、`AvgResourcePackManager.ts`、`AvgVisualOverrideRepository.ts`、`AvgVisualPartitionArchive.ts`、`AvgNarrativeStage.tsx` | 同名 AVG 单元测试、`AvgSpeakerBinding.test.ts`、`SaveArchiveZip.test.ts` |
| v1.8.0 写回 | `StateWritebackRecovery.ts`、`StateWritebackRecoveryService.ts`、`StateWritebackRecoveryPanel.tsx` | 三个同名测试入口、`TurnOrchestrator.llm.test.ts` |
| v1.8.1 | `AvgResourcePackSettings.tsx` 的下载、导入和本地校验说明 | `AvgResourcePackManager.test.ts` |
| v1.8.2 | `ApiConfigManager.ts`、`BundledMainProtocol.ts`、`TurnOrchestrator.ts` | `ApiConfigManager.test.ts`、`ApiConfigManager.indexedDb.test.ts`、`TurnOrchestrator.llm.test.ts` |
| v1.8.3 | `AvgSpeakerIdentity.ts`、`AvgSpeakerBinding.ts`、按回合冻结的展示元数据 | `AvgSpeakerIdentity.test.ts`、`AvgSpeakerBinding.test.ts`、`TurnOrchestrator.llm.test.ts` |
| v1.8.4 | NPC 冻结集合诊断、长期准入补档与 `GameScreen.tsx` 可关闭提示 | `NpcIntentSimulation.test.ts`、`GameScreen.turnCompletionMessage.test.ts`、`TurnOrchestrator.llm.test.ts` |

最终本地验收（2026-09-05）：`npm run lint` 通过；`npm test` 为 285 个测试文件通过、20 个按配置跳过，2912 项测试通过、65 项按配置跳过；`npm run build` 通过；`git diff --check` 通过。默认测试不请求真实付费 API。

## 推荐重建顺序

1. 先重建 v1.7.25–v1.7.29。这五版改动边界明确，可独立增加单元测试。
2. 定义 v1.8.0 的 AVG 类型合同、显示设置和稳定绑定算法，不先接 UI。
3. 重建本地视觉仓库、资源包校验和存档 ZIP 分区；用损坏包、重复路径、越界路径和原子回滚测试保护数据。
4. 重建状态写回依赖域隔离与恢复胶囊；这是存档安全边界，必须先有失败矩阵测试再接回合流程。
5. 接入 AVG 舞台、造型管理和设置界面。
6. 最后接入 v1.8.2 的功能合并协议，再叠加 v1.8.3/1.8.4 的身份与 NPC 合规修复。

## 验证标准

- `package.json`、`APP_VERSION`、README 和更新日志必须一致后才能宣称源码为 `1.8.4`。
- 新增迁移必须能读取现有 v1.7.24 存档，且旧档缺少新字段时采取保守默认值。
- 每个确定性恢复规则需验证重复执行幂等。
- 状态写回隔离需验证非法域不会污染合法域，且恢复不会改变正文、时间和槽位顺序。
- 合并 API 模式需验证正常主回合只有一次生成请求，单模块失败不回滚其他结果。
- AVG 未安装资源包、资源缺失、人物歧义、场景歧义和减少动态效果模式均需有可见回退。

## 辅助脚本

`scripts/reverse-deploy-diff.mjs` 用于比较旧、新构建中的字符串字面量，并借旧版 source map 推定新版新增片段所属源码文件。它只用于生成逆向证据，不参与应用运行时。

`scripts/extract-three-kingdoms-avg-registry.mjs` 从已检出的 `v1.8.4` 发布产物机械提取已接受的人物/场景匹配元数据和 1122 项完整性声明，生成运行时信任注册表；它不会执行发布包主程序。
