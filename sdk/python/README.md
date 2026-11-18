# nya-browser Python SDK

用 Python 管理 Nya Browser 的会话、代理、分组和文件，并通过 CDP 控制会话里的浏览器。浏览器控制交给你自己的框架：Patchright / Playwright / Puppeteer / browser-use / 原始 CDP 都可以。

## 安装

```bash
pip install "nya-browser[patchright] @ git+https://github.com/metolab/nya-browser#subdirectory=sdk/python"
# 或者用原版 Playwright
pip install "nya-browser[playwright] @ git+https://github.com/metolab/nya-browser#subdirectory=sdk/python"
```

连接已有浏览器不需要 `playwright install`。

## 认证

在网页右下角菜单（或管理后台左下角）打开 **API Keys** 创建 Key。Key 的权限和创建它的账号完全一样：

- 普通用户：列出、启动被授权的会话，开关自己的窗口，文件，CDP 控制。
- 管理员：以上全部，加上创建/编辑/删除/停止会话，管理代理和分组。

```bash
export NYA_BASE_URL=https://example.com/nya-browser   # 含 BASE_PATH
export NYA_API_KEY=nya_xxxxxxxxxx_...
```

## 快速开始

```python
from nya import Nya

nya = Nya()  # 读取 NYA_BASE_URL / NYA_API_KEY

proxy = nya.proxies.create(name="us-1", type="socks5", host="1.2.3.4", port=1080,
                           username="u", password="p")
print(nya.proxies.test(proxy.id).exit_ip)
print(nya.proxies.probe(type="socks5", host="5.6.7.8", port=1080).ok)   # 不保存，只测试

s = nya.sessions.create(name="shop-01", proxy_id=proxy.id,
                        timezone="America/New_York", chrome_language="en-US")

with s.browser() as context:          # 自动启动会话，优先用 Patchright
    page = context.pages[0] if context.pages else context.new_page()
    page.goto("https://example.com")
    print(page.title())
```

`s.browser()` 给出的是会话自己的持久 context（Cookie、登录态都在里面）。**不要** 调 `browser.new_context()`，那会得到一个不带会话数据的临时 context。

### 自己管理 Playwright

```python
from patchright.sync_api import sync_playwright

with sync_playwright() as pw:
    context = s.connect(pw)           # 等价于 connect_over_cdp(ws_url, headers=...)
    ...
```

### 异步

```python
import asyncio
from nya import AsyncNya

async def main():
    async with AsyncNya() as nya:
        s = await nya.sessions.get("SESSION_ID")
        async with s.browser() as context:
            page = context.pages[0]
            await page.goto("https://example.com")

asyncio.run(main())
```

`AsyncNya` 的方法和 `Nya` 一一对应，全部需要 `await`。

## 其他框架

```python
ep = s.ensure_running()      # 未运行就启动，并等到 CDP 可连
ep.ws_url                    # wss://host/ws/cdp/<id>
ep.headers                   # {"Authorization": "Bearer nya_..."}
ep.ws_url_with_token         # 不支持自定义请求头的工具用这个
ep.http_url                  # Chrome 兼容的 /json/version、/json/list
```

- Puppeteer：`puppeteer.connect({ browserWSEndpoint: ws_url, headers })`
- browser-use 等只收一个 URL 的库：`cdp_url=ep.ws_url_with_token`
- 原始 CDP：

```python
from nya.cdp import CdpClient

async with CdpClient.connect(ep) as cdp:
    targets = await cdp.send("Target.getTargets")
```

### 本地转发

只认 `http://127.0.0.1:9222` 这种地址的工具（Selenium `debuggerAddress`、chrome-devtools-mcp `--browserUrl`、`chrome://inspect`）可以用本地转发：

```bash
nya cdp-forward shop-01 --port 9222 --start
```

转发端口不需要认证，只绑定 127.0.0.1。

## 会话的其他操作

```python
s.update(home_url="https://example.com", idle_timeout_minutes=0)
s.set_proxy(other_proxy.id)          # 运行中就地切换，不重启浏览器
s.set_proxy(custom="socks5://u:p@5.6.7.8:1080")   # 只属于这个会话的临时代理
s.set_proxy(custom={"type": "ss", "host": "5.6.7.8", "port": 8388, "password": "p",
                    "extra": {"method": "aes-256-gcm"}, "via_proxy_id": front.id})
s.test_proxy()                        # 测试当前代理的出口
s.regenerate_fingerprint()
s.restart()
s.stop()

s.files.upload(["./a.png"], dir=".")
s.files.list(".")
s.files.downloads()                   # 浏览器下载记录
s.files.download("report.pdf", "./out/")

s.type_text("hello")                  # 系统级键盘输入，不经过 CDP
s.set_clipboard("text")
s.windows.list()
```

浏览器里的下载会落到会话文件夹，用 `s.files` 取回；Playwright 的 `download.save_as()` 在远程连接下不可用。网页上传文件请用 `set_input_files` 的内存文件形式（`{"name", "mimeType", "buffer"}`）。

## 行为说明

- 一个会话就是一个 Chrome，CDP 能看到这个会话的所有窗口，人和 Agent 可以同时操作。
- `browser.close()` / `Browser.close` 只断开当前连接，不会关闭会话浏览器；停止会话请用 `s.stop()`。
- 会话停止或浏览器重启时连接会被关闭（关闭码 4001 `session_stopped` / 4002 `browser_closed`），重新 `connect` 即可。
- CDP 连接计入活跃状态，Agent 连着时不会触发空闲自动停止。
- 每个会话最多 8 个并发 CDP 连接。

## 错误

全部继承 `nya.NyaError`（带 `status`、`code`）：`AuthenticationError`(401)、`PermissionDeniedError`(403)、`NotFoundError`(404)、`ConflictError`(409，其中 `SessionNotRunningError`)、`RateLimitError`(429)、`ServiceUnavailableError`(502/503)、`SessionStoppedError`。
