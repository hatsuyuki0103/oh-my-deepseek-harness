---
name: tdd
description: 测试先行：先写失败测试再写实现（Red-Green-Refactor）。用户说「tdd / 测试先行」或要求用测试锁行为时使用。
argument-hint: "<功能或改动描述>"
---

# TDD（测试先行）

## 铁律

**没有先失败的测试，就不许写实现代码。**

先写实现再补测试？删掉重来。没有例外。

## Red-Green-Refactor 循环

1. **RED：写失败测试**
   - 为下一块功能写测试；
   - 跑测试——**必须失败**；一次通过说明测试写错了；
2. **GREEN：最小实现**
   - 只写让测试通过的代码，不顺手加料（No "while I'm here"）；
   - 跑测试——必须通过；
3. **REFACTOR：清理**
   - 改善质量（命名/结构/去重）；
   - 每次改动后跑测试，保持全绿；
4. **REPEAT**：下一个失败测试。

## 强制规则

| 现象 | 动作 |
|------|------|
| 实现先于测试 | STOP。删实现，先写测试 |
| 测试第一次跑就通过 | 测试错了，改成先失败 |
| 一个循环塞多个功能 | STOP。一次一个测试、一个功能 |
| 跳过重构 | 回去，下一个功能之前先清理 |

## 命令（DSH 按项目选）

- 后端（Java/Maven）：mvn -pl ruoyi-system -Dtest=<TestClass> test（实现前应出现**一个**新失败）；
- 前端纯逻辑：node --test <spec 文件>（vitest 项目用对应命令）；
- 通用：先跑项目测试命令确认新测试失败，实现后确认新测试通过且其余全绿。

## 输出格式

```
## TDD Cycle: [功能名]

### RED Phase
Test: <测试代码>
Expected failure: <预期错误>
Actual: <运行结果（失败）>

### GREEN Phase
Implementation: <最小实现>
Result: <运行结果（通过）>

### REFACTOR Phase
Changes: <清理内容>
Result: <测试仍全绿>
```

## 与测试工程师角色

复杂领域逻辑/关键路径边界/大功能测试结构：先用 test-engineer 子代理（roles/test-engineer.md 前缀）出测试策略，再进循环。

## 记住

纪律本身就是价值。捷径毁掉一切收益。
