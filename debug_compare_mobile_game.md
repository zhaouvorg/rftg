# 手机版与 PC 单机的一致性核验

以原生 RFTG 源码目录中的 `debug_compare_online_game.md` 的固定种子、锁定 transcript、逐决策对照和真实界面操作原则为基础。此处比较游戏功能，不比较 GTK 和 H5 的像素或布局样式。

## 1. 核验对象

- 原版 `rftgserver` 保持规则、洗牌、对手 AI、计分的权威性。
- 手机版仍是浏览器 JavaScript + Node WebSocket/TCP 网关；不使用 WASM，也不在运行时启动原生 `rftg` 代替玩家。
- PC 的公开新游戏扩展列表、勾选联动、可用阶段、全部服务器候选项、玩家实际选择、公开牌桌及终局结果是对照对象。
- 手机版按顶部回合/阶段 → 当前行动 → 自己的手牌 → 自己牌桌 → 其他玩家牌桌 → 信息排列，取消手牌/牌桌分页。顶部标准局显示 5 个、双人进阶显示 7 个 PC 原版阶段图标；当前、已选、未选阶段分别以蓝色边框、正常、灰度显示。卡牌、选项、目标和状态自动换行。行动底部一行左侧重选、右侧确认，跳过/完成/其他支付方式先作为选项选中再统一确认；产品已移除建议选择。
- 顶部设置在玩法说明左边，认输在退出左边。卡牌和文字可独立缩放至 0.75–2 倍，保存到 localStorage，刷新和恢复默认均验证；对最大缩放在 320、390、768、1440 宽度检查无横向溢出。

“同一个联网客户端”不意味着服务器增加了单机的本地读档、撤销、战役或调试菜单；现有联机协议不提供这些操作。本核验覆盖该协议中的新建游戏与对局功能。

## 2. 三条独立运行路径

| 路径 | 运行方式 | 用途 |
| --- | --- | --- |
| A：参考局 | 原生 learner 引擎，固定 seed，初始座位 0 为 human path；生成 V2 transcript 后全席位锁定重放 | 固定每个玩家的决策，排除重新计算 AI 导致的分歧 |
| B：PC 单机基准 | 私有 Xvfb 内运行临时插桩的 `rftg`，AI 与受控席位均按 transcript 重放 | 从真实单机引擎读取每步请求、合法阶段、手牌/牌桌，以及终局 XML |
| C：手机实际界面 | 原版服务器 + Node 网关 + `headless: true` Chromium；对手锁定同一 transcript | 通过真实 HTML 按钮、复选框、卡牌点击完成全局，核对实际发出的消息 |

B 的 AUTOPLAY 是请求和状态的 oracle，**不是 GTK 控件可点击性的证明**。创建参数另用从实际 `gui.c` / `client.c` 提取的回调做 C oracle；手机实际控件则在 C 路径逐步点击。这里没有把“自动把答案写入客户端”的日志当作手机版 UI 验收。

整个流程不连接用户桌面。Xvfb 使用 `-displayfd` 分配私有显示，GTK 设置使用独立的 `XDG_CONFIG_HOME`；不改 `HOME`、用户偏好或现有数据库。服务器使用新的目录、数据库、随机空闲端口。结束时仅停止测试自身进程组。

## 3. 参考控制器与原生插桩

`scripts/native-reference.mjs` 在输出目录编译测试专用副本，不修改 `RFTG/src` 源文件或替换现有二进制。

- GUI 副本扩大原 AUTOPLAY 的 512 字节列表缓冲，防止 Orb 等长列表截断；在写入回答之前输出 `MOBILE_STATE`，不改变规则和随机数。
- learner 副本仅补上原命令行没有的 `arc1_mask` 配置入口，以测试精确扩展组合。
- 参考 AI 为 human seat 提出策略。以下控制器编码按真实 `gui.c` 规范化，发生在**生成** transcript 之前：Frontier 先选世界，再进入单独的 KEEP/PLACE 确认；阶段 rv 保留 arg1；已提交防御的确认使用 rv=2；消费能力只返回选中一对；不弃牌生产/不升级时同时清空两组选择。
- 这些差异来自原 AI 的原子操作、旧缓冲内容与人类 GUI 的分步操作，不能靠修改保存后的 transcript 或跳过不匹配记录解决。
- 生成后重新执行锁定重放。测试专用 AI 入口在锁定验证中若被再次调用，立即失败，禁止退回实时 AI。要求 replay PASS、分数逐席位一致；有 Role hit/miss 输出的扩展还必须为 0/0。XCS 的原 `ai_shutdown` 提前返回，不打印这些计数。

所有 native 运行设置 `RFTG_AI_NO_SAVE_NET=1`。manifest 记录原生二进制、源码、AI 权重、浏览器/网关源文件、导入数据和测试 oracle 的 SHA-256。运行结束再次检查网页输入和 AI 权重未被修改。

## 4. 创建参数对照

`tests/native/create-oracle.py` 复用原库 `tests/test_create_options_parity.py` 的 GTK 状态 mock，直接提取并编译这些实际 C 回调：

- `exp_toggle` / `arc_of_exp`
- `xcs_option_toggled`
- `update_sensitivity`
- 最终 expansion / mode / arc1 mask 解析代码

`tests/configuration.test.mjs` 对 100 组、每组 100 次随机操作及初始状态，共 **10,100 个状态**，逐字段比较 JS、PC 单机和 PC 联机。`tests/browser.test.mjs` 另将一组 80 次操作送到真实 HTML 控件，核对选中和禁用状态。

公开扩展顺序为 Base、TGS、RvI、BoW、AA、XI、XCS。Arc 1 可独立组合；切换不同系列清空原系列；Counterstrike 强制勾选并锁定 XI、Invasion、Frontier；取消 Counterstrike 保留这些选择并解锁。双人进阶、目标、夺取、人数上限与 PC 同步。

特别注意：当前 PC 只勾 XCS 与同时勾 XI+XCS，最终 expanded 都是 8；同一 mode 的主牌池相同。内部旧 expansion=7 不在公开列表中，不能拿它替代 PC 的 XCS 单选。

## 5. 每一步如何比较

决策键使用初始座位映射及 `pos + type + args`。`pos` 是选择日志的整数偏移，不是“第几个选择”。初始座位 0 可在确定起始世界后轮转，测试显式比较当前座位。

每个决策：

1. 等待服务器下发该 pos 的状态和请求。
2. 比较 B/C 的 type、三项 args、完整 offered / special 数组，包括顺序和重复值。唯一例外是 ACTION.list：它是原生输出缓冲，不能当作合法行动列表。
3. 比较回合、运行阶段、VP 池，以及自己的手牌/保存牌、公开场牌的物理 ID、设计 ID、归属、区域、货物和损伤。
4. 行动选择以原生 `action_legal_helper` 及 PC 选择上下文生成合法集合，对照网页阶段选项；避免只靠前后端共用一段 JS 得出“一致”。
5. 检查真实 DOM 包含全部选项及各组键，记录标签、选中/禁用状态。包括独立的跳过/完成/其他支付方式选项；真实点击后再通过统一确认按钮提交。原生数字答案仅用于定位真实控件，不直接提交答案、不调用应用内部函数、不使用“建议选择”兜底。
6. 逐个点击真实卡牌/能力/阶段，再点击确认；记录浏览器实际发送的 JSON，与参考帧完整比较。非法、缺项、无法确认、服务器拒绝均立即失败。
7. 双人进阶 Frontier 额外真实点击左殖民 → 右殖民 → 取消的加成循环，检查被加成按钮和明确显示的执行顺序。
8. 检查整页和手牌、场牌、候选项、地图、状态等容器没有横向溢出，且顶部回合阶段、行动、手牌、自己的桌面、对手桌面、信息均在同一 DOM 页面中按顺序出现，行动在手牌上方。

唯一自动回复的 UI 协议步骤是 `CHOICE_INVASION_CONFIRM` 的 arg3 bit1：PC 的前一个 Done 已提交防御，这里原本就不需要再点一次。该步骤仍记录、比较、计入协议决策总数，但不计为真人按钮点击。无前置防御选择的确认、全桌防御结果仍必须点击。

完成一局必须同时满足：

- 全部受控席位 transcript 帧都已消费，整数偏移恰好到达末尾；
- 原生 B 产生含 GameOver 的 XML；
- 浏览器收到正常终局，服务器 SQLite 为 `DONE`，结果行数等于玩家数；
- A/B/C 受控初始席位得分一致；B/C 全部玩家按轮转后座位比较得分、获胜标记、VP 筹码、手牌数、完整场牌、货物/损伤属性、回合与 VP 池；
- 没有 JS 错误、资源 HTTP 错误、协议拒绝、transcript mismatch/exhaustion、异常弃局；
- 终局在 320、390、768、1440 宽度检查不横向溢出。

## 6. 执行命令

原库应先原地编译（测试需要其对象文件来链接只读 oracle）：

```bash
# 将 RFTG_SOURCE 设为实际原生源码目录的 src 子目录
export RFTG_SOURCE=/path/to/RFTG/src
make -C "$RFTG_SOURCE" -j4 rftg rftgserver ai_client learner
npm run check
npm test
npm run test:integration
npm run test:browser
npm run test:consistency
# 上述所有测试：npm run test:all
```

环境依赖：Node 22+、项目 npm 依赖、C 编译器、pkg-config/GTK2 开发包、Python3、Xvfb、Chrome/Chromium。

```bash
RFTG_SOURCE=/absolute/RFTG/src CHROME_BIN=/usr/bin/google-chrome \
  npm run test:consistency -- --case counterstrike-conquest \
  --out /tmp/rftg-mobile-conquest-check
```

`--case` 可逗号分隔；默认 all。`--out` 必须为空，防止覆盖既有证据；不指定时使用带时间戳的 `test-results/consistency-*`。

默认矩阵包括 13 局：

| case | 扩展/模式 | 人数 | seed |
| --- | --- | --- | --- |
| base | 基础 | 2 | 424242 |
| advanced | 基础，双人进阶 | 2 | 1001 |
| arc1 | BoW，mask=7 | 2 | 1001 |
| arc1-subset | BoW，mask=5 | 2 | 1002 |
| orb | AA + Orb | 2 | 1001 |
| invasion | XI + Invasion | 2 | 1001 |
| xcs-cards | XCS 普通牌组 | 2 | 1001 |
| frontier | XCS + Frontier | 2 | 1001 |
| invasion-frontier | XCS + Invasion + Frontier | 2 | 1001 |
| counterstrike | Counterstrike，双人进阶 | 2 | 1001 |
| counterstrike-1002 | Counterstrike，双人进阶 | 2 | 1002 |
| counterstrike-conquest | Counterstrike，双人进阶；必须实际出现修复、路线、系统征服、防御结果并点击一次征服尝试 | 2 | 1008 |
| invasion-4 | XI + Invasion | 4 | 1001 |

这不是穷举所有卡牌组合的数学证明。`summary.json` 的 types / roles / chosenRoles 是本轮实际覆盖范围；没有出现的罕见卡牌链不能借“55 种协议已实现”声称都被整局执行过。

## 7. 证据和定位

```text
test-results/consistency-*/
  manifest.json                 配置、环境、输入哈希、完成状态
  summary.json                  每局结果、决策/点击/自动确认数、类型、阶段、分数
  native-oracle/                临时插桩源码、对象、可执行文件
  <case>/
    reference/                  生成与锁定验证日志、不可变 V2 transcript
    local/                      独立 GTK 配置、stderr、决策 JSON、终局 XML
    server/                     独立 SQLite、服务器日志与终局 XML
    mobile-decisions.json       每步请求、原生基准、扩展快照、模型、DOM、实际答案
    database-result.json        最终 DONE 与结果行
    create-mobile.png           创建参数界面
    choice-<type>.png            每种实际出现选择的无头截图
    final-mobile.png            手机终局
    failure.json / failure.png  失败时保存首个差异和现场
```

先修最早的语义差异，重新从起始种子执行，不把失败记录录成新基线。输出中的旧失败目录只用于排查，最终验收以 manifest.result=PASS 的完整运行及对应 summary 为准。

## 8. 首轮运行

2026-11-13 执行完成。最终证据：[manifest](test-results/consistency-20261113-final/manifest.json)、[逐局结果](test-results/consistency-20261113-final/summary.json)。

13/13 局 PASS：1156 个协议决策，1107 次真实界面决策，49 次 PC 零点击确认；全部终局 SQLite 为 DONE。创建参数 10,100 个状态一致；另有 24 项单元/配置、15 项真实服务器集成、2 项无头浏览器回归通过。

| case | 协议决策 | 实际界面决策 | 自动确认 | 回合 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| base | 47 | 47 | 0 | 10 | PASS |
| advanced | 43 | 43 | 0 | 6 | PASS |
| arc1 | 72 | 72 | 0 | 18 | PASS |
| arc1-subset | 46 | 46 | 0 | 12 | PASS |
| orb | 74 | 74 | 0 | 12 | PASS |
| invasion | 56 | 50 | 6 | 8 | PASS |
| xcs-cards | 60 | 60 | 0 | 14 | PASS |
| frontier | 83 | 83 | 0 | 17 | PASS |
| invasion-frontier | 51 | 46 | 5 | 7 | PASS |
| counterstrike | 121 | 114 | 7 | 10 | PASS |
| counterstrike-1002 | 161 | 152 | 9 | 12 | PASS |
| counterstrike-conquest | 221 | 209 | 12 | 17 | PASS |
| invasion-4 | 121 | 111 | 10 | 12 | PASS |

实测覆盖 31 种 choice 类型，包括 Frontier 48/49/53、Conquest 51/52、入侵/反击防御 30/33/34/54、修复 26/27，以及 Orb 35/36/38/39/40。seed=1008 实际进入征服阶段并选择一次征服尝试，也实际选择了 Produce: Repair。具体集合以 summary 中 types、roles、chosenRoles 为准。

本次还修复了生产回答尾部数组、SELECT_LAST 排序、孤立第二发展/殖民规范化、Frontier 加成与冷却、反击防御误禁 Done、重复防御确认及过时的征服状态展示。

## 9. 显示设置与操作区调整后的复验

2026-11-13 再次全程无头执行，当前代码对应的证据为 [manifest](test-results/consistency-display-20261113/manifest.json)、[逐局结果](test-results/consistency-display-20261113/summary.json)、[完整运行日志](test-results/consistency-display-20261113/run.log) 和 [回归摘要](test-results/consistency-display-20261113/verification.json)。首轮证据保留作为历史记录。

- 所有屏幕宽度均按行动、手牌、自己牌桌、其他玩家牌桌、信息排列；默认手牌和场牌增大，继续自动换行。
- 设置位于玩法说明左边，认输位于退出左边。卡牌和文字独立调整为 0.75–2.00 倍，覆盖即时生效、互不干扰、刷新保留、恢复默认后再次刷新保留。最大放大系数下检查 320、390、768、1440 宽度的页面、设置面板、卡牌和按钮行均无横向溢出。
- 行动底部只有一行重选、确认；跳过/完成/其他支付方式改为选择列表中的项目。验证选中不会立即发送，重选能够清除，确认才提交。完整矩阵逐步核对实际发送值与原生答案。
- 产品中移除建议选择入口及算法；自动出牌策略仅存在于测试目录，普通浏览器对局测试也通过真实候选控件完成选择。
- 页面名称统一为“银河竞逐”，两项目文档中的源码名称统一为 RFTG。

结果：13/13 局 PASS，逐局数量与上表相同，共 1156 个协议决策、1107 次真实界面决策、49 次 PC 零点击确认，覆盖 31 种实际 choice，全部数据库终局为 DONE。当前 runtime 哈希在运行前后保持一致。

另外通过 24 项单元/配置测试（含 10,100 次 PC 配置回调对照）、15 项真实服务器集成测试、2 项无头浏览器测试；手机完整对局完成 49 次真实界面决策。资源及语法检查通过。测试所启动的服务器、网关、浏览器和私有 Xvfb 均已退出。


## 10. 阶段图片图标与点击说明

行动选择使用 PC 原始图片图标，固定为 52×52 像素触摸按钮，独立于手牌/场牌的缩放系数。图标采用浅色底以显示原图中的黑色交易、消费符号；选中时金色高亮。320 像素窄屏每行至少 4 个，390 像素每行 5 个，超出自动换行。全部说明集中在图标下方，随最后一次点击切换，重选与新决策会清除旧说明。

顶部回合栏同样只使用图标：标准局为探索、发展、殖民、消费、生产 5 个；双人进阶为探索、发展、再次发展、殖民、再次殖民、消费、生产 7 个。阶段图片沿用原生 `phase_icon` 映射（探索 23、消费 24），第二次发展／殖民带数字 2 标记，阶段名称只放在可访问标签和提示中。

Orb 选择地图不重复渲染坐标按钮，而是显示实际板块美术、主／小气闸、神器背面和调查队米宝；移动、返回气闸、初始气闸和卡牌放置均直接点击金色地图目标。放置目标按坐标合并四种旋转，地图上显示半透明卡牌预览，旋转按钮在当前坐标的合法朝向间循环；不画单机版没有的合法区域框。Done／Stay 等非格子选项作为独立按钮保留并统一确认。地图选择或放置进行时，下方常驻 Orb 面板不再重复地图。

第二次发展/殖民使用对应基础图标和数字 2；威望使用独立徽标。生产修复映射到 PC 的 icon 25，避免误用数值相同的无行动图标；Orb 使用专用黄色调查队图标，边境使用原生 Frontier 图标，加成后改变对应殖民图标。

`tests/action-controls.mjs` 从 PC 图标映射独立核对所有合法阶段按钮、图片加载、徽标、可访问名称、尺寸和换行。完整一致性测试在每次阶段请求都执行这项检查，真实点击后再核对说明标题是否切换到对应阶段；最终仍比较完整原生回答。

浏览器回归额外检查 320、390 宽度及卡牌/文字同时 2 倍的设置，逐一点击基础阶段、检查集中说明、验证重选清空并完成整局；阶段图标不随放大系数变成宽卡片。

2026-11-13 复验完成：[manifest](test-results/consistency-phase-icons-20261113-final/manifest.json)、[逐局结果](test-results/consistency-phase-icons-20261113-final/summary.json)、[日志](test-results/consistency-phase-icons-20261113-final/run.log)、[回归摘要](test-results/consistency-phase-icons-20261113-final/verification.json)。13/13 局通过，共 1156 个协议决策、1107 次真实界面决策、49 次 PC 零点击确认；当前 runtime 哈希在核验期间未变化。另外通过 24 项单元/配置测试及 2 项无头浏览器测试，手机完整对局完成 49 步真实界面决策。

无头截图：[默认阶段选择](test-results/consistency-phase-icons-20261113-final/phases-mobile.png)、[320 宽度，2 倍设置](test-results/consistency-phase-icons-20261113-final/phases-320-scale2.png)、[390 宽度，2 倍设置](test-results/consistency-phase-icons-20261113-final/phases-390-scale2.png)。不带 `-final` 的同名目录为调整图标对比度时主动中止的运行，不属于验收结果。


## 11. 静态 CDN / Nginx 动态网关部署核验

分离部署配置与操作方法见 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。运行 `npm run test:deployment` 验证完整静态构建、独立静态服务、API CORS、WebSocket Origin，以及真实 Nginx 的 TLS 代理和静态资源跳转。

2026-11-13 验证通过：24 项单元/配置测试、2 项原有无头浏览器测试、4 项部署测试。部署测试在临时目录和随机端口启动真实 Nginx，使用临时证书，把两个测试域名仅在无头浏览器内映射到回环地址；不修改系统 Nginx，不访问示例域名。

HTTPS/WSS 分离入口实际完成 49 步网页选择直至原生服务器结算，并验证刷新后的会话恢复。HTTP、HTTPS 动态域名的首页、JS、shared 模块、图片和配置静态路径均重定向到静态入口，保留查询参数；动态白名单正常代理，未知 API 为 404。Node 关闭静态服务后不能直接读取这些文件，未经允许的跨域 API 和 WS 握手均被拒绝。

结果见 [部署结果](test-results/deployment/summary.json) 和 [无头终局截图](test-results/deployment/split-final.png)。前面各节的 13 局语义一致性证据为各次功能修改时的历史运行；本节专门覆盖此次部署与传输调整。
