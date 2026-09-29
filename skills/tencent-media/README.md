# tencent-media

腾讯云 TokenHub Token Plan 的生图 / 生视频驱动（零依赖 Node，CLI 形态与同仓 `aliyun-media` 对齐）。

## 为什么存在

`aliyun-media` 绑定阿里云百炼；本技能让同一套肌肉记忆（`detect / constants / image / video / task / stitch`）
跑在腾讯云 TokenHub 上：生图覆盖同步与异步两类模型，生视频覆盖两套提交方法族，
并在**付费前**用 constants 里的每模型上限（提示词字符数、参考图张数、尺寸/时长合法域）做前置校验。

## 用法

```powershell
$s = "C:\Users\yaoyufeng\.dsh\plugins\oh-my-deepseek-harness\skills\tencent-media\scripts\tencent-media.mjs"
node $s detect                     # 三值结论：能否用云端
node $s constants                  # 模型清单/端点/上限/默认值（唯一事实源）
node $s image  --prompt "..." --dry-run          # 零成本核对请求形状
node $s image  --prompt "..." --image ref.png --out out
node $s video i2v --image first.png --prompt "..." --duration 15 --out out
node $s video t2v --prompt "..." --duration 30   # 自动分段 + 尾帧衔接 + concat
node $s task <task_id>             # 免费续查，不重跑
node $s stitch --files a.mp4 --files b.mp4 --out out.mp4
```

## 设计要点

- **单源真相**：模型 id、端点、每模型上限、默认值与降级链只写在脚本 `constants` 里；
  本文件与 `SKILL.md` 刻意不含这些字面量，契约测试会强制这一点。
- **付费前校验**：提示词超限、参考图超量、参考图过小/过扁、尺寸或时长不合法 → 立刻 `USAGE`，不打网络。
- **响应形状容错**：不同模型的成功返回路径不一致，结果 URL 由深度遍历 `collectUrls` 抓取，
  但会跳过 `task_id`/`request_id`/回调地址，并排除回显的参考图 URL。
- **分段拼接**：超过单段时长的目标自动切段，段间以上一段尾帧续接（需 ffmpeg），最后 concat。
- **安全**：密钥只在 env / `~/.dsh/.credentials.yaml` 的 `refs:` 读取，输出恒为掩码；
  `Authorization` 只发往官方域（https）。

## 测试

```powershell
cd C:\Users\yaoyufeng\.dsh\plugins\oh-my-deepseek-harness
node --test test/tencent-media.test.mjs
```

契约测试零网络：覆盖掩码、MIME、data URI 上限、参数解析、URL 抓取多形状、
每模型上限、分段规划、detect 三值链、base 守卫、`--dry-run` 请求形状与密钥不泄漏。
