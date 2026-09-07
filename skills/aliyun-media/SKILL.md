---
name: aliyun-media
description: 阿里云 Token Plan 生图/生视频/视频编辑：检测 dsh 是否配置 Token Plan，配置则走云端异步生成（含超时长分段拼接与尾帧衔接），未配置则给配置配方或回退本机 stable-diffusion-webui / ComfyUI。用户说「画一张图 / 生图 / 生成视频 / 图生视频 / 视频编辑 / aliyun-media」时使用。
argument-hint: "<生图或生视频的自然语言需求>"
---

# Aliyun Media（Token Plan 生图 / 生视频 / 视频编辑）

## 定位

把"生图 / 生视频 / 视频编辑"收敛到一条确定路径：

1. **检测**：`node <skill>/scripts/aliyun-media.mjs detect` 给出三值结论
   `{configuredIntent, keyAccessible, source, baseUrl, keyHint, reason}`；
2. **keyAccessible=true** → 云端路径（下文）；
3. **configuredIntent=true 且 keyAccessible=false** → 先走「配置修复指引」，**不要**直接推本地后端；
4. **双 false** → 先打印配置配方，再 `scan` 本机后端，可用则本地生成。

模型 id、endpoint、默认尺寸/分辨率/时长、降级链的**唯一事实源是脚本常量**：
运行 `node <skill>/scripts/aliyun-media.mjs constants` 读取全表（含降级链）。
本文件与 README 不重复这些字面量（有机器断言守护）。

## 云端：图像

- 文生图：`... image --prompt "<提示词>"`（默认模型/尺寸/张数见 constants；默认 4K 16:9，竖幅用 `--size` 换 9:16）。
- 图像编辑 / 多图参考：`... edit --prompt "<指令>" --image 本地图1 --image 本地图2 ...`
  （本地图自动 Base64 内联；参考图数量与总大小上限见 constants，超限脚本会拒绝并提示压缩）。
- 异步任务由脚本轮询到终态并**立即下载**产物到 `--out`（默认 `outputs/media/`），末行 JSON 给绝对路径。
- 失败时脚本透传 provider 的 code+message 原文；按 constants 的降级链换模型重试。

## 云端：视频（有声）与分段拼接

- 文生视频：`... video t2v --prompt "<提示词>"`；首帧生视频：`... video i2v --image 本地图 --prompt ...`；
  参考生视频：`... video r2v --reference 本地图... --prompt ...`。
- 默认 1080P、16:9、目标 30 秒。**服务端单段时长有上限（见 constants）**：超过时脚本自动分段，
  段间用上一段尾帧作下一段首帧（需本机 ffmpeg；`scan` 会探针 ffmpeg），跨段人物/物体一致性靠参考图维持；
  全部段完成后自动 concat 成单文件。`--no-stitch` 可强制单段。
- 无 ffmpeg 时脚本只出第一段并告警；段文件按 `{kind}-{task_id}-{i}.mp4` 落盘，`video stitch` 可事后独立重拼。
- 水印恒关闭（脚本硬编码，无开启旗标）。

## 云端：视频编辑

- `... video edit --video url:<公网或OSS地址> --prompt "<编辑指令>" [--reference 本地图...]`
- **视频输入不支持 Base64**：本地视频必须先有公网/OSS URL，否则脚本拒绝并给出指引；参考图可 Base64。
- 编辑模型不可用（403/未授权）时按 constants 降级链改用首帧重生成或参考生视频。

## 回退：配置配方（无 Token Plan 时先给这个）

在 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers` 下加一个 provider（id 自取，含 token-plan 语义），
`apiKeyEnv` 指向环境变量名；密钥本体放环境变量或 `~/.dsh/.credentials.yaml` 的 `refs:` 下同名键。
配置完成后重跑 `detect` 验证 `keyAccessible=true`。

## 回退：本地后端

- `... scan` 探针 stable-diffusion-webui（7860）、ComfyUI（8188）、ffmpeg，输出 `running/apiOk` 区分"端口开着"与"API 可用"。
- SD-WebUI：`... sd-txt2img --prompt "<提示词>"`（v1 最小参数集：prompt+固定步数/尺寸）。
- ComfyUI：`... comfy-run --workflow 你的工作流.json`（自备工作流的薄透传）。
- 都不可用 → 报告扫描结果并停止，不臆造能力。

## 纪律

- `detect` 的 `keyAccessible` 语义 = **本地可读**（env / `refs:` 平面键）；服务端有效性由首个真实调用的 401/403 原文裁决，detect 不做网络探测。
- node 的 fetch 默认不读 `HTTP(S)_PROXY`；若本机直连被阻断（node>=24 可设 `NODE_USE_ENV_PROXY=1`），先以 `detect`/dry-run 排除请求形状问题，再查代理与 DNS，不要现场盲改脚本。
- 密钥只从 env / `refs:` 读取；任何输出（含 dry-run）只有掩码形态；`--base` 仅允许官方域，越界需显式危险旗标。
- 本地图像一律 Base64 内联；本地音频/视频一律拒绝并给 OSS 指引。
- 结果 URL 有时效：脚本在 SUCCEEDED 后立即下载；超时不重跑（重跑付费），而是给出 task_id 免费续查命令。
- `--dry-run` 打印脱敏请求体（Base64 截断为长度），用于核对请求形状而不付费。

## 输出契约

```
## Media Done
- detect: <source / reason>
- files: <绝对路径列表>
- notes: <分段/降级/跳过说明（如有）>
```

## 最终清单

- [ ] 先 detect 再选路径（云端 / 配置修复 / 本地回退）
- [ ] 产物已落盘并回报绝对路径
- [ ] 失败时透传 provider 原文，未吞错
- [ ] 未在任何输出中泄漏密钥明文
