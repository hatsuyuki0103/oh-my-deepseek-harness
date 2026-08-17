---
name: skill-authoring
description: DSH 技能创作指南：frontmatter 契约、kebab 命名、provider/register 注册、目录注入、契约测试、插件打包与市场发布全流程。用户说「写个技能 / 怎么发布技能 / 技能没出现」时使用。
argument-hint: "<技能名或想法>"
---

# Skill Authoring（DSH 技能创作指南）

## 定位

为 DeepSeek Harness 创作与发布 agent 技能（skill）的完整指南。本包自身就是范本：`oh-my-deepseek-harness` 用 `ctx.skills.registerProvider` 把包内 `skills/*/SKILL.md` 注册进目录。

## 技能文件契约

- 目录束：`<root>/<name>/SKILL.md`（或扁平 `<root>/<name>.md`）；
- frontmatter（YAML，`---` 包裹）：
  - `name`（必填）：kebab-case（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`）；
  - `description`（必填）：一句话说清何时用、做什么——**空 description 会让整个技能目录加载失败**；
  - `argument-hint`（可选）：参数提示，渲染进目录的 whenToUse；
- 正文：markdown；写「何时用/何时不用/步骤/输出契约/最终清单」结构最利于模型执行；
- 排除非技能文件：MEMORY.md / README.md 会被官方加载器忽略（本包 provider 同样排除）。

## 两种注册方式

1. **运行时技能**（动态、进程内）：`ctx.skills.register({ name, description, content, invocation })` —— rank 250，随插件 Fiber 拆除；
2. **提供方**（持久、可打包，推荐发布用）：
   - `ctx.skills.registerProvider((control) => ({ name, list(options), get(candidate, options) }))`；
   - list() 返回候选 `{ name, description, whenToUse?, invocation:{modelInvocable,userInvocable}, provider, source, resourceBase, rank, locator, path, metadata }`；
   - get() 校验候选对象身份后返回定义（含 content）；惰性加载正文；
   - 源变化时调用注册作用域内的 `control.invalidate()` 失效目录缓存。

## 目录注入与模型体验

- 注册表按「宿主全局层 + 会话 scope 链」分层合并：最近层同名直接胜出，rank 只在单层内裁决；
- 官方 `dsh-tool-skill` 把摘要渲染进会话 `<available_skills>` 目录，模型经 `skill` 工具加载全文；
- 本包 provider：rank 275（高于运行时 250，低于用户根目录 400/500——用户同名技能可覆盖本包）。

## 插件打包（发布形态）

1. 包结构：host 插件入口 `index.mjs`（`export const name / inject / apply`）+ `cordis.patch.yml`（`insert: [{id, name}]`）+ 技能文件 + 测试；
2. package.json：`dsh.bundle.patch` 指向 patch 文件；`dshWorkshop` 元数据（schema/type/integration/install/lifecycle/permissions/compatibility/capability/evidence）；
3. 安装：`dsh plugin --profile web add <包名>`（pnpm 安装 + 自动把声明 dsh.bundle 的依赖写进 dsh.profile.bundles）；
4. 重启 dsh web 生效（profile bundle 需要 restart-profile）；
5. 发布：npm publish → 提 PR 到 awesome-dsh-plugin 列表（npm 包 repository 需指回同一仓库）→ dshmarket 市场自动收录。

## 契约测试（每个技能包必备）

node --test 断言：
- 每个技能文件可解析、name/description 非空、kebab、目录内唯一；
- provider list() 返回全部技能、get() 返回正文、伪造候选被拒绝；
- 插件入口导出形态（name/inject/apply）。

## 常见问题

| 症状 | 根因 |
|------|------|
| 技能没出现在目录 | 未安装进 profile / 未重启 / bundle 未 reconcile / frontmatter 缺 description |
| 整个目录加载失败 | 某技能 description 为空 |
| 同名技能被覆盖 | 更近 scope 层或更高 rank 的条目胜出（先到先得） |
| 改文件后目录不更新 | provider 需调 control.invalidate()（或重启） |
| 市场拒收 | package.json repository 与 npm 包不一致 / 未过 awesome-dsh-plugin 审核 |

## 输出契约

创作/诊断技能时按「技能名 → 触发场景 → frontmatter → 正文结构 → 注册/打包方式 → 验证」给结论，并给出可落地的文件清单。

## 最终清单

- [ ] frontmatter 契约满足（kebab + 非空 description）
- [ ] 注册方式与发布形态匹配（register vs registerProvider + bundle）
- [ ] 契约测试通过
- [ ] 安装/重启/验证链路走通（或诊断出断点）
