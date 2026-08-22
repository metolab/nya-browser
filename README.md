# Nya Browser

远程隔离 Chromium 桌面。仓库：https://github.com/metolab/nya-browser

GitHub Actions 只编译本仓库的 Node 应用。Chromium 在本地构建后作为 Release 附件发布，镜像构建时再下载。

## 生产

```bash
cp config/env.example .env   # 改掉 INIT_ADMIN_PASSWORD
docker compose up -d
```

镜像：`ghcr.io/metolab/nya-browser:latest`。默认端口 `8080`，数据目录 `./data`。

NVIDIA 机器上打开硬件加速（Xvfb 出图，GL/WebGL 走 GPU）：

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

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
