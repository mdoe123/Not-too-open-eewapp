// 地震详情页
// 直接使用 eqckq.html 示例（Leaflet + 高德瓦片 + 烈度圈 + 信息面板）
// 通过 WebView 全屏加载，URL 参数传入地震数据和主题
//
// HTML 示例已包含完整布局：地图、震级、位置、深度、时间、烈度分布、安全提示
// 无需额外 RN 布局，避免重复造轮子

import React from 'react';
import {StyleSheet} from 'react-native';
import {WebView} from 'react-native-webview';
import {formatOriginTimeShort} from '../utils/eew';
import type {EventDetailScreenProps} from '../navigation/types';

export default function EventDetailScreen({route}: EventDetailScreenProps) {
  const {event} = route.params;
  const isDark = false; // WebView 内部通过 useColorScheme 无法获取，固定浅色；如需深色可改传参

  // 构建 URL 参数（与 eqckq.html 支持的参数一致）
  const params = new URLSearchParams({
    elat: String(event.lat),
    elon: String(event.lng),
    dph: String(event.depth),
    m: String(event.magnitude),
    name: event.location,
    time: formatOriginTimeShort(event.originTime),
    theme: isDark ? 'dark' : 'light',
  });

  return (
    <WebView
      source={{uri: `file:///android_asset/eqckq.html?${params.toString()}`}}
      style={styles.webview}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
