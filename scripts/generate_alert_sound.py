#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
地震预警主音生成脚本（DB/T 113.1-2026 标准）

按 DB/T 113.1-2026 标准生成警报主音 WAV 文件：
- 5 个时变频率音频信号叠加
- 每个信号分三阶段：快速上升(0~0.3s) → 缓慢下降(0.3~1.4s) → 快速下降(1.4~2.0s)
- 关键采样点频率数值严格符合标准表 3 规定
- 关键点之间线性插值频率
- 相位累积法生成时变正弦波，保证相位连续
- 采样率：44100Hz，单声道，PCM 16bit WAV
- 时长：2.0 秒

表 3 警报主音各音频信号各阶段关键采样点频率数值（Hz）

| 编号 | 0.0s  | 0.3s  | 1.4s  | 2.0s  |
|------|-------|-------|-------|-------|
| 1    | 1064  | 5288  | 4828  | 1064  |
| 2    | 840   | 4175  | 3812  | 840   |
| 3    | 616   | 3061  | 2795  | 616   |
| 4    | 392   | 1948  | 1779  | 392   |
| 5    | 140   | 696   | 635   | 140   |

依赖：numpy + scipy
    pip install numpy scipy

用法：
    python scripts/generate_alert_sound.py

输出：
    android/app/src/main/res/raw/alert_sound.wav
"""

import os
import sys
import numpy as np
from scipy.io import wavfile

# ==== 参数配置 ====
SAMPLE_RATE = 44100
DURATION = 2.0
AMPLITUDE = 32767  # Short.MAX_VALUE

# ==== DB/T 113.1-2026 表 3 关键采样点 ====
# 每个信号 4 个关键点：(时间s, 频率Hz)
SIGNAL_KEYPOINTS = [
    # 信号 1
    [(0.0, 1064), (0.3, 5288), (1.4, 4828), (2.0, 1064)],
    # 信号 2
    [(0.0, 840),  (0.3, 4175), (1.4, 3812), (2.0, 840)],
    # 信号 3
    [(0.0, 616),  (0.3, 3061), (1.4, 2795), (2.0, 616)],
    # 信号 4
    [(0.0, 392),  (0.3, 1948), (1.4, 1779), (2.0, 392)],
    # 信号 5
    [(0.0, 140),  (0.3, 696),  (1.4, 635),  (2.0, 140)],
]

# ==== 计算输出路径 ====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'android', 'app', 'src', 'main', 'res', 'raw')
OUTPUT_FILE = os.path.join(OUTPUT_DIR, 'alert_sound.wav')


def interpolate_frequency(keypoints, t_array):
    """
    在关键采样点之间线性插值频率

    :param keypoints: [(t0, f0), (t1, f1), ...] 按时间升序
    :param t_array: numpy 数组，需要插值的时间点
    :return: numpy 数组，每个时间点对应的频率
    """
    times = np.array([kp[0] for kp in keypoints])
    freqs = np.array([kp[1] for kp in keypoints])
    # np.interp 自动在关键点之间线性插值，超出范围用边界值
    return np.interp(t_array, times, freqs)


def generate_signal(keypoints, total_samples):
    """
    用相位累积法生成时变频率正弦波

    原理：频率是相位的导数，相位 = ∫2πf(t)dt
    离散化：phase[n] = phase[n-1] + 2π * f[n] / SAMPLE_RATE
    信号 = sin(phase)

    相位累积法保证频率变化时相位连续，无突变咔哒声。

    :param keypoints: 关键采样点列表
    :param total_samples: 总采样数
    :return: numpy 数组，float64 信号
    """
    t_array = np.arange(total_samples) / SAMPLE_RATE
    freq_array = interpolate_frequency(keypoints, t_array)

    # 相位累积
    phase_increment = 2.0 * np.pi * freq_array / SAMPLE_RATE
    phase = np.cumsum(phase_increment)

    return np.sin(phase)


def generate_pcm():
    """
    生成 5 个时变频率信号叠加的 PCM 数据

    步骤：
    1. 分别生成 5 个时变正弦波（相位累积法）
    2. 5 个信号相加
    3. 归一化到 [-AMPLITUDE, +AMPLITUDE] 范围
    4. 转换为 int16
    """
    total_samples = int(SAMPLE_RATE * DURATION)

    # 生成 5 个信号并叠加
    mixed = np.zeros(total_samples, dtype=np.float64)
    for i, keypoints in enumerate(SIGNAL_KEYPOINTS):
        signal = generate_signal(keypoints, total_samples)
        mixed += signal

    # 归一化：先按峰值归一化到 [-1, 1]，再缩放到 [-AMPLITUDE, +AMPLITUDE]
    peak = np.max(np.abs(mixed))
    if peak > 0:
        mixed = mixed / peak
    pcm = (mixed * AMPLITUDE).astype(np.int16)

    return pcm


def main():
    print('生成地震预警主音 WAV 文件（DB/T 113.1-2026 标准）')
    print(f'  采样率: {SAMPLE_RATE} Hz')
    print(f'  时长: {DURATION} 秒')
    print(f'  信号数: {len(SIGNAL_KEYPOINTS)} 个时变频率信号叠加')
    print(f'  三阶段: 快速上升(0~0.3s) → 缓慢下降(0.3~1.4s) → 快速下降(1.4~2.0s)')
    print()
    print('  各信号关键采样点频率(Hz):')
    print('  编号 | 0.0s  | 0.3s  | 1.4s  | 2.0s')
    print('  -----|-------|-------|-------|------')
    for i, kp in enumerate(SIGNAL_KEYPOINTS, 1):
        print(f'  {i}    | {kp[0][1]:<5} | {kp[1][1]:<5} | {kp[2][1]:<5} | {kp[3][1]:<5}')

    # 创建输出目录
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'\n  输出目录: {OUTPUT_DIR}')

    # 生成 PCM 数据
    pcm = generate_pcm()
    print(f'  PCM 样本数: {len(pcm)}')

    # 写入 WAV 文件
    wavfile.write(OUTPUT_FILE, SAMPLE_RATE, pcm)

    file_size = os.path.getsize(OUTPUT_FILE)
    print(f'  文件大小: {file_size} 字节 ({file_size / 1024:.1f} KB)')
    print(f'  输出文件: {OUTPUT_FILE}')
    print(f'完成！')


if __name__ == '__main__':
    try:
        main()
    except ImportError as e:
        print(f'错误：缺少依赖库 - {e}', file=sys.stderr)
        print(f'请运行: pip install numpy scipy', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'错误：{e}', file=sys.stderr)
        sys.exit(1)
