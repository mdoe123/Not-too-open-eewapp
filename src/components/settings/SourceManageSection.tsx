// 数据源管理分组
// 列出所有数据源：名称 + 启用开关 + 优先级调整 + 自定义源的编辑/删除/分享
//
// 数据源按 category 分为两组显示：
// - 预警数据源（eew）：customSource(category=eew)
// - 速报数据源（eqlist）：customSource(category=eqlist)
//
// 每组内按 priority 升序排列，优先级调整按钮仅在同组内生效（不跨组调整）。
// 自定义源（customSource）额外显示编辑/删除/分享按钮；
// 顶部标题栏右侧有"添加"和"导入"按钮。
import React, {memo, useState, useCallback} from 'react';
import {Pressable, StyleSheet, Switch, Text, View, Alert} from 'react-native';
import {SourceConfig, SourceType, SourceCategory} from '../../types';
import {AppColors} from '../../theme/colors';
import {
  ServerIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PlusIcon,
  ImportIcon,
  EditIcon,
  TrashIcon,
  ShareIcon,
} from '../icons/SettingsIcons';
import {SliderRow} from './SliderRow';
import {CustomSourceEditor} from './CustomSourceEditor';
import {ImportSourceModal} from './ImportSourceModal';
import {ExportSourceModal} from './ExportSourceModal';

export interface SourceManageSectionProps {
  /** 数据源列表 */
  sources: SourceConfig[];
  /** 替换数据源列表 */
  updateSources: (sources: SourceConfig[]) => void;
  /** 配色 */
  colors: AppColors;
}

/**
 * 数据源显示名称
 *
 * 合规改造（v13+）：仅保留 customSource 和 simulated 两种类型。
 * customSource 类型使用用户配置的 name 字段显示，不在此映射中。
 */
const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  // 自定义数据源（使用用户配置的 name 显示，此处仅为类型完整性）
  customSource: '自定义数据源',
  // 模拟事件标识（非数据源配置项，仅为类型完整性）
  simulated: '模拟预警',
};

/** 分组标题配置 */
const GROUP_TITLES: Record<SourceCategory, string> = {
  eew: '预警数据源',
  eqlist: '速报数据源',
};

/** 分组顺序 */
const GROUP_ORDER: SourceCategory[] = ['eew', 'eqlist'];

/** 自定义源起始 priority（避开 wolfx 源的 1-15 区间） */
const CUSTOM_SOURCE_START_PRIORITY = 100;

/**
 * 获取数据源的 category（带兜底）
 *
 * 兼容旧版本配置（无 category 字段）：类型名含 'Eqlist' 归为 eqlist，否则 eew。
 */
function getCategory(s: SourceConfig): SourceCategory {
  return s.category ?? (s.type.includes('Eqlist') ? 'eqlist' : 'eew');
}

/** 判断是否为 GET 轮询数据源（type 名含 'Get' 或 customSource + http 协议），WS 源无需轮询间隔设置 */
function isGetSource(s: SourceConfig): boolean {
  if (s.type === 'customSource') {
    return s.protocol === 'http';
  }
  return s.type.includes('Get');
}

/** 判断是否为自定义源 */
function isCustomSource(s: SourceConfig): boolean {
  return s.type === 'customSource';
}

/** 获取数据源显示名称（customSource 用用户配置的 name，其他用 SOURCE_TYPE_LABEL） */
function getSourceName(s: SourceConfig): string {
  if (isCustomSource(s)) {
    return s.name || '未命名自定义源';
  }
  return SOURCE_TYPE_LABEL[s.type];
}

/**
 * 为新自定义源分配 priority
 * 策略：取当前所有源 priority 最大值 +1，最小为 CUSTOM_SOURCE_START_PRIORITY
 */
function nextPriority(sources: SourceConfig[]): number {
  if (sources.length === 0) {
    return CUSTOM_SOURCE_START_PRIORITY;
  }
  const max = Math.max(...sources.map(s => s.priority));
  return Math.max(max + 1, CUSTOM_SOURCE_START_PRIORITY);
}

/** 数据源管理分组 */
// React.memo：父组件（SettingsScreen）拖动滑块等操作触发重渲染时，
// 仅当 sources/updateSources/colors 变化才重渲染本分组
export const SourceManageSection = memo(function SourceManageSection({
  sources,
  updateSources,
  colors,
}: SourceManageSectionProps) {
  // Modal 状态
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceConfig | undefined>(undefined);
  const [importVisible, setImportVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [exportingSources, setExportingSources] = useState<SourceConfig[]>([]);

  /** 更新单个源的启用状态 */
  const setEnabled = (s: SourceConfig, enabled: boolean) => {
    updateSources(
      sources.map(item => (item === s ? {...item, enabled} : item)),
    );
  };

  /** 更新单个 GET 源的轮询间隔（毫秒） */
  const setPollInterval = (s: SourceConfig, intervalMs: number) => {
    updateSources(
      sources.map(item => (item === s ? {...item, pollIntervalMs: intervalMs} : item)),
    );
  };

  /** 打开添加源编辑器 */
  const handleAdd = () => {
    setEditingSource(undefined);
    setEditorVisible(true);
  };

  /** 打开编辑源编辑器 */
  const handleEdit = (s: SourceConfig) => {
    setEditingSource(s);
    setEditorVisible(true);
  };

  /** 保存源（添加或更新） */
  const handleSave = (source: SourceConfig) => {
    if (editingSource) {
      // 编辑模式：替换同 priority 的源
      updateSources(
        sources.map(s => (s.priority === editingSource.priority ? source : s)),
      );
    } else {
      // 添加模式：分配新 priority
      const newSource = {...source, priority: nextPriority(sources)};
      updateSources([...sources, newSource]);
    }
    setEditorVisible(false);
    setEditingSource(undefined);
  };

  /** 删除源（Alert 二次确认） */
  const handleDelete = (s: SourceConfig) => {
    Alert.alert(
      '删除数据源',
      `确定要删除"${getSourceName(s)}"吗？此操作不可撤销。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            updateSources(sources.filter(item => item !== s));
          },
        },
      ],
      {cancelable: true},
    );
  };

  /** 打开导出 Modal */
  const handleExport = (s: SourceConfig) => {
    setExportingSources([s]);
    setExportVisible(true);
  };

  /** 导入合并后的源列表 */
  const handleImport = (merged: SourceConfig[]) => {
    updateSources(merged);
    setImportVisible(false);
  };

  /**
   * 在指定分组内上调优先级（与组内上一个交换 priority）
   */
  const moveUp = (category: SourceCategory, index: number) => {
    if (index <= 0) {
      return;
    }
    const groupSorted = getGroupSorted(sources, category);
    if (index >= groupSorted.length) {
      return;
    }
    const arr = groupSorted.map(s => ({...s}));
    const cur = arr[index];
    const prev = arr[index - 1];
    const tmp = cur.priority;
    cur.priority = prev.priority;
    prev.priority = tmp;
    // 用对象引用回写（不依赖 type，customSource 也用对象引用）
    const priorityMap = new Map<SourceConfig, number>();
    arr.forEach(s => priorityMap.set(s, s.priority));
    updateSources(
      sources.map(s => {
        const newPriority = priorityMap.get(s);
        return newPriority !== undefined ? {...s, priority: newPriority} : s;
      }),
    );
  };

  /**
   * 在指定分组内下调优先级（与组内下一个交换 priority）
   */
  const moveDown = (category: SourceCategory, index: number) => {
    const groupSorted = getGroupSorted(sources, category);
    if (index >= groupSorted.length - 1) {
      return;
    }
    const arr = groupSorted.map(s => ({...s}));
    const cur = arr[index];
    const next = arr[index + 1];
    const tmp = cur.priority;
    cur.priority = next.priority;
    next.priority = tmp;
    const priorityMap = new Map<SourceConfig, number>();
    arr.forEach(s => priorityMap.set(s, s.priority));
    updateSources(
      sources.map(s => {
        const newPriority = priorityMap.get(s);
        return newPriority !== undefined ? {...s, priority: newPriority} : s;
      }),
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionHint, {color: colors.textSecondary}]}>
        启用数据源并调整优先级，数字越小越优先。主源故障时按优先级切换备源。优先级调整仅在同组内生效
      </Text>

      {/* 顶部操作按钮栏 */}
      <View style={[styles.toolbar, {borderBottomColor: colors.border}]}>
        <Pressable
          onPress={handleAdd}
          style={({pressed}) => [
            styles.toolbarBtn,
            {backgroundColor: pressed ? colors.surface : 'transparent'},
          ]}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
          accessibilityRole="button"
          accessibilityLabel="添加自定义源">
          <PlusIcon size={20} color={colors.text} />
          <Text style={[styles.toolbarBtnText, {color: colors.text}]}>添加</Text>
        </Pressable>
        <View style={styles.toolbarDivider} />
        <Pressable
          onPress={() => setImportVisible(true)}
          style={({pressed}) => [
            styles.toolbarBtn,
            {backgroundColor: pressed ? colors.surface : 'transparent'},
          ]}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
          accessibilityRole="button"
          accessibilityLabel="导入数据源">
          <ImportIcon size={20} color={colors.text} />
          <Text style={[styles.toolbarBtnText, {color: colors.text}]}>导入</Text>
        </Pressable>
      </View>

      {GROUP_ORDER.map(category => {
        const groupSorted = getGroupSorted(sources, category);
        if (groupSorted.length === 0) {
          return null;
        }
        return (
          <View key={category}>
            <View style={[styles.groupHeader, {borderBottomColor: colors.border}]}>
              <Text style={[styles.groupTitle, {color: colors.text}]}>
                {GROUP_TITLES[category]}
              </Text>
              <Text style={[styles.groupCount, {color: colors.textSecondary}]}>
                {groupSorted.length} 个
              </Text>
            </View>
            {groupSorted.map((s, index) => (
              <View key={`${s.type}-${s.priority}`}>
                <View style={[styles.sourceRow, {borderBottomColor: colors.border}]}>
                  <View style={styles.sourceLeft}>
                    <ServerIcon size={22} color={colors.text} />
                    <View style={styles.sourceMeta}>
                      <Text style={[styles.sourceName, {color: colors.text}]} numberOfLines={2}>
                        {getSourceName(s)}
                      </Text>
                      <Text style={[styles.priorityText, {color: colors.textSecondary}]}>
                        优先级 {s.priority}
                        {isCustomSource(s) && s.note ? ` · ${s.note}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.sourceRight}>
                    {/* 优先级调整按钮组 */}
                    <View style={styles.priorityBtns}>
                      <PriorityButton
                        disabled={index === 0}
                        onPress={() => moveUp(category, index)}
                        colors={colors}
                        accessibilityLabel="上调优先级">
                        <ChevronUpIcon size={22} color={index === 0 ? colors.silent : colors.text} />
                      </PriorityButton>
                      <PriorityButton
                        disabled={index === groupSorted.length - 1}
                        onPress={() => moveDown(category, index)}
                        colors={colors}
                        accessibilityLabel="下调优先级">
                        <ChevronDownIcon
                          size={22}
                          color={index === groupSorted.length - 1 ? colors.silent : colors.text}
                        />
                      </PriorityButton>
                    </View>

                    {/* 分隔符（功能组之间） */}
                    {isCustomSource(s) && <View style={[styles.divider, {backgroundColor: colors.border}]} />}

                    {/* 自定义源操作按钮组 */}
                    {isCustomSource(s) && (
                      <View style={styles.customBtns}>
                        <PriorityButton
                          onPress={() => handleEdit(s)}
                          colors={colors}
                          accessibilityLabel="编辑数据源">
                          <EditIcon size={20} color={colors.text} />
                        </PriorityButton>
                        <PriorityButton
                          onPress={() => handleExport(s)}
                          colors={colors}
                          accessibilityLabel="分享数据源">
                          <ShareIcon size={20} color={colors.text} />
                        </PriorityButton>
                        <PriorityButton
                          onPress={() => handleDelete(s)}
                          colors={colors}
                          accessibilityLabel="删除数据源">
                          <TrashIcon size={20} color={colors.error} />
                        </PriorityButton>
                      </View>
                    )}

                    {/* 启用开关 */}
                    <SwitchInline
                      value={s.enabled}
                      onValueChange={v => setEnabled(s, v)}
                      colors={colors}
                    />
                  </View>
                </View>
                {isGetSource(s) && (
                  <PollIntervalRow
                    pollIntervalMs={s.pollIntervalMs ?? 2000}
                    colors={colors}
                    onSlidingComplete={ms => setPollInterval(s, ms)}
                  />
                )}
              </View>
            ))}
          </View>
        );
      })}

      {/* 空状态提示 */}
      {sources.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, {color: colors.textSecondary}]}>
            暂无数据源。点击上方"添加"按钮配置自定义源，或"导入"从分享的 JSON 导入。
          </Text>
        </View>
      )}

      {/* 自定义源编辑器 Modal */}
      <CustomSourceEditor
        visible={editorVisible}
        initialSource={editingSource}
        onSave={handleSave}
        onClose={() => {
          setEditorVisible(false);
          setEditingSource(undefined);
        }}
        colors={colors}
      />

      {/* 导入源 Modal */}
      <ImportSourceModal
        visible={importVisible}
        existingSources={sources}
        onImport={handleImport}
        onClose={() => setImportVisible(false)}
        colors={colors}
      />

      {/* 导出源 Modal */}
      <ExportSourceModal
        visible={exportVisible}
        sources={exportingSources}
        onClose={() => {
          setExportVisible(false);
          setExportingSources([]);
        }}
        colors={colors}
      />
    </View>
  );
});

/**
 * 获取指定分组内按 priority 升序排列的数据源列表
 */
function getGroupSorted(sources: SourceConfig[], category: SourceCategory): SourceConfig[] {
  return sources
    .filter(s => getCategory(s) === category)
    .sort((a, b) => a.priority - b.priority);
}

/** 优先级调整按钮（大点击区，避免误触） */
function PriorityButton({
  children,
  onPress,
  disabled,
  colors,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  colors: AppColors;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
      style={({pressed}) => [
        styles.priorityBtn,
        {
          backgroundColor: pressed && !disabled ? colors.surface : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      {children}
    </Pressable>
  );
}

/** 内联开关（复用 RN Switch，封装颜色） */
function SwitchInline({
  value,
  onValueChange,
  colors,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: AppColors;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{false: colors.border, true: colors.text}}
      thumbColor={value ? colors.background : colors.surface}
      ios_backgroundColor={colors.border}
    />
  );
}

/** GET 源轮询间隔设置行（复用 SliderRow，毫秒 ↔ 秒转换） */
function PollIntervalRow({
  pollIntervalMs,
  colors,
  onSlidingComplete,
}: {
  pollIntervalMs: number;
  colors: AppColors;
  onSlidingComplete: (intervalMs: number) => void;
}) {
  // 毫秒转秒展示；onSlidingComplete 时转回毫秒提交
  const seconds = Math.max(2, Math.round(pollIntervalMs / 1000));
  return (
    <View style={styles.pollIntervalRow}>
      <SliderRow
        label="轮询间隔"
        value={seconds}
        minimum={2}
        maximum={60}
        step={1}
        unit="秒"
        onSlidingComplete={v => onSlidingComplete(Math.round(v) * 1000)}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    borderRadius: 6,
  },
  toolbarBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  toolbarDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  groupCount: {
    fontSize: 12,
    lineHeight: 16,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 72,
  },
  sourceLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  sourceMeta: {
    flex: 1,
    marginLeft: 10,
  },
  sourceName: {
    fontSize: 15,
    lineHeight: 21,
  },
  priorityText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  sourceRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  priorityBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: 4,
  },
  customBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  pollIntervalRow: {
    paddingLeft: 34,
    backgroundColor: 'transparent',
  },
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
