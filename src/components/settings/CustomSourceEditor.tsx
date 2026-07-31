// 自定义源编辑器 Modal
//
// 提供添加/编辑 customSource 类型数据源的表单界面。
// 使用 RN 内置 Modal（不修改导航栈），从底部滑入全屏覆盖。
//
// 表单分三组：
// 1. 基本信息：名称、类别、备注
// 2. 连接：协议、URL、鉴权 token、HTTP 轮询间隔
// 3. 字段映射：listPath + 7 必填字段 + 3 可选字段（可折叠）
//
// 设计遵循用户偏好：
// - 黑白极简风格，支持 light/dark 主题（colors 注入）
// - 字段映射区域默认折叠，用眼睛图标展开/收起
// - authToken 密码框，眼睛图标显示/隐藏
// - 保存按钮居中全宽，位于显眼位置
// - 校验失败用红色边框 + 错误提示文字
import React, {memo, useEffect, useState} from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {SourceConfig} from '../../types/config';
import {SourceCategory} from '../../types/eew';
import {AppColors} from '../../theme/colors';
import {EyeOpenIcon, EyeClosedIcon} from '../icons/SettingsIcons';
import {SliderRow} from './SliderRow';
import {isValidEndpoint} from '../../sources/custom/sourceShare';

export interface CustomSourceEditorProps {
  /** 是否显示 */
  visible: boolean;
  /** 编辑模式传入现有源；添加模式不传 */
  initialSource?: SourceConfig;
  /** 保存回调 */
  onSave: (source: SourceConfig) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 配色 */
  colors: AppColors;
}

/** 表单状态（与 SourceConfig 字段对齐） */
interface FormState {
  name: string;
  note: string;
  category: SourceCategory;
  protocol: 'ws' | 'http';
  endpoint: string;
  authToken: string;
  pollIntervalMs: number;
  listPath: string;
  eventId: string;
  originTime: string;
  magnitude: string;
  depth: string;
  lat: string;
  lng: string;
  location: string;
  intensity: string;
  isFinal: string;
  isCancel: string;
  reportNum: string;
  reportType: string;
}

/** 默认表单值 */
const EMPTY_FORM: FormState = {
  name: '',
  note: '',
  category: 'eqlist',
  protocol: 'http',
  endpoint: '',
  authToken: '',
  pollIntervalMs: 30000,
  listPath: '',
  eventId: '',
  originTime: '',
  magnitude: '',
  depth: '',
  lat: '',
  lng: '',
  location: '',
  intensity: '',
  isFinal: '',
  isCancel: '',
  reportNum: '',
  reportType: '',
};

/** 从 SourceConfig 初始化表单 */
function sourceToForm(src?: SourceConfig): FormState {
  if (!src) {
    return {...EMPTY_FORM};
  }
  const fm = src.fieldMapping ?? ({} as Partial<FormState>);
  return {
    name: src.name ?? '',
    note: src.note ?? '',
    category: src.category ?? 'eqlist',
    protocol: src.protocol ?? 'http',
    endpoint: src.endpoint ?? '',
    authToken: src.authToken ?? '',
    pollIntervalMs: src.pollIntervalMs ?? 30000,
    listPath: fm.listPath ?? '',
    eventId: fm.eventId ?? '',
    originTime: fm.originTime ?? '',
    magnitude: fm.magnitude ?? '',
    depth: fm.depth ?? '',
    lat: fm.lat ?? '',
    lng: fm.lng ?? '',
    location: fm.location ?? '',
    intensity: fm.intensity ?? '',
    isFinal: fm.isFinal ?? '',
    isCancel: fm.isCancel ?? '',
    reportNum: fm.reportNum ?? '',
    reportType: fm.reportType ?? '',
  };
}

/** 校验表单，返回字段级错误 */
function validateForm(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) {
    errors.name = '名称必填';
  }
  if (!form.endpoint.trim()) {
    errors.endpoint = 'URL 必填';
  } else if (!isValidEndpoint(form.endpoint.trim())) {
    errors.endpoint = 'URL 必须以 http/https/ws/wss 开头';
  }
  if (!form.eventId.trim()) errors.eventId = '必填';
  if (!form.originTime.trim()) errors.originTime = '必填';
  if (!form.magnitude.trim()) errors.magnitude = '必填';
  if (!form.depth.trim()) errors.depth = '必填';
  if (!form.lat.trim()) errors.lat = '必填';
  if (!form.lng.trim()) errors.lng = '必填';
  if (!form.location.trim()) errors.location = '必填';
  // listPath 可选，但若提供必须非空
  if (form.listPath.trim() === '' && form.listPath.length > 0) {
    errors.listPath = '留空或填入有效路径';
  }
  return errors;
}

/** 表单状态转 SourceConfig */
function formToSource(form: FormState, priority: number): SourceConfig {
  const fieldMapping = {
    listPath: form.listPath.trim() || undefined,
    eventId: form.eventId.trim(),
    originTime: form.originTime.trim(),
    magnitude: form.magnitude.trim(),
    depth: form.depth.trim(),
    lat: form.lat.trim(),
    lng: form.lng.trim(),
    location: form.location.trim(),
    intensity: form.intensity.trim() || undefined,
    isFinal: form.isFinal.trim() || undefined,
    isCancel: form.isCancel.trim() || undefined,
    reportNum: form.reportNum.trim() || undefined,
    reportType: form.reportType.trim() || undefined,
  };
  return {
    type: 'customSource',
    name: form.name.trim(),
    enabled: true,
    priority,
    category: form.category,
    endpoint: form.endpoint.trim(),
    protocol: form.protocol,
    pollIntervalMs: form.protocol === 'http' ? form.pollIntervalMs : undefined,
    authToken: form.authToken.trim() || undefined,
    note: form.note.trim() || undefined,
    fieldMapping,
  };
}

/** 自定义源编辑器 */
export const CustomSourceEditor = memo(function CustomSourceEditor({
  visible,
  initialSource,
  onSave,
  onClose,
  colors,
}: CustomSourceEditorProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [showAuthToken, setShowAuthToken] = useState(false);
  // 保留初始 priority：编辑模式使用原 priority；添加模式使用 -1（父组件在 onSave 中赋实际值）
  const [initialPriority, setInitialPriority] = useState<number>(initialSource?.priority ?? -1);

  // visible 切换或 initialSource 变化时重置表单
  useEffect(() => {
    if (visible) {
      setForm(sourceToForm(initialSource));
      setErrors({});
      setShowMapping(!!initialSource?.fieldMapping);
      setShowAuthToken(false);
      setInitialPriority(initialSource?.priority ?? -1);
    }
  }, [visible, initialSource]);

  /** 更新单个字段 */
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({...prev, [key]: value}));
    // 清除该字段的错误
    if (errors[key]) {
      setErrors(prev => {
        const next = {...prev};
        delete next[key];
        return next;
      });
    }
  };

  /** 保存 */
  const handleSave = () => {
    const newErrors = validateForm(form);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // 自动展开字段映射区域（如果有错误）
      if (Object.keys(newErrors).some(k => k !== 'name' && k !== 'endpoint')) {
        setShowMapping(true);
      }
      return;
    }
    const source = formToSource(form, initialPriority);
    onSave(source);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent={false}>
      <KeyboardAvoidingView
        style={[styles.container, {backgroundColor: colors.background}]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled>
        {/* 顶部标题栏 */}
        <View style={[styles.header, {borderBottomColor: colors.border}]}>
          <Pressable onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.textSecondary}]}>取消</Text>
          </Pressable>
          <Text style={[styles.headerTitle, {color: colors.text}]}>
            {initialSource ? '编辑数据源' : '添加数据源'}
          </Text>
          <Pressable onPress={handleSave} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.text, fontWeight: '600'}]}>保存</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* ====== 基本信息 ====== */}
          <SectionTitle colors={colors}>基本信息</SectionTitle>

          <FieldRow
            label="名称"
            required
            value={form.name}
            onChangeText={v => update('name', v)}
            placeholder="如：USGS 地震速报"
            error={errors.name}
            colors={colors}
          />

          <SegmentRow
            label="类别"
            value={form.category}
            options={[
              {value: 'eqlist', label: '速报'},
              {value: 'eew', label: '预警'},
            ]}
            onChange={v => update('category', v as SourceCategory)}
            colors={colors}
          />

          <FieldRow
            label="备注"
            value={form.note}
            onChangeText={v => update('note', v)}
            placeholder="可选"
            colors={colors}
          />

          {/* ====== 连接 ====== */}
          <SectionTitle colors={colors}>连接</SectionTitle>

          <SegmentRow
            label="协议"
            value={form.protocol}
            options={[
              {value: 'http', label: 'HTTP 轮询'},
              {value: 'ws', label: 'WebSocket'},
            ]}
            onChange={v => update('protocol', v as 'ws' | 'http')}
            colors={colors}
          />

          <FieldRow
            label="URL"
            required
            value={form.endpoint}
            onChangeText={v => update('endpoint', v)}
            placeholder="https:// 或 wss:// 开头"
            error={errors.endpoint}
            colors={colors}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <View style={[styles.row, {borderBottomColor: colors.border}]}>
            <View style={styles.rowLabelWrap}>
              <Text style={[styles.rowLabel, {color: colors.text}]}>鉴权 Token</Text>
              <Text style={[styles.rowHint, {color: colors.textSecondary}]}>可选</Text>
            </View>
            <View style={styles.authRow}>
              <TextInput
                style={[
                  styles.textInput,
                  styles.textInputFlex,
                  {color: colors.text, borderColor: colors.border, backgroundColor: colors.surface},
                ]}
                value={form.authToken}
                onChangeText={v => update('authToken', v)}
                placeholder="留空表示不鉴权"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showAuthToken}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => setShowAuthToken(!showAuthToken)}
                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                style={styles.eyeBtn}>
                {showAuthToken ? (
                  <EyeClosedIcon size={20} color={colors.text} />
                ) : (
                  <EyeOpenIcon size={20} color={colors.text} />
                )}
              </Pressable>
            </View>
          </View>

          {form.protocol === 'http' && (
            <View style={styles.pollRow}>
              <SliderRow
                label="轮询间隔"
                value={Math.max(2, Math.round(form.pollIntervalMs / 1000))}
                minimum={2}
                maximum={60}
                step={1}
                unit="秒"
                onSlidingComplete={v => update('pollIntervalMs', Math.round(v) * 1000)}
                colors={colors}
              />
            </View>
          )}

          {/* ====== 字段映射（可折叠）====== */}
          <Pressable
            onPress={() => setShowMapping(!showMapping)}
            style={[styles.collapseHeader, {borderBottomColor: colors.border}]}>
            <Text style={[styles.sectionTitleText, {color: colors.text}]}>字段映射</Text>
            <View style={styles.collapseIcon}>
              {showMapping ? (
                <EyeClosedIcon size={20} color={colors.textSecondary} />
              ) : (
                <EyeOpenIcon size={20} color={colors.textSecondary} />
              )}
            </View>
          </Pressable>

          {showMapping && (
            <View style={styles.mappingGroup}>
              <Text style={[styles.groupHint, {color: colors.textSecondary}]}>
                每个字段填入"路径表达式"，从 API 返回的 JSON 中提取值。语法：$.field、$.a.b、$.arr[0]、$.time * 1000
              </Text>

              <FieldRow
                label="listPath（列表路径）"
                value={form.listPath}
                onChangeText={v => update('listPath', v)}
                placeholder="如 $.features（USGS）；留空为单事件"
                error={errors.listPath}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="事件 ID"
                required
                value={form.eventId}
                onChangeText={v => update('eventId', v)}
                placeholder="$.id"
                error={errors.eventId}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="发震时间"
                required
                value={form.originTime}
                onChangeText={v => update('originTime', v)}
                placeholder="$.time（毫秒）或 $.time * 1000"
                error={errors.originTime}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="震级"
                required
                value={form.magnitude}
                onChangeText={v => update('magnitude', v)}
                placeholder="$.mag"
                error={errors.magnitude}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="深度（km）"
                required
                value={form.depth}
                onChangeText={v => update('depth', v)}
                placeholder="$.depth"
                error={errors.depth}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="纬度"
                required
                value={form.lat}
                onChangeText={v => update('lat', v)}
                placeholder="$.lat"
                error={errors.lat}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="经度"
                required
                value={form.lng}
                onChangeText={v => update('lng', v)}
                placeholder="$.lng"
                error={errors.lng}
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="位置"
                required
                value={form.location}
                onChangeText={v => update('location', v)}
                placeholder="$.place"
                error={errors.location}
                colors={colors}
              />

              <FieldRow
                label="烈度（可选）"
                value={form.intensity}
                onChangeText={v => update('intensity', v)}
                placeholder="$.intensity?"
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="是否最终报（可选）"
                value={form.isFinal}
                onChangeText={v => update('isFinal', v)}
                placeholder="$.isFinal?"
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="是否取消报（可选）"
                value={form.isCancel}
                onChangeText={v => update('isCancel', v)}
                placeholder="$.isCancel?"
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="报数/第几报（可选）"
                value={form.reportNum}
                onChangeText={v => update('reportNum', v)}
                placeholder="$.reportNum?"
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <FieldRow
                label="测定类型（可选）"
                value={form.reportType}
                onChangeText={v => update('reportType', v)}
                placeholder="$.type?"
                colors={colors}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {/* 底部留白 */}
          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* 底部保存按钮（居中全宽，显眼位置） */}
        <View style={[styles.footer, {borderTopColor: colors.border, backgroundColor: colors.background}]}>
          <Pressable
            onPress={handleSave}
            style={({pressed}) => [
              styles.saveBtn,
              {backgroundColor: colors.text, opacity: pressed ? 0.85 : 1},
            ]}>
            <Text style={[styles.saveBtnText, {color: colors.background}]}>保存数据源</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ======================== 子组件 ========================

function SectionTitle({children, colors}: {children: React.ReactNode; colors: AppColors}) {
  return (
    <View style={[styles.sectionTitle, {borderBottomColor: colors.border}]}>
      <Text style={[styles.sectionTitleText, {color: colors.text}]}>{children}</Text>
    </View>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  colors: AppColors;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  keyboardType?: 'default' | 'url' | 'numeric' | 'email-address';
}

function FieldRow({
  label,
  value,
  onChangeText,
  placeholder,
  required,
  error,
  colors,
  autoCapitalize = 'sentences',
  autoCorrect = true,
  keyboardType = 'default',
}: FieldRowProps) {
  return (
    <View style={[styles.row, {borderBottomColor: colors.border}]}>
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, {color: colors.text}]}>
          {label}
          {required && <Text style={{color: colors.error}}> *</Text>}
        </Text>
      </View>
      <TextInput
        style={[
          styles.textInput,
          styles.textInputFlex,
          {
            color: colors.text,
            borderColor: error ? colors.error : colors.border,
            backgroundColor: colors.surface,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
      />
      {error ? (
        <Text style={[styles.errorText, {color: colors.error}]}>{error}</Text>
      ) : null}
    </View>
  );
}

interface SegmentRowProps<T extends string> {
  label: string;
  value: T;
  options: Array<{value: T; label: string}>;
  onChange: (v: T) => void;
  colors: AppColors;
}

function SegmentRow<T extends string>({label, value, options, onChange, colors}: SegmentRowProps<T>) {
  return (
    <View style={[styles.row, {borderBottomColor: colors.border}]}>
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, {color: colors.text}]}>{label}</Text>
      </View>
      <View style={styles.segmentWrap}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.segmentBtn,
                {
                  backgroundColor: active ? colors.text : colors.surface,
                  borderColor: active ? colors.text : colors.border,
                },
              ]}>
              <Text style={[styles.segmentText, {color: active ? colors.background : colors.text}]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ======================== 样式 ========================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabelWrap: {
    marginBottom: 6,
  },
  rowLabel: {
    fontSize: 14,
    lineHeight: 19,
  },
  rowHint: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
  },
  textInputFlex: {
    flex: 1,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  authRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeBtn: {
    padding: 8,
    marginLeft: 4,
  },
  pollRow: {
    paddingLeft: 0,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  collapseIcon: {
    padding: 4,
  },
  mappingGroup: {
    paddingBottom: 8,
  },
  groupHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 40,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
