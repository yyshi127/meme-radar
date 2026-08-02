# GMGN Meme Radar

一个本地运行、只读的 Meme 币早期发现雷达。它不会自动买币，也不会把评分包装成“上涨概率”。

## 网页版

在 PowerShell 中运行：

```powershell
cd 'C:\Users\Administrator\Desktop\临时\meme-radar'
npm.cmd run web
```

然后打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。也可以右键用 PowerShell 运行 `start-web.ps1`。

雷达分为两个独立页面：

- `http://127.0.0.1:8787/discovery` — **猎星榜**：冻结的改造前最后一版 `legacy-v1` 评分；风险尽调不作为入榜前提。
- `http://127.0.0.1:8787/verified` — **验金榜**：Top100、关联钱包、Bundler、关键风险完整度参与严格过滤。

同一代币在两页可能得到不同结论，这是两种策略并存的目的，并非数据冲突。

`legacy-v1` 原版规则没有持币地址总数门槛；它按聪明钱/KOL、GMGN 信号、趋势/热搜、流动性、市值、阶段和基础风险评分。若需要增加最低持币人数，那属于新策略变更，而不是原版恢复。

网页默认每 5 秒读取一次本地状态，后台按 `config.json` 中的间隔更新数据；也可点右上角“立即扫描”。服务只监听本机 `127.0.0.1`，GMGN 私钥和 API Key 不会发送到浏览器。

网页功能：

- ALERT / WATCH / SKIP 汇总和筛选
- 按链、阶段、代币名或合约搜索
- 候选评分、信号数量、聪明钱和 KOL 买入概览
- Top100 持仓深度尽调：Bundler、老鼠仓/狙击钱包、同一资金源、同步注资、Dev 马甲与筹码集中度
- 单币安全分、数据完整度、验证状态、入选原因、风险与硬过滤结果
- 收藏为重点观察对象；收藏及最后快照存入 SQLite，不会随页面刷新或扫描结果变化而丢失
- 持续记录发现后价格表现与钱包历史结果；样本不足时不显示伪造的“胜率”
- 合约地址一键复制
- 点击代币名称或详情按钮，在新标签页打开对应 GMGN 详情页
- 桌面和手机浏览器自适应布局

## 命令行版

单次扫描：

```powershell
npm.cmd run scan
```

持续监控：

```powershell
npm.cmd run watch
```

也可右键用 PowerShell 运行 `start-radar.ps1`。默认每 120 秒扫描一次，按 `Ctrl+C` 停止。

单币尽调：

```powershell
node .\src\index.mjs inspect sol <合约地址>
node .\src\index.mjs inspect bsc <合约地址>
```

## 当前数据源

- GMGN 1 分钟趋势榜
- GMGN 1 分钟热搜榜
- 发射台新创建 / 接近毕业代币
- Smart Money 实时买入和 30 分钟钱包聚类
- KOL 实时买入
- GMGN Smart Money / KOL 信号流

默认扫描 Solana 和 BSC。只有至少两类信号共振，才可能进入 `ALERT`。合约风险、刷量、持仓集中、Bundler、内盘比例和追涨风险会扣分或直接硬过滤。

## 输出文件

- `output/latest.md`：可读榜单与报警原因
- `output/latest.json`：完整机器可读数据
- `data/state.json`：首次发现、分数变化和报警去重状态
- `data/radar.sqlite`：收藏、Top100 缓存、历史观测与钱包结果
- `output/web-dashboard-desktop.png`：桌面端验收截图
- `output/web-dashboard-mobile.png`：移动端验收截图

## 分数含义

分数只表示“值得优先研究的程度”，不是胜率或收益预测。主要加分项是聪明钱钱包聚类、多类信号共振、早期市值区间、流动性和安全基线；主要扣分项是追涨、集中度、Rug、Bundler、内盘和低流动性。

KOL 单独买入不会触发报警。未经 Top100 持仓尽调或关键风险数据不完整的候选不会进入 `ALERT`。Smart Money 和 KOL 也不是无条件可信，交易前仍需检查持仓结构、池子深度和退出流动性。

## 当前边界

- 尚未接入 X 官方 API，所以当前“社交”信号来自 GMGN 热搜、KOL 钱包和代币社交资料，不等于实时推文监控。
- 尚未发送 Telegram / 微信通知；报警保存在报告并打印到终端。
- 校准概率需要至少 20 个同链同分数段成熟样本，整体校准状态默认需要 50 个成熟样本；当前没有足够样本时会明确显示“暂不提供”。
