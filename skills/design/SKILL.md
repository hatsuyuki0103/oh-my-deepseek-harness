---
name: design
description: 仓库级 DESIGN.md 设计源工作流：盘点既有设计证据 → 只问缺失上下文 → 建/刷新 DESIGN.md，作为产品/UI/前端决策的持久依据。用户说「design / 设计方向 / UX 指南 / 设计系统」时使用。
argument-hint: "<产品面或功能>"
---

# Design（设计源工作流）

## 定位

把仓库级 DESIGN.md 建成设计事实源与规范契约：

    既有仓库证据 → 缺失上下文访谈 → 建/刷新 DESIGN.md → UI/前端决策引用它

产出是持续维护的设计简报/清单（实现、评审、后续前端工作都应引用），不是像素对齐循环，也不是一次性视觉批评。**DSH 无视觉：本技能不依赖截图比对；视觉参考实现不在本技能范围（无视觉模型，需要时由用户在浏览器人工确认）。**

## 何时使用 / 何时不用

使用：用户要设计方向/UX 指南/前端规划/设计系统对齐；UI/前端实现前需要设计简报；既有 UI/组件/资产需要归纳成可复用的设计事实源；UI/UX 决策模糊需靠产品上下文、约束与原则澄清；功能在开工前需要 DESIGN.md。

不用：纯后端/API/基础设施、无用户可见设计后果；需要截图比对/视觉评分（DSH 无视觉，跳过并说明）。

## 工作流

1. **盘点既有设计证据**（动手前先读仓库）：
   - DESIGN.md、docs/design*、docs/ux*、docs/frontend*、README、产品规格、PRD、issue 记录；
   - UI 源码：路由、页面、布局、组件、主题文件、CSS 变量、tokens、图标、资产；
   - 无障碍、响应式、i18n、内容与平台约束（代码或文档中已编码的）。
   - 记录证据带文件路径；区分「观察到的事实」与「设计推断」。
2. **只问缺失上下文**（仓库证据答不了的设计关键点，一轮聚焦问清）：
   - 目标用户/角色与任务；产品/业务目标与非目标；品牌气质或禁忌风格；
   - 主流程与信息架构；无障碍级别、设备/浏览器支持、实现约束；仓库外既有的设计资产/参考。
   - 用户无法回答或要求自主推进 → 带显式假设与开放问题建 DESIGN.md，不阻塞。
3. **建/刷新 DESIGN.md**（保留有用内容、消除矛盾、未知标开放问题）：

```
# Design

## Source of truth
- Status: Draft | Active | Needs refresh
- Last refreshed: YYYY-MM-DD
- Primary product surfaces / Evidence reviewed:

## Brand
- Personality / Trust signals / Avoid:

## Product goals
- Goals / Non-goals / Success signals:

## Personas and jobs
- Primary personas / User jobs / Key contexts:

## Information architecture
- Primary navigation / Core routes/screens / Content hierarchy:

## Design principles
- Principle 1..n / Tradeoffs:

## Visual language
- Color / Typography / Spacing & rhythm / Shape & elevation / Motion / Imagery:

## Components
- Existing to reuse / New or changed / Variants & states / Ownership:

## Accessibility
- Level / Keyboard & focus / Contrast / Reduced motion:

## Constraints
- Platform / Browser / Device / i18n:

## Open questions
- ...
```

4. **交付**：报告 DESIGN.md 变更、证据来源、关键决定、开放问题；后续实现/评审引用它。

## 输出契约

```
## Design Brief Update

DESIGN.md: <创建/刷新> — <路径>
Evidence reviewed: <文件列表>
Decisions made: <...>
Open questions: <...>
```

## 最终清单

- [ ] 仓库设计证据先盘点（带路径）
- [ ] 只问仓库证据答不了的上下文（一轮聚焦）
- [ ] DESIGN.md 结构完整、矛盾已清、未知已标
- [ ] 无视觉断言（DSH 无视觉；视觉点留给用户确认）
- [ ] 实现/评审可引用该文档
