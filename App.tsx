// 应用根组件
// 使用 react-navigation native-stack 导航，包含 Onboarding（引导页）、Home（主界面）和 Settings（占位设置页）
// 使用 react-native-gesture-handler 的 GestureHandlerRootView 包裹（导航栈依赖）
// 根据系统色彩模式切换 Navigation 主题
//
// 首次启动检测：
// - useOnboarding 读取 AsyncStorage '@eew_onboarding_completed' 标志
// - null（加载中）→ 渲染空白启动屏
// - false（首次启动）→ 初始路由为 Onboarding
// - true（已完成）→ 初始路由为 Home

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
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import {useOnboarding} from './src/hooks/useOnboarding';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const colors = getColors(isDarkMode);
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

  // 引导状态加载中：渲染空白启动屏，避免路由闪烁
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
