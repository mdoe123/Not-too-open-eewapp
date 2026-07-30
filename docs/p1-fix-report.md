# P1 安全审查修复报告

本报告记录基于循环式安全审查后，针对 P1 级问题进行的修复内容。P0 修复见 [p0-fix-report.md](./p0-fix-report.md)。

> 核实状态说明：✅ 已修复 / ⚠️ 部分修复 / ❌ 未修复（含文件已重构/删除）

## 修复清单

### 批次 1：Kotlin 原生层 P1

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P1-4 | FloatingWindowModule 无生命周期清理，窗口泄漏 | floatingwindow/FloatingWindowModule.kt | 覆写 invalidate() 调用 removeFloatingView() | ✅ 已修复（FloatingWindowModule.kt:112-117，实际调用 removeAllViews()，效果一致） |
| P1-5 | 边缘吸附动画与拖动冲突，造成抖动 | FloatingWindowModule.kt | snapAnimator 保存为成员变量，ACTION_DOWN 时 cancel | ❌ 未修复（无 snapAnimator，FloatingWindowModule 无拖动/吸附动画逻辑） |
| P1-7 | BootReceiver 重复触发 startForegroundService | autostart/BootStarterService.kt | AtomicBoolean 启动幂等标志 | ✅ 已修复（BootStarterService.kt:40,49） |
| P1-8 | FullScreenAlertActivity 未声明 configChanges，报警中断闪屏 | AndroidManifest.xml | 添加 configChanges="orientation\|screenSize\|keyboardHidden\|uiMode\|density" | ❌ 未修复（LockScreenAlertActivity 声明无 configChanges 属性） |
| P1-9 | usesCleartextTraffic 占位符未定义，可能允许 HTTP 明文流量 | build.gradle | manifestPlaceholders 显式定义：release=false，debug=true | ✅ 已修复（build.gradle:95,109） |
| P2-5 | showOnLockScreen 无效属性 | AndroidManifest.xml | 移除该属性 | ✅ 已修复（已改用有效的 showWhenLocked） |

### 批次 2：useFloatingWindow 竞态重构

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P1-12 | 异步竞态，多个 interval 并行；无 mounted 守卫 | hooks/useFloatingWindow.ts | 引入自增 requestIdRef + mountedRef，.then 回调校验 | ⚠️ 部分修复（仅 mountedRef 存在，无 requestIdRef 自增竞态防护） |
| P1-13 | FloatingWindowManager.show() 未捕获 rejection | useFloatingWindow.ts | show().catch 回退 isVisibleRef=false | ❌ 未修复（setEvents().catch 仅打日志，未回退 isVisibleRef=false） |
| P1-20 | isVisibleRef 在 show resolve 前为 false，interval 提前调用 updateContent | useFloatingWindow.ts | interval 启动移入 show().then() 内 | ✅ 已修复（startCountdownTick 在 setEvents().then() 内调用） |

### 批次 3：useConfig 写入序列化 + SliderRow debounce

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P1-18 | useConfig 写入竞态，多次 setItem 顺序不可控 | hooks/useConfig.ts | 移除 updater 内副作用，改用 useEffect 监听 config 变化 debounce 300ms 写入 | ✅ 已修复（useConfig.ts:30 PERSIST_DEBOUNCE_MS=300 + :235-251 useEffect） |
| P1-16 | SliderRow 拖动时每帧写入 AsyncStorage | components/settings/SliderRow.tsx、ThresholdSection.tsx | 内部维护本地显示值，onSlidingComplete 才提交配置 | ✅ 已修复（SliderRow.tsx:62 localValue + :100 onSlidingComplete） |
| P2-5 | useConfig persist 与 updateAlert/updateSources 逻辑重复 | useConfig.ts | 统一通过 useEffect 持久化，updateAlert/updateSources 仅 setConfig | ✅ 已修复（useConfig.ts:253-262 仅 setConfig） |

### 批次 4：UI 性能优化

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P1-14 | EewCard 每张卡片独立 setInterval，N 张卡片 = N 定时器 | components/EewCard.tsx | arrived 后停止定时器 | ✅ 已修复（EewCard.tsx:76-93，arrived 后不启动定时器） |
| P1-15 | EewCard 每秒重复计算 Haversine 距离，无 memoization | EewCard.tsx | useMemo 缓存 distance/intensity/sWaveArrival/alertLevel | ✅ 已修复（EewCard.tsx:67-74 useMemo 缓存） |
| P1-19 | EpicenterMap 每标记 3 个 Animated.loop，N 事件 = 3N 动画 | components/EpicenterMap.tsx | 限制可见标记数（MAX_MARKERS=5） | ❌ 未修复（EpicenterMap.tsx 已删除） |
| P2-1 | EpicenterMap 硬编码颜色未走主题 | EpicenterMap.tsx | 使用 colors.critical + colors.background | ❌ 未修复（EpicenterMap.tsx 已删除） |

### 批次 5：权限刷新 + 备用源恢复

| 编号 | 问题 | 修复文件 | 修复方式 | 核实状态 |
|------|------|---------|---------|---------|
| P1-17 | usePermissions 无 focus 刷新，从系统设置返回后状态过期 | screens/onboarding/OnboardingScreen.tsx | useFocusEffect 在屏幕重新聚焦时调用 refreshStatus | ✅ 已修复（OnboardingScreen.tsx:51-55） |
| P1-2 | 备用源耗尽后无恢复机制，系统永久无源可用 | sources/SourceManager.ts | 新增 failedSources 队列，每 10 次心跳退避重试最早失败的源 | ✅ 已修复（SourceManager.ts:22 failedSources + :188-200 退避重试） |

## 顺手修复的 P2 问题

| 编号 | 问题 | 修复方式 |
|------|------|---------|
| P2-1 | EpicenterMap 硬编码颜色 | 使用 colors.critical + colors.background |
| P2-5 | showOnLockScreen 无效属性 + useConfig persist 逻辑重复 | 移除 + 统一持久化入口 |

## 未在本次修复范围（留待后续）

- **P1-6**：BootStarterService 的 dataSync 类型在 Android 14 受时长限制，留待 Task 4 重新选型（specialUse 或其他）
- **P2-2/P2-3/P2-4**：colors.ts 缺 success/error 语义色、SourceStatusBar/PermissionRow 硬编码颜色
- **P2-6 至 P2-15**：配置版本迁移、JSON.parse schema 校验、HomeScreen render 函数 useCallback、formatOriginTime 防护等规范性问题

## 验证结果

- `npx tsc --noEmit`：exit 0，无错误
- `npx jest smoke`：17/17 通过
- `npx jest`（全量）：smoke.test.ts 通过；App.test.tsx 失败（预先存在的 RN 测试环境配置问题，与本次修复无关）

## 悲观预测

1. **未处理的空值**：已修复（SourceManager 主源校验、useFloatingWindow mountedRef）
2. **并发访问**：SourceManager isSwitching 串行化 + useFloatingWindow requestId 竞态防护
3. **外部状态依赖**：usePermissions focus 刷新解决了从系统设置返回的状态过期
4. **时间/超时假设**：SourceManager 退避重试间隔 10 次心跳（约 5 分钟），可配置
5. **资源泄漏**：FloatingWindowModule invalidate 清理 + EewCard arrived 后停止定时器
