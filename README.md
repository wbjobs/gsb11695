# 字形缓存 / 位图字体 / SDF 字体 — 10 万字符渲染性能对比

纯前端 Demo（无构建步骤），对同一份 10 万字符文本用三种方案渲染并量化对比：

| 方案 | 原理 | 特点 |
| --- | --- | --- |
| 字形缓存 | 每个 (字符, 尺寸桶) 光栅化一次存入 LRU 缓存，`drawImage` 复用 | 缓存命中后极快；内存受预算控制，超预算按 LRU 淘汰 |
| 位图字体 | Worker 预生成固定分辨率图集，逐字符 `drawImage` 贴图 | 单图集内存小；放大明显模糊（固定分辨率的固有缺陷） |
| SDF 字体 | Worker 将字形转为有向距离场图集，WebGL2 着色器 `fwidth` 平滑重建边缘 | 任意缩放/旋转都清晰；WebGL2 不可用时自动降级到位图字体 |

## 运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

（必须通过 HTTP 访问：ES Module、Worker、fetch 均不支持 file:// 协议。）

## 技术栈落点

- **Canvas**：2D 画布（字形缓存、位图字体）+ WebGL2 画布（SDF），视口剔除只画可见字符
- **FontFace API**：`src/font-manager.js` 动态加载字体并注册，加载完成后触发重渲染
- **Web Worker**：`src/workers/atlas-worker.js` 在后台线程光栅化字形、计算 SDF（Chamfer 距离变换），回报进度
- **PerformanceObserver**：`src/perf.js` 采集每帧 `measure`（avg / p95 / FPS）与 `longtask`
- **IndexedDB**：`src/db.js` 持久化字体二进制与已生成图集（PNG blob），二次打开秒载

## 验收路径对照

- **三种方案渲染正确**：左上角切换「渲染方案」，三方案共用同一份文本与版式
- **性能对照可量化**：点「运行基准对比」，三方案各渲 60 帧，输出 avg / p95 / FPS / 内存对照表；勾选「连续渲染」可实时观察
- **缩放旋转正确**：拖动缩放（0.1×–8×）与旋转（0–360°）滑杆；位图方案放大可见模糊，SDF 始终清晰
- **字体加载后重渲染**：切换字体下拉框，FontFace 加载完成后三个方案自动重排重渲（日志可见来源：网络 / IndexedDB）
- **缓存失效正确**：点「缓存失效」清空字形 LRU 缓存 + IndexedDB 图集并强制重建；切换字体也会自动使字形缓存失效（统计面板「失效」计数 +1）
- **内存控制**：调整「缓存预算 (MB)」，字形缓存超预算即按 LRU 淘汰，统计面板实时显示 命中/未命中/淘汰/内存
- **降级到位图字体**：WebGL2 不可用或 SDF 图集生成失败时自动切换到位图方案并写日志（可用 `chrome://flags` 关闭 WebGL 验证）

## 测试

```bash
node test/run-tests.mjs   # LRU 缓存 / SDF 距离场 / 文本生成 / 布局与剔除 的纯逻辑测试
```

## 目录结构

```
index.html            页面与控件
styles.css
fonts/                内置 DejaVu 字体（FontFace 加载）
src/
  main.js             编排：UI 状态、渲染器生命周期、基准测试、验收流程
  font-manager.js     FontFace 加载 + IndexedDB 字体缓存
  atlas-client.js     图集 Worker 客户端 + IndexedDB 图集缓存
  perf.js             PerformanceObserver 封装
  db.js               IndexedDB 封装
  lru.js              LRU 缓存（字节预算 + 淘汰统计）
  sdf-core.js         SDF 距离变换（纯函数）
  layout.js           字符级贪心换行布局 + 视口剔除
  text-gen.js         确定性伪随机文本生成
  view2d.js           2D 视图变换（缩放/旋转/逆变换）
  renderers/          三种渲染器
  workers/            图集生成 Worker
test/run-tests.mjs    Node 纯逻辑测试
```
