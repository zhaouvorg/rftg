# 银河竞逐 · RFTG Mobile

H5（原生 JavaScript ES modules）+ Node.js 的在线客户端，直接连接原生 RFTG 的 `src/rftgserver` 使用的 TCP 协议。浏览器与 Node 网关合起来承担桌面 `rftg` 的在线客户端角色；游戏规则、洗牌、AI、持久化和最终计分仍由现有服务器负责。

本文中的 RFTG 指原生源码目录；路径示例中的 `/path/to/RFTG` 请替换为实际位置。

运行路径为 `浏览器 ⇄ WebSocket/JSON ⇄ Node ⇄ TCP ⇄ 原版 rftgserver`。运行时没有 WASM、C/C++ 编译、原生客户端子进程或远程桌面。每个登录会话有独立的上游 TCP 连接，可与桌面客户端处于同一大厅和对局。

## 本地启动

需要 Node.js 22+，以及已经运行的 `rftgserver`。当前目录已安装依赖。

```bash
cd ../rftg-mobile
npm start
```

打开 <http://127.0.0.1:3000>。手机与电脑处于同一局域网时，打开 `http://电脑的局域网IP:3000`。

在新的机器上先运行 `npm ci`。已有资源和数据随工程保存在 `public/`，日常运行不需要原项目源码目录。服务器默认地址是 `127.0.0.1:16309`，可通过环境变量或 `.env` 修改：

```bash
cp .env.example .env
# 编辑 .env 中的 RFTG_HOST、RFTG_PORT 等
npm start

# 或仅本次指定
PORT=3100 RFTG_HOST=192.168.1.10 RFTG_PORT=16309 npm start
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 网页监听地址 |
| `PORT` | `3000` | 网页与 WebSocket 端口 |
| `RFTG_HOST` | `127.0.0.1` | 原游戏服务器地址 |
| `RFTG_PORT` | `16309` | 原游戏服务器 TCP 端口 |
| `SESSION_GRACE_MS` | `604800000` | 浏览器断开后保留会话和上游连接的时间（一周） |
| `SERVE_STATIC` | `true` | 本地同时提供静态页面；生产网关设为 `false` |
| `PUBLIC_ORIGIN` | 空 | Nginx 对外动态 Origin，例如 `https://rftg.a.com`（示例） |
| `ALLOWED_ORIGINS` | 空 | 允许跨域 API 与 WebSocket 的静态入口，逗号分隔；默认同源 |
| `SERVER_LABEL` | 上游地址和端口 | 登录页显示的服务器名称 |

## 生产部署：静态 CDN + Nginx 动态网关

以 `a.com` **占位示例**说明，实际域名可替换：

- `rftgm.a.com:443`：用户入口，由 CDN 分发 `dist/static/` 的全部静态文件。
- `rftg.a.com:443`：Nginx 终止 HTTPS/WSS，只代理 `/ws`、`/api/config`、`/healthz` 到内部 Node `127.0.0.1:30001`。
- `rftg.a.com:16309`：原生 `rftgserver`；Node 通常通过回环或内网连接它，PC 客户端仍可直接连接。
- 动态域名的首页、JS、图片等静态请求全部 301 到静态域名，保留路径和查询参数；Node 设置 `SERVE_STATIC=false`，不提供静态文件。

需要 Node.js 22+、npm、Nginx 和已编译的原生 `rftgserver`、`ai_client`。下面假设 `RFTG` 与 `rftg-mobile` 同级，分别位于 `/srv/RFTG` 和 `/srv/rftg-mobile`；目录、域名、证书和运行用户都应替换为实际值。

先按[原生服务部署步骤](docs/DEPLOYMENT.md#0-启动原生-rftg-服务)安装 [rftg.service.example](deploy/rftg.service.example)，从 `RFTG/src` 运行服务器，监听 TCP 16309。模板使用 `RFTG/src/rftg.sqlite` 保存账号和对局，AI 子进程随服务一起管理。Node 网关另由 `rftg-mobile.service` 运行。

**1. 构建并发布静态入口**（在开发机或构建机执行）：

```bash
# 在项目根目录执行，示例域名必须替换
npm ci
npm run build:static -- --gateway-origin https://rftg.a.com
# 上传 dist/static/ 的全部内容到 CDN / 静态站点根目录
```

发布目录包含 `public/` 和浏览器需要的 `shared/`，不包含 Node 服务、依赖或 `.env`。`client-config.json` 指定网关，构建时同步生成 CSP。

**2. 安装并启动 Node 网关**（在动态服务器执行，先放好完整项目）：

```bash
cd /srv/rftg-mobile
npm ci --omit=dev
test -f .env || cp deploy/gateway.env.example .env
# 编辑 .env：PUBLIC_ORIGIN 填动态域名，ALLOWED_ORIGINS 填静态入口
# 保持 HOST=127.0.0.1、PORT=30001、SERVE_STATIC=false
# RFTG_HOST / RFTG_PORT 指向已有的原生服务器
npm start
```

`npm start` 等价于 `node server/index.mjs`，自动读取项目根目录的 `.env`，在当前终端前台运行。在另一终端执行 `curl --fail http://127.0.0.1:30001/healthz` 检查 Node 已启动。生产常驻使用 [systemd 模板](deploy/rftg-mobile.service.example)，按[详细部署文档](docs/DEPLOYMENT.md#22-用-systemd-常驻运行)替换用户、目录和 Node 路径后启用；先用 Ctrl+C 停止前台进程，避免端口冲突。

**3. 安装 Nginx 动态网关模板**（同一台动态服务器）：

```bash
cd /srv/rftg-mobile
sudo install -m 644 deploy/nginx-gateway.conf.example /etc/nginx/conf.d/rftg-mobile.conf
sudoedit /etc/nginx/conf.d/rftg-mobile.conf
# 替换所有示例域名、证书路径；proxy_pass 对应 Node 的 127.0.0.1:30001
sudo nginx -t
# 校验成功后，重载已经运行的 Nginx
sudo systemctl reload nginx
```

[动态 Nginx 模板](deploy/nginx-gateway.conf.example)包含 `map` 和完整 `server` 块，需由 `http {}` 中的 `include /etc/nginx/conf.d/*.conf;` 加载。静态源站若也用 Nginx，在**静态源站服务器**使用 [静态 Nginx 模板](deploy/nginx-static.conf.example)；对象存储/CDN 直接托管时不需要它。

完整的 systemd 安装、启动/重启/日志命令、两份 Nginx 模板的配置步骤、跨域与 CDN 缓存规则、上线检查和本地分离运行方式，见 [部署文档](docs/DEPLOYMENT.md)。

## 使用

- 登录原服务器账号。新用户名会按原服务器行为自动注册；用户名为 2–20 位英文字母、数字或下划线，密码最多 20 字节。
- 创建或加入房间，房主可添加服务器 AI、移除席位和开始游戏。桌面客户端玩家能看到相同房间。
- 新建游戏只列出基础游戏、风云际会、反叛与帝国、战争边缘及其组合，并提供人数、双人进阶、目标和夺取限制；不提供异星遗迹及 Xeno 系列的建房选项。
- 回合和阶段状态固定在页面顶部；标准局显示 5 个 PC 原版阶段图标，双人进阶按实际执行顺序显示第二次探索、发展、殖民等 7 个图标。当前阶段、已选阶段和未选阶段分别使用蓝色边框、正常和灰度状态，不显示阶段文字。
- 同页从上到下排列顶部回合阶段、当前行动、自己的手牌、自己的牌桌、其他玩家牌桌和信息。手牌与场牌默认放大；卡牌/选项超出一行自动换行。展示货物、损伤、阶段、VP、军力、威望、目标、入侵/征服/反击和修复状态。卡牌可放大阅读。
- 选择 1／2 个阶段使用 PC 原始图片图标，窄屏每行至少 4 个；点击图标后，下方显示该阶段说明。阶段图标保持紧凑，不随卡牌放大系数增宽；第二次发展／殖民、威望和边境加成都有独立标记。
- Frontier 与 PC 一样作为殖民加成：先选殖民，再点边境；进阶双殖民可循环加成左侧、右侧、取消，并显示执行顺序。生产修复、Orb、威望及补选第二阶段均按游戏状态开放。
- 选择界面覆盖当前协议的 55 类选择：弃牌、放置、支付、殖民能力、交易、消费、生产、入侵防御与修复、Orb 地图与神器、边境及征服等。Orb 地图直接显示板块原图、主／小气闸、神器背面和调查队米宝；移动、返回气闸、起始气闸和卡牌放置都直接点击地图目标，不再重复列出坐标按钮。放置时地图显示半透明卡牌预览并用“旋转方向”切换朝向；完成／留在原地等非格子选项仍作为单独按钮确认。
- 行动底部始终一行：左侧“重选”，右侧“确认”。跳过、完成及其他支付方式列为可选项，选中后统一确认；不再提供建议选择。
- 顶部“设置”位于“玩法说明”左边，可分别调整全局卡牌和文字的放大系数（0.75–2.00 倍），立即生效并由浏览器保存，刷新后保留；可恢复默认。顶部“认输”位于“退出”左边。
- 刷新页面或断线后会恢复 Node 内存中的会话，默认保留一周。保留时间过后，使用相同账号重新登录，可由原服务器恢复未结束的对局。
- 支持大厅/牌桌聊天、认输、查看最终得分、下载本局文本记录和返回大厅。最终分数与获胜者读取服务器结算消息。

## 无头测试

所有测试均为无头方式。真实对局测试启动现有的 `rftgserver` 可执行文件，使用临时目录、独立 SQLite 数据库、随机空闲端口，结束后清理自己的进程；不使用 `src/rftg.sqlite`。一致性测试的 PC 基准仅在私有 Xvfb 中启动 GTK；普通集成和浏览器回归不启动 GTK。服务器自行启动的 AI 是原服务器的正常对手席位，网页玩家的选择始终由 JS 或无头网页产生。

```bash
npm run check             # 资源完整性、JS 语法
npm test                  # 协议、隐私、选择、支付和 10100 次 PC 配置回调对照
npm run test:integration  # 实际服务器完整对局和重连
npm run test:browser      # 无头 Chromium 的完整手机界面对局
npm run test:consistency  # 13 局固定 transcript，原生基准与手机真实按钮逐步对照
npm run test:deployment   # 真实 Nginx + TLS + 跨域 WSS 的无头完整对局、静态 301
npm run test:all          # 上述全部测试
```

集成测试默认从相邻的 RFTG 原生源码目录读取 `src/` 下的 `rftgserver`、`ai_client`、`cards.txt` 和 `network/`。可设置 `RFTG_SOURCE=/path/to/src` 更换路径。浏览器测试默认使用 `/usr/bin/google-chrome`，可设置 `CHROME_BIN`；Playwright 使用 `headless: true`。

测试涵盖：基础及双人进阶完整对局；Orb 布图、移动及完整对局；入侵、防御结果；边境选牌与确认；反击和入侵 + 边境；Arc 1 组合；生产/交易/消费；与原服务器 AI 对局；WebSocket 会话恢复；TCP 断开后的账号恢复；过期选择拦截；隐藏手牌；手机界面 49 次真实交互直至服务器结算。

浏览器截图和一致性证据保存在 `test-results/`。完整方案、运行前提、矩阵、逐步比较方式及真实覆盖边界见 [debug_compare_mobile_game.md](debug_compare_mobile_game.md)。一致性测试还需要已编译的原库对象文件、GTK2 开发包、Python3 和 Xvfb。

## 工程结构

```text
server/       HTTP、WebSocket、TCP 协议解码与会话状态
shared/       浏览器和 Node 共用的选择、支付检查、牌库与扩展快照模块
public/       H5 界面、样式、364 张卡牌设计及本地图片资源
scripts/      从原项目导入资源、校验资源
tests/        单元、真实服务器和无头浏览器测试
deploy/       生产环境 Node 配置、systemd 常驻服务和 Nginx 模板
docs/         协议实现与分离部署说明
dist/static/  生成的 CDN 静态发布目录（npm run build:static）
```

修改原游戏的卡牌后，可重新导入资源：

```bash
npm run assets
# 或 node scripts/import-assets.mjs --source /path/to/RFTG
node scripts/verify-assets.mjs
```

资源导入为纯 Node 脚本，保留原设计编号、各扩展牌数和 Arc 1 组合顺序。普通状态帧没有设计编号，因此这个顺序是与原服务器互通的必要条件。XCS 动态生成的卡牌根据服务器附带的设计编号更新。

代码按 GPL-2.0-or-later 提供，见 [LICENSE](LICENSE)。卡面等素材沿用原项目资源及其权利归属，见 [ASSET_LICENSES.md](ASSET_LICENSES.md)。
