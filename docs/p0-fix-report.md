# P0 安全审查修复报告

本报告记录基于循环式安全审查后，针对 P0 级问题进行的修复内容。

## 修复清单

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P0-1 | FullScreenAlertActivity.registerReceiver 未指定导出标志，Android 14 崩溃 | fullscreenalert/FullScreenAlertActivity.kt | API 33+ 使用 RECEIVER_NOT_EXPORTED 三参重载，API 26-32 走原两参重载（@Suppress 兼容） |
| P0-2 | manifest 缺 FOREGROUND_SERVICE_DATA_SYNC 权限，startForeground 崩溃 | AndroidManifest.xml | 添加 `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />` |
| P0-3 | SourceManager.handleFailure 中 activate 的 Promise 未捕获 | sources/SourceManager.ts | activate 内 try-catch 包裹 connect，失败时上报 error 并触发下一轮切换 |
| P0-4 | SourceManager 切换逻辑并发竞态，多源同时激活 | sources/SourceManager.ts | 引入 isSwitching 标志位串行化切换；切换前先 disconnect 旧源；切换期间忽略旧源延迟回调 |
| P0-5 | FloatingWindowModule.show 字段类型不匹配时主线程崩溃 | floatingwindow/FloatingWindowModule.kt | show 主入口加 try-catch；新增 safeGetDouble 工具函数，hasKey + isNull + try-catch 三重保护 |
| P0-6 | useMockEewStream.switchToBackup 闭包过期，事件 source 与显示源名不一致 | hooks/useMockEewStream.ts | activeSource 改为 useRef 存储，startEventInterval 内部读 ref；reconnect/switchToBackup timer 存入 ref，卸载时统一清理 |
| P0-7 | useLockScreenAlert.triggerAlert 忽略调用方 level，近场强破坏性地震不触发 | hooks/useLockScreenAlert.ts | triggerAlert 增加可选 level 参数，调用方传入综合计算的 level；未传则降级用 computeAlertLevel（向后兼容） |
| P0-8 | useLockScreenAlert 无事件去重，同一事件重复触发全屏报警 | hooks/useLockScreenAlert.ts | 内部维护 triggeredEventIdsRef: Set<string>，同一 event.id 只触发一次；新增 resetTriggered 方法清理记录 |
| P0-9 | 核心预警联动 Hook 全部未集成 | screens/HomeScreen.tsx、screens/SettingsScreen.tsx | HomeScreen 集成 useFloatingWindow + useLockScreenAlert + useConfig；SettingsScreen 集成 useConfig + settings/ 四组组件（替换占位页） |
| P0-10 | SourceManageSection 直接变异源对象，违反不可变性 | components/settings/SourceManageSection.tsx | moveUp/moveDown 内 `sorted.map(s => ({...s}))` 深拷贝后再交换 priority |
| P0-11 | apiKey 明文存储于 AsyncStorage | hooks/useConfig.ts | 新增 stripApiKeys 函数，所有持久化前剥离 sources 中的 apiKey 字段，仅运行时内存持有 |

## 顺手修复的相关问题

| 编号 | 问题 | 修复方式 |
|------|------|---------|
| P1-1 | SourceManager.start 主源用 `!` 非空断言 | 改为存在性校验，缺失时上报 error 并 return |
| P1-3 | SourceManager.stop 不清理引用 | stop 清空 activeSource/backupQueue/adapters，新增 isStopped 标志 |
| P1-10 | threshold=0 边界语义不明 | 构造函数 `Math.max(1, threshold)` 下限校验 |
| P1-11 | useMockEewStream.reconnect/switchToBackup 返回的清理函数被丢弃 | timer 存入 ref，主 useEffect 清理时统一清除 |
| P2-7 | HomeScreen 内联 render 函数未 useCallback | renderCard/renderItemSeparator/renderEmpty 用 useCallback 包裹 |

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
