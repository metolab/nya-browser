# Windows 伪装：指标清单、总体设计与 e2e 测试方案

状态：已实现
基线版本：Chromium `157.0.8103.78`（`browser/VERSION`，ungoogled-chromium 157.0.8103.78-1）

## 1. 目标与范围

在 Linux 宿主机上运行的 Nya Chromium，按会话可选两种操作系统身份：

| 选项 | 含义 |
|---|---|
| `linux` | 不做任何 OS 伪装 |
| `windows`（伪装，新会话默认） | 网页可观察到的 OS 相关信号尽量与 Windows 10/11 上的 Google Chrome 一致 |

目标：

1. 通过 UA 类检测、BrowserLeaks 基础页、CreepJS 的 "lies" 一致性检查。
2. 每一项伪装都有可自动执行的 e2e 判定，并以 Windows 真机采集的报告作为基准。
3. `linux` 选项零回归。

不在范围内：

- TCP/IP 层 OS 指纹（TTL、窗口大小等）：网站看到的是代理出口，由代理节点决定。
- TLS（JA3/JA4）与 HTTP/2 指纹：由 Chrome 网络栈决定，跨平台一致，无需处理。
- 顶级风控的黑盒判定：只能人工抽样，不作为自动化门槛。
- 浏览器自身 UI（标题栏、菜单外观）：网页不可见，只影响 VNC 观感。

## 2. 现状（已具备的能力）

| 能力 | 位置 | 说明 |
|---|---|---|
| 每会话指纹配置 | `shared/src/types.ts` 的 `FingerprintConfig`；`backend/src/runtime/fingerprint.ts` | 种子、CPU/内存、GPU 型号、WebRTC、地理位置、字体库 |
| 启动参数注入 | `backend/src/runtime/session/chromeConfig.ts` 的 `chromeArgs()` | `--nya-fp-seed`、`--nya-gpu-*`、`--nya-fonts`、`--nya-ua-brand=Google Chrome` 等 |
| 参数下发到渲染进程 | 补丁 `001-build-switches`（`RenderProcessHostImpl` 的开关白名单） | 新增开关需加入该白名单 |
| Windows 字体库 | 镜像内的真实 Windows 字体与 `backend/src/runtime/windowsFonts.ts`（按版本生成 fontconfig）；没有真实字体的镜像改用 `config/fonts-windows-aliased.conf`（Linux 字体别名成 Windows 字体名）加 `shared/src/windowsFontNames.ts` 的字体名过滤；补丁 `004-fonts` | 跟随 `os` 和 `windowsRelease` 自动选择，不可手动配置；Linux 会话只用全局 fontconfig 里的真实 Linux 字体 |
| GPU 型号伪装 | 补丁 `006-webgl-webgpu`；`shared/src/gpuProfiles.ts` | 仅在 NVIDIA 同厂商内改型号，SwiftShader 不改 |
| Google Chrome 品牌 | 补丁 `002-identity`（`user_agent_utils.cc`） | UA-CH brands 含 `Google Chrome` |
| 网络语音 | 补丁 `008-speech` | Google 网络语音 |
| Widevine | `scripts/install-widevine.sh` | 镜像内安装 CDM |
| Device-Memory 请求头 | 补丁 `002-identity` | 与 `navigator.deviceMemory` 一致 |
| 媒体设备名 | `shared/src/mediaDevices.ts` | 按 OS、种子和语言自动生成，无手动配置：Windows 为 `麦克风 (Realtek(R) Audio)` 一类加 USB 摄像头，Linux 为 PulseAudio 声卡名加 V4L2 摄像头 |
| 现有指纹 e2e | `scripts/e2e-fingerprint.mjs`、`e2e-fonts.mjs`、`e2e-gpu-params.mjs` | API 建会话，通过 CDP 跑探针，逐项 `check()` |

当前实测（本地 SwiftShader 会话）：

```text
navigator.userAgent = Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36
UNMASKED_RENDERER  = ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
```

现有 e2e 的已知不稳定因素：依赖 `https://example.com`、`https://httpbin.org`。首次导航偶发停在 `about:blank`，导致需要安全上下文的检查（`mediaDevices`、地理位置、WebGPU）误报失败。新测试必须用本地探针服务（见第 5 节）。

## 3. 指标清单

档位说明：

- **P1**：身份，必须完全一致。
- **P2**：一致性，主流检测站点会交叉比对。
- **P3**：渲染细节，只能逼近，用偏差分衡量。
- **已有**：只需回归验证。

判定方式（规则引擎见第 5.4 节）：

| 判定方式 | 含义 |
|---|---|
| `exact` | 与基准完全相等 |
| `pattern` | 匹配正则或格式 |
| `set` | 集合相等 |
| `num` | 数值相等，可带容差 |
| `consistency` | 同一指标在多个上下文（主线程、Worker、请求头）之间必须一致 |
| `stability` | 同一会话内多次读取稳定，跨会话不同 |
| `deviation` | 输出与基准的偏差分，不判通过与否 |
| `verify` | 预期无需改动，只确认 |

Windows 目标值写"以基准为准"的项，最终以第 5.3 节采集的真机报告为准；表中给出的是常见值，用于设计参考。

### 3.1 身份（ID）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| ID-01 | UA 字符串 | `navigator.userAgent`、`appVersion`、`User-Agent` 请求头 | `X11; Linux x86_64` | `Windows NT 10.0; Win64; x64`（Win10、Win11 相同） | `content/common/user_agent.cc` 的统一平台串（补丁 `002-identity`） | exact | P1 |
| ID-02 | `navigator.platform` | JS | `Linux x86_64` | `Win32` | `third_party/blink/renderer/core/execution_context/navigator_base.cc`、`navigator_id.cc` | exact | P1 |
| ID-03 | UA-CH 平台 | `navigator.userAgentData.platform`、`Sec-CH-UA-Platform` | `"Linux"` | `"Windows"` | `components/embedder_support/user_agent_utils.cc`（补丁 `002-identity`） | exact | P1 |
| ID-04 | 平台版本 | `getHighEntropyValues(['platformVersion'])`、`Sec-CH-UA-Platform-Version` | 空字符串（Chromium 在 Linux 上的默认值） | Win10：`10.0.0`（微软约定 1.0.0 到 10.0.0）；Win11：13.0.0 及以上，具体值以基准为准 | 同 ID-03 | exact | P1 |
| ID-05 | 架构、位数、WoW64、型号、外形 | `architecture`、`bitness`、`wow64`、`model`、`formFactors` | `x86`、`64`、`false`、`""`、`["Desktop"]` | 同左 | 无需改动 | verify | P1 |
| ID-06 | 按需下发的高熵请求头 | 服务端发 `Accept-CH` 或 `Critical-CH` 后的请求头 | Linux 值 | 与 ID-03、ID-04 一致 | 网络层复用同一份 metadata | consistency | P1 |
| ID-07 | 各上下文一致 | Dedicated Worker、Shared Worker、Service Worker、iframe 内的 `navigator.*` | — | 与主线程完全一致 | 同一代码路径，验证即可 | consistency | P1 |
| ID-08 | CDP 版本信息 | `Browser.getVersion`、`/api` 的 CDP version 接口、SDK | Linux UA | Windows UA | 跟随 ID-01 自动变化 | exact | P1 |
| ID-09 | 品牌 | `brands`、`fullVersionList`、`Sec-CH-UA` | `Google Chrome` | 同左 | 补丁 `002-identity` | exact | 已有 |
| ID-10 | Firefox 专有字段 | `navigator.oscpu`、`buildID` | `undefined` | `undefined` | 无需改动 | verify | P1 |

### 3.2 图形（GFX）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| GFX-01 | WebGL 显卡字符串格式 | `UNMASKED_RENDERER_WEBGL` | `ANGLE (NVIDIA, NVIDIA GeForce .../PCIe/SSE2, OpenGL 4.5 ...)` 或 Vulkan 格式；无 GPU 时为 SwiftShader | `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)` | 补丁 `006-webgl-webgpu` 与 `nya_farbling.cc` 的 `MaybeSpoofUnmaskedRenderer`（已支持 `(0x...)` 段） | pattern | P2 |
| GFX-02 | WebGL 厂商字符串 | `UNMASKED_VENDOR_WEBGL` | `Google Inc. (NVIDIA)` | 同左（以基准为准） | — | exact | P2 |
| GFX-03 | WebGL1/2 上限参数 | `getParameter(...)` | GL 或 Vulkan 后端的值 | D3D11 后端的值。常见差异：`ALIASED_LINE_WIDTH_RANGE` 为 `[1,1]`，`MAX_VERTEX_UNIFORM_VECTORS` 为 4095，`MAX_FRAGMENT_UNIFORM_VECTORS` 为 1024，`MAX_VARYING_VECTORS` 为 30；以基准为准 | 新补丁：按 Windows 配置表覆盖 `getParameter` | num | P2 |
| GFX-04 | WebGL 扩展列表 | `getSupportedExtensions()`（WebGL1/2） | GL 或 Vulkan 后端的集合 | D3D11 后端的集合 | 新补丁：Linux 多出的扩展隐藏；Windows 独有、Linux 实现不了的扩展列为风险项 | set | P2 |
| GFX-05 | 着色器精度 | `getShaderPrecisionFormat` | — | 以基准为准 | 新补丁 | exact | P2 |
| GFX-06 | 上下文默认属性、`MAX_SAMPLES` | `getContextAttributes()` 等 | — | 以基准为准 | 新补丁 | exact | P2 |
| GFX-07 | WebGPU 适配器信息 | `adapter.info` 的 vendor、architecture、device、description | Vulkan 后端格式 | D3D12 后端格式 | 补丁 `006-webgl-webgpu` | pattern | P2 |
| GFX-08 | WebGPU limits 与 features | `adapter.limits`、`adapter.features` | Vulkan 值 | D3D12 值 | 新补丁：配置表覆盖 | set、num | P2 |
| GFX-09 | 无 GPU 时的表现 | 上述全部 | SwiftShader | 真实 Windows 很少用 SwiftShader | 后端在 `windows` 加 SwiftShader 组合时给出警告 | verify | P2 |
| GFX-10 | 渲染哈希 | canvas、WebGL `readPixels` 哈希 | 已加噪声 | 同会话稳定，跨会话不同 | 补丁 `003-canvas-audio`、`006-webgl-webgpu` | stability | 已有 |

e2e 里 GFX 行的编号按采集分组：GFX-01 WebGL1、GFX-02 WebGL2（渲染器、参数、精度、扩展）、GFX-03 WebGPU 适配器信息、GFX-04 WebGPU features、GFX-05 WebGPU limits、GFX-06 WGSL 语言特性与 `getPreferredCanvasFormat()`。每组都在基准里有 WebGL 数据的所有上下文（主线程、Dedicated Worker、Shared Worker、iframe）各比一次，行名带 `@上下文` 后缀。

### 3.3 字体与文字（FNT）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| FNT-01 | 可见字体集合 | `document.fonts.check`、`queryLocalFonts`、字宽探测 | `win10`、`win11` 字体库已有 | 与基准集合一致 | 补丁 `004-fonts`；`windows` 模式自动绑定字体库 | set | 已有 |
| FNT-02 | 通用字体族默认值 | serif、sans-serif、monospace、standard 实际落到的字体（zh-CN、en-US 各测一次） | Noto CJK、Liberation | 以基准为准（如中文无衬线落到微软雅黑） | `writeChromePreferences()` 写 `webkit.webprefs.fonts.*`；fontconfig 回退顺序 | exact | P2 |
| FNT-03 | Windows 专有字体的字宽 | Segoe UI、Microsoft YaHei、Consolas 等的 `measureText` 宽度 | 名字挂在 Liberation 等字体上，字宽不对 | 与基准一致 | 换成字宽兼容的字体，或使用真实字体（授权待决） | deviation | P3 |
| FNT-04 | Emoji 渲染与字宽 | canvas 画 emoji、测外框 | Noto Color Emoji | Segoe UI Emoji | 同 FNT-03 | deviation | P3 |
| FNT-05 | 字形步进宽度（advance） | 14 种字体 × 15 个小数字号 × 4 个字符（`0`、`年`、`a`、`W`）的 span 宽度 | Fontations 线性步进或 hinting 取整 | DirectWrite：有 EBLC 位图 strike 的字号走 GDI classic 整数像素步进（宋体、MS Gothic 等），其余为 natural 模式的设计单位步进 | 补丁 `004-fonts`（`SkTypeface_fontations.cpp`） | num（0.002px） | 完成 |
| FNT-06 | 文字光栅化 | canvas `fillText` 像素 | Fontations 灰度抗锯齿 | DirectWrite ClearType | 只靠噪声掩盖 | deviation（仅参考） | P3 |

### 3.4 主题、屏幕与窗口（UI）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| UI-01 | CSS 系统颜色 | `getComputedStyle` 读 `Canvas`、`CanvasText`、`Highlight`、`HighlightText`、`ButtonFace`、`Field`、`LinkText`、`AccentColor` 等 | Aura 主题 | 以基准为准 | 新补丁：Blink LayoutTheme 或 `ui/native_theme` 的系统色 | exact | P2 |
| UI-02 | 滚动条 | `overflow:scroll` 元素的 `offsetWidth - clientWidth`；样式 | 待测 | 以基准为准 | 新补丁：native theme 滚动条参数 | num | P2 |
| UI-03 | 默认表单控件尺寸 | 默认 button、input、select、checkbox、range、date 的 `getBoundingClientRect` | 待测 | 以基准为准 | 主要受 FNT-02 影响，剩余差异另补 | num（±1px） | P2 |
| UI-04 | 屏幕与任务栏 | `screen.width/height/availWidth/availHeight/availTop` | 取决于 Xvfb 和 openbox | 100% 缩放时，Win11 任务栏 48px、Win10 任务栏 40px，位于底部 | `sessionManager.ts` 生成的 openbox 配置加底部 margin，Chrome 通过 `_NET_WORKAREA` 读取 | num | P2 |
| UI-05 | 设备像素比 | `devicePixelRatio`、`matchMedia('(resolution...)')` | 1 | 常见 1、1.25、1.5，需和屏幕尺寸一致 | 已有显示设置，增加 Windows 常见组合 | verify | P2 |
| UI-06 | 窗口边框 | `outerWidth - innerWidth`、`outerHeight - innerHeight` | openbox 边框 | 以基准为准 | openbox 主题或窗口装饰参数 | num（容差） | P3 |
| UI-07 | 媒体特性 | `pointer: fine`、`hover`、`prefers-*`、`forced-colors` | — | 同左 | 无需改动 | verify | P2 |
| UI-08 | 键盘布局 | `navigator.keyboard.getLayoutMap()` | 待测 | 以基准为准 | 待定 | verify | P2 |

### 3.5 媒体（MED）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| MED-01 | 编解码支持矩阵 | `MediaSource.isTypeSupported`、`canPlayType`（H.264、HEVC、AV1、VP9、AAC、Opus） | 待测 | 以基准为准（Windows 有 Media Foundation，HEVC 通常可用） | 新补丁或 feature 开关 | exact | P2 |
| MED-02 | 解码能力 | `MediaCapabilities.decodingInfo` 的 `supported`、`smooth`、`powerEfficient` | 软件解码 | 以基准为准 | 新补丁 | exact | P2 |
| MED-03 | Widevine | `requestMediaKeySystemAccess('com.widevine.alpha', ...)` 及 robustness | 已安装 | 一致 | 已有 | exact | 已有 |
| MED-04 | 语音列表 | `speechSynthesis.getVoices()` | 只有 Google 网络语音（补丁 `008-speech`） | Microsoft 本地语音（如 Huihui、Kangkang、Yaoyao、David、Zira、Mark，按系统语言）加 Google 网络语音 | 新补丁：本地语音列表注入；`speak()` 的行为另行评估 | set | P2 |
| MED-05 | WebRTC 编解码能力 | `RTCRtpSender/RTCRtpReceiver.getCapabilities('video'/'audio')` | 待测 | 以基准为准 | 新补丁 | set | P2 |
| MED-06 | 音频上下文参数 | `AudioContext` 的 `sampleRate`、`baseLatency`、`outputLatency`、`destination.maxChannelCount` | PulseAudio 或虚拟声卡的值 | 以基准为准（WASAPI） | 新补丁 | num | P2 |
| MED-07 | 音频指纹 | OfflineAudioContext 哈希 | 已加噪声（补丁 `003-canvas-audio`） | 稳定性 | 已有 | stability | 已有 |

### 3.6 API 面（API）

| ID | 指标 | 网页读取方式 | Linux 现状 | Windows 目标 | 实现位置 | 判定 | 档位 |
|---|---|---|---|---|---|---|---|
| API-01 | API 存在性 | `window`、`navigator` 及主要原型上的属性名集合 | Linux 版 Chrome 的集合 | 与基准相同，例如 `navigator.getInstalledRelatedApps` 只在 Windows 和 Android 上存在 | 优先用 Blink 的 `--enable-blink-features` / `--disable-blink-features` 开关；开关不够再写补丁 | set | P2 |
| API-02 | 权限默认状态 | `navigator.permissions.query` 查各项权限 | — | 以基准为准 | — | exact | P2 |
| API-03 | 电池 | `navigator.getBattery()` | 待测 | 台式机通常为 `charging: true`、`level: 1` | 待定 | exact | P2 |
| API-04 | 设备类 API | `navigator.bluetooth.getAvailability()`、HID、Serial、USB | 待测 | 以基准为准 | 待定 | verify | P2 |
| API-05 | 通知 | `Notification.permission`、`maxActions` | — | 以基准为准 | — | verify | P2 |

### 3.7 硬件与设备（HW，基本已有）

| ID | 指标 | 现状 | Windows 模式下要补的 | 判定 | 档位 |
|---|---|---|---|---|---|
| HW-01 | `hardwareConcurrency` | 已有 | — | exact | 已有 |
| HW-02 | `deviceMemory` 及请求头 | 已有（补丁 `002-identity`） | — | consistency | 已有 |
| HW-04 | 媒体设备名 | 按 OS 和种子自动生成 | Windows 风格的设备名，如 `Speakers (Realtek(R) Audio)` | set | P2 |
| HW-05 | 音频伪设备 | Linux 上只有 `default` | Windows 上通常还有 `communications` 条目（以基准为准） | set | P2 |
| HW-06 | 时区、语言、地理位置 | 已有 | 与 OS 无关 | — | 已有 |

### 3.8 全量覆盖规则

Chrome 157 真机基准接入后，探针里每一项能拿到的数据都有对应规则。专项规则之外的 section 由 ALL-01 兜底精确比较，新增采集项不会漏检。

| e2e ID | 内容 | 判定 |
|---|---|---|
| ENV-01 | CSS 系统字体（`caption`、`menu`、`status-bar` 等）、默认字体、WebAuthn、存储配额、电池、蓝牙、日期格式、通知 `maxActions`、WebRTC 编解码顺序 | exact |
| MISC-01 | PDF 查看器、`webdriver`、plugins、mimeTypes、DNT、cookie、`maxTouchPoints`、Intl、时区偏移、`window.chrome` 键、JS 堆上限、`navigator.connection` | exact |
| API-04 | `queryLocalFonts` 的可用性与权限状态 | exact |
| DEV-01 | 电池、蓝牙、related apps、媒体设备、通知、presence | exact |
| DEV-02 | 授权前的 `enumerateDevices()`：每种设备一条、`deviceId`/`label`/`groupId` 全部为空，种类覆盖基准 | policy |
| HASH-01 | canvas、WebGL、音频哈希都能生成（数值按会话噪声变化，稳定性由 STAB-FP 检查） | present |
| CTX-01 | 主线程、Dedicated/Shared/Service Worker、iframe 的全部身份字段（版本号归一化后） | exact |
| HDR-01 | 导航、各上下文 fetch、iframe 导航的全部请求头；另检查导航的 `sec-ch-viewport-width` 等于 `innerWidth` | exact、consistency |
| ALL-01 | 主报告里未被专项规则认领的所有 section | exact |
| MED-HW | 依赖宿主 GPU 的媒体项：HEVC、`powerEfficient`、H.265 与 H.264 High 的 RTP 能力、WebRTC 编解码顺序 | 宿主 GPU 与基准一致时并入 MED-01/02、RTC-01、ENV-01 精确比较，否则 SKIP |
| UI-04 | 屏幕尺寸、任务栏工作区；窗口最大化（`outer` 等于工作区、`screenX/Y` 为 0、`innerWidth` 等于 `outerWidth`），工具栏高度 70 到 100 像素 | exact、range |

### 3.9 外部检测站点（EXT）

| ID | 检测 | 方式 | 门槛 |
|---|---|---|---|
| EXT-01 | CreepJS | 本地部署开源版，抓 lies 和 trash 两部分 | `windows` 模式下 lies 为 0 |
| EXT-02 | Pixelscan、BrowserLeaks | 在线运行，不阻断 | 人工抽查，结果记录到附录 |

## 4. 总体设计

### 4.1 配置模型

`shared/src/types.ts` 的 `FingerprintConfig` 增加两个字段：

```ts
export type OsProfile = 'linux' | 'windows';
export type WindowsRelease = 'win10' | 'win11';

export interface FingerprintConfig {
  // ...existing fields
  os: OsProfile;
  windowsRelease: WindowsRelease;
}
```

新增 `shared/src/osProfiles.ts` 作为身份数据的唯一来源：

```ts
export const OS_PROFILES = {
  linux: null,
  win10: {
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    navigatorPlatform: 'Win32',
    chPlatform: 'Windows',
    chPlatformVersion: '10.0.0',
    taskbarPx: 40,
  },
  win11: {
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    navigatorPlatform: 'Win32',
    chPlatform: 'Windows',
    chPlatformVersion: '<from baseline>',
    taskbarPx: 48,
  },
} as const;
```

规则：

- 新会话默认 `os: 'windows'`、`windowsRelease: 'win11'`、WebRTC `offline`。库里缺这两个字段的旧会话经 `normalizeFingerprint()` 归一化为 `linux`（`LEGACY_OS`），行为不变。
- 字体库没有单独的配置项，完全由 `os` 和 `windowsRelease` 决定：Windows 会话用对应版本的 Windows 字体，Linux 会话用真实 Linux 字体（Linux UA 配 Windows 字体本身就是矛盾的指纹）。旧版本存下的 `fontProfile` 在读取时丢弃，接口收到该字段时忽略。
- `fingerprintsEqual()` 和 `fingerprintLaunchChanged()` 加入这两个字段；改了 OS 必须重启 Chrome。
- `shared/src/schemas.ts` 的创建和修改接口增加这两个字段（zod 枚举）；批量创建同样支持。
- Python SDK 的 `_models.py` 同步增加字段。

### 4.2 启动参数

`chromeArgs()` 在 `os === 'windows'` 时追加：

```text
--nya-os=windows
--nya-os-ua-platform=Windows NT 10.0; Win64; x64
--nya-os-navigator-platform=Win32
--nya-os-ch-platform=Windows
--nya-os-ch-platform-version=<OS_PROFILES[release].chPlatformVersion>
--nya-os-release=win10|win11
```

- 身份值全部由后端从 `osProfiles.ts` 传入，Chromium 里不写死这些字符串，方便调整和测试。
- 新开关加入补丁 `001-build-switches` 的渲染进程白名单。UA 在浏览器进程计算；`navigator.*`、WebGL 和 Worker 都在渲染进程。
- `linux` 模式不追加任何 `--nya-os*` 参数，从根上保证零回归。

### 4.3 Chromium 补丁

Nya 自己新增的文件（`nya_farbling.{h,cc}`、`chrome/browser/ui/nya/*`、X11 readback 缓存）按 Chromium 路径放在 `browser/src/`，构建时整体复制进源码树；对 Chromium 原有文件的修改按子系统切成补丁（`browser/patches/series`），每个文件只属于一个补丁：

| 补丁 | 范围 |
|---|---|
| `001-build-switches` | `--nya-*` 开关定义、渲染进程开关白名单、BUILD.gn 接入、`runtime_enabled_features.json5` |
| `002-identity` | UA、UA-CH、`navigator.*` 身份、Device-Memory |
| `003-canvas-audio` | canvas 与音频噪声 |
| `004-fonts` | 字体过滤、Windows 度量（Fontations scaler）、`queryLocalFonts()`、系统字体关键字 |
| `005-system-ui-input` | 系统色、键盘布局 |
| `006-webgl-webgpu` | WebGL/WebGPU 型号伪装与 D3D11/D3D12 形态、GPU 进程初始化 |
| `007-media-webrtc` | 媒体能力、设备列表与轨道名、WebRTC、WebCodecs、Web Audio 输出参数 |
| `008-speech` | 本地与网络语音 |
| `009-x11-display-registry` | 多 X display 连接、事件源、窗口 |
| `010-x11-clipboard` | 按 display 的剪贴板 |
| `011-x11-gpu-present` | readback 呈现、EGL 与 X display 解耦 |
| `012-browser-windows` | 浏览器窗口、弹窗、窗口阴影与生命周期 |

维护流程（`browser/scripts/patches.sh`）：源码树整棵纳入 git（tag `nya-base` 是打完 ungoogled 与 portablelinux 补丁、未做域名替换的状态），其上是 `nya/files`、每个补丁一个提交和最后的 `nya/domsub`（域名替换，不导出）。修改后用 `git commit --fixup` 和 `git rebase -i --autosquash nya-base` 并入对应补丁，再 `patches.sh export` 写回仓库；`patches.sh check` 只编译 Nya 改动的对象。`build.sh` 每次都从 `nya-base` 严格重放，补丁打不上就失败，产物与仓库内容一一对应；内容未变的文件保留 mtime，`out/` 保留，默认增量编译。升级 Chromium 时，把旧的 `browser/.portablelinux` 改名保留，改 `browser/VERSION` 后执行 `patches.sh prep`、`patches.sh init`，再用 `patches.sh rebase <旧树>/build/src` 做三方合并。

下表是 Windows 伪装各项改动的功能说明，按开发时的历史编号排列（157 起已并入上面的子系统补丁）：

| 历史编号 | 覆盖指标 | 主要内容 |
|---|---|---|
| `028-os-identity.patch` | ID-01 到 ID-10 | UA、`navigator.platform`、UA-CH（含高熵值和请求头）；`--nya-os*` 开关和渲染进程白名单 |
| `029-windows-ui-media-gpu.patch` | UI-01、MED-04、MED-05、GFX-01 到 GFX-06 | Windows 浅色系统色；`--nya-os-voices` 提供 OneCore 本地语音；假音频设备 48 kHz；WebGL 的 D3D11 渲染器字符串、参数表、精度、扩展过滤；X11 下放开 WebGPU 的 Vulkan/GL 互操作检查；拒绝 CPU 适配器 |
| `030-windows-fonts-input-gpu-interop.patch` | UI-03、UI-06、MED-02、GFX-07 | 文本框宽度按 'x' 字宽（DirectWrite 不报告 OS/2 平均字宽）；102 键反斜杠；H.264/VP9 `powerEfficient`；进程内 GPU 初始化 Vulkan 互操作，WebGPU 拿到真实 NVIDIA 适配器 |
| `031-windows-font-metrics.patch` | FNT-02、FNT-03、UI-03 | 垂直度量按 DirectWrite 取 OS/2 win 值（或 typo 值），跳过 Linux 的 VDMX 和借位修正；CSS 通用族名不再交给 fontconfig 兜底，改走 `-webkit-standard` |
| `032-windows-gtk-keyboard-webgpu.patch` | UI-06、GFX-02、GFX-04 到 GFX-06 | GTK 键盘布局表的 102 键；WebGL2 的 int64 参数；隐藏 Vulkan 独有的 WebGPU 特性，`maxBufferSize`、`maxComputeWorkgroupStorageSize` 收敛到 D3D12 上限；`getPreferredCanvasFormat()` 返回 `bgra8unorm` |
| `033-windows-media-privacy-ui.patch` | MED-01、MED-02、RTC-01、DEV-02、ENV-01、API-01 | 授权前的 `enumerateDevices()` 按 Windows 规则屏蔽（每种一条、id 为空），设备名带 `Default - `、`Communications - ` 前缀；有真实 GPU 时（`--nya-os-hw-video`）声明 HEVC、H.264/VP9 `powerEfficient`、H.265 与 H.264 High 的 RTP 能力；`webkitRTCPeerConnection` 别名跟随 WebRTC 开关；`caption`、`menu`、`status-bar` 系统字体取 Windows 非客户区字体（Segoe UI 12px）；给 `requestStorageAccessFor` 加 `NyaRequestStorageAccessFor` 开关，Windows 会话与 Privacy Sandbox 广告接口、Shared Storage 一起通过 `--disable-blink-features` 关闭（与当前 Chrome 稳定版一致） |
| `034-windows-dwrite-metrics.patch` | FNT-05、UI-03 | Fontations scaler 在 `NYA_FONT_RASTER=dwrite` 时按 DirectWrite 计算步进宽度：字号范围内有 EBLC 位图 strike（gasp 只在 flags 为 1 时扩展范围）时用 GDI classic 规则（等宽 DBCS 字体按半角格子取整，其余取该 ppem 的位图步进或四舍五入的像素宽度，再折回设计单位并按 `round(size*64)/64` 缩放取整），否则用设计单位取整的 natural 步进；Calibri、Courier New 按 Blink 的位图屏蔽名单排除 |
| `035-host-owned-lifetime.patch` | 无（多显示器基础设施） | 151 构建树里未进入任何补丁的改动：剪贴板、`EncodeWidget`、退出流程，升级 157 时补回，使补丁能完整复现生产二进制 |
| `036-windows-runtime-media.patch` | ALL-01、CTX-02、GFX-01 到 GFX-06、MED-HW、DEV-02 | 有真实 GPU 时 WebRTC 编解码工厂登记声明的 H.264 High/H.265 格式（SDP 与 `getCapabilities()` 一致，实际编解码落到软件 H.264）；WebCodecs 对声明的硬件编解码按支持返回；AAC 编码能力；`queryLocalFonts()` 在真实 Windows 字体下按字体名过滤；WebGPU `adapter.info` 的 `device`/`description` 保持为空；Windows 模式隐藏 `chromium-experimental-*` WebGPU 特性，WGSL 按稳定版集合报告（不受 `--enable-unsafe-webgpu` 影响）；OneCore 语音的 `boundary`/`sentence` 事件与暂停、恢复；任意音频输出设备都按 48 kHz/480 帧报告；授权后 `MediaStreamTrack.label` 用伪装设备名；D3D11 的 `getInternalformatParameter(SAMPLES)` 带 1；深色 Highlight；Windows 缺失的通用族名不再回退 |

Linux 版 Chromium（151 起，157 相同）的系统字体和 Web 字体都走 Fontations（`SkFontMgr_New_FCI` + `SkFontScanner_Make_Fontations`，scaler 是 `SkTypeface_fontations.cpp` 里的 `SkFontationsScalerContext`），不经过 `SkFontHost_FreeType.cpp`，所以字形度量的修改都落在 Fontations scaler 上。

所有分支都以 `--nya-os=windows` 为条件，`linux` 模式不追加任何 `--nya-os*` 参数，行为与补丁前一致。WebGL/WebGPU 的伪装另外要求真实 GPU 是 NVIDIA（`EmulatesWindowsGpu`），SwiftShader 会话保持原样。


### 4.4 后端

| 位置 | 改动 |
|---|---|
| `shared/src/osProfiles.ts` | `OS_TYPES`、`WINDOWS_RELEASES`、各版本的 UA-CH `platformVersion` 和任务栏高度（Win10 40、Win11 48 像素） |
| `fingerprint.ts` | 归一化、合并、比较 `os` 和 `windowsRelease`；旧会话缺字段时归一化为 `linux`；丢弃旧的 `fontProfile` |
| `windowsFonts.ts` | 镜像里有 `/opt/nya/winfonts` 时，给 Windows 会话单独写一份 fontconfig（`FONTCONFIG_FILE`），只包含所选版本的 Windows 字体；Win10 会话排除 Win11 新增的字体 |
| `session/chromeConfig.ts` 的 `chromeArgs()` | 追加 `--nya-os*`、`--nya-os-voices`、`--enable-blink-features=WebShare,WebBluetooth`；有真实 Windows 字体时不再传 `--nya-fonts` 过滤 |
| `session/chromeConfig.ts` 的 `writeChromePreferences()` | 写入 Chrome on Windows 的默认字体（`webkit.webprefs.fonts.*`，按语言区分）；书签栏默认只在新标签页显示；切回 Linux 时清除这些值 |
| `session/desktop.ts` 的 openbox 配置 | Windows 会话的底部工作区留出任务栏高度，使 `screen.availHeight` 与真机一致 |
| `session/chromeConfig.ts` 的 `chromeFontEnv()` 与 `sessionManager.ts` 的 `startChrome()` | Windows 会话设置 `NYA_FONT_RASTER=dwrite`（补丁 `004-fonts`）和对应的 `FONTCONFIG_FILE`；Chrome 窗口映射后由 openbox 最大化（openbox 的应用规则会压掉 `--start-maximized`），Chrome 不再画客户端缩放边框，`innerWidth` 等于 `outerWidth`。Linux 会话不变 |

### 4.5 前端

- `SessionFormDialog.tsx` 和 `BatchSessionFormDialog.tsx` 增加"操作系统"下拉框：Linux（真实）、Windows（伪装）。
- 选择 Windows 时显示"Windows 版本"（Win10、Win11）。没有字体库选项，字体跟随系统和版本。
- 显卡选择 SwiftShader 时提示 Windows 伪装建议配合真实显卡使用。
- 会话列表的地区列显示 `Win10` / `Win11` 标签。
- Python SDK 的 `sessions.create/update` 接受 `os`、`windows_release`。

### 4.6 数据流

```text
SessionFormDialog (os, windowsRelease)
  -> POST /api/sessions (zod schema)
  -> fingerprint.ts normalize -> SQLite session.fingerprint
  -> session/chromeConfig.chromeArgs() -> --nya-os* / --nya-fonts / Preferences / openbox margins
  -> Chromium: browser process (UA, UA-CH) + renderer (navigator, WebGL, WebGPU, theme, media)
```

## 5. e2e 测试设计

### 5.1 目录结构

```text
e2e/probe/index.html          # probe page; collects one report, uploads it with ?source=real
e2e/probe/collect-common.js   # collectors shared by every context
e2e/probe/collect-main.js     # main-thread only collectors (fonts, layout, media, WebGL, WebGPU)
e2e/probe/probe.js            # orchestration: main, dedicated/shared/service worker, iframe
e2e/probe/worker.js, shared-worker.js, sw.js, frame.html
e2e/probe-server.mjs          # HTTPS static server + header echo + Accept-CH / Critical-CH + report upload
e2e/lib/nya.mjs               # Nya API / CDP helpers (Node 22 built-ins only)
e2e/lib/os-cases.mjs          # cases, rules, matrix rows
e2e/fixtures/windows/win11-chrome157-gtx1080ti.json # real-machine baseline (primary, sorts first)
e2e/fixtures/windows/win11-edge155-gtx1080ti.json   # Edge baseline, kept for reference only
e2e/fixtures/windows/allowlist.json                 # expected diffs, each with a reason
e2e/fixtures/linux/157/snapshot.json                # linux regression snapshot
scripts/e2e-os.mjs            # runner: create sessions, collect, compare, print matrix
e2e/tests/os-profile.spec.ts  # Playwright UI test for the new option (T8)
```

### 5.2 探针服务与安全上下文

会话的 Chrome 以独立 uid 运行，`applyUidLoopbackFilter()` 拦截了它对 `127.0.0.0/8` 的访问，所以探针服务监听容器的非回环地址。

- `probe-server.mjs` 默认启用 HTTPS：首次启动用 `openssl` 生成自签证书，SAN 包含本机全部 IPv4 地址和 `--san` 传入的地址。
- runner 通过 CDP 对会话执行 `Security.setIgnoreCertificateErrors`，页面因此是安全上下文（`userAgentData`、WebGPU、`getHighEntropyValues` 都要求安全上下文）。不需要后端增加任何仅测试使用的开关。
- 真机采集时，在浏览器里手动接受一次证书即可。
- 真机页面每隔几秒轮询 `/api/version`，探针文件改动或本机调用 `/api/rerun` 后自动刷新并重新上传，便于远程迭代采集项。`/api/rerun` 只接受本机地址。

请求头采集：探针服务对页面响应 `Accept-CH` 和 `Critical-CH`，按来源（页面导航、页面 fetch、Worker fetch、Service Worker fetch、iframe 导航）分别记录 `Sec-CH-UA-*` 请求头。

### 5.3 报告格式与基准采集

基准和 Nya 采集使用同一份报告格式：`meta`（来源、浏览器版本、标签）、`contexts.<上下文>.<分类>`，规则按指标 ID 从中取值对比。

真机基准采集流程：

1. 在 Windows 能访问到的机器上运行 `node e2e/probe-server.mjs --host=0.0.0.0 --port=<端口> --out=<目录>`。
2. Windows 上用 Chrome 或 Edge 打开 `https://<ip>:<端口>/?source=real`，接受证书。页面采集完成后自动上传报告，标签按 `platformVersion` 自动判断（13 及以上为 win11）。
3. 报告存为 `e2e/fixtures/windows/<release>-<浏览器><主版本>-<显卡>.json`。
4. Chromium 升级大版本时重新采集。

当前主基准来自 Win11 + Chrome 157.0.8103.79 + GTX 1080 Ti（同一台机器的 Edge 155 报告只作参考，不参与比较）。Win10 用例使用同一份 Win11 基准，按"跨版本"规则比较：只检查 Win10 也成立的项（字体集合排除 Win11 新增字体，含 Cascadia，度量只比拉丁字体，`availHeight` 按 40 像素任务栏计算，`platformVersion` 交给 ID-04 按版本检查）。Nya 与基准同为 157，版本差条目已全部从 allowlist 移除。Win10 的 zh-CN 等语言里 `sans-serif`/`serif` 默认字体与 Win11 不同（Win11 为 Noto Sans/Serif SC，Win10 为 Microsoft YaHei/SimSun），跨版本比较时 CTX-02 跳过这两个通用族。

比较前统一做版本归一化：`Chrome/1xx.0.xxxx.xx` 这类完整版本号替换为 `N`，GREASE 品牌名（`Not=A?Brand` 等每个版本都会变）替换为 `GREASE`。

### 5.4 规则引擎

`e2e/lib/os-cases.mjs` 为每个指标 ID 生成一行结果：

| 规则 | 行为 |
|---|---|
| exact | 展平后逐键相等；allowlist 按完整键或键前缀匹配 |
| set | 集合相等；分别报告多出的项和缺少的项 |
| num / tolerance | 数值在容差内（均为绝对值）：字宽 0.02 像素，字高与 canvas 文字包围盒 1 像素，字形步进 0.002 像素，表单控件尺寸 1 像素，窗口边框高度 70 到 100 像素；JS 递归深度为基准的 -30% 到 +50%（下限由解释器帧大小决定，并发 Sparkplug 代码在递归中途就绪会把读数抬高约 45%，单次采样的基准可能落在这个区间的任意位置） |
| policy | 按 Windows 行为判断，不依赖基准的具体值（如授权前设备列表的屏蔽方式） |
| same-gpu | 显卡型号与基准一致时全量比较；同为 NVIDIA D3D11（伪装了其他型号）时只比较与型号无关的形态项（WebGL 参数与扩展、WebGPU features/limits/WGSL、硬件媒体项），型号由 GFX-07 单独检查；其余情况 SKIP 并列出跳过的键 |
| consistency | 同一报告内各上下文、请求头之间相等 |
| stability | 同一会话两次采集，指纹哈希一致 |

`allowlist.json` 登记预期内的差异，每条都写了原因。被覆盖的项输出 `ALLOW`，不算失败。宿主机不是 NVIDIA D3D11 形态时，GFX 行和 MED-HW 行输出 `SKIP` 并说明原因；`allowlist.json` 的 `hostMedia.patterns` 定义哪些媒体键依赖宿主 GPU（包括 ALL-01 里的 `sdp.video` 和 WebCodecs 硬件项）。被放行的 WebGL 扩展同时从 `extensionOrder` 和依赖它的 `extra` 值（`maxDrawBuffersWebgl`、`maxViewsOvr`）里剔除。CTX-02 检查各上下文的 JS 递归深度与 canvas 文字度量。

### 5.5 测试用例

| 用例 | 会话配置 | 覆盖指标 | 通过条件 |
|---|---|---|---|
| `linux`（T1） | 显式选择 Linux | 身份、字体、界面、媒体、API | 与 Linux 快照一致 |
| `win11`（T2 到 T6） | `os: windows`、`win11` | ID、FNT、UI、MED、RTC、API、GFX、STAB | 全部 PASS 或 ALLOW |
| `win10`（T2 到 T6） | `os: windows`、`win10` | 同上，按跨版本规则 | 全部 PASS 或 ALLOW |
| `win11-gpu` | `os: windows`、`win11`、`gpuProfile: rtx-3070` | 同 win11；GFX 按形态比较，GFX-07 检查各上下文的伪装型号字符串与 WebGPU `architecture`，且 `device`/`description` 为空 | 全部 PASS 或 ALLOW |
| `lifecycle`（T7） | 新建、改 OS、改版本 | 默认值、非法值拒绝、改 OS 后 Chrome 重启且身份切换 | 全部 PASS |
| `os-profile.spec.ts`（T8） | Playwright 操作表单 | 前端 | 能选 Windows；版本下拉框出现；没有字体库选项；保存后接口返回对应值 |

### 5.6 运行方式

runner 只用 Node 22 内置模块，直接在容器内运行：

```bash
tar czf /tmp/nya-e2e.tgz e2e/lib e2e/probe e2e/probe-server.mjs e2e/fixtures scripts/e2e-os.mjs
docker cp /tmp/nya-e2e.tgz nya-browser:/tmp/ && docker exec nya-browser sh -c 'mkdir -p /tmp/nya-e2e && tar xzf /tmp/nya-e2e.tgz -C /tmp/nya-e2e'
docker exec -w /tmp/nya-e2e nya-browser node scripts/e2e-os.mjs --cases=linux,win11,win10,lifecycle --out=/tmp/os-out
# re-run the rules on collected samples without new sessions
docker exec -w /tmp/nya-e2e nya-browser node scripts/e2e-os.mjs --evaluate=/tmp/os-out
```

GFX 和 MED-HW 行需要宿主机有与基准同型号的 NVIDIA 显卡；没有显卡的开发机上这些行为 `SKIP`。

## 6. 分阶段计划与完成情况

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 测试底座 | 探针页、探针服务、规则、runner、Linux 快照、Win11 真机基准 | 完成 |
| P1 选项与身份 | 配置模型、接口、前端、SDK、`--nya-os*`、补丁 028；T1、T2、T7、T8 | 完成 |
| P2 一致性 | 补丁 029 到 032；Windows 字体、默认字体、任务栏、媒体、语音、API 面、WebGL/WebGPU | 完成，T3 到 T6 全部 PASS 或 ALLOW |
| P3 渲染细节 | 真实 Windows 字体文件（内部镜像）、DirectWrite 垂直度量、通用族名 | 完成；字形栅格化仍是 Fontations（见第 7 节） |
| P4 Chrome 157 基准全量对齐 | 补丁 033、034；窗口最大化；FNT-05、ENV、MISC、DEV、HASH、CTX、HDR、ALL-01、MED-HW 规则 | 完成，本地 SwiftShader 与 GPU 测试容器全部 PASS |
| P5 升级 Chromium 157 与整体复查 | 补丁 001 到 034 rebase 到 157，补回 035；复查结论落地为补丁 036 与后端修正；`win11-gpu` 用例 | 完成，见 8.2 |

## 7. 已知差异与风险

以下差异属于驱动层、闭源组件、真机硬件或 Chromium 版本差，改造量超出范围，已写入 `allowlist.json`（每条带原因）或在此登记：

1. **JS 栈深度**：Windows 与 Linux 版 Chrome 的栈上限相同（V8 主线程约 984 KB，Blink worker 500 KB），帧大小也相同：解释器下的递归深度（下限）本地 iframe 为 12516，真机为 12460。Windows 模式因此不改任何栈大小。实际读数在下限到约 1.45 倍之间波动，取决于并发 Sparkplug 代码何时就绪；真机 worker 的两次读数（8876、9020）就是被抬高后的值，Linux 同样的上限下也能测到。
2. **文字栅格化**：步进宽度、垂直度量已按 DirectWrite 对齐（FNT-02、FNT-05 全部通过），但字形像素仍由 Fontations 灰度抗锯齿生成，不是 ClearType，canvas 文字像素与真机不同，只靠会话噪声掩盖。韩文 Malgun Gothic 的符号字形外框有细微差异。
3. **WebGL**：`WEBGL_draw_buffers`、`OVR_multiview2`、`WEBGL_provoking_vertex` 在 D3D11 上有。Linux 上 ANGLE 的 EGL 后端固定 `eglBindAPI(EGL_OPENGL_ES_API)`，NVIDIA 给出的是 OpenGL ES 3.2 上下文，而这三个扩展依赖桌面 GL 特性，换 GPU 后端才能暴露。
4. **WebGPU 全局对象**：`GPUSubgroupMatrixConfig` 等取决于宿主显卡驱动；Linux 模式在 GPU 主机上（带 `--enable-unsafe-webgpu`）还会出现 `GPUResourceTable`。
5. **硬件媒体**：有真实 GPU 时声明的 HEVC 解码、H.265 与 H.264 High RTP 能力只体现在能力查询接口（`canPlayType`、`decodingInfo`、`getCapabilities`）上；Linux 构建没有 HEVC 解码器，真正播放 HEVC 会失败，`createOffer()` 的 SDP 里也不会出现这些编解码。SwiftShader 会话不声明这些能力。
6. **媒体设备**：基准机器没有摄像头，Nya 模拟一个摄像头；`communications` 设备条目只用于列表展示，`getUserMedia` 不能按它的 `deviceId` 选择。
7. **触摸屏**：基准机器带触摸屏（`maxTouchPoints` 为 10、`any-pointer: coarse`），Nya 按无触摸的台式机建模。
8. **语音**：Google 网络语音依赖联网状态，不做比较；本地 OneCore 语音按语言注入并精确比较。
9. **窗口**：Nya 的 Windows 会话总是最大化。基准里的 Chrome 窗口是还原状态，最大化时的 `innerWidth` 按 Windows Chrome 的行为（最大化时没有缩放边框，等于 `outerWidth`）检查，未经真机最大化数据确认。
10. **Service Worker**：基准浏览器因自签证书拒绝注册 Service Worker，CTX-01 跳过该上下文；Nya 侧 Service Worker 的身份由 ID 系列规则与其他上下文做一致性检查。
11. **AudioContext 状态**：页面未经用户交互时为 `suspended`，基准页面被点击过，为 `running`。
12. **Linux 模式的 UA-CH `platformVersion`**：保持 Chromium 在 Linux 上的原样（空字符串），未做修改。
13. **Chromium 升级**：每个大版本都要重新采集基准，全部补丁随之 rebase。
14. **SwiftShader 会话**：真实 Windows 很少用 SwiftShader 渲染。这种组合只在表单里提示，不阻止；WebGL/WebGPU 与硬件媒体的伪装只在真实 NVIDIA 显卡上启用。
15. **新文档的窗口尺寸**：Chromium 在 X11 下，新文档开始时 `outerWidth`/`outerHeight` 为 0，偶尔会短暂等于 `inner*`，`load` 之后才稳定。这在 linux 模式下同样存在，探针会等尺寸稳定后再读取。
16. **外部依赖**：`scripts/e2e-fingerprint.mjs` 的 `hardware` 用例依赖 httpbin.org，网络慢时会超时，重跑即可。

## 8. 实现与验证记录

### 8.1 发布注意事项

- `browser/CHROMIUM.sha256` 已更新为 157.0.8103.78 加 `browser/src` 与补丁 001 到 012 的构建。CI 构建镜像之前，必须先执行 `bash scripts/publish-chromium.sh` 上传 Chromium 包，否则镜像构建会因校验和不匹配而失败。
- Windows 字体放在私有仓库 `metolab/nya-browser-assets`，由 `scripts/fetch-assets.sh` 检出到 `third_party/assets/`（已加入 `.gitignore`），构建时复制到 `/opt/nya/winfonts`。没有这个目录时，Windows 会话退回 `--nya-fonts` 名称过滤加度量别名的方式。

### 8.2 测试结果

| 环境 | 内容 | 结果 |
|---|---|---|
| 本地（SwiftShader） | `e2e-os.mjs`：linux、win11、win10、lifecycle（Chromium 157.0.8103.78，`browser/src` 与补丁 001 到 012） | 107 PASS，0 FAIL；GFX 与 MED-HW 共 14 项因没有 NVIDIA 显卡而 SKIP |
| GPU 测试机（GTX 1080 Ti） | 同上，加 `win11-gpu` | 226 PASS，0 FAIL，0 SKIP；GFX 在四个上下文、硬件媒体项均精确比较通过 |
| 本地 | FNT-05 字形步进 | 210 个样本（14 种字体 × 15 个字号）与 Chrome 157 真机逐一相等 |
| 本地 | Playwright 全部套件（含 `os-profile.spec.ts`） | 38 passed |
| 本地 | `npm run test:unit` | 145 passed |
| 本地 | `e2e-fonts.mjs` | 151 上通过，157 未重跑 |
| 本地 | `e2e-fingerprint.mjs` | 32 项检查全部通过 |

会话以前默认打开 google.com。约一半的会话里，这个标签页会让浏览器 UI 线程持续满载（进程内 GPU 加 SwiftShader 线程池一直在出帧），CDP 的 `Page.navigate`、`Runtime.evaluate` 全部超时。Chromium 151 的旧镜像同样能复现，与 Windows 伪装无关。新会话默认打开新标签页，本轮 `e2e-fingerprint.mjs` 没有再出现。

## 附录 A：人工抽查记录

| 日期 | Chromium | 配置 | Pixelscan | BrowserLeaks | CreepJS | 备注 |
|---|---|---|---|---|---|---|
| | | | | | | |
