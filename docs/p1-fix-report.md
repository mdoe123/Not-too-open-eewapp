# P1 安全审查修复报告

本报告记录基于循环式安全审查后，针对 P1 级问题进行的修复内容。P0 修复见 [p0-fix-report.md](./p0-fix-report.md)。

## 修复清单

### 批次 1：Kotlin 原生层 P1

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P1-4 | FloatingWindowModule 无生命周期清理，窗口泄漏 | floatingwindow/FloatingWindowModule.kt | 覆写 invalidate() 调用 removeFloatingView() |
| P1-5 | 边缘吸附动画与拖动冲突，造成抖动 | FloatingWindowModule.kt | snapAnimator 保存为成员变量，ACTION_DOWN 时 cancel |
| P1-7 | BootReceiver 重复触发 startForegroundService | autostart/BootStarterService.kt | AtomicBoolean 启动幂等标志 |
| P1-8 | FullScreenAlertActivity 未声明 configChanges，报警中断闪屏 | AndroidManifest.xml | 添加 configChanges="orientation\|screenSize\|keyboardHidden\|uiMode\|density" |
| P1-9 | usesCleartextTraffic 占位符未定义，可能允许 HTTP 明文流量 | build.gradle | manifestPlaceholders 显式定义：release=false，debug=true |
| P2-5 | showOnLockScreen 无效属性 | AndroidManifest.xml | 移除该属性 |

### 批次 2：useFloatingWindow 竞态重构

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P1-12 | 异步竞态，多个 interval 并行；无 mounted 守卫 | hooks/useFloatingWindow.ts | 引入自增 requestIdRef + mountedRef，.then 回调校验 |
| P1-13 | FloatingWindowManager.show() 未捕获 rejection | useFloatingWindow.ts | show().catch 回退 isVisibleRef=false |
| P1-20 | isVisibleRef 在 show resolve 前为 false，interval 提前调用 updateContent | useFloatingWindow.ts | interval 启动移入 show().then() 内 |

### 批次 3：useConfig 写入序列化 + SliderRow debounce

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P1-18 | useConfig 写入竞态，多次 setItem 顺序不可控 | hooks/useConfig.ts | 移除 updater 内副作用，改用 useEffect 监听 config 变化 debounce 300ms 写入 |
| P1-16 | SliderRow 拖动时每帧写入 AsyncStorage | components/settings/SliderRow.tsx、ThresholdSection.tsx | 内部维护本地显示值，onSlidingComplete 才提交配置 |
| P2-5 | useConfig persist 与 updateAlert/updateSources 逻辑重复 | useConfig.ts | 统一通过 useEffect 持久化，updateAlert/updateSources 仅 setConfig |

### 批次 4：UI 性能优化

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P1-14 | EewCard 每张卡片独立 setInterval，N 张卡片 = N 定时器 | components/EewCard.tsx | arrived 后停止定时器 |
| P1-15 | EewCard 每秒重复计算 Haversine 距离，无 memoization | EewCard.tsx | useMemo 缓存 distance/intensity/sWaveArrival/alertLevel |
| P1-19 | EpicenterMap 每标记 3 个 Animated.loop，N 事件 = 3N 动画 | components/EpicenterMap.tsx | 限制可见标记数（MAX_MARKERS=5） |
| P2-1 | EpicenterMap 硬编码颜色未走主题 | EpicenterMap.tsx | 使用 colors.critical + colors.background |

### 批次 5：权限刷新 + 备用源恢复

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P1-17 | usePermissions 无 focus 刷新，从系统设置返回后状态过期 | screens/onboarding/OnboardingScreen.tsx | useFocusEffect 在屏幕重新聚焦时调用 refreshStatus |
| P1-2 | 备用源耗尽后无恢复机制，系统永久无源可用 | sources/SourceManager.ts | 新增 failedSources 队列，每 10 次心跳退避重试最早失败的源 |

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
