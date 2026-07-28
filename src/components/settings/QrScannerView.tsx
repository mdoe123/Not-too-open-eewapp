// 二维码扫码视图组件
//
// 封装 react-native-vision-camera 摄像头预览 + QR 识别，支持单码和分块累积两种模式。
// 扫到分块 chunk（format === 'eew-app-source-pack-chunked'）时累积，收齐后调用 onChunksComplete。
// 扫到非 chunk 内容时调用 onScan（单码模式）。
//
// 权限处理：
// - 首次挂载请求相机权限
// - 'denied' 显示提示 + "前往系统设置"按钮
// - 无后置摄像头显示错误提示
//
// 防抖：同一码 500ms 内不重复触发
import React, {memo, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet, Linking, ActivityIndicator} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import {AppColors} from '../../theme/colors';
import {
  assembleChunks,
  CHUNKED_PACK_FORMAT,
  SourceShareChunk,
} from '../../sources/custom/sourceShare';

export interface QrScannerViewProps {
  /** 单码模式：扫到非 chunk 格式时调用 */
  onScan: (value: string) => void;
  /** 分块模式：全部 chunks 收集完成时调用 */
  onChunksComplete: (json: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 配色 */
  colors: AppColors;
}

/** 扫码进度（分块模式） */
interface ScanProgress {
  collected: number;
  total: number;
}

/** 二维码扫码视图 */
export const QrScannerView = memo(function QrScannerView({
  onScan,
  onChunksComplete,
  onError,
  onClose,
  colors,
}: QrScannerViewProps) {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('back');
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  // 已收集的 chunks：chunkIndex → chunk
  const collectedChunksRef = useRef<Map<number, SourceShareChunk>>(new Map());

  // 防抖：上次扫码内容和时间
  const lastScanRef = useRef<{value: string; time: number}>({value: '', time: 0});

  // 首次挂载请求权限
  useEffect(() => {
    if (!hasPermission && !permissionRequested) {
      requestPermission();
      setPermissionRequested(true);
    }
  }, [hasPermission, permissionRequested, requestPermission]);

  /** 扫码回调 */
  const onCodeScanned = (codes: Array<{value?: string}>) => {
    for (const code of codes) {
      if (!code.value) continue;

      // 防抖：500ms 内同内容不重复触发
      const now = Date.now();
      if (
        lastScanRef.current.value === code.value &&
        now - lastScanRef.current.time < 500
      ) {
        continue;
      }
      lastScanRef.current = {value: code.value, time: now};

      // 尝试解析为分块 chunk
      try {
        const parsed = JSON.parse(code.value);
        if (parsed?.format === CHUNKED_PACK_FORMAT) {
          // 分块模式：累积
          collectedChunksRef.current.set(parsed.chunkIndex, parsed as SourceShareChunk);
          const collected = collectedChunksRef.current.size;
          const total = parsed.totalChunks as number;
          setProgress({collected, total});

          if (collected === total) {
            // 收齐全部 chunks，组装还原
            const chunks = Array.from(collectedChunksRef.current.values());
            const result = assembleChunks(chunks);
            if (result.ok) {
              // 重置状态
              collectedChunksRef.current.clear();
              setProgress(null);
              onChunksComplete(result.json);
            } else {
              onError?.(result.error);
            }
          }
          return;
        }
      } catch {
        // 非 JSON 或解析失败，作为单码处理
      }

      // 单码模式
      onScan(code.value);
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned,
  });

  // 权限未授予
  if (!hasPermission) {
    return (
      <View style={[styles.container, {backgroundColor: colors.background}]}>
        <View style={[styles.header, {borderBottomColor: colors.border}]}>
          <Pressable onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.textSecondary}]}>关闭</Text>
          </Pressable>
          <Text style={[styles.headerTitle, {color: colors.text}]}>扫码导入</Text>
          <View style={{width: 40}} />
        </View>
        <View style={styles.centerContent}>
          {permissionRequested ? (
            <>
              <Text style={[styles.errorText, {color: colors.error}]}>
                相机权限被拒绝
              </Text>
              <Text style={[styles.hintText, {color: colors.textSecondary}]}>
                请前往系统设置开启相机权限后重试
              </Text>
              <Pressable
                onPress={() => Linking.openSettings()}
                style={({pressed}) => [
                  styles.actionBtn,
                  {backgroundColor: colors.text, opacity: pressed ? 0.85 : 1},
                ]}>
                <Text style={[styles.actionBtnText, {color: colors.background}]}>
                  前往系统设置
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.text} />
              <Text style={[styles.hintText, {color: colors.textSecondary}]}>
                正在请求相机权限...
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  // 无后置摄像头
  if (!device) {
    return (
      <View style={[styles.container, {backgroundColor: colors.background}]}>
        <View style={[styles.header, {borderBottomColor: colors.border}]}>
          <Pressable onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={[styles.headerBtn, {color: colors.textSecondary}]}>关闭</Text>
          </Pressable>
          <Text style={[styles.headerTitle, {color: colors.text}]}>扫码导入</Text>
          <View style={{width: 40}} />
        </View>
        <View style={styles.centerContent}>
          <Text style={[styles.errorText, {color: colors.error}]}>
            未找到后置摄像头
          </Text>
          <Text style={[styles.hintText, {color: colors.textSecondary}]}>
            设备可能没有可用的后置摄像头
          </Text>
        </View>
      </View>
    );
  }

  // 正常扫码界面
  return (
    <View style={styles.container}>
      {/* 摄像头预览 */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
      />

      {/* 顶部标题栏（半透明黑色） */}
      <View style={styles.headerOverlay}>
        <Pressable onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <Text style={styles.headerBtnOverlay}>关闭</Text>
        </Pressable>
        <Text style={styles.headerTitleOverlay}>扫码导入</Text>
        <View style={{width: 40}} />
      </View>

      {/* 中央扫描框（四角 L 形） */}
      <View style={styles.scanArea} pointerEvents="none">
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {/* 底部提示 + 进度 */}
      <View style={styles.footerOverlay}>
        {progress ? (
          <>
            <Text style={styles.progressText}>
              已扫描 {progress.collected}/{progress.total}
            </Text>
            <View style={styles.progressBar}>
              {Array.from({length: progress.total}).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressSegment,
                    {
                      backgroundColor: i < progress.collected ? '#FFFFFF' : 'rgba(255,255,255,0.3)',
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.hintTextOverlay}>
              请继续扫描剩余二维码
            </Text>
          </>
        ) : (
          <Text style={styles.hintTextOverlay}>将二维码对准框内</Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  // 顶部标题栏（带背景的版本，用于错误状态）
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
  // 居中内容（错误/加载状态）
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  hintText: {
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 16,
  },
  actionBtn: {
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  // 摄像头预览叠加层
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  headerBtnOverlay: {
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 4,
    color: '#FFFFFF',
  },
  headerTitleOverlay: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    color: '#FFFFFF',
  },
  // 中央扫描框（240x240，四角 L 形）
  scanArea: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 240,
    height: 240,
    marginTop: -120,
    marginLeft: -120,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#FFFFFF',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  // 底部提示
  footerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  progressText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 10,
  },
  progressBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  hintTextOverlay: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
});
