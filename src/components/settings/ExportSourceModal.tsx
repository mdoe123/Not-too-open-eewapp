// 导出源配置 Modal
//
// 展示选中的源配置 JSON 文本 + 二维码图片，提供复制到剪贴板和系统分享。
// 默认不导出 authToken（敏感字段），用户可勾选"包含鉴权 Token"开关。
//
// 设计：
// - 顶部：源选择（默认选中当前 customSource 源）
// - 中部：JSON 文本预览 + 二维码图片（Tab 切换）
// - 底部：复制到剪贴板 / 系统分享
import React, {memo, useState, useMemo, useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Share,
  Alert,
  Switch,
  Platform,
} from 'react-native';
import {SourceConfig} from '../../types/config';
import {AppColors} from '../../theme/colors';
import {
  exportSources,
  serializePack,
  chunkPack,
  SourceShareChunk,
} from '../../sources/custom/sourceShare';
import {CopyIcon, ShareIcon} from '../icons/SettingsIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';

export interface ExportSourceModalProps {
  visible: boolean;
  /** 待导出的源（默认单个源） */
  sources: SourceConfig[];
  /** 关闭回调 */
  onClose: () => void;
  /** 配色 */
  colors: AppColors;
}

/** 导出源配置 Modal */
export const ExportSourceModal = memo(function ExportSourceModal({
  visible,
  sources,
  onClose,
  colors,
}: ExportSourceModalProps) {
  const [includeAuth, setIncludeAuth] = useState(false);
  const [viewMode, setViewMode] = useState<'json' | 'qrcode'>('json');
  const [copied, setCopied] = useState(false);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);

  /** 序列化 JSON */
  const jsonString = useMemo(() => {
    const pack = exportSources(sources, {includeAuth});
    return serializePack(pack);
  }, [sources, includeAuth]);

  /** 是否需要分块（>2000 字符自动切换分块模式） */
  const needsChunking = jsonString.length > 2000;

  /** 分块后的 chunks（仅在 needsChunking 时计算） */
  const chunks = useMemo<SourceShareChunk[] | null>(() => {
    if (!needsChunking) return null;
    return chunkPack(jsonString);
  }, [jsonString, needsChunking]);

  // sources 或 includeAuth 变化时重置 chunk 索引
  useEffect(() => {
    setCurrentChunkIdx(0);
  }, [sources, includeAuth]);

  /** 复制到剪贴板 */
  const handleCopy = async () => {
    try {
      Clipboard.setString(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      Alert.alert('复制失败', (e as Error).message);
    }
  };

  /** 系统分享 */
  const handleShare = async () => {
    try {
      await Share.share({
        message: jsonString,
        title: 'EEW App 数据源配置',
      });
    } catch (e) {
      Alert.alert('分享失败', (e as Error).message);
    }
  };

  /** 关闭并重置 */
  const handleClose = () => {
    setIncludeAuth(false);
    setViewMode('json');
    setCopied(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}>
      <View style={[styles.container, {backgroundColor: colors.background}]}>
        {/* 顶部标题栏 */}
        <View style={[styles.header, {borderBottomColor: colors.border}]}>
          <Pressable onPress={handleClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.textSecondary}]}>关闭</Text>
          </Pressable>
          <Text style={[styles.headerTitle, {color: colors.text}]}>导出数据源</Text>
          <View style={{width: 40}} />
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* 包含鉴权 Token 开关 */}
          <View style={[styles.row, {borderBottomColor: colors.border}]}>
            <View style={styles.rowLabelWrap}>
              <Text style={[styles.rowLabel, {color: colors.text}]}>包含鉴权 Token</Text>
              <Text style={[styles.rowHint, {color: colors.textSecondary}]}>
                开启后导出 authToken，仅限个人备份使用
              </Text>
            </View>
            <Switch
              value={includeAuth}
              onValueChange={setIncludeAuth}
              trackColor={{false: colors.border, true: colors.text}}
              thumbColor={includeAuth ? colors.background : colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>

          {/* 视图切换 Tab */}
          <View style={styles.tabRow}>
            <Pressable
              onPress={() => setViewMode('json')}
              style={[
                styles.tabBtn,
                {
                  backgroundColor: viewMode === 'json' ? colors.text : colors.surface,
                  borderColor: viewMode === 'json' ? colors.text : colors.border,
                },
              ]}>
              <Text style={[styles.tabText, {color: viewMode === 'json' ? colors.background : colors.text}]}>
                JSON 文本
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setViewMode('qrcode')}
              style={[
                styles.tabBtn,
                {
                  backgroundColor: viewMode === 'qrcode' ? colors.text : colors.surface,
                  borderColor: viewMode === 'qrcode' ? colors.text : colors.border,
                },
              ]}>
              <Text style={[styles.tabText, {color: viewMode === 'qrcode' ? colors.background : colors.text}]}>
                二维码
              </Text>
            </Pressable>
          </View>

          {/* JSON 文本视图 */}
          {viewMode === 'json' && (
            <View style={[styles.jsonBox, {borderColor: colors.border, backgroundColor: colors.surface}]}>
              <ScrollView horizontal={false}>
                <Text
                  style={[styles.jsonText, {color: colors.text}]}
                  selectable>
                  {jsonString}
                </Text>
              </ScrollView>
            </View>
          )}

          {/* 二维码视图 */}
          {viewMode === 'qrcode' && (
            <View style={styles.qrBox}>
              {needsChunking && chunks ? (
                <>
                  {/* 分块模式：显示当前 chunk 二维码 + 切帧 UI */}
                  <Text style={[styles.chunkTitle, {color: colors.text}]}>
                    分块导出：第 {currentChunkIdx + 1}/{chunks.length} 个二维码
                  </Text>
                  <Text style={[styles.chunkHint, {color: colors.textSecondary}]}>
                    接收方需依次扫描全部 {chunks.length} 帧二维码
                  </Text>

                  <View style={[styles.qrCodeWrap, {backgroundColor: colors.background}]}>
                    <QRCode
                      value={JSON.stringify(chunks[currentChunkIdx])}
                      size={240}
                      color={colors.text}
                      backgroundColor={colors.background}
                    />
                  </View>

                  {/* 分段进度指示器 */}
                  <View style={styles.chunkIndicator}>
                    {chunks.map((_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.chunkIndicatorSegment,
                          {
                            backgroundColor: i <= currentChunkIdx ? colors.text : 'transparent',
                            borderColor: i <= currentChunkIdx ? colors.text : colors.border,
                          },
                        ]}
                      />
                    ))}
                  </View>

                  {/* 切换按钮 */}
                  <View style={styles.chunkNavRow}>
                    <Pressable
                      onPress={() => setCurrentChunkIdx(Math.max(0, currentChunkIdx - 1))}
                      disabled={currentChunkIdx === 0}
                      style={({pressed}) => [
                        styles.chunkNavBtn,
                        {
                          borderColor: colors.text,
                          opacity: currentChunkIdx === 0 ? 0.3 : (pressed ? 0.7 : 1),
                        },
                      ]}>
                      <Text style={[styles.chunkNavBtnText, {color: colors.text}]}>上一帧</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setCurrentChunkIdx(Math.min(chunks.length - 1, currentChunkIdx + 1))}
                      disabled={currentChunkIdx === chunks.length - 1}
                      style={({pressed}) => [
                        styles.chunkNavBtn,
                        {
                          backgroundColor: colors.text,
                          opacity: currentChunkIdx === chunks.length - 1 ? 0.3 : (pressed ? 0.85 : 1),
                        },
                      ]}>
                      <Text style={[styles.chunkNavBtnText, {color: colors.background}]}>下一帧</Text>
                    </Pressable>
                  </View>

                  <Text style={[styles.qrSizeText, {color: colors.textSecondary}]}>
                    总大小：{jsonString.length} 字符
                  </Text>
                </>
              ) : (
                <>
                  {/* 单二维码模式（≤2000 字符） */}
                  <View style={[styles.qrCodeWrap, {backgroundColor: colors.background}]}>
                    <QRCode
                      value={jsonString}
                      size={240}
                      color={colors.text}
                      backgroundColor={colors.background}
                    />
                  </View>
                  <Text style={[styles.qrSizeText, {color: colors.textSecondary}]}>
                    当前大小：{jsonString.length} 字符
                  </Text>
                </>
              )}
            </View>
          )}

          {/* 复制状态提示 */}
          {copied && (
            <Text style={[styles.copiedTip, {color: colors.success}]}>
              已复制到剪贴板
            </Text>
          )}
        </ScrollView>

        {/* 底部操作按钮 */}
        <View style={[styles.footer, {borderTopColor: colors.border, backgroundColor: colors.background}]}>
          <Pressable
            onPress={handleCopy}
            style={({pressed}) => [
              styles.actionBtn,
              styles.actionBtnSecondary,
              {borderColor: colors.text, opacity: pressed ? 0.7 : 1},
            ]}>
            <CopyIcon size={20} color={colors.text} />
            <Text style={[styles.actionBtnText, {color: colors.text}]}>复制 JSON</Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            style={({pressed}) => [
              styles.actionBtn,
              styles.actionBtnPrimary,
              {backgroundColor: colors.text, opacity: pressed ? 0.85 : 1},
            ]}>
            <ShareIcon size={20} color={colors.background} />
            <Text style={[styles.actionBtnText, {color: colors.background}]}>系统分享</Text>
          </Pressable>
        </View>
      </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  rowLabelWrap: {
    flex: 1,
    paddingRight: 16,
  },
  rowLabel: {
    fontSize: 15,
    lineHeight: 20,
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
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
    fontSize: 14,
    fontWeight: '500',
  },
  jsonBox: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    minHeight: 200,
    maxHeight: 400,
  },
  jsonText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  qrBox: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  qrWarning: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  qrWarningText: {
    fontSize: 12,
    lineHeight: 17,
  },
  qrSizeText: {
    fontSize: 11,
    marginTop: 6,
  },
  qrCodeWrap: {
    padding: 16,
    borderRadius: 8,
  },
  // 分块模式样式
  chunkTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  chunkHint: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  chunkIndicator: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 16,
    marginBottom: 12,
    width: '100%',
    paddingHorizontal: 8,
  },
  chunkIndicatorSegment: {
    flex: 1,
    height: 4,
    borderWidth: 1,
    borderRadius: 2,
  },
  chunkNavRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 8,
  },
  chunkNavBtn: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chunkNavBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  copiedTip: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionBtnSecondary: {
    borderWidth: 1,
  },
  actionBtnPrimary: {},
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
