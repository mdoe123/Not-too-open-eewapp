// 应用根组件
// 使用 react-navigation native-stack 导航，包含 Onboarding（引导页）、Home（主界面）和 Settings（占位设置页）
// 使用 react-native-gesture-handler 的 GestureHandlerRootView 包裹（导航栈依赖）
// 根据系统色彩模式切换 Navigation 主题
//
// 启动流程（三层拦截，优先级从高到低）：
// 1. 用户协议/免责声明（useLegalDisclaimer）
//    - null（加载中）→ 渲染空白启动屏
//    - false（未同意）→ 渲染 DisclaimerModal，用户必须同意才能继续
// 2. 引导页（useOnboarding）
//    - null（加载中）→ 渲染空白启动屏
//    - false（首次启动）→ 初始路由为 Onboarding
//    - true（已完成）→ 初始路由为 Home

import React, {useMemo} from 'react';
import {StatusBar, useColorScheme, StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer, DarkTheme, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {getColors} from './src/theme/colors';
import {RootStackParamList} from './src/navigation/types';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import EventDetailScreen from './src/screens/EventDetailScreen';
import SimulateAlertScreen from './src/screens/SimulateAlertScreen';
import AboutScreen from './src/screens/AboutScreen';
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import DisclaimerModal from './src/components/DisclaimerModal';
import {useOnboarding} from './src/hooks/useOnboarding';
import {useLegalDisclaimer} from './src/hooks/useLegalDisclaimer';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const colors = getColors(isDarkMode);
  // 免责声明是最外层拦截（优先级高于 onboarding）
  const {isAcknowledged, acknowledge} = useLegalDisclaimer();
  const {isCompleted} = useOnboarding();

  // 自定义导航主题：黑白简约风格
  // 使用 useMemo 缓存，避免每次渲染都重建对象导致 NavigationContainer 不必要重渲染
  const navigationTheme = useMemo(() => {
    const base = isDarkMode ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
        primary: colors.text,
      },
    };
  }, [isDarkMode, colors]);

  // 第一层：免责声明状态加载中 → 渲染空白启动屏
  if (isAcknowledged === null) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <View style={[styles.splash, {backgroundColor: colors.background}]} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // 第一层：未同意免责声明 → 渲染免责声明弹窗（拦截所有后续流程）
  if (!isAcknowledged) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <DisclaimerModal onAgree={acknowledge} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // 第二层：引导状态加载中 → 渲染空白启动屏，避免路由闪烁
  if (isCompleted === null) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <View style={[styles.splash, {backgroundColor: colors.background}]} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // 首次启动 → 初始路由为 Onboarding；已完成 → Home
  const initialRouteName: keyof RootStackParamList = isCompleted ? 'Home' : 'Onboarding';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <NavigationContainer theme={navigationTheme}>
          <Stack.Navigator
            initialRouteName={initialRouteName}
            screenOptions={{
              headerStyle: {backgroundColor: colors.background},
              headerTintColor: colors.text,
              headerTitleStyle: {fontWeight: '600'},
              headerShadowVisible: false,
              contentStyle: {backgroundColor: colors.background},
            }}>
            <Stack.Screen
              name="Onboarding"
              component={OnboardingScreen}
              options={{headerShown: false}}
            />
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{headerShown: false}}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{title: '设置'}}
            />
            <Stack.Screen
              name="EventDetail"
              component={EventDetailScreen}
              options={{title: '地震详情'}}
            />
            <Stack.Screen
              name="SimulateAlert"
              component={SimulateAlertScreen}
              options={{title: '模拟预警'}}
            />
            <Stack.Screen
              name="About"
              component={AboutScreen}
              options={{title: '关于'}}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
  },
});

export default App;
