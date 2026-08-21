# Nya Browser

远程隔离 Chromium 桌面。仓库：https://github.com/metolab/nya-browser

GitHub Actions 只编译本仓库的 Node 应用。Chromium 在本地构建后作为 Release 附件发布，镜像构建时再下载。

## 生产

```bash
cp config/env.example .env   # 改掉 INIT_ADMIN_PASSWORD
docker compose up -d
```

镜像：`ghcr.io/metolab/nya-browser:latest`。默认端口 `8080`，数据目录 `./data`。

## 本地构建镜像

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Chromium

版本钉在 `browser/VERSION`。

```bash
bash browser/scripts/build.sh
bash scripts/publish-chromium.sh
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
