// 用户位置 Hook
// 支持两种位置来源：
// - 'gps'：使用 GPS 自动定位（getCurrentPosition + watchPosition）
// - 'manual'：使用用户手动输入的经纬度，不走 GPS
//
// 降级策略（GPS 模式）：
// - 权限被拒 / 定位失败 / 超时 → 返回 mock 位置（北京），isMock=true
// - 保证上层（距离/烈度/倒时计算）始终有可用坐标，App 不崩
// - 拿到真实位置后 isMock 变 false，所有依赖自动重算
//
// 位置权限在 Onboarding 引导页已请求（ACCESS_FINE_LOCATION），
// 本 Hook 不重复请求权限，权限未授予时直接降级 mock。
import {useEffect, useRef, useState} from 'react';
import Geolocation, {
  GeolocationResponse,
  GeolocationError,
} from '@react-native-community/geolocation';
import {Platform} from 'react-native';
import {UserLocation} from '../types';
import {log} from '../utils/logger';

/** Mock 降级位置（北京），定位失败时使用 */
const MOCK_USER_LAT = 39.9;
const MOCK_USER_LNG = 116.4;

/** 首次定位超时（毫秒），超时后降级到低精度重试 */
const INITIAL_TIMEOUT_MS = 8000;

/** 高精度失败后的低精度（网络定位）重试超时（毫秒） */
const FALLBACK_TIMEOUT_MS = 7000;

/** 接受缓存位置的最大年龄（毫秒），避免重复冷启动 GPS */
const MAX_CACHE_AGE_MS = 60000;

/** watchPosition 最小更新间隔（毫秒） */
const WATCH_INTERVAL_MS = 60000;

/** watchPosition 移动距离阈值（米），省电：移动超过此距离才更新 */
const WATCH_DISTANCE_FILTER_M = 100;

export interface UseUserLocationOptions {
  /** 位置来源模式：'gps' 自动定位，'manual' 用手动坐标 */
  mode: 'gps' | 'manual';
  /** 手动纬度（mode='manual' 时生效） */
  manualLat: number;
  /** 手动经度（mode='manual' 时生效） */
  manualLng: number;
}

export interface UseUserLocationResult {
  /** 当前用户位置（真实或降级值），始终非空 */
  location: UserLocation;
  /** 是否为 mock 降级值（GPS 失败）或手动模式（手动坐标非真实 GPS） */
  isMock: boolean;
}

/**
 * 获取用户位置
 *
 * - mode='manual'：返回手动坐标，不启动 GPS（但仍调用 useState 保证 Hook 顺序稳定）
 * - mode='gps'：getCurrentPosition 快速拿一次（15s 超时），watchPosition 持续更新；
 *               失败时降级 mock 坐标
 *
 * 卸载时 clearWatch 清理。
 */
export function useUserLocation(options: UseUserLocationOptions): UseUserLocationResult {
  const {mode, manualLat, manualLng} = options;

  // 始终调用 useState 保证 Hook 顺序稳定（手动模式下这些 state 不被使用）
  const [gpsLocation, setGpsLocation] = useState<UserLocation>({
    lat: MOCK_USER_LAT,
    lng: MOCK_USER_LNG,
    timestamp: Date.now(),
  });
  const [gpsIsMock, setGpsIsMock] = useState(true);

  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    log('LOCATION', `useEffect 触发 mode=${mode} platform=${Platform.OS}`);

    // 手动模式：不启动 GPS
    if (mode === 'manual') {
      log('LOCATION', '手动模式，跳过 GPS');
      return;
    }
    // 非 Android 直接降级（iOS 未适配）
    if (Platform.OS !== 'android') {
      log('LOCATION', '非 Android 平台，跳过 GPS');
      return;
    }

    let mounted = true;

    const handleSuccess = (pos: GeolocationResponse) => {
      if (!mounted) return;
      const next: UserLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        timestamp: pos.timestamp,
      };
      setGpsLocation(next);
      setGpsIsMock(false);
      log('LOCATION', `定位成功 ${next.lat.toFixed(4)}, ${next.lng.toFixed(4)}`);
    };

    let lowAccuracyRetried = false;

    const handleError = (err: GeolocationError) => {
      if (!mounted) return;
      log('LOCATION', `定位失败 code=${err.code} message=${err.message}`);
      // 高精度超时且未做过低精度重试时，降级到网络定位重试一次
      // 适用场景：室内/弱信号 GPS 无法定位，但网络定位可用
      if (err.code === 3 && !lowAccuracyRetried) {
        lowAccuracyRetried = true;
        log('LOCATION', '高精度超时，降级到低精度（网络定位）重试');
        Geolocation.getCurrentPosition(handleSuccess, handleErrorFallback, {
          enableHighAccuracy: false,
          timeout: FALLBACK_TIMEOUT_MS,
          maximumAge: MAX_CACHE_AGE_MS,
        });
        return;
      }
      handleErrorFallback(err);
    };

    const handleErrorFallback = (err: GeolocationError) => {
      if (!mounted) return;
      setGpsIsMock(prev => {
        if (!prev) {
          log('LOCATION', `定位失败降级 mock: ${err.code} ${err.message}`);
        }
        return true;
      });
      setGpsLocation(prev =>
        prev.lat === MOCK_USER_LAT && prev.lng === MOCK_USER_LNG
          ? prev
          : {lat: MOCK_USER_LAT, lng: MOCK_USER_LNG, timestamp: Date.now()},
      );
    };

    log('LOCATION', `调用 getCurrentPosition enableHighAccuracy=true timeout=${INITIAL_TIMEOUT_MS}`);
    Geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: INITIAL_TIMEOUT_MS,
      maximumAge: MAX_CACHE_AGE_MS,
    });

    log('LOCATION', `调用 watchPosition`);
    watchIdRef.current = Geolocation.watchPosition(handleSuccess, handleErrorFallback, {
      enableHighAccuracy: true,
      interval: WATCH_INTERVAL_MS,
      fastestInterval: WATCH_INTERVAL_MS,
      distanceFilter: WATCH_DISTANCE_FILTER_M,
      useSignificantChanges: false,
    });

    return () => {
      mounted = false;
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [mode]);

  // 手动模式：返回手动坐标；GPS 模式：返回 GPS 定位结果
  if (mode === 'manual') {
    return {
      location: {lat: manualLat, lng: manualLng, timestamp: Date.now()},
      isMock: true,
    };
  }
  return {location: gpsLocation, isMock: gpsIsMock};
}
