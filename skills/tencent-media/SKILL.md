---
name: tencent-media
description: 腾讯云 TokenHub Token Plan 生图/生视频：检测 dsh 是否配置 TokenHub（settings.yaml provider + .credentials.yaml 密钥），配置则走云端（生图同步/异步双通道、生视频异步轮询、超时长自动分段与尾帧衔接），未配置则给配置配方。用户说「用腾讯云生图 / 腾讯云生视频 / tokenhub / tencent-media」时使用。
argument-hint: "<生图或生视频的自然语言需求>"
---

# Tencent Media（腾讯云 TokenHub 生图 / 生视频）

## 定位

把"用腾讯云生图 / 生视频"收敛到一条确定路径：

1. **检测**：`node <skill>/scripts/tencent-media.mjs detect` 给出三值结论
   `{configuredIntent, keyAccessible, source, baseUrl, keyHint, reason}`；
2. **keyAccessible=true** → 云端路径（下文）；
3. **configuredIntent=true 且 keyAccessible=false** → 先走「配置修复指引」，**不要**盲试；
4. **双 false** → 打印配置配方后停止（本技能不猜凭据）。

模型 id、端点、每个模型的提示词上限/参考图上限/尺寸与时长合法域、降级链的**唯一事实源是脚本常量**：
运行 `node <skill>/scripts/tencent-media.mjs constants` 读取全表。
本文件与 README **不得**复述这些字面量（有契约测试守护）。

## 云端：图像（同步 / 异步两条通道）

- 文生图：`... image --prompt "<提示词>"`（默认模型、默认画幅与分辨率见 constants）。
- 参考生图 / 图像编辑：`... image --prompt "<指令>" --image 本地图 --image url:https://...`
  （本地图自动内联为 data URI；**每模型参考图数量上限与单图/总包大小上限见 constants**，超限在发请求前就被拒绝）。
  - 参考图的**最小边长与最大宽高比**也按 constants 校验（本地 PNG/JPEG 直接读文件头，不依赖解码库）。
- 尺寸写法按模型而异（档位 / 画幅+分辨率 / 宽x高 三种），**不合法会在付费前报 USAGE**；
  这是刻意的：不同模型的上限差异很大，写错就是白烧一次调用。
- 同步模型一次返回图片地址；异步模型先得 `task_id`，脚本自动轮询到终态并**立即下载**到 `--out`（默认 `outputs/media/`）。
- `--n` 为**客户端重复次数**（服务端无 n 参数），逐张落盘。
- 结果 URL 有有效期（见 constants 的说明），脚本一律落盘，不把 URL 当交付物。

## 云端：视频（异步 + 分段拼接）

- 文生视频：`... video t2v --prompt "<提示词>" [--duration 秒] [--resolution 档位] [--ratio 画幅]`
- 首帧生视频：`... video i2v --image 首帧.png --prompt "<动作与运镜描述>"`；h3 系还支持 `--last-frame`（尾帧）。
- **服务端单段时长有上限（见 constants）**：`--duration` 超过上限时脚本自动分段，
  段间用上一段**尾帧**作下一段首帧（需本机 ffmpeg），全部完成后自动 concat 成单文件；`--no-stitch` 可强制单段。
- **文生视频必须给具体画幅**（`adaptive` 只对首帧生视频有效），脚本会拒绝 `t2v + adaptive`。
- 提交方法族有两套（扁平参数 / content 数组），脚本按模型自动选择，用户无需关心；
  `--dry-run` 会打印 `style` 字段（`flat` 或 `content-array`）便于核对。

## 免费续查与重拼

- `... task <task_id> [--model ...]`：只查状态与结果 URL，**不重跑、不再付费**；轮询超时时按提示用它续查。
- `... stitch --files a.mp4 --files b.mp4 --out out.mp4`：事后独立重拼分段文件。

## 回退：配置配方（无 TokenHub 配置时先给这个）

在 `~/.dsh/settings.yaml` 的 provider 列表下加一个 provider（id 含 tokenhub 语义），
`apiKeyEnv` 指向环境变量名；密钥本体放环境变量，或 `~/.dsh/.credentials.yaml` 的 `refs:` 下同名键。
配置完成后重跑 `detect` 验证 `keyAccessible=true`。

## 纪律

- `detect` 的 `keyAccessible` 语义 = **本地可读**（env / `refs:` 平面键）；服务端有效性由首个真实调用的 401/403 原文裁决。
- 密钥只从 env / `refs:` 读取；任何输出（含 `--dry-run`）只有掩码形态；`--base` 仅允许官方域（见 constants 的守卫），越界需显式危险旗标。
- 失败时**透传 provider 原文** code+message，不吞错、不臆造原因。
- 所有会花钱的调用前先 `--dry-run` 核对请求形状（零成本）。
- 结果 URL 有时效：终态后立即下载；超时不重跑，给 `task <id>` 续查命令。

## 输出契约

```
## Media Done
- detect: <source / reason>
- files: <绝对路径列表>
- notes: <同步/异步、分段、降级、跳过说明（如有）>
```

## 最终清单

- [ ] 先 `detect` 再选路径（云端 / 配置修复 / 停止）
- [ ] 付费前 `--dry-run` 核对过请求形状
- [ ] 产物已落盘并回报绝对路径
- [ ] 失败时透传 provider 原文，未吞错
- [ ] 未在任何输出中泄漏密钥明文
