# 大规模文本渲染对比 Demo：字形缓存 / 位图字体 / SDF 字体

纯前端、零构建、零依赖。渲染 10 万字符，横向对比三种文本渲染方案的性能与质量。

## 运行

```bash
cd B
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 必须通过 HTTP 访问（ES Module 与 Web Worker 不支持 file:// 协议）。

## 三种方案

| 方案 | 实现 | 特点 |
|---|---|---|
| 字形缓存 | Canvas 2D 动态图集，按需光栅化，缓存键 = 字体\|量化尺寸\|字符 | 首次未命中时光栅化，命中后纯 `drawImage`；内存超预算整代驱逐 |
| 位图字体 | 固定 32px 基准图集，一次构建 | 渲染最快，但放大明显模糊（对照“缩放模糊”） |
| SDF 字体 | 主线程光栅化掩码 → Web Worker 计算距离场 → WebGL smoothstep 渲染 | 构建最慢，任意缩放/旋转边缘清晰 |

## 技术栈覆盖

- **Canvas**：2D 图集 + 渲染（方案一/二），WebGL 画布（方案三）
- **FontFace API**：URL / 本地文件加载自定义字体，`document.fonts` 注册
- **Web Worker**：SDF 距离场计算（两遍 Chamfer 变换），不阻塞主线程
- **PerformanceObserver**：监听 `longtask` 与 `measure`，量化每方案渲染耗时
- **IndexedDB**：字体二进制持久化，刷新后自动恢复；可一键清空

## 验收标准对照

| 验收项 | 操作 |
|---|---|
| 三种方案渲染正确 | 左侧面板切换“渲染方案”，画布实时切换 |
| 性能对照可量化 | 点击“运行基准测试”：帧均 / 渲染耗时 / FPS / 冷启动四列对比；实时面板显示 FPS、缓存命中率、内存占用 |
| 缩放旋转正确 | “缩放”“旋转”滑杆（SDF 任意角度清晰，位图放大模糊，字形缓存按量化尺寸重新光栅化） |
| 字体加载后重渲染正确 | 输入字体 URL 或选择本地字体文件 → FontFace 加载 → 三方案图集自动失效重建 |
| 缓存失效正确 | “失效缓存”按钮 / 内存预算调小触发驱逐；面板“缓存代际”“驱逐”计数递增，重渲染结果一致 |
| 降级到位图字体 | 勾选“模拟 SDF 构建失败”或在无 WebGL 环境选择 SDF → 自动切换位图字体并显示降级横幅 |

## 其他特性

- **内存控制**：字形缓存预算（MB）可调，超预算整代驱逐并统计
- **大量文本**：1 万 / 5 万 / 10 万字符切换，滚轮滚动、拖拽平移，按行保守裁剪只渲染可见区
- **降级**：SDF 构建失败 / WebGL 缺失 / 模拟失败 → 自动降级位图字体

## 目录结构

```
index.html                  页面与控件
css/style.css
js/main.js                  主控：UI、渲染循环、方案切换、降级、基准测试
js/text.js                  确定性伪随机文本生成（594 唯一字符）
js/layout.js                网格布局 + 视图仿射变换 + 可见区裁剪
js/perf.js                  PerformanceObserver 监控 + 基准测试
js/font-loader.js           FontFace 加载 + IndexedDB 持久化
js/idb.js                   IndexedDB 极简封装
js/renderers/glyph-cache.js 方案一：字形缓存（动态图集 + 预算驱逐）
js/renderers/bitmap-font.js 方案二：位图字体（固定尺寸图集）
js/renderers/sdf-font.js    方案三：SDF（WebGL 渲染）
js/workers/sdf-worker.js    SDF 距离场计算 Worker
```
