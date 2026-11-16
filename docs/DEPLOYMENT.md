# 静态 CDN 与动态网关分开部署

本文的 `a.com`、`rftgm.a.com`、`rftg.a.com` **全部是占位示例**，请替换为实际域名。客户端源码默认使用同源地址，没有写死这些域名。生产环境由 Nginx 处理 TLS，Node 在内部 HTTP 端口运行。

## 访问路径

```text
玩家浏览器
  ├─ HTTPS rftgm.a.com:443 → CDN / 静态源站 → dist/static/
  │    index.html、JS、shared/、卡牌数据、图片、字体、client-config.json
  └─ HTTPS / WSS rftg.a.com:443 → Nginx → HTTP / WS 127.0.0.1:30001
                                                       Node 网关
                                                          │ TCP
                                                   127.0.0.1:16309
                                                     rftgserver

PC 原版客户端 ── TCP rftg.a.com:16309 ── rftgserver
```

用户入口始终是静态域名。Node 和原生服务器在同一机器时，Node 的 `RFTG_HOST` 用 `127.0.0.1`；分机器则填实际内网地址。16309 是原生 TCP 协议，浏览器只连接 HTTPS/WSS 网关，不连接 16309。

## 部署前准备

- 构建机和动态服务器安装 Node.js 22+ 与 npm；用 `node --version`、`npm --version` 检查。静态源站只需托管构建产物。
- 动态服务器安装 Nginx，准备动态域名的 HTTPS 证书。下面的常驻运行命令以 Linux + systemd 为例。
- 原生 `rftgserver` 和 `ai_client` 已编译；按第 0 节启动原生服务，Node 能访问其 TCP 16309 端口。`npm start` 不会代为启动原生服务器。
- 静态域名指向 CDN；动态域名指向网关 Nginx。两者可以位于不同服务器，也可以使用完全不同的主域名。

下文假设原生 `RFTG` 和完整网页项目 `rftg-mobile` 放在动态服务器的**同一个父目录**，以 `/srv` 为例：

```text
/srv/
├── RFTG/
│   └── src/
│       ├── rftgserver
│       ├── ai_client
│       ├── cards.txt
│       ├── network/
│       └── rftg.sqlite      # 已有数据库，或首次启动时创建
└── rftg-mobile/
    ├── server/
    ├── shared/
    ├── public/
    ├── deploy/
    └── .env
```

两个项目由实际部署用户维护。若使用其他父目录，统一替换两份 service 模板和命令中的 `/srv`；原生目录名按大小写使用 `RFTG`。网关需要 `server/`、`shared/`、`public/data/cards.json` 等项目文件，仅上传 `dist/static/` 无法启动 Node。Node 依赖在动态服务器通过 npm 安装。

模板一览：

| 文件 | 用途与安装位置 |
| --- | --- |
| [gateway.env.example](../deploy/gateway.env.example) | 复制为项目根目录的 `.env`，配置 Node 端口、上游和允许来源 |
| [rftg.service.example](../deploy/rftg.service.example) | 动态服务器 `/etc/systemd/system/rftg.service`，运行原生 TCP 游戏服务器及其 AI 子进程 |
| [rftg-mobile.service.example](../deploy/rftg-mobile.service.example) | 动态服务器 `/etc/systemd/system/rftg-mobile.service`，使 Node 常驻并开机启动 |
| [nginx-gateway.conf.example](../deploy/nginx-gateway.conf.example) | 动态服务器 Nginx：HTTPS/WSS 代理及静态请求 301 |
| [nginx-static.conf.example](../deploy/nginx-static.conf.example) | 可选，安装在静态源站的 Nginx：托管 `dist/static/` |

## 0. 启动原生 RFTG 服务

使用网页项目提供的 [rftg.service.example](../deploy/rftg.service.example)，运行的是 `RFTG/src/rftgserver`。`ai_client` 由游戏服务器按需启动，无需另建服务；本服务全程无头运行，不启动桌面 `rftg`。

```bash
cd /srv/rftg-mobile
id -un
sudo install -m 644 deploy/rftg.service.example /etc/systemd/system/rftg.service
sudoedit /etc/systemd/system/rftg.service
```

修改并检查：

| 配置 | 应填写的值 |
| --- | --- |
| `User=rftg` | 已存在的非 root 部署用户，通常与 Node 服务使用同一用户；模板不自动创建用户 |
| `WorkingDirectory=/srv/RFTG/src` | 原生源码的 `src` 绝对路径，目录中保留 `ai_client`、牌库和 `network/` |
| `ExecStart=/srv/RFTG/src/rftgserver -p 16309 -d /srv/RFTG/src/rftg.sqlite` | 可执行文件、TCP 端口和 SQLite 数据库的实际路径 |

部署用户需要能执行 `rftgserver`、`ai_client`，读取游戏资源，并写入数据库文件及其所在目录。模板沿用 `RFTG/src/rftg.sqlite`，数据库不存在时服务器会创建并初始化；若已有账号和对局保存在其他位置，应把 `-d` 指向已有数据库。游戏 XML 默认也导出到 `RFTG/src`，可在 `ExecStart` 添加 `-e /实际导出目录` 更换为另一个可写目录。

如果已有手动启动的服务器占用 16309，先停止该实例，再启用服务，确保只有一个进程使用同一端口和数据库。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rftg
sudo systemctl status rftg --no-pager
sudo journalctl -u rftg -n 100 --no-pager
```

日志应出现 `Server ready. Listening on port 16309...`。模板显式设置 `KillMode=control-group`，停止或重启服务时一并结束服务器及其 AI 子进程，配置含义见 [systemd 官方文档](https://www.freedesktop.org/software/systemd/man/262/systemd.kill.html)。

```bash
sudo systemctl restart rftg       # 更新原生程序或 service 配置后重启
sudo journalctl -u rftg -f        # 跟随日志，Ctrl+C 退出日志查看
sudo systemctl stop rftg          # 停止原生服务及其 AI 子进程
sudo systemctl start rftg         # 再次启动
```

修改 service 文件后先执行 `sudo systemctl daemon-reload` 再重启。原生服务监听 IPv4 TCP 16309；同机 Node 保持 `RFTG_HOST=127.0.0.1`、`RFTG_PORT=16309`，PC 客户端使用动态服务器的地址和该端口直连。两份服务分别管理原生服务器和 Node；下面继续部署静态入口与 Node 网关。

## 1. 生成静态发布目录

在项目根目录执行；下方域名仅作示例：

```bash
npm ci
npm run build:static -- --gateway-origin https://rftg.a.com
```

也可以用 `GATEWAY_ORIGIN=https://rftg.a.com npm run build:static`。产物为 `dist/static/`，把**目录里的全部内容**上传到静态站点根路径。它已经包含 `shared/`，不能只上传源码中的 `public/`。不需要把 Node、`server/`、`node_modules/` 或 `.env` 放到 CDN。

生成的 `client-config.json`：

```json
{
  "gatewayOrigin": "https://rftg.a.com"
}
```

浏览器据此使用 `https://rftg.a.com/api/config` 和 `wss://rftg.a.com/ws`。网关值只能是协议、域名、可选端口，不包含路径。静态资源和共享 JS 始终从静态域名加载。配置、API 请求均不依赖跨域 Cookie；登录和会话恢复走 WebSocket。

构建时也会在 HTML 写入允许该 HTTPS/WSS 地址的 CSP。**更换网关地址时重新构建并发布整个目录**，使 `index.html` 和 `client-config.json` 一致。若 CDN 另行设置 CSP 响应头，也要同步 `connect-src`；多个 CSP 会同时生效。

CDN / 静态源站缓存配置：

| 路径 | 缓存策略 |
| --- | --- |
| `/index.html`、`/`、`/client-config.json` | 每次检查更新；CDN TTL 设为 0，不强制缓存 |
| `*.mjs`、`*.js`、`*.css`、`/shared/*`、`/data/*` | `Cache-Control: no-cache`，更新时与 HTML 一起发布 |
| `/assets/*` | `Cache-Control: public, max-age=86400`；同名图片更新时清除对应 CDN 缓存 |

文件名没有内容哈希，不要把所有文件设为一年 immutable。静态服务要正确返回 `.mjs` 的 JavaScript MIME 类型；不存在的文件返回 404，不要把缺失的 JS 或 `/api/config` 回退到首页。

使用 Nginx 做静态源站时，按第 3.2 节安装 [nginx-static.conf.example](../deploy/nginx-static.conf.example)。对象存储/CDN 也可以直接托管同一目录，按上表设置响应头。

## 2. 配置 Node 动态网关

### 2.1 安装依赖并前台启动

在**动态服务器**执行；运行目录是完整项目根目录：

```bash
cd /srv/rftg-mobile
node --version
npm --version
npm ci --omit=dev
test -f .env || cp deploy/gateway.env.example .env
# 使用编辑器修改 .env；已有文件不会被上面的命令覆盖
```

将 `.env` 配置为下面的生产模式，并替换域名及上游地址。即使此前用过本地 `.env`，也要检查监听端口和 `SERVE_STATIC`：

```dotenv
HOST=127.0.0.1
PORT=30001
SERVE_STATIC=false
PUBLIC_ORIGIN=https://rftg.a.com
ALLOWED_ORIGINS=https://rftgm.a.com
SERVER_LABEL=rftg.a.com:16309
RFTG_HOST=127.0.0.1
RFTG_PORT=16309
SESSION_GRACE_MS=604800000
```

`PUBLIC_ORIGIN` 是浏览器看到的动态域名，包含 HTTPS 协议；内部连接仍是 HTTP。`ALLOWED_ORIGINS` 是允许的静态入口，按完整 Origin 匹配，包括协议和非默认端口；多个入口用逗号分隔。API CORS 和 WebSocket 握手使用同一策略，不依赖用户可伪造的 `X-Forwarded-*` 来决定允许来源。

`SERVE_STATIC=false` 后，Node 只提供 `/api/config`、`/healthz` 和 `/ws`。直接访问 Node 的 `/`、JS、图片和 `/shared/` 都返回 404。`SERVER_LABEL` 只控制登录页显示的服务器名称，实际 TCP 目标由 `RFTG_HOST` / `RFTG_PORT` 决定。

启动命令：

```bash
cd /srv/rftg-mobile
npm start
```

`npm start` 执行 `node server/index.mjs`。程序自动读取项目根目录的 `.env`，无需 `source .env`；已设置的进程环境变量优先于文件。它在当前终端前台运行，适合首次检查。Node 使用内部 HTTP/WS，HTTPS/WSS 由 Nginx 提供，因此 Node 不需要证书参数。

在另一个终端检查：

```bash
curl --fail --silent --show-error http://127.0.0.1:30001/healthz
# 预期：{"ok":true,"service":"rftg-mobile"}
```

这只检查 Node 存活，不代表原生服务器已经可连接。生产常驻按下一节设置；在启用服务之前，用 Ctrl+C 停止本次前台进程，避免占用同一个端口。

### 2.2 用 systemd 常驻运行

使用 [rftg-mobile.service.example](../deploy/rftg-mobile.service.example)。它直接执行与 `npm start` 相同的 Node 入口，进程异常退出后自动重启，启用后随系统启动。

```bash
cd /srv/rftg-mobile
command -v node
id -un
sudo install -m 644 deploy/rftg-mobile.service.example /etc/systemd/system/rftg-mobile.service
sudoedit /etc/systemd/system/rftg-mobile.service
```

在服务文件中修改这三项：

| 配置 | 应填写的值 |
| --- | --- |
| `User=rftg` | 已存在的非 root 部署用户；若用当前用户部署，可填上面 `id -un` 的结果。模板不自动创建用户 |
| `WorkingDirectory=/srv/rftg-mobile` | 完整项目的绝对路径 |
| `ExecStart=/usr/bin/node /srv/rftg-mobile/server/index.mjs` | `command -v node` 得到的绝对路径，加项目入口的绝对路径 |

确保该用户能执行 Node、读取项目和 `.env`，并能穿过这些目录。如果 Node 由 nvm 等工具安装在用户目录，仍要填写实际绝对路径；systemd 不加载交互式 shell 的初始化文件。服务由程序自行加载 `.env`，不需要另写 `EnvironmentFile`。

编辑完成后启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rftg-mobile
sudo systemctl status rftg-mobile --no-pager
sudo journalctl -u rftg-mobile -n 100 --no-pager
curl --fail --silent --show-error http://127.0.0.1:30001/healthz
```

日常操作：

```bash
sudo systemctl restart rftg-mobile       # 更新代码或 .env 后重启
sudo journalctl -u rftg-mobile -f         # 跟随日志，Ctrl+C 退出日志查看
sudo systemctl stop rftg-mobile          # 手动停止服务
sudo systemctl start rftg-mobile         # 再次启动
```

更新依赖时在项目根目录先执行 `npm ci --omit=dev`，再重启服务；修改 service 文件后还要先执行 `sudo systemctl daemon-reload`。若机器使用其他进程管理器，工作目录、Node 入口和 `.env` 配置保持相同即可。服务模板采用 `Type=exec`，使启动时能发现入口程序无法执行等错误；配置含义见 [systemd 官方文档](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)。

Node 会话保存在当前进程内存中；一个 Nginx 上游对应一个 Node 实例即可。重启 Node 后使用原账号重新登录，恢复原生服务器上的对局；短暂断网和页面刷新在保留期内可用 token 自动恢复。若部署多个 Node 实例，需要让 WebSocket 重连回到原实例，不能简单随机分流。

## 3. Nginx 只放行动态路径

### 3.1 安装动态网关模板

在**动态服务器**使用 [nginx-gateway.conf.example](../deploy/nginx-gateway.conf.example)。以下示例假定 `/etc/nginx/nginx.conf` 的 `http {}` 内已有 `include /etc/nginx/conf.d/*.conf;`；若发行版使用其他包含目录，改为该目录。模板含顶层 `map` 和完整 `server` 块，不能塞入已有的 `server {}` 或 `location {}` 内，也不要对同一个域名重复安装两份站点配置。

```bash
cd /srv/rftg-mobile
sudo install -m 644 deploy/nginx-gateway.conf.example /etc/nginx/conf.d/rftg-mobile.conf
sudoedit /etc/nginx/conf.d/rftg-mobile.conf
```

需要替换的内容：

| 模板值 | 替换为 |
| --- | --- |
| 所有 `rftg.a.com` | 实际动态域名，包括 `server_name`、HTTPS 跳转和证书路径 |
| 所有 `rftgm.a.com` | 实际静态入口域名，用于静态请求的 301 跳转 |
| `ssl_certificate`、`ssl_certificate_key` | 已部署的证书链、私钥绝对路径；示例路径仅是常见布局 |
| `http://127.0.0.1:30001` | Node 的内部 HTTP 地址，须与 `.env` 的监听地址和端口一致 |

若 Nginx 与 Node 不在同一台机器，Node 的 `HOST` 与 Nginx 的 `proxy_pass` 都改为可达的内部地址。默认模板按两者同机配置。

```bash
sudo nginx -t
# 仅在校验成功后，重载已经运行的 Nginx
sudo systemctl reload nginx
```

如果 Nginx 尚未运行，在校验成功后使用 `sudo systemctl enable --now nginx`。不使用 systemd 管理 Nginx 的安装可用 `sudo nginx -s reload` 重载，见 [Nginx 官方控制命令说明](https://nginx.org/en/docs/beginners_guide.html#control)。

| 访问动态域名的路径 | Nginx 行为 |
| --- | --- |
| `/ws` | 转发给 Node，支持 WebSocket Upgrade |
| `/api/config` | 转发给 Node，跨域 JSON，禁止缓存 |
| `/healthz` | 转发给 Node，健康检查，禁止缓存 |
| 其他 `/api/*` | 404 |
| `/`、`/index.html`、JS、`/shared/*`、图片、字体及其他路径 | 301 到 `https://rftgm.a.com$request_uri` |

HTTP 80 端口使用相同的路径分类：动态路径跳转到网关 HTTPS，其余静态路径直接跳到静态入口。

例如 `https://rftg.a.com/app.mjs?v=2` 返回 `301 Location: https://rftgm.a.com/app.mjs?v=2`。静态路径不会被转发到 Node，也不会从动态域名直接读取文件。跳转目标是配置里的固定静态域名，保留原路径及查询参数。

模板通过显式 `Upgrade` / `Connection` 头和 HTTP/1.1 支持 WSS，关闭 WebSocket 响应缓冲并提高读超时；这是 Nginx WebSocket 代理需要的配置。[Nginx 官方说明](https://nginx.org/en/docs/http/websocket.html)

Node 30 秒发送一次 WebSocket ping。`/api/config`、`/healthz` 返回 `Cache-Control: no-store`，API CORS 由 Node 统一生成，Nginx 不需要再添加第二套 `Access-Control-Allow-Origin`。动态主机不需要配置静态 `root` / `alias`。

### 3.2 静态源站使用 Nginx（可选）

仅当 CDN 后面使用自己的 Nginx 静态源站时执行；对象存储托管可跳过。在**静态源站服务器**放好 `dist/static/` 全部产物，并复制项目提供的 [nginx-static.conf.example](../deploy/nginx-static.conf.example) 模板到该机器，然后执行：

```bash
# 当前目录中已放好 nginx-static.conf.example
sudo install -m 644 nginx-static.conf.example /etc/nginx/conf.d/rftg-mobile-static.conf
sudoedit /etc/nginx/conf.d/rftg-mobile-static.conf
# 修改 server_name、证书路径、root，以及 CSP 中的 HTTPS/WSS 动态域名
sudo nginx -t
sudo systemctl reload nginx
```

这里同样要求 `conf.d/*.conf` 由 `http {}` 加载；Nginx 首次启动方式见上一节。`root` 默认 `/srv/rftg-mobile/dist/static`，应指向这台机器上包含 `index.html` 的发布目录，Nginx 工作进程需要能读取它。`server_name` 和证书应匹配 CDN 回源时使用的主机名；若 CDN 使用独立回源域名，请相应调整。CSP 中的动态域名应与构建参数 `--gateway-origin` 一致。

静态源站不运行 Node，也不代理 `/api/config` 或 `/ws`。CDN 的缓存规则仍按第 1 节配置。

## 4. 上线后检查

将下面的示例域名替换后，在能够访问生产域名的终端执行：

```bash
# 动态网关：预期 HTTP 200，JSON 中 ok 为 true
curl --fail --silent --show-error https://rftg.a.com/healthz

# 跨域 API：预期 HTTP 200，以及允许静态入口的 Access-Control-Allow-Origin
curl --fail --include --header 'Origin: https://rftgm.a.com' https://rftg.a.com/api/config

# 静态直连：预期 HTTP 301，Location 保留路径和查询参数；此处不加 -L
curl --head 'https://rftg.a.com/app.mjs?v=2'
# Location: https://rftgm.a.com/app.mjs?v=2

# CDN 静态模块：预期 HTTP 200，Content-Type 为 JavaScript MIME
curl --fail --head https://rftgm.a.com/app.mjs
```

跨域 API 的 `Access-Control-Allow-Origin` 应是 `https://rftgm.a.com`，不是动态域名。HTTPS 页面只连接 HTTPS/WSS；WebSocket 虽不使用普通 fetch 的 CORS 预检，本项目仍会在握手时检查 `Origin`，因此静态入口必须配置在 `ALLOWED_ORIGINS` 中。CDN 在另一服务器或另一个主域名不影响这个机制。

这些命令检查部署入口与响应头；健康检查不验证原生 TCP 登录或完整游戏。下面的无头部署测试覆盖 TLS、跨域 WebSocket 和完整对局。

## 5. 本地测试

默认仍为一个端口，最简单：

```bash
# 先启动原生 rftgserver，监听 127.0.0.1:16309
HOST=127.0.0.1 PORT=3000 SERVE_STATIC=true PUBLIC_ORIGIN= ALLOWED_ORIGINS= \
RFTG_HOST=127.0.0.1 RFTG_PORT=16309 npm start
```

访问 `http://127.0.0.1:3000`。源码中的 `public/client-config.json` 保持空网关地址，自动同源连接 `ws://127.0.0.1:3000/ws`。没有生产 `.env` 时直接 `npm start` 即可。

也可以分成静态 3000、Node 30001；在两个终端分别运行：

```bash
# 终端 1：动态网关，仍连接 16309
HOST=127.0.0.1 PORT=30001 SERVE_STATIC=false \
PUBLIC_ORIGIN=http://127.0.0.1:30001 \
ALLOWED_ORIGINS=http://127.0.0.1:3000 \
RFTG_HOST=127.0.0.1 RFTG_PORT=16309 npm start
```

```bash
# 终端 2：独立静态入口
npm run build:static -- --gateway-origin http://127.0.0.1:30001
npm run preview:static
```

仍从 `http://127.0.0.1:3000` 进入。生产用 HTTPS/WSS；本地上述命令用 HTTP/WS，不需要本机证书。

## 6. 全程无头验证

```bash
npm run test:deployment
```

需要 Chrome/Chromium、OpenSSL、Nginx 和已编译的原生服务器；可用 `CHROME_BIN`、`NGINX_BIN`、`RFTG_SOURCE` 指定位置。

测试启动独立临时目录、随机端口、临时 TLS 证书和真实 Nginx。`gateway.rftg.test` / `static.rftg.test` 仅在测试浏览器中映射到回环地址，不使用真实域名、不更改系统 Nginx。测试验证独立静态目录、CSP、跨域 API、Origin 拒绝、HTTPS→WSS、静态路径 301、刷新恢复，并通过真实网页控件完成与原生服务器的整局游戏。结果保存在 `test-results/deployment/`。
