# Piwin 砚 · 宣传片

约 1 分 50 秒的产品介绍动画，Inkstone（砚）视觉语言：一滴墨 → ensō → 七大特色 → 三步上手 → 真实对话 → 尾声。
画面与配乐全部由代码生成（Canvas 水墨 + DOM 界面 + Web Audio 合成古琴/太鼓/音效），无外部素材依赖。

## 播放

```bash
python3 -m http.server 8802 --bind 127.0.0.1 --directory .   # 在仓库根目录
open http://127.0.0.1:8802/docs/marketing/promo/
```

快捷键：空格 播放/暂停 · ←/→ 快退/快进 5 秒 · 1–9 跳到章节 · M 静音 · F 全屏。
`?t=41.6` 从指定秒数开始。

## 导出 MP4

需要系统 Chrome 与 ffmpeg，服务器同上：

```bash
node docs/marketing/promo/export.mjs --dir dist/promo            # 全片 + 配乐
node docs/marketing/promo/export.mjs --dir dist/promo --stills 7,25.5,80   # 抽帧检查
```

每一帧都是时间 `t` 的纯函数（`window.__promo.frame(t)`），配乐由同一份事件表经 `OfflineAudioContext` 渲染，
所以导出结果与实时播放一致。产物放在 `dist/`（已 gitignore），不要提交视频二进制。

## 结构

| 文件 | 职责 |
| --- | --- |
| `index.html` | 各场景 DOM，`data-in / data-fx / data-steps` 声明入场与状态 |
| `promo.css` | Inkstone 墨面/纸面令牌与组件 |
| `js/timeline.js` | 场景表、缓动、声明式动画器 |
| `js/ink.js` | 水墨晕染、ensō 笔触、落墨、朱笔翻页 |
| `js/scenes.js` | 场景专属运动（数据包、声纹、滚动、画廊漂移） |
| `js/score.js` | 配乐事件表与合成引擎 |
| `js/main.js` | 播放器、控件、导出 API |
| `export.mjs` | 逐帧截图 + ffmpeg 合成 |
