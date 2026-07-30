# P0 安全审查修复报告

本报告记录基于循环式安全审查后，针对 P0 级问题进行的修复内容。

> 核实状态说明：✅ 已修复 / ⚠️ 部分修复 / ❌ 未修复（含文件已重构/删除）

## 修复清单

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P0-1 | FullScreenAlertActivity.registerReceiver 未指定导出标志，Android 14 崩溃 | fullscreenalert/FullScreenAlertActivity.kt | API 33+ 使用 RECEIVER_NOT_EXPORTED 三参重载，API 26-32 走原两参重载（@Suppress 兼容） | ✅ 已修复（实际位于 EewBackgroundService.kt，FullScreenAlertActivity 已重命名为 LockScreenAlertActivity 且无 registerReceiver） |
| P0-2 | manifest 缺 FOREGROUND_SERVICE_DATA_SYNC 权限，startForeground 崩溃 | AndroidManifest.xml | 添加 `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />` | ✅ 已修复（AndroidManifest.xml:25） |
| P0-3 | SourceManager.handleFailure 中 activate 的 Promise 未捕获 | sources/SourceManager.ts | activate 内 try-catch 包裹 connect，失败时上报 error 并触发下一轮切换 | ✅ 已修复（SourceManager.ts:119-136） |
| P0-4 | SourceManager 切换逻辑并发竞态，多源同时激活 | sources/SourceManager.ts | 引入 isSwitching 标志位串行化切换；切换前先 disconnect 旧源；切换期间忽略旧源延迟回调 | ✅ 已修复（SourceManager.ts:35） |
| P0-5 | FloatingWindowModule.show 字段类型不匹配时主线程崩溃 | floatingwindow/FloatingWindowModule.kt | show 主入口加 try-catch；新增 safeGetDouble 工具函数，hasKey + isNull + try-catch 三重保护 | ✅ 已修复（FloatingWindowModule.kt:701 safeGetDouble + :129 show try-catch） |
| P0-6 | useMockEewStream.switchToBackup 闭包过期，事件 source 与显示源名不一致 | hooks/useMockEewStream.ts | activeSource 改为 useRef 存储，startEventInterval 内部读 ref；reconnect/switchToBackup timer 存入 ref，卸载时统一清理 | ❌ 未修复（useMockEewStream.ts 已删除，被 useEewStream.ts 取代；替代实现用 useState 而非 useRef，架构已重构为多源并行） |
| P0-7 | useLockScreenAlert.triggerAlert 忽略调用方 level，近场强破坏性地震不触发 | hooks/useLockScreenAlert.ts | triggerAlert 增加可选 level 参数，调用方传入综合计算的 level；未传则降级用 computeAlertLevel（向后兼容） | ❌ 未修复（useLockScreenAlert.ts 已删除，锁屏预警改由原生 EewBackgroundService + LockScreenAlertActivity 实现） |
| P0-8 | useLockScreenAlert 无事件去重，同一事件重复触发全屏报警 | hooks/useLockScreenAlert.ts | 内部维护 triggeredEventIdsRef: Set<string>，同一 event.id 只触发一次；新增 resetTriggered 方法清理记录 | ❌ 未修复（useLockScreenAlert.ts 已删除；事件去重逻辑已迁移至原生 EewBackgroundService 层） |
| P0-9 | 核心预警联动 Hook 全部未集成 | screens/HomeScreen.tsx、screens/SettingsScreen.tsx | HomeScreen 集成 useFloatingWindow + useLockScreenAlert + useConfig；SettingsScreen 集成 useConfig + settings/ 四组组件（替换占位页） | ⚠️ 部分修复（HomeScreen 已集成 useFloatingWindow + useConfig；SettingsScreen 已集成 useConfig + 四组设置组件；但 useLockScreenAlert 已删除，锁屏预警由原生服务承担） |
| P0-10 | SourceManageSection 直接变异源对象，违反不可变性 | components/settings/SourceManageSection.tsx | moveUp/moveDown 内 `sorted.map(s => ({...s}))` 深拷贝后再交换 priority | ✅ 已修复（SourceManageSection.tsx:205,230） |
| P0-11 | apiKey 明文存储于 AsyncStorage | hooks/useConfig.ts | 新增 stripApiKeys 函数，所有持久化前剥离 sources 中的 apiKey 字段，仅运行时内存持有 | ✅ 已修复（useConfig.ts:36-47） |

## 顺手修复的相关问题

| 编号 | 问题 | 修复方式 | 核实状态 |
|------|------|---------|---------|
| P1-1 | SourceManager.start 主源用 `!` 非空断言 | 改为存在性校验，缺失时上报 error 并 return | ✅ 已修复（SourceManager.ts:79-85） |
| P1-3 | SourceManager.stop 不清理引用 | stop 清空 activeSource/backupQueue/adapters，新增 isStopped 标志 | ✅ 已修复（SourceManager.ts:213-230） |
| P1-10 | threshold=0 边界语义不明 | 构造函数 `Math.max(1, threshold)` 下限校验 | ✅ 已修复（SourceManager.ts:43） |
| P1-11 | useMockEewStream.reconnect/switchToBackup 返回的清理函数被丢弃 | timer 存入 ref，主 useEffect 清理时统一清除 | ❌ 未修复（useMockEewStream.ts 已删除，架构已重构） |
| P2-7 | HomeScreen 内联 render 函数未 useCallback | renderCard/renderItemSeparator/renderEmpty 用 useCallback 包裹 | ✅ 已修复（HomeScreen.tsx:199,227,229） |

## 未在本次修复范围（待后续处理）

- **P1 级**：useFloatingWindow 竞态（P1-12/13/20）、EewCard 性能（P1-14/15）、SliderRow 持久化 debounce（P1-16）、usePermissions focus 刷新（P1-17）、useConfig 写入序列化（P1-18）等
- **P2 级**：硬编码颜色、colors.ts 语义色扩展、配置版本迁移、JSON.parse schema 校验等
- **Task 4 后台服务**：当前 P0-9 集成仅前台工作，App 在后台时预警联动不触发。Task 4 实现后需将 useFloatingWindow/useLockScreenAlert 迁移到后台服务

## 验证结果

- `npx tsc --noEmit`：exit 0，无错误
- `npx jest smoke`：17/17 通过
- `npx jest`（全量）：smoke.test.ts 通过；App.test.tsx 失败（预先存在的 RN 测试环境配置问题，与本次修复无关）

## 待定疑问的处理决策

1. **P0-9 集成入口位置**：当前集成到 HomeScreen（前台工作），Task 4 实现后台服务时迁移。已加注释说明。
2. **P0-7 level 语义**：采用"综合 level"方案，调用方传入基于震级+距离+烈度计算的 level。当前 mock 流用 computeAlertLevel 降级，Task 4 补全真实计算。
3. **P0-11 apiKey 必要性**：保留 SourceConfig.apiKey 字段（未来鉴权数据源可能需要），但持久化时剥离，仅运行时内存持有。
4. **P1-6 前台服务类型**：dataSync 在 Android 14 受时长限制，留待 Task 4 重新选型。
