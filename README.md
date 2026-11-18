# Nya Browser

远程隔离 Chromium 桌面。仓库：https://github.com/metolab/nya-browser

GitHub Actions 只编译本仓库的 Node 应用。Chromium 在本地构建后作为 Release 附件发布，镜像构建时再下载。

## 生产

```bash
cp config/env.example .env   # 改掉 INIT_ADMIN_PASSWORD
docker compose up -d
```

镜像：`ghcr.io/metolab/nya-browser:latest`。默认端口 `8080`，数据目录 `./data`。

挂到子路径时设置 `BASE_PATH`（不要末尾斜杠），例如 `BASE_PATH=/nya-browser`。容器内 `/api/health` 仍可用于健康检查；页面、API 和 VNC WebSocket 都在该前缀下。反向代理不要剥掉前缀，并开启 WebSocket 升级。

NVIDIA 机器上打开硬件加速（Xvfb 出图，GL/WebGL 走 GPU）：

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

## 会话默认值

新建会话不填的项取以下默认值：

- 系统：Windows 11 伪装（Linux 需显式选择）。旧库里没有系统字段的会话仍按 Linux 运行。
- WebRTC：`offline`（API 可用，没有任何 ICE 候选）。
- 时区和语言：`auto`，启动时按代理最近一次测试得到的出口国家决定；没有代理或没测过时用 Asia/Shanghai、zh-CN。
- 主页：留空，打开新标签页。
- 字体和媒体设备名：没有配置项，跟随系统、版本和指纹种子自动生成。

挂代理的会话只能连到自己的本地代理端口，直连的包（包括 WebRTC 的 UDP）在 iptables 里被拒绝。

会话的代理可以选已保存的代理，也可以填一个只属于该会话的临时代理（字段或分享链接，可选已保存的代理做前置），保存时自动测试出口。每个运行中的会话都有一个 sing-box sidecar（直连会话用 direct 出口），Chrome 固定连它，所以切换代理只替换 sidecar、断开现有连接，浏览器不重启；只有时区/语言为 `auto` 且出口国家变了，或 WebRTC 为 replace/forward 且出口 IP 变了时才重启 Chrome。

会话的代理可以选已保存的代理，也可以填一个只属于该会话的临时代理（字段或分享链接，可选已保存的代理做前置），保存时自动测试出口。每个运行中的会话都有一个 sing-box sidecar（直连会话用 direct 出口），Chrome 固定连它，所以切换代理只替换 sidecar、断开现有连接，浏览器不重启；只有时区/语言为 `auto` 且出口国家变了，或 WebRTC 为 replace/forward 且出口 IP 变了时才重启 Chrome。

## Windows 字体

Windows 会话优先使用真实的 Windows 字体。字体有授权限制，不放在本仓库，而是放在私有仓库 [metolab/nya-browser-assets](https://github.com/metolab/nya-browser-assets) 的 `windows-fonts/` 下。构建镜像前用 `scripts/fetch-assets.sh` 把 `third_party/assets.ref` 固定的 commit 检出到 `third_party/assets`。Image workflow 通过只读 deploy key（secret `NYA_ASSETS_DEPLOY_KEY`）访问，本地使用 git/gh 凭据。

```bash
bash scripts/fetch-assets.sh          # before a local docker build
# after committing new assets there:
bash scripts/fetch-assets.sh --pin    # pin its main, then commit third_party/assets.ref
```

没有 `third_party/assets` 时，镜像里的 Windows 会话改用别名成 Windows 字体名的 Linux 字体（`config/fonts-windows-aliased.conf`）。

## Agent / SDK

每个会话的浏览器通过 `wss://<host><BASE_PATH>/ws/cdp/<sessionId>` 暴露 CDP，用 API Key（菜单里的「API Keys」）认证，权限与创建它的账号相同。Python SDK 见 [`sdk/python`](sdk/python/README.md)。反向代理需要对 `/ws/cdp/` 开启 WebSocket 升级。

## 本地构建镜像

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Chromium

上游版本钉在 `browser/VERSION`，实际安装的包钉在 `browser/CHROMIUM.sha256`。同版本重新发布后必须提交新的摘要，否则 Image workflow 会继续用 Docker 缓存里的旧 Chrome。

```bash
bash browser/scripts/build.sh
bash scripts/publish-chromium.sh
# commit the updated browser/CHROMIUM.sha256, then rebuild the image
```

Release tag：`chromium-<version>`，附件：`nya-chromium-<version>-linux64.tar.xz`。

Nya 对 Chromium 的修改由两部分组成：`browser/src/`（Nya 自有文件，按 Chromium 路径存放）和 `browser/patches/`（按子系统切分的补丁，每个文件只属于一个补丁）。`build.sh` 每次都把源码树重置到 `nya-base` 再严格重放（补丁打不上就失败），产物与仓库内容一一对应；内容没变的文件保留原 mtime，`out/` 也保留，所以只重编改动涉及的对象，`--clean` 才从头构建（数小时）。源码树里的提交依次是 `nya/files`、每个补丁一个提交、最后的 `nya/domsub`（域名替换，不导出），工作区始终是干净的。修改补丁用 `browser/scripts/patches.sh`：

```bash
cd browser/.portablelinux/build/src
# edit, then fold the change into the patch that owns the file
git commit -a --fixup=<commit of nya/00x-....patch>
git rebase -i --autosquash nya-base
cd - && bash browser/scripts/patches.sh export   # write back to browser/src and browser/patches
bash browser/scripts/patches.sh check            # compile only the objects Nya touches
```

升级 Chromium：把 `browser/.portablelinux` 改名保留，修改 `browser/VERSION`（portablelinux 没有对应发布时，同时更新 `browser/portablelinux/`），然后：

```bash
bash browser/scripts/patches.sh prep
bash browser/scripts/patches.sh init
bash browser/scripts/patches.sh rebase browser/.portablelinux-<old>/build/src
# on conflicts: resolve, git -C browser/.portablelinux/build/src rebase --continue, then
bash browser/scripts/patches.sh rebase --finish
bash browser/scripts/patches.sh check && bash browser/scripts/build.sh --clean
```

镜像构建时会从 [Tampermonkey](https://www.tampermonkey.net/crx/tampermonkey_stable.crx) 安装油猴（`browser/TAMPERMONKEY.sha256` 钉版本），会话默认加载、高级模式、不打开新手页。本地可把 CRX 放到 `cache/tampermonkey_stable.crx` 供离线构建。

镜像构建时还会从 Google 组件 CDN 下载 Widevine CDM（`browser/WIDEVINE.sha256` 钉版本）到 `/opt/nya-widevine`，会话通过用户数据目录里的 hint 文件加载。Widevine 是 Google 闭源组件，许可禁止未经授权分发，不要把含它的镜像公开发布。本地可把 CRX 放到 `cache/widevine.crx3` 供离线构建。

无网络 Release、只在本机构镜像时：

```bash
bash scripts/stage-chromium.sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
```

## 开发

```bash
npm ci
npm run dev:backend
npm run dev:frontend
```
