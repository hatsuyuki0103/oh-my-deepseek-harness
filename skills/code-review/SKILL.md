---
name: code-review
description: 全面代码评审：code-reviewer + architect 双独立通道并行评审，严重度评级 + 架构状态（CLEAR/WATCH/BLOCK）+ 确定性合入门禁。用户说「review this code / code review / 帮我审代码」或合入 PR 前使用。
argument-hint: "[diff | 文件列表 | 目录]"
---

# Code Review（代码评审）

## 何时使用

- 用户说 "review this code" / "code review" / "帮我审"；
- 合入 PR 前；
- 大功能实现后；
- 需要质量评估时。

## 双通道独立评审（DSH 版）

**绝不自我评审兜底**：起草/作者上下文不得兼任评审者。两个通道都用 subagent（prompt = 本插件 `roles/` 对应角色文件全文 + 改动范围 + 明确边界）：

1. **确定改动**：git diff / 指定文件，确定评审范围；
2. **并行双通道**（同批发起两个后台 subagent）：
   - **code-reviewer 通道**（roles/code-reviewer.md）：安全/质量/性能/最佳实践/可维护性发现，按 CRITICAL/HIGH/MEDIUM/LOW 评级，给 APPROVE / REQUEST CHANGES / COMMENT；
   - **architect 通道**（roles/architect.md）：设计/权衡视角的恶魔代言人，给架构状态 CLEAR / WATCH / BLOCK + file:line 证据 + 权衡建议；
   - 任一通道无法发起或没交证据 → 报告 `independent review unavailable`，**不批准、不标合入就绪**；
3. **确定性合入门禁**（综合两通道）：
   - architect = BLOCK → 最终 REQUEST CHANGES；
   - 否则 code-reviewer = REQUEST CHANGES → 最终 REQUEST CHANGES；
   - 否则 architect = WATCH → 最终 COMMENT；
   - 否则最终结论跟随 code-reviewer 通道；
   - 最终报告必须让架构阻塞项不可能被忽略。

## 评审类别

安全（硬编码密钥/注入/XSS/CSRF/路径穿越/敏感日志）、代码质量（函数体积/复杂度/嵌套）、性能（算法/N+1/缓存/无界循环）、最佳实践（命名/文档/错误处理）、可维护性（重复/耦合/可测试性）。

## 严重度

CRITICAL（安全漏洞，合入前必修）/ HIGH（缺陷或重大异味，合入前应修）/ MEDIUM（次要，方便时修）/ LOW（风格建议）。

## 架构状态契约

CLEAR（无未决架构阻塞）/ WATCH（非阻塞设计顾虑，必须进入最终综合）/ BLOCK（阻止合入的设计问题）。

## 输出格式

```
CODE REVIEW REPORT
==================

Files Reviewed: N
Total Issues: M
Architectural Status: CLEAR / WATCH / BLOCK
Final Recommendation: APPROVE / REQUEST CHANGES / COMMENT

CRITICAL (n) / HIGH (n) / MEDIUM (n) / LOW (n)
- file:line — 问题 | 风险 | 修复建议

## Architect Addendum
- Antithesis / Tradeoff tension / Synthesis（architect 通道产出）

## Independent Review Evidence
- code-reviewer 通道: <subagent 证据摘要>
- architect 通道: <subagent 证据摘要>
```

## 与其他流程的关系

- autopilot / ultragoal 的合入闸：干净 = 最终 APPROVE 且架构 CLEAR（独立证据齐）；
- 非干净且属实现修复 → rework（autopilot 状态机）；非干净且暴露计划/需求错误 → 回 ralplan。

## 最终清单

- [ ] 改动范围明确
- [ ] 双通道独立 subagent 证据齐（不齐则报告 unavailable，不批准）
- [ ] 每个问题有 file:line + 修复建议
- [ ] 严重度评级与架构状态符合契约
- [ ] 合入门禁按确定性规则执行，架构阻塞不可忽略
