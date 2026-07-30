// 导入源配置 Modal
//
// 支持四种导入方式（Tab 切换）：
// 1. 粘贴 JSON：用户粘贴分享 JSON 后解析、校验、预览，确认后合并到现有源列表
// 2. 扫码导入：调用摄像头扫描二维码，单码/分块累积，扫到内容后自动切回粘贴 Tab 预览
// 3. 文件夹扫描：扫描固定目录（应用外部私有目录 eew_sources/）下所有 .json 文件批量导入
// 4. 文件选择器：通过系统 SAF 选择单个 .json 文件导入
//
// 设计：
// - 顶部：法律免责横幅（黄色警告）
// - Tab 切换条：粘贴 JSON / 扫码导入 / 文件夹 / 选择器
// - Tab 1（粘贴）：多行 TextInput + 解析按钮 + 预览 + 底部确认导入
// - Tab 2（扫码）：全屏 QrScannerView，扫码后切回 Tab 1 预览
// - Tab 3（文件夹）：目录路径提示 + 文件列表 + 一键导入全部按钮
// - Tab 4（选择器）：选择文件按钮 + 预览
//
// 安全设计：
// - 导入的源强制 enabled=false（由 mergeImported 保证）
// - 扫码成功后切回粘贴 Tab，让用户确认预览后再导入
import React, {memo, useState, useCallback, useEffect} from 'react';
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
  ActivityIndicator,
} from 'react-native';
import {SourceConfig} from '../../types/config';
import {AppColors} from '../../theme/colors';
import {
  parsePack,
  validatePack,
  mergeImported,
} from '../../sources/custom/sourceShare';
import {QrScannerView} from './QrScannerView';
import {FileSourceImportManager} from '../../native/FileSourceImportManager';

export interface ImportSourceModalProps {
  visible: boolean;
  /** 现有源列表（用于合并去重） */
  existingSources: SourceConfig[];
  /** 导入成功回调，传入合并后的完整源列表 */
  onImport: (merged: SourceConfig[]) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 配色 */
  colors: AppColors;
}

/** 预览状态 */
interface PreviewState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: string[];
  sources?: SourceConfig[];
  added?: number;
  updated?: number;
  reassigned?: number;
}

/** Tab 视图模式 */
type ViewMode = 'paste' | 'scan' | 'folder' | 'picker';

/** 导入源配置 Modal */
export const ImportSourceModal = memo(function ImportSourceModal({
  visible,
  existingSources,
  onImport,
  onClose,
  colors,
}: ImportSourceModalProps) {
  const [jsonText, setJsonText] = useState('');
  const [preview, setPreview] = useState<PreviewState>({status: 'idle'});
  const [viewMode, setViewMode] = useState<ViewMode>('paste');

  // 文件夹扫描状态
  const [dirPath, setDirPath] = useState<string>('');
  const [fileList, setFileList] = useState<string[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [importAllLoading, setImportAllLoading] = useState(false);

  // 文件选择器状态
  const [pickerLoading, setPickerLoading] = useState(false);

  /** 解析 JSON 并预览结果（供所有导入方式共用） */
  const parseAndPreview = useCallback((text: string) => {
    if (!text.trim()) {
      setPreview({status: 'error', message: 'JSON 内容为空'});
      return;
    }
    const parsed = parsePack(text);
    if (!parsed.ok) {
      setPreview({status: 'error', message: parsed.error});
      return;
    }
    const validated = validatePack(parsed.pack);
    if (!validated.ok) {
      setPreview({
        status: 'error',
        message: '校验失败',
        errors: validated.errors,
      });
      return;
    }
    const mergeResult = mergeImported(existingSources, validated.sources);
    setPreview({
      status: 'success',
      sources: validated.sources,
      added: mergeResult.added,
      updated: mergeResult.updated,
      reassigned: mergeResult.reassigned,
    });
  }, [existingSources]);

  /** 解析按钮点击（Tab 1 粘贴） */
  const handleParse = () => {
    parseAndPreview(jsonText);
  };

  /** 确认导入 */
  const handleConfirm = () => {
    if (preview.status !== 'success' || !preview.sources) {
      return;
    }
    const mergeResult = mergeImported(existingSources, preview.sources);
    onImport(mergeResult.merged);
    // 重置
    setJsonText('');
    setPreview({status: 'idle'});
  };

  /** 关闭并重置 */
  const handleClose = () => {
    setJsonText('');
    setPreview({status: 'idle'});
    setViewMode('paste');
    setFileList([]);
    onClose();
  };

  /** 扫码单码回调 */
  const handleSingleScan = (value: string) => {
    setJsonText(value);
    setViewMode('paste');
    parseAndPreview(value);
  };

  /** 扫码分块完成回调 */
  const handleChunksComplete = (json: string) => {
    setJsonText(json);
    setViewMode('paste');
    parseAndPreview(json);
  };

  /** 扫码错误回调 */
  const handleScanError = (error: string) => {
    setPreview({status: 'error', message: `扫码错误：${error}`});
    setViewMode('paste');
  };

  /** 加载文件夹路径和文件列表 */
  const loadFolderInfo = useCallback(async () => {
    setScanLoading(true);
    try {
      const [path, names] = await Promise.all([
        FileSourceImportManager.getSourceDirectoryPath(),
        FileSourceImportManager.scanSourceFiles(),
      ]);
      setDirPath(path ?? '');
      setFileList(names);
    } catch {
      setFileList([]);
    } finally {
      setScanLoading(false);
    }
  }, []);

  // 切换到文件夹 Tab 时自动加载
  useEffect(() => {
    if (visible && viewMode === 'folder') {
      loadFolderInfo();
    }
  }, [visible, viewMode, loadFolderInfo]);

  /** 一键导入文件夹下所有 .json 文件 */
  const handleImportAllFromFolder = async () => {
    setImportAllLoading(true);
    try {
      const contents = await FileSourceImportManager.readAllSourceFiles();
      if (contents.length === 0) {
        setPreview({status: 'error', message: '文件夹中无 .json 文件'});
        return;
      }

      // 逐个解析并累积所有有效的源
      const allSources: SourceConfig[] = [];
      const errors: string[] = [];
      for (let i = 0; i < contents.length; i++) {
        const text = contents[i];
        const parsed = parsePack(text);
        if (!parsed.ok) {
          errors.push(`文件 ${i + 1}: ${parsed.error}`);
          continue;
        }
        const validated = validatePack(parsed.pack);
        if (!validated.ok) {
          errors.push(`文件 ${i + 1}: 校验失败`);
          continue;
        }
        allSources.push(...validated.sources);
      }

      if (allSources.length === 0) {
        setPreview({
          status: 'error',
          message: '无有效的数据源',
          errors,
        });
        return;
      }

      // 合并到现有源
      const mergeResult = mergeImported(existingSources, allSources);
      onImport(mergeResult.merged);
      // 重置
      setPreview({status: 'idle'});
    } catch (e) {
      setPreview({
        status: 'error',
        message: `导入失败：${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setImportAllLoading(false);
    }
  };

  /** 文件选择器：选择并导入单个 .json 文件 */
  const handlePickFile = async () => {
    setPickerLoading(true);
    try {
      const json = await FileSourceImportManager.pickFile();
      // 解析预览，让用户确认后再导入
      setJsonText(json);
      parseAndPreview(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('USER_CANCELED')) {
        // 用户取消，静默处理
      } else {
        setPreview({status: 'error', message: `文件读取失败：${msg}`});
      }
    } finally {
      setPickerLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.container, {backgroundColor: colors.background}]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled>
        {/* 顶部标题栏 */}
        <View style={[styles.header, {borderBottomColor: colors.border}]}>
          <Pressable onPress={handleClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.textSecondary}]}>取消</Text>
          </Pressable>
          <Text style={[styles.headerTitle, {color: colors.text}]}>导入数据源</Text>
          <View style={{width: 40}} />
        </View>

        {/* 法律免责横幅 */}
        <View style={[styles.disclaimerBanner, {backgroundColor: colors.yellow}]}>
          <Text style={styles.disclaimerText}>
            ⚠ 导入的源配置来自第三方，App 不保证其合法性与数据准确性。{'\n'}
            使用前请自行确认数据来源合法合规，风险自担。
          </Text>
        </View>

        {/* Tab 切换条 */}
        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setViewMode('paste')}
            style={[
              styles.tabBtn,
              {
                backgroundColor: viewMode === 'paste' ? colors.text : colors.surface,
                borderColor: viewMode === 'paste' ? colors.text : colors.border,
              },
            ]}>
            <Text style={[styles.tabText, {color: viewMode === 'paste' ? colors.background : colors.text}]}>
              粘贴
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('scan')}
            style={[
              styles.tabBtn,
              {
                backgroundColor: viewMode === 'scan' ? colors.text : colors.surface,
                borderColor: viewMode === 'scan' ? colors.text : colors.border,
              },
            ]}>
            <Text style={[styles.tabText, {color: viewMode === 'scan' ? colors.background : colors.text}]}>
              扫码
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('folder')}
            style={[
              styles.tabBtn,
              {
                backgroundColor: viewMode === 'folder' ? colors.text : colors.surface,
                borderColor: viewMode === 'folder' ? colors.text : colors.border,
              },
            ]}>
            <Text style={[styles.tabText, {color: viewMode === 'folder' ? colors.background : colors.text}]}>
              文件夹
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('picker')}
            style={[
              styles.tabBtn,
              {
                backgroundColor: viewMode === 'picker' ? colors.text : colors.surface,
                borderColor: viewMode === 'picker' ? colors.text : colors.border,
              },
            ]}>
            <Text style={[styles.tabText, {color: viewMode === 'picker' ? colors.background : colors.text}]}>
              选择器
            </Text>
          </Pressable>
        </View>

        {/* Tab 1：粘贴 JSON */}
        {viewMode === 'paste' && (
          <>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
              <Text style={[styles.hint, {color: colors.textSecondary}]}>
                粘贴其他用户分享的源配置 JSON。导入时按 endpoint 去重：同 API 地址的源会被更新，不同地址的源会追加为新源（priority 冲突时自动重新分配）。
              </Text>

              <TextInput
                style={[
                  styles.jsonInput,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
                value={jsonText}
                onChangeText={v => {
                  setJsonText(v);
                  setPreview({status: 'idle'});
                }}
                placeholder='粘贴 JSON，如 {"format":"eew-app-source-pack",...}'
                placeholderTextColor={colors.textSecondary}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                onPress={handleParse}
                style={({pressed}) => [
                  styles.parseBtn,
                  {backgroundColor: colors.text, opacity: pressed ? 0.85 : 1},
                ]}>
                <Text style={[styles.parseBtnText, {color: colors.background}]}>解析并预览</Text>
              </Pressable>

              {/* 预览结果 */}
              {preview.status === 'success' && (
                <View style={[styles.previewBox, {borderColor: colors.success, backgroundColor: colors.surface}]}>
                  <Text style={[styles.previewTitle, {color: colors.success}]}>
                    解析成功
                  </Text>
                  <Text style={[styles.previewText, {color: colors.text}]}>
                    待导入 {preview.sources?.length ?? 0} 个源（新增 {preview.added ?? 0}，更新 {preview.updated ?? 0}{preview.reassigned ? `，重排 ${preview.reassigned}` : ''}）
                  </Text>
                  {preview.sources?.map((s, i) => (
                    <Text key={i} style={[styles.previewSource, {color: colors.textSecondary}]}>
                      • {s.name}（priority {s.priority}，{s.category === 'eew' ? '预警' : '速报'}）
                    </Text>
                  ))}
                  <Text style={[styles.previewNote, {color: colors.textSecondary}]}>
                    注：导入的源默认禁用，需手动启用
                  </Text>
                </View>
              )}

              {preview.status === 'error' && (
                <View style={[styles.previewBox, {borderColor: colors.error, backgroundColor: colors.surface}]}>
                  <Text style={[styles.previewTitle, {color: colors.error}]}>解析失败</Text>
                  <Text style={[styles.previewText, {color: colors.text}]}>
                    {preview.message}
                  </Text>
                  {preview.errors?.map((e, i) => (
                    <Text key={i} style={[styles.previewError, {color: colors.error}]}>
                      • {e}
                    </Text>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* 底部导入按钮 */}
            <View style={[styles.footer, {borderTopColor: colors.border, backgroundColor: colors.background}]}>
              <Pressable
                onPress={handleConfirm}
                disabled={preview.status !== 'success'}
                style={({pressed}) => [
                  styles.importBtn,
                  {
                    backgroundColor: colors.text,
                    opacity: preview.status === 'success' ? (pressed ? 0.85 : 1) : 0.4,
                  },
                ]}>
                <Text style={[styles.importBtnText, {color: colors.background}]}>
                  确认导入
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Tab 2：扫码导入 */}
        {viewMode === 'scan' && (
          <View style={styles.scannerContainer}>
            <QrScannerView
              onScan={handleSingleScan}
              onChunksComplete={handleChunksComplete}
              onError={handleScanError}
              onClose={handleClose}
              colors={colors}
            />
          </View>
        )}

        {/* Tab 3：文件夹扫描 */}
        {viewMode === 'folder' && (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <Text style={[styles.hint, {color: colors.textSecondary}]}>
              将 .json 文件放入下方目录，点击"扫描"刷新列表，确认后点击"导入全部"。
            </Text>

            <View style={[styles.dirBox, {borderColor: colors.border, backgroundColor: colors.surface}]}>
              <Text style={[styles.dirLabel, {color: colors.textSecondary}]}>扫描目录：</Text>
              <Text style={[styles.dirPath, {color: colors.text}]} selectable>
                {dirPath || '加载中...'}
              </Text>
            </View>

            <View style={styles.folderActionRow}>
              <Pressable
                onPress={loadFolderInfo}
                disabled={scanLoading}
                style={({pressed}) => [
                  styles.folderBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: scanLoading ? 0.5 : (pressed ? 0.7 : 1),
                  },
                ]}>
                <Text style={[styles.folderBtnText, {color: colors.text}]}>
                  {scanLoading ? '扫描中...' : '刷新列表'}
                </Text>
              </Pressable>
            </View>

            {/* 文件列表 */}
            <View style={styles.fileListSection}>
              <Text style={[styles.fileListTitle, {color: colors.textSecondary}]}>
                扫描结果（{fileList.length} 个文件）
              </Text>
              {scanLoading ? (
                <ActivityIndicator color={colors.text} style={styles.loadingIndicator} />
              ) : fileList.length === 0 ? (
                <Text style={[styles.emptyHint, {color: colors.textSecondary}]}>
                  目录为空。请通过文件管理器将 .json 文件放入上述目录。
                </Text>
              ) : (
                fileList.map((name, i) => (
                  <View key={i} style={[styles.fileItem, {borderBottomColor: colors.border}]}>
                    <Text style={[styles.fileName, {color: colors.text}]} numberOfLines={1}>
                      📄 {name}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* 预览错误（批量导入失败时显示） */}
            {preview.status === 'error' && (
              <View style={[styles.previewBox, {borderColor: colors.error, backgroundColor: colors.surface}]}>
                <Text style={[styles.previewTitle, {color: colors.error}]}>导入失败</Text>
                <Text style={[styles.previewText, {color: colors.text}]}>
                  {preview.message}
                </Text>
                {preview.errors?.map((e, i) => (
                  <Text key={i} style={[styles.previewError, {color: colors.error}]}>
                    • {e}
                  </Text>
                ))}
              </View>
            )}

            {/* 底部导入全部按钮 */}
            <View style={[styles.footer, {borderTopColor: colors.border, backgroundColor: colors.background}]}>
              <Pressable
                onPress={handleImportAllFromFolder}
                disabled={importAllLoading || fileList.length === 0}
                style={({pressed}) => [
                  styles.importBtn,
                  {
                    backgroundColor: colors.text,
                    opacity: (importAllLoading || fileList.length === 0) ? 0.4 : (pressed ? 0.85 : 1),
                  },
                ]}>
                <Text style={[styles.importBtnText, {color: colors.background}]}>
                  {importAllLoading ? '导入中...' : `导入全部（${fileList.length} 个文件）`}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* Tab 4：文件选择器 */}
        {viewMode === 'picker' && (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <Text style={[styles.hint, {color: colors.textSecondary}]}>
              点击下方按钮打开系统文件选择器，选择 .json 文件后自动解析预览。
            </Text>

            <Pressable
              onPress={handlePickFile}
              disabled={pickerLoading}
              style={({pressed}) => [
                styles.parseBtn,
                {
                  backgroundColor: colors.text,
                  opacity: pickerLoading ? 0.5 : (pressed ? 0.85 : 1),
                },
              ]}>
              <Text style={[styles.parseBtnText, {color: colors.background}]}>
                {pickerLoading ? '选择中...' : '选择 .json 文件'}
              </Text>
            </Pressable>

            {/* 预览结果 */}
            {preview.status === 'success' && (
              <View style={[styles.previewBox, {borderColor: colors.success, backgroundColor: colors.surface}]}>
                <Text style={[styles.previewTitle, {color: colors.success}]}>
                  解析成功
                </Text>
                <Text style={[styles.previewText, {color: colors.text}]}>
                  待导入 {preview.sources?.length ?? 0} 个源（新增 {preview.added ?? 0}，更新 {preview.updated ?? 0}{preview.reassigned ? `，重排 ${preview.reassigned}` : ''}）
                </Text>
                {preview.sources?.map((s, i) => (
                  <Text key={i} style={[styles.previewSource, {color: colors.textSecondary}]}>
                    • {s.name}（priority {s.priority}，{s.category === 'eew' ? '预警' : '速报'}）
                  </Text>
                ))}
                <Text style={[styles.previewNote, {color: colors.textSecondary}]}>
                  注：导入的源默认禁用，需手动启用
                </Text>
              </View>
            )}

            {preview.status === 'error' && (
              <View style={[styles.previewBox, {borderColor: colors.error, backgroundColor: colors.surface}]}>
                <Text style={[styles.previewTitle, {color: colors.error}]}>解析失败</Text>
                <Text style={[styles.previewText, {color: colors.text}]}>
                  {preview.message}
                </Text>
                {preview.errors?.map((e, i) => (
                  <Text key={i} style={[styles.previewError, {color: colors.error}]}>
                    • {e}
                  </Text>
                ))}
              </View>
            )}

            {/* 底部导入按钮 */}
            {preview.status === 'success' && (
              <View style={[styles.footer, {borderTopColor: colors.border, backgroundColor: colors.background}]}>
                <Pressable
                  onPress={handleConfirm}
                  style={({pressed}) => [
                    styles.importBtn,
                    {
                      backgroundColor: colors.text,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}>
                  <Text style={[styles.importBtnText, {color: colors.background}]}>
                    确认导入
                  </Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
});

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
  // 法律免责横幅
  disclaimerBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disclaimerText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#000000',
  },
  // Tab 切换条
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tabBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  jsonInput: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minHeight: 200,
    lineHeight: 18,
  },
  parseBtn: {
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  parseBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    marginTop: 16,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 4,
  },
  previewSource: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  previewNote: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
    fontStyle: 'italic',
  },
  previewError: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  importBtn: {
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // 扫码容器（全屏）
  scannerContainer: {
    flex: 1,
  },
  // 文件夹扫描 Tab
  dirBox: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  dirLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  dirPath: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  folderActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  folderBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  fileListSection: {
    marginBottom: 16,
  },
  fileListTitle: {
    fontSize: 13,
    marginBottom: 8,
  },
  loadingIndicator: {
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 16,
    textAlign: 'center',
  },
  fileItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileName: {
    fontSize: 14,
  },
});
