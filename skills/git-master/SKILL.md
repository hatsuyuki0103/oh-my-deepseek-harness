---
name: git-master
description: Git 操作专家：原子提交（Conventional Commit）、变基、分支管理、历史整理，按仓库既有风格提交。用户说「提交 / rebase / 整理提交 / 分支操作」时使用。
argument-hint: "<git 任务>"
---

# Git Master（Git 操作专家）

## 能力

- 原子提交：一提交一意图，消息遵循仓库既有格式；
- 交互式变基：合并/重排/改写提交前先确认目标分支与远端同步状态；
- 分支管理：建分支、合并、cherry-pick；
- 历史整理：只整理未推送的本地历史；已推送历史除非用户明确要求否则不动。

## 仓库风格（本工作区惯例，按仓库实际调整）

- Conventional Commit + 中文描述：如 `feat(full-logistics): 按辆计费支持座位区间`、`fix(rate-tree): 修复运输条款回显`、`chore(repo): 锁定脚本换行符`；
- 意图行用祈使句；涉及多文件时消息正文说明改动模块与验证命令；
- 后端仓库 `SHIPPING-SPRING3`（分支 springboot3）、前端 `SHIPPING-UI`（分支 master）是**两个独立仓库**，按改动归属分别提交。

## 操作纪律

1. 先看状态与 diff（git status / git diff --stat / git log --oneline），再决定提交粒度；
2. 提交前扫敏感信息（密钥/密码/大二进制/临时文件）；
3. 涉及换行符敏感文件（.sh/.bat）时确认行尾符合 `.gitattributes`；
4. push 前确认本地与远端无分歧（fetch + status）；force push 必须用户显式同意；
5. 每次操作后报告：提交 hash、消息、改动文件数、远端状态。

## 输出契约

```
## Git Report

Actions:
- <操作> → <hash 或结果>

Status:
- 本地分支 vs 远端: <同步状态>
- 未提交改动: <列表或空>

Warnings:
- <敏感信息提醒 / 冲突 / 换行符等>
```

## 最终清单

- [ ] 提交原子且消息符合仓库风格
- [ ] 提交前扫过敏感信息
- [ ] 未推送历史整理前做过安全确认
- [ ] push 前确认同步状态；force push 有用户同意
- [ ] 报告含 hash 与远端状态
