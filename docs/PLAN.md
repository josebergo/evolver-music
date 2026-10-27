# Evolver Music — 心情音乐桌面软件 · 技术方案（Wails + Go 版）

> 一句话：输入一段心情文字（几个词、一句话、一篇文章都行），软件生成一首贴合这份心情的原创音乐；风格（DJ、蓝调等）可选；全程零 API 费用；Wails + Go 单文件交付（约 20~40MB），不是 Electron 的百兆级。

---

## 0. 关键调研结论（已在本机验证）

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| zcode 有没有可复用的对外 API？ | **没有。** ZCode 桌面版是 Electron GUI，无 CLI；其登录凭证是专用 JWT（`~/.zcode/v2/credentials.json`），绑定 zcode 应用本身，会轮换、也不应被第三方软件盗用 | 本机检查 ZCode 安装目录与配置 |
| 那"不另外花钱的 AI"怎么办？ | 用**智谱开放平台的 GLM Flash 系列免费 API**——与 zcode 同厂、同 GLM 模型家族（zcode 内置供应商端点即 `api.z.ai`）。注册即得免费 Key，OpenAI 兼容接口 | [GLM-4-Flash 免费文档](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414)、[GLM-4.7-Flash 免费文档](https://docs.bigmodel.cn/cn/guide/free/glm-4.7-flash) |
| 智谱有云端音乐生成 API 吗？ | **没有**（只有文本/图像/CogVideoX 视频）。所以音乐本体走"AI 作曲 + 本地合成"路线 | [BigModel 产品列表](https://bigmodel.cn) |
| Wails + Go 工具链 | **全部就绪**：Wails v2.16.0、Go 1.27.0、WebView2 Runtime 155.0.4283.62（已装）、Node 26.8.1 / npm 11.19 / pnpm 12.5、ffmpeg 8.1.2（开发期辅助）。`wails doctor` 无缺项；upx / NSIS 为可选（打包期自动下载） | 本机 `wails doctor` 实测 |

**AI 成本结论：心情→音乐规格的一次调用约 1~2K token，落在 GLM Flash 免费额度内（有限流），实际使用零成本。** 应用内做 Provider 抽象，默认 GLM Flash 免费；设置页可填任意 OpenAI 兼容端点（z.ai、DeepSeek 等）。

**为什么 Wails 而不是 Electron：** 单 exe 约 20~40MB（含内嵌音源；纯程序约 10~15MB），Electron 同等功能 100~150MB 起；启动快、内存占用低（复用系统 WebView2，不自带 Chromium）；Go 后端天然擅长 HTTP 调用、文件 IO、配置管理。代价：依赖系统 WebView2（本机已装；Win10/11 绝大多数自带，极少数老机器安装包里捆绑引导装一次即可）。

---

## 1. 产品定义

**输入**
- 心情文本：几个词 / 一句话 / 一段文章，任意长度
- 可选风格：`自动（AI 判断）`、Lo-Fi Chill、DJ/EDM、蓝调、氛围 Ambient、钢琴独奏、爵士、古风、Synthwave、电影感
- 可选参数：时长（30s / 1min / 2min / 3min）、速度倾向、能量倾向

**输出**
- 一首结构完整（前奏—主段—高潮—尾奏）的原创器乐曲，即时播放
- 导出 WAV / MP3
- 历史记录：每次生成的（心情文本、参数、音乐规格、音频文件）自动归档，可回放、可收藏
- 不做真人歌声（免费路径做不到高质量人声；后期可作为付费可选接入）

---

## 2. 总体架构：三段式管线

```
┌─────────────────────────── WebView2 前端（React + Tone.js）───────────────────────────┐
│  输入界面 → Go 绑定调用 Compose() ──────────→ 音乐规格 JSON → 音频引擎（Tone.js+SoundFont）│
│                                        ↑                                    → 播放          │
└──────────────────────────────┼──────────────────────────────────→ OfflineAudioContext ─┼─→ WAV/MP3 字节流
                               │                                                        ↓
┌──────────────────────────────┴────────────── Go 后端（Wails 绑定）──────────────────────┐
│  AI Provider：net/http 调 GLM Flash（无 CORS 问题，Key 只存 Go 侧）                        │
│  降级引擎：情感词典 → 心情四维 → 风格配方（纯 Go，离线可用）                                 │
│  设置存储（%AppData%）· 历史索引 · 保存对话框 + 文件写盘                                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### ① 心情理解 + 作曲（唯一的 AI 环节，零成本，跑在 Go 后端）

Go 侧用 `net/http` 直调 `https://open.bigmodel.cn/api/paas/v4/chat/completions`（模型 `glm-4-flash` 或最新免费 Flash 版本）。**放在 Go 而不是前端 fetch**：WebView 的 wails:// 源直连外部 API 有 CORS 不确定性，且 API Key 留在后端更安全。Prompt 要求输出**受 JSON Schema 约束的音乐规格**：

```jsonc
{
  "mood": { "valence": 0.35, "energy": 0.25, "tension": 0.2, "warmth": 0.6 },  // 心情四维
  "style": "lofi",
  "tempo": 85,
  "key": "Bm",
  "sections": [
    { "name": "intro", "bars": 4, "energy": 0.3,
      "chords": ["Bm7", "Gmaj7", "D", "A7"],
      "melody": [ /* 音高+时值序列，限制在音域内 */ ],
      "bassPattern": "soft_walk", "drumPattern": "lofi_sparse", "layers": ["epiano", "vinyl"] }
    // verse / chorus / outro ...
  ],
  "mix": { "reverb": 0.4, "sidechain": 0, "lofiCharacter": 0.7 }
}
```

Go 侧与前端**共用同一份 zod/JSON Schema 定义的类型**（TS 类型 + Go struct 双份，M1 用代码生成或手写对齐，测试保证字段一致）。

**质量保障（防 AI 乱写导致听不了）：**
- 每种风格是一份**约束模板**（和弦库、节奏型枚举、音色枚举、速度区间），LLM 只在模板内"填空"而不是自由发挥
- **校验器**（Go + 前端 zod 双保险）：和弦合法性、旋律音域、小节对齐、时值总和，不合法的项自动修正或重试
- 规格里带生成种子，同一规格确定性渲染，方便"重新生成"只改 AI 层不重算渲染

### ② 音乐渲染（100% 本地，WebView2 前端内）

- **Tone.js**（Web Audio 框架）：调度和弦垫/旋律/贝斯/鼓组/氛围层。WebView2 是 Chromium 内核，Web Audio / OfflineAudioContext 完整支持，所听即所渲染
- **SoundFont**（`smplr` 加载 FluidR3_GM 派生的**按乐器子集**开源免费音源）：钢琴、电钢、贝斯、管风琴、爵士鼓等真实音色；只内嵌用到的乐器（约 15~25MB），而非整包 140MB
- **合成器音色**（Tone.js 内置）：supersaw/pluck/sub-bass 覆盖 DJ/EDM/Synthwave
- **效果链**：混响、delay、sidechain 压缩（电子风格）、bitcrush + 黑胶噪声（Lo-Fi）、滤波器扫频
- 风格即"配方"：`蓝调 = 12小节进行 + shuffle 节奏 + 属七和弦 + 吉他/口琴音色`，`DJ/EDM = 四踩底鼓 + supersaw 和弦 + drop 段落结构 + sidechain`

### ③ 播放、导出与归档

- 实时播放走 AudioContext；**导出走 OfflineAudioContext 离线渲染**（比实时快）→ 前端编 WAV；MP3 用 `lamejs`（纯 JS，免 CGO/免外部依赖）
- 音频字节流经 Wails 绑定传给 Go → Go 弹**原生保存对话框** → 写盘（前端无文件系统权限，这是 Wails 的标准做法）
- 历史记录：Go 侧管理 `%AppData%/evolver-music/tracks/`（音频文件）+ JSONL 索引（心情原文、参数、规格 JSON）

### 降级链（软件永远可用）

```
GLM Flash API（Go 调用）──失败──▶ 重试(指数退避×2) ──仍失败──▶ 本地规则引擎（纯 Go）
                                                               关键词/情感词典 → 心情四维
                                                               → 从风格模板库直接取参数化配方
```

---

## 3. 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 桌面壳 | **Wails v2.16**（已装）+ WebView2（已装 155） | 单 exe 约 20~40MB；复用系统 WebView2；Go 后端无 CGO 依赖 |
| Go 后端 | Go 1.27 标准库为主（net/http、embed、os、runtime/dialog） | AI 调用、设置、历史、文件写盘全部零第三方依赖起步 |
| 前端构建 | Vite（`wails init` 官方 react-ts 模板自带） | `wails dev` 热重载，调试音频参数友好 |
| 前端 | React 18 + TypeScript + Zustand | 类型约束音乐规格 JSON；状态简单 |
| 音频 | **Tone.js** + smplr(soundfont) + lamejs | 见 §2 |
| AI | Go `net/http` 直调 OpenAI 兼容接口（GLM Flash 免费） | 无 CORS、Key 不进前端；Provider 可替换 |
| 本地存储 | `%AppData%/evolver-music/` + JSONL 索引 + JSON 设置 | 简单够用，后期可换 bbolt/SQLite |
| 打包 | `wails build`（单 exe，`-upx` 可选压缩）；NSIS 安装器（`wails build -nsis`，自动下载 NSIS） | 本机 doctor 已确认 upx/nsis 可用 |
| 包管理 | 前端 pnpm（12.5 已装）；Go modules | — |

### 主要依赖清单

- **npm（前端）**：`react`、`zustand`、`tone`、`smplr`、`@breezystack/lamejs`（lamejs 维护分支）、`zod`
- **Go（后端）**：起步仅 Wails v2 自带；后续视需要 `github.com/google/uuid` 等，保持极简

**体积预算**：Go+前端程序 ~12MB + 按乐器子集 SoundFont ~15~25MB = 单 exe 约 20~40MB（upx 后更小）。对比：Electron 同方案 100~150MB。

---

## 4. 需要的外部资源（一次性、均免费）

| 资源 | 获取方式 | 用途 |
| --- | --- | --- |
| 智谱 API Key | bigmodel.cn 注册 → 控制台建 Key（免费） | GLM Flash 心情理解+作曲；软件设置页填入，Go 侧加密存储 |
| SoundFont 音源 | FluidR3_GM / MusyngKite 派生的按乐器子集文件（开源免费） | 真实乐器音色，随 exe 内嵌，离线可用 |

---

## 5. 开发过程中使用的 ZCode 能力 / Skill（给开发 agent 用，不进产品）

| Skill / 工具 | 用途 | 阶段 |
| --- | --- | --- |
| `frontend-design` | 播放器界面与生成页视觉设计 | M1/M2 |
| `test-driven-development` | 规格 JSON 校验器（Go + TS 双侧）、和弦/节奏编译器的单测 | M1/M2 |
| `verification-before-completion` | 每个里程碑的实际播放/导出/`wails build` 验证 | 全程 |
| `hyperframes-audio`（参考） | 不直接用（它是视频合成的混音 skill），但其效果链次序（先滤波后压缩、混音 bus、limiter 收尾）与 ducking 思路作为音频引擎设计参考 | M2 |
| `media-use`（可选） | 需要对照样本/灵感素材时，用其 HeyGen 免费额度检索现成 BGM；非核心依赖 | M4 |

---

## 6. 界面草图（单窗口三区）

```
┌──────────────────────────────────────────────┐
│  Evolver Music                    [历史][设置] │
├──────────────────────────────────────────────┤
│  现在的心情是…                                  │
│  ┌────────────────────────────────────────┐  │
│  │ （多行文本框：几个词 / 一句话 / 一篇文章）      │  │
│  └────────────────────────────────────────┘  │
│  风格: [自动▾]  时长: [2min▾]  能量: ──●──     │
│                          [ ✦ 生成音乐 ]        │
├──────────────────────────────────────────────┤
│  ▶ ━━━━━━━●━━━━ 01:23 / 02:00   🎵 Lo-Fi·85bpm│
│  mood: 疲惫但平静 · Bm · Bm7→Gmaj7→D→A7        │
│  [重新生成] [导出 WAV] [导出 MP3] [♥收藏]        │
├──────────────────────────────────────────────┤
│  历史: 今天·昨天·更早（卡片列表，点击回放）        │
└──────────────────────────────────────────────┘
```

---

## 7. 里程碑

| 里程碑 | 内容 | 验收标准 |
| --- | --- | --- |
| **M1 核心管线**（先跑通再打磨） | `wails init`（react-ts）脚手架；Go 侧 GLM Flash 调用 + Schema 约束 + 降级引擎；规格校验器（zod 前端 + Go 双侧）；Tone.js 按 2 种风格（自动 Lo-Fi / 电子）渲染 30–60s 循环并播放 | 断网情况下输入"下雨天有点丧"仍能生成可听的 lo-fi 循环 |
| **M2 完整产品** | 8–10 种风格模板；SoundFont 音色子集；多段结构与能量曲线；WAV/MP3 导出（Go 对话框+写盘）；历史记录与收藏；参数滑杆 | 每种风格抽查试听；导出文件可被系统播放器打开 |
| **M3 打包分发** | `wails build` 单 exe + NSIS 安装器；首启动引导（填 API Key，可跳过走离线模式） | 干净 Windows 机器安装后可用；exe ≤ 40MB |
| **M4 增强（可选）** | 心情日记（按日期归档生成的音乐）；频谱可视化；更多风格包；重新生成只换段落不换整体 | — |

---

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| LLM 规格质量不稳定 | 风格模板约束 + 校验器自动修正 + 失败重试/降级本地引擎 |
| 免费 API 限流 | 单次生成 token 量极小；加本地缓存（同心情同参数命中缓存）；限流时自动切离线引擎 |
| 合成音色"电子味"重 | SoundFont 优先做声学乐器；Lo-Fi/EDM 本就是电子音色，扬长避短 |
| 长文本心情（一篇文章） | LLM 先做一次摘要→心情四维，再作曲；两步在一次请求内完成 |
| WebView2 依赖 | 本机已装；Win10/11 绝大多数自带；安装器内置官方引导（Evergreen bootstrap）兜底 |
| Wails v3 尚在 alpha | 锁定 v2.16 稳定版；架构上前后端通过绑定层隔离，未来迁移 v3 只动壳 |
| 前后端规格类型漂移 | Go struct 与 TS zod schema 双侧单测对齐（固定用例 JSON 两边解析结果一致） |
| zcode 未来开放 API | Provider 抽象已预留，届时切换端点即可 |

---

## 9. 目录结构（M1 落地时）

```
evolver-music/
├─ docs/PLAN.md                # 本方案
├─ main.go                     # Wails 入口
├─ app.go                      # 绑定层：Compose/Export/Settings/History 等方法
├─ internal/
│  ├─ ai/                      # provider(GLM Flash/自定义) + prompt + 降级引擎（纯 Go）
│  ├─ schema/                  # 音乐规格 Go struct + 校验
│  └─ store/                   # 设置(%AppData%) + 历史 JSONL 索引
├─ frontend/                   # Vite + React + TS
│  ├─ src/
│  │  ├─ music/                # 风格模板库 / 和弦与节奏编译器 / zod schema
│  │  ├─ audio/                # Tone.js 引擎：编排、音色加载、效果链、离线渲染、WAV/MP3 编码
│  │  ├─ store/                # Zustand 状态
│  │  └─ ui/                   # React 界面
│  ├─ src/assets/soundfonts/   # 内嵌的按乐器子集音源（wails embed 进 exe）
│  └─ wailsjs/                 # Wails 自动生成的绑定（go ⇒ ts）
└─ wails.json                  # Wails 配置（窗口、打包选项）
```
