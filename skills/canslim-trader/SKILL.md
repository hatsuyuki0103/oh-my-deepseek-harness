---
name: canslim-trader
description: CANSLIM 交易员：按七因子（C/A/N/S/L/I/M）给 A 股打分排序，产出买入 / 卖出 / 融券做空信号，并在 A 股 T+1 与两融约束下用 `ptrade` 模拟盘 CLI 走完「扫描 → 建议 → 计划 → 下单 → 结算 → 风控 → 平仓 → 台账」闭环。需要 CANSLIM 选股、买卖点判定或模拟盘演练时使用。
argument-hint: "[--codes <600519,002594>] [--asof YYYY-MM-DD] [--offline] [--json] [--root <path>]"
---

# CANSLIM 交易员（canslim-trader）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

本技能把 **CANSLIM 七因子选股口径** 与 **`ptrade` 模拟盘** 绑成一条可验证的流水线。口径真源是 `ptrade` 仓库的 `INTERFACES.md`：§6.1（七因子打分）/ §6.2（信号判定顺序）/ §2（阈值配置）/ §7（CLI 契约）；`ptrade` 同时是该接口的实现。技能内任何数值与实现冲突时，**以 `INTERFACES.md` 与 `ptrade/strategy.py` 的实际阈值为准**，并同步本文件。

## 何时用

- 想让一批 A 股按 CANSLIM 口径**打分、排序、出买入候选**（强票 / 弱票对照）；
- 想在模拟盘里验证「七因子 → 信号 → 交易计划 → 成交 → 结算 → 风控 → 平仓」的完整闭环；
- 想复现某个历史交易日（`--asof`）的选股结论，或核对账户台账（`ledger` / `status`）；
- 想演练**融资买入 / 融券卖出**在 T+1、保证金比例与维持担保比例约束下的真实行为，且不承担真金白银风险；
- 想给已持仓做**止损 / 止盈 / 破位离场**的机械化判定。

## 何时不用

- **真实资金实盘下单**：`ptrade` 是本地模拟撮合器，不含任何券商通道；要实盘请走券商终端，并自行承担全部风险。
- **日内 / 高频 / T+0 策略**：本包按日线 + 日频结算建模，A 股当日买入不可当日卖出（见「A 股 T+1 约束」），不存在日内回转口径。
- **纯基本面研究或宏观判断**：本技能产出的是「可执行信号 + 交易计划」，不是投研报告；需要定性研究请用别的工具。
- **数据缺失却要求最新结论**：`--offline` 只读本地缓存，缺数据就如实报错；不得用记忆里的数字顶替行情。
- **需要保证收益**：任何打分与信号都是机械规则，不构成收益承诺。

## 前置检查（开工前 30 秒）

1. **`ptrade` 是否可用**：`python -m ptrade --help` 能跑通 → 包已装（Python ≥ 3.11）。
   **不可用时先安装**（`ptrade` 是独立发布的 Python 包，不随本插件分发）：

   ```sh
   pip install git+https://github.com/hatsuyuki0103/ptrade
   # 或从 Releases 下载 wheel：https://github.com/hatsuyuki0103/ptrade/releases
   ```

   首次使用若需要 `--offline`（离线夹具），在 `ptrade` 仓库跑一次
   `python tools/fetch-fixtures.py`（从 release 下载夹具与剧本）。

2. **数据根**（后文记作 `<root>`）：按 `--root <path>` → `PTRADE_HOME` → 源码检出根 → `~/.ptrade` 依次解析。
   三个中最常用的是显式指定：`python -m ptrade ... --root <path>`；想固定一个工作目录就设 `PTRADE_HOME`。
   账户状态、台账、缓存、图表产物都落在 `<root>` 下。
3. **配置**：`<root>/config.json` 存在则覆盖默认阈值，缺失字段回落到默认值（下表默认值即 `INTERFACES.md` §2）；
4. **三条铁律**：① `--offline` 下**绝不联网**；② 任何一单先 `plan` 后 `order`；③ 每笔成交后必须 `settle` 到次一交易日才能再动同一持仓。

## CANSLIM 七因子打分口径

子分先归一到 **0-100**，再按权重加权求和；**缺失数据 → 该因子 50 分（中性）** 并在 `risks` 标注 `"<因子>数据缺失"`。权重和 = 1.0。

| 因子 | 含义 | 权重 | 主数据源 | 打分规则（与 `strategy.py` 一致） |
|---|---|---|---|---|
| **C** | 当季盈利 | 0.18 | `quarterly_report(最近报告期).net_profit_yoy` | `>=100%`→100；`>=50%`→90；`>=30%`→80；`>=20%`→70；`>=10%`→55；`>=0`→40；`<0`→15。**加速加成**：本季增速 > 上季增速 → 得分 × `c_accel_bonus`（默认 1.25，上限 100） |
| **A** | 年度盈利 | 0.16 | `fin_indicator(code)` 年度 `net_profit_yoy` / `roe` | 取最近 3 个年报，每年映射：`>=50`→100；`>=25`→85；`>=15`→70；`>=5`→55；`>=0`→40；`<0`→20；`roe >= 17%` 该年额外 +10（上限 100）；三年取均值 |
| **N** | 新事物（新高） | 0.14 | `daily()` 250 日区间位置 + 量能 | 收盘 ≥ 250 日最高 × 0.98（创新高）→100；距高点 `<=5%`→85；`<=15%`→65；`<=30%`→45；否则 25。**创新高且成交量 > 50 日均量 ×1.5 → 取 `max(score, 90)`** |
| **S** | 供给（流通盘 + 量能） | 0.12 | `spot()` 的 `float_mv` / `turnover`；`holders().holders_chg_pct` | 流通市值：`<50 亿`→80；`50-200 亿`→90；`200-500 亿`→75；`500-1000 亿`→60；`>=1000 亿`→45。换手率 `3%-15%`→+10；股东户数**减少**（筹码集中）→+10，增加 →−10；上限 100、下限 0 |
| **L** | 龙头 / 落后（相对强度） | 0.16 | `daily()` 计算 RS = 个股近 6 月涨幅 − 指数近 6 月涨幅 | 行业内（`industry_constituents`）RS 百分位：前 10%→100；前 25%→85；前 50%→65；前 75%→45；后 25%→25。行业取不到 → 绝对 RS 分档：`>30%`→90；`>15%`→75；`>0`→60；`>-15%`→40；否则 20 |
| **I** | 机构认同度 | 0.12 | `top_holders()` 机构合计持股比例与环比变化 | 合计持股 `10%-60%`→85；`60%-80%`→70；`>80%`（过挤）→55；`3%-10%`→60；`<3%`→35；机构数/持股环比**增加** → +10，减少 → −10；上限 100、下限 0 |
| **M** | 市场方向 | 0.12 | `market_breadth()` | 基础 20 分；指数在 50 日线上 +20、200 日线上 +20；指数 20 日涨幅 `>5%`→+25，`>0`→+15，`>-5%`→+5，否则 0；涨跌家数比 `>2`→+20，`>1`→+12，`>=0.5`→+5，否则 0；涨停家数 `>50`→+15，`>=20`→+8；上限 100 |

`total` = Σ(子分 × 权重)，取值 0-100；M 因子不随个股变化（同交易日共用，内部缓存）。

## 买入信号

判定**顺序敏感、先命中先返回**（与 `strategy.py` 一致）：

1. `total <= short_threshold`（默认 40）→ `short`（做空候选，见下节）
2. `total >= buy_threshold`（默认 75）**且** `M >= 50` **且** `L >= 60` → `buy`
3. `total >= buy_threshold` 但 `M < 50` 或 `L < 60` → `watch`（原因写进 `reasons`：市场方向或相对强度不达标）
4. `total >= 50` → `watch`
5. 其他 → `avoid`

**买入前置条件（缺一不可）**：`M >= 50`（市场方向不逆风）+ `L >= 60`（相对强度在行业前 50% 内）。CANSLIM 里 M 与 L 是否决项——个股再好，市场下跌或个股落后，就不买。

建仓纪律：

- `plan` 先把推荐转成计划（`action ∈ {open_long, add_long, open_short, close_long, close_short, hold, watch}`——做多与做空的加/平动作齐全），**不落单**；
- **单票仓位上限**：`(多头市值 + 融券市值) / 净资产 <= max_position_pct`（默认 0.20，即单票 ≤ **净资产**的 20%）——分母是**净资产，不是总资产**：总资产含融券券款与融资买入形成的市值，杠杆下随开仓自动放大，用它当分母会让「单票 20%」越加杠杆越松，风控形同虚设（`INTERFACES.md` §5 强约束 v2 裁决）；
- 同时持仓数 ≤ `max_positions`（默认 5）；总敞口 ≤ `max_gross_exposure`（默认 2.0）；
- 数量：`qty > 0` 且 `qty % 100 == 0`，否则 `INVALID_LOT`；
- 涨停（`price >= limit_up`）不可买 → `LIMIT_UP_NO_BUY`；停牌 → `SUSPENDED`；资金不足 → `INSUFFICIENT_CASH`。

## 卖出信号与止损

按下列次序先命中先执行：

1. **−7% 止损**：相对成本价跌幅 `<= stop_loss_pct`（默认 `-0.07`）→ 无条件平仓（`close`），**不加仓、不摊薄**；
2. **跌破均线**：收盘跌破 50 日均线 → 减半或清仓（中期趋势破坏）；跌破 200 日均线 → 清仓（破位即离场）；
3. **连续放量下跌**：连续 3 个交易日下跌且每日成交量 > 50 日均量 → 清仓（放量杀跌，供给涌出）；
4. **止盈**：浮盈 `>= take_profit_pct`（默认 0.25）→ 分批止盈（先减半，余仓用移动止损保护）；
5. **信号退化**：`total < 50`（`avoid`）或 `<= 40`（`short`）→ 平多。

执行：`python -m ptrade close --code 600519 [--ratio 1.0]`；`--ratio` 支持部分平仓。跌停（`price <= limit_down`）不可卖 → `LIMIT_DOWN_NO_SELL`。

## 做空（融券）信号

**做多与做空是两条独立口径，不得互相推断**：`buy` / `watch` 属多头；`short` 只在 `total <= short_threshold`（默认 40）时给出——「分数不高」不等于「可以做空」。

做空前置条件（缺一不可，任何一条不满足就放弃该票）：

1. **仅两融标的可融券做空**：`ds.is_short_target(code)` 为真，否则 `NOT_SHORT_TARGET`（融资标的 ≠ 融券标的，金融股/次新股常只可融资）；
2. **保证金空间充足**：融券保证金比例 `margin_ratio_short`（默认 1.00 = 100%）所需额度可用，否则 `INSUFFICIENT_MARGIN_SPACE`；
3. **杠杆闸（v3 新增）**：开仓后必须同时满足 `leverage = total_debt / net_assets <= max_leverage`（默认 2.0）**且** `maintenance_ratio >= 1.30`，否则拒单 → `LEVERAGE_LIMIT`（防「开仓即低于平仓线」）；
4. **券源约束**：单票可融券量 ≤ 该股流通股本 × `short_source_limit_ratio`（默认 2%），超限 → `SHORT_SOURCE_LIMIT`；
5. **敞口约束**：融券市值 / 净资产 ≤ `max_short_exposure`（默认 0.50）；总敞口 ≤ `max_gross_exposure`（默认 2.0）；
6. **担保比例约束**：维持担保比例 ≥ 平仓线（默认 1.30 = 130%），低于警戒线 1.50 后停止加仓，触发平仓线后 `forced_liquidation` 只允许减仓（拒 `SHORT_SELL`/`BUY`/`MARGIN_BUY` → `BELOW_MAINTENANCE`）。

- 做空平仓 = **买券还券**（`BUY_TO_COVER`），同样受 T+1 与券源约束；`close` 会先买券还券，再卖券还款 / 卖出；
- 成本：融券费率 `lending_rate_annual`（默认 8%/年）、融资利率 `financing_rate_annual`（默认 6.5%/年）按日计息——做空持仓要把券息算进成本，`settle` 时入账；
- 费用：佣金（双边，`max(额 × 0.00025, 5)`）、印花税 0.0005（卖出方向）、过户费 0.00001（沪深双边）、市价单滑点 5bp。

## 模拟盘玩法（CLI 闭环）

按顺序复制执行（真源：`INTERFACES.md` §7）。打分示例用 `600519`（强票）/`002594`（中性）/`000001`（弱票），**交易示例用低价票 `601398`**（工商银行 ≈ 7.02 元）——高价票在 50 万账户里一手就超单票上限。下列命令均已在 `--offline` + 夹具下**逐条实跑，退出码全为 0**：

```sh
# 0) 初始化账户：默认 50 万现金；--reset 重置
python -m ptrade init --cash 500000

# 1) 查看账户状态（快照）
python -m ptrade status --json

# 2) 同步行情 / 财务数据（--offline 只读本地缓存，绝不联网）
#    ⚠️ 多代码必须加引号！Windows PowerShell 会把裸写的逗号当数组运算符、把 002594/000001 当数值 → 丢前导零
python -m ptrade sync --codes "600519,002594,000001" --start 2025-04-01 --end 2025-10-09 --offline

# 3) 打分 + 排序：scan 出七因子与信号，recommend 出可执行建议
python -m ptrade scan --codes "600519,002594,000001" --asof 2025-10-09 --offline --json
python -m ptrade recommend --codes "600519,002594,000001" --asof 2025-10-09 --offline --json

# 4) 转成执行计划（只算不落单）
python -m ptrade plan --codes "601398,600110" --asof 2025-10-09 --offline --json

# 5) 下单前**先算单票上限**：50 万账户 = net_assets × 20% = 10 万/票、最多 5 票合计 ≤ 50 万
#    601398 工商银行 ≈ 7.02 元 → 10000 股 = 70200 元 ✅ 在上限内（实测 status="filled"）
python -m ptrade order --code 601398 --side buy --qty 10000 --price 7.02 --trade-date 2025-10-09 --offline --json
#    反例：600519 贵州茅台 ≈ 1380 元/股 → **一手（100 股）≈ 13.8 万 > 10 万** → 实测被拒 POSITION_LIMIT_PCT
python -m ptrade order --code 600519 --side buy --qty 100 --trade-date 2025-10-09 --offline --json
#    T+1：当日买入不能当日卖 → 实测被拒 T1_NOT_SETTLED
python -m ptrade order --code 601398 --side sell --qty 10000 --trade-date 2025-10-09 --offline --json

# 6) 结算（T+1）+ 风控体检
python -m ptrade settle --trade-date 2025-10-10 --offline --json
python -m ptrade risk --offline --json

# 7) 次日卖出 / 平仓 + 台账 + 账户快照（实测均 status="filled"）
python -m ptrade order --code 601398 --side sell --qty 5000 --trade-date 2025-10-10 --offline --json
python -m ptrade close --code 601398 --ratio 1.0 --trade-date 2025-10-10 --offline --json
python -m ptrade ledger --limit 20 --json
python -m ptrade status --json

# 8) 看盘：生成离线自包含 K 线图（K线 + MA12/24/48/96 + BOLL + MACD + SAR + 成交量/成交额，日/周/月线页内切换，含 CANSLIM 分析区）
python -m ptrade chart --code 601398 --period daily --asof 2025-10-09 --offline --json
```

命令语义（必须遵守）：

- `--offline` 透传 `DataSource(offline=True)`：**任何命令在 `--offline` 下不得联网**，缺数据如实报错（`NO_MARKET_DATA` / `NO_PRICE`），不得编造；
- `--json` 输出 `{"ok": bool, "command": str, "data": {...}, "error": str|null}` 到 stdout，**退出码 0/1**；**业务拒单不算错误**：`ok=true` 且 `data.orders[].status == "rejected"`；
- 无 `--json` 时输出中文可读表格；
- 全局 `--root <path>` 覆盖数据根目录（并行/测试用隔离目录）；`--asof` 缺省 = 最近交易日；
- 状态与台账落盘：`<root>/data/state.json`（账户快照）与 `<root>/data/ledger.jsonl`（append-only 成交流水）——**同一数据根同时只能有一个写者**，多人/多 lane 演练请各自 `--root` 隔离；
- `chart` 生成**离线自包含单文件 HTML**（ECharts 内联 + 数据内联、**无 `http(s)://` 外链**，双击即看），默认落 `<root>/reports/chart_<code>_<asof>.html`，`--out <path>` 可覆盖；`--json` 返回 `{"path": ..., "payload_summary": {...}}`；`chart.py` 未就绪时返回 `ok=false` + 明确 error，**不得崩栈**（口径真源：`INTERFACES.md` §7）。
- `risk --json` 的 `maintenance_ratio` **可能是 `null`**：空账户 / 无负债时为 `null`（**不再输出 `Infinity`**——严格 JSON 解析器不接受它），此时 `status == "safe"` 且 `exposure.has_debt == false`；有负债时才给出数值（`exposure.leverage` / `gross_ratio` / `short_ratio` 同理）。

## A 股 T+1 约束

- **当日买入的股票，次一交易日才可卖出**：当日买入的多头 `available_qty == 0`；当日提交 **`SELL`（卖多头，查 `long_available`）** 与 **`BUY_TO_COVER`（买券还券，查 `short_available`）** → 拒单 `T1_NOT_SETTLED`；
- **`SHORT_SELL`（融券开仓）不受 T+1 可用量约束**：它是借券卖出、不卖自己的持仓，只受**融券标的白名单**（`is_short_target`）与**券源上限**约束，同日可连续开仓（别把做空误当成"卖出持仓"）；
- **卖出资金 T+1 到账**：当日卖出所得不计入当日可用资金，次日结算后才可用；
- **按交易日推进**：`python -m ptrade settle --trade-date <次一交易日>`（内部 `roll_to`：T+1 结算 → 按日计息 → mark-to-market → 风险评估；日期早于当前交易日或非交易日 → `ValueError`）；
- 结论：本技能**不产出日内策略**，所有「今日买、今日卖」的方案在 A 股都不成立。

## 两融约束（融资 / 融券）

- **融资买入**（`MARGIN_BUY`）必须 `ds.is_margin_target(code)`，否则 `NOT_MARGIN_TARGET`；保证金比例 `margin_ratio_long`（默认 0.80）；
- **融券卖出**（`SHORT_SELL`）必须 `ds.is_short_target(code)`，否则 `NOT_SHORT_TARGET`；保证金比例 `margin_ratio_short`（默认 1.00）；
- **还款**（`REPAY_MARGIN`，卖券还款）**只支持全额还款**（`repay = financing_debt`）；净额不足全额 → `INSUFFICIENT_CASH`——本版本**不实现部分还款**；
- **维持担保比例**（口径真源：`INTERFACES.md` §3.2，**交易所口径**）= `collateral_value / total_debt`（分母 ≤ 0 → `math.inf`）：
  - `collateral_value = available_cash + frozen_collateral + long_market_value`（**融券券款计入分子**：券款是信用资金账户里的现金，交易所口径下属可充抵保证金的资金；**只排除 `frozen_t1`**——T+1 待交收的普通卖出款）；
  - `total_debt = financing_debt + short_market_value + interest_accrued`；其中 `financing_debt = Σ 融资买入金额 N`（**全额口径**，而非按 `1 - margin_ratio_long` 折算的净额），融券负债用**市值**口径；
  - **融资买入时自有资金不出账**（`available_cash` 只扣费用 `F`），留在信用账户里当担保物 → 所以分子含 `available_cash`；
  - **杠杆闸（v3）**：开仓后须 `leverage = total_debt / net_assets <= max_leverage`（默认 2.0）且 `maintenance_ratio >= 1.30`，否则拒单 `LEVERAGE_LIMIT`；
  - **量级参考（50 万本金，零费用口径）**：融资买入 20 万（`m_long = 0.80`）→ `(500000+200000)/200000 = 3.5`；票跌 20% → `660000/200000 = 3.3`；融券卖出 20 万（`m_short = 1.00`）→ `(500000+200000)/200000 = 3.5`；券跌 20% → `700000/160000 = 4.375`；**满额融资**（受保证金规则 `N <= 净资产 / m_long` 约束，即 N ≤ 62.5 万；`max_leverage = 2.0` 只是调低保证金比例后的回退保护）开仓 ratio = `(500000+625000)/625000 = 1.80`，标的自开仓价**跌约 50% 即触及 130% 平仓线**——别以为平仓线很难触发；融券容量则由 `max_leverage` 与 `max_short_exposure`（融券市值 ≤ 净资产 × 0.50，即 ≤ 25 万）约束，**不受**保证金额度规则限制；
  - **两种口径别混（v3.2）**：上面的 `1.80 / 跌 50%` 是**纯函数口径**（单票满额融资 62.5 万）。**引擎实际可达**的场景里最先卡住的是**仓位限制**（单票 ≤ 净资产 20% = 10 万/票、最多 5 票 → 组合融资规模 ≈ 50 万），开仓 ratio ≈ **2.0**（verifier 实测一组 5 票场景为 **2.0137**），需跌 **≈70%**（实测 **71.4%**）才触及 130%——所以在模拟盘里「跌一半就强平」并不成立，两种口径都要会算；
  - `>= 3.00`（`max_maintenance_ratio`）→ 可提取；`< 1.50`（`warn_maintenance_ratio`）→ 警戒，停止加仓；`< 1.30`（`min_maintenance_ratio`，**130% 平仓线**）→ `margin_call` / `forced_liquidation`：只允许减仓，加仓方向被拒（`MARGIN_CALL_BLOCKED` / `BELOW_MAINTENANCE`）；
- **开仓额度**（只作额度校验、**不参与** `collateral_value`）：`margin_required` = 融资部分 `Σ 融资买入金额 × margin_ratio_long` + 融券部分 `max(0, Σ 融券市值 × margin_ratio_short − frozen_collateral)`；`margin_available = net_assets − margin_required`，不足 → `INSUFFICIENT_MARGIN_SPACE`；
- 单票 `long_value + short_value` ≤ `max_position_pct` × **净资产**（v2 裁决：分母 = 净资产，**非总资产**），否则 `POSITION_LIMIT_PCT`；
- 利息按日计提：融资 6.5%/年、融券 8%/年（`settle` 时入账）。

### 融上再融（浮盈放大额度，但浮盈不是现金）

融资赚钱之后**额度会自动变大**，可以继续加融资；但**浮盈不能当现金花**。额度全部由**实时** `net_assets` 派生，不缓存、不静态化：

- **随浮盈同步放大的三档额度**：单票上限 `max_position_pct × net_assets`、可再融资额度 `margin_available = net_assets − margin_required`、杠杆上限 `max_leverage × net_assets`；
- **浮盈只放大额度、不产生可支用现金**：`available_cash` 只随**实际成交**（`cash_delta`）与 T+1 解冻变化，市值上涨只改 `long_market_value` → 「浮盈 → 释放额度 → 再融资买入」**可行**，「浮盈 → 直接取现买别的」**不可行**（本版本也不实现资金划出；`maintenance_ratio >= 3.00` 只产出只读的 `MAINTENANCE_EXTRACTABLE` 提示）。注意区分：**真实卖出**所得进 `frozen_t1`、次日转 `available_cash` 是合法路径——那是**已实现**收益，与浮盈不是一回事；
- **释放出的额度仍受三层约束**：① 仓位限制（单票 ≤ 净资产 20%）→ ② 保证金额度 → ③ 杠杆闸（默认参数下通常 ① 先卡住）；
- **风险面（必须可见）**：融资利息按日计提 → `interest_accrued` 增长 → 净资产被侵蚀 → 额度**反向压缩**；
- **算例**（50 万本金、`m_long = 0.80`、融资买入 10 万、零费用；口径 = §3.3 融资买入只扣费用、自有资金不出账）：开仓后 `available_cash 500000`、`financing_debt 100000`、`net_assets 500000`（= 本金，开仓不产生盈亏）、单票上限 `100000`、可再融资 `420000`；标的**涨 60%** → `net_assets 560000`、单票上限 `112000`、可再融资 `480000`（浮盈 60000 全部走额度，`available_cash` 仍是 500000）。

## 输出契约

每次给出结论时必须包含：

1. **打分表**：每票 `total` + 七因子子分（C/A/N/S/L/I/M 各 0-100）+ 所用权重 + `asof` 交易日；
2. **信号**：`buy | watch | avoid | short`，并写明命中的是 §6.2 的第几条分支（尤其 `buy` 要给出 M、L 实际值）；
3. **理由与风险**：`reasons` / `risks` 用中文并**引用具体数值**（例：`"当季净利润同比 +82.5%，且较上季 +31.0% 加速"`）；
4. **可执行建议**：`{"code","name","action","side","score","confidence","entry","stop_loss","take_profit","position_pct","reasons","risks","factors"}`，`action ∈ {open_long, open_short, close, watch}`、`side ∈ {long, short, none}`；
5. **原始证据**：贴出实际执行的命令与原始 JSON/表格输出（含退出码），不得口述「已通过」；拒单必须贴 `status == "rejected"` 与错误码。

## 最终清单

- [ ] 打分口径与 `ptrade/strategy.py` 逐条一致（七因子、权重、缺失 = 50 中性）
- [ ] 信号按顺序敏感口径判定，`buy` 明确给出 M ≥ 50 且 L ≥ 60 两个前置条件
- [ ] 卖出四类触发（−7% 止损 / 破 50·200 日均线 / 连续放量下跌 / +25% 止盈）都已声明
- [ ] 做空信号与做多信号**分开**陈述，且写明两融标的、保证金、券源 2% 约束
- [ ] **A 股 T+1** 已声明：当日买入次日才可卖；卖出资金 T+1 到账
- [ ] 130% 平仓线与 150% 警戒线、300% 可提取线已声明
- [ ] 「融上再融」已声明：浮盈只放大额度、**不进** `available_cash`；利息反向压缩额度可见
- [ ] CLI 命令序列可直接复制执行，`--offline` / `--json` 语义与 §7 一致
- [ ] 输出契约五件套齐全（打分表 / 信号 / 理由风险 / 建议 / 原始证据）
- [ ] 证据为原始命令输出（含退出码与 pass/fail），非转述
- [ ] 免责声明在场

## 免责声明

本技能**仅供研究与模拟盘演练**，**不构成任何投资建议**。`ptrade` 是本地模拟撮合器，不接任何券商实盘通道；CANSLIM 打分与信号是对公开数据的机械化解读，不预测未来，历史表现不代表未来收益，模拟盘盈利不等于实盘盈利（未计入真实冲击成本、券源可得性与流动性）。真实交易前请自行核验数据来源、合规要求与自身风险承受能力；**据此操作，风险自负**。
