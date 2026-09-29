# oh-my-deepseek-harness

OMX-style workflow skills, rewritten for [DeepSeek Harness](https://www.deepseekharness.com).

Adapted from the skill designs of [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) (MIT) and rewritten around DeepSeek Harness native capabilities:

- `omx question` → `ask_user_question` structured per-round questioning
- Codex goal mode → DSH `create_goal` / `get_goal` / `update_goal`
- native subagent role routing → `subagent` / `subagent_fork` + role prompts (when the `subagent` surface is preset-disabled or unmounted, reviews/parallelism fall back to the teammate dual channel — `spawn_teammate` + `wait_agent` for evidence — and only then to `workflow` fan-out; see `docs/capability-matrix.md`)
- tmux team orchestration → official agent team first (`spawn_teammate` + nine team tools + task board as the single ledger): ordered four-level ladder by the live roster = ① nine team tools → ② `workflow` script fan-out → ③ `subagent`/`subagent_fork` one-shot subagents → ④ in-session serial; use the first available, never skip a level; see `docs/capability-matrix.md`
- `omx ralph` CLI → DSH native `ralph` tool (when preset-disabled, degrade per `docs/capability-matrix.md` to the in-session Ralph discipline)
- `.omx/` workspace conventions (context / interviews / specs / plans) preserved

**Vision is supported**: `visual-ralph` (implement or restyle frontend UI against an approved reference / URL baseline, with DSH vision model + `read_image` structured verdict and pixel iteration, leaving reusable design tokens). visual-verdict / frontend-ui-ux / vision are OMX-internal mechanisms and were not ported standalone; hud is terminal-HUD orchestration and does not depend on a vision model — not included yet.

## Bundled skills

| Skill | Description |
|---|---|
| `deep-interview` | Socratic deep interview: per-round structured questions + ambiguity scoring, converging to an executable spec |

All 24 skills are shipped — treat the `README.md` table as the source of truth for the full catalog, and see `docs/capability-matrix.md` for optional-capability probes and the four-level degradation ladder. v2.0.1 highlights: the two media-generation skills were removed (breaking change — the most convenient recovery source is the pre-deletion commit `cc4605f`, whose ancestors still carry both skills in one shot; per skill, `e868005` = Aliyun and `f9e0304` = Tencent, the latter already including Aliyun), `autopilot` now defaults to agent-team collaboration (`spawn_teammate` + `team_task_*` board, four-level fallback), and `skills/team/references/skill-dispatch.md` carries the 24-skill dispatch matrix.

## Install

```sh
dsh plugin --profile web add oh-my-deepseek-harness
```

Restart `dsh web`; the skills then appear in the session skill catalog and are loadable via the `skill` tool.

## Development

```sh
node --test test/*.test.mjs   # provider contract tests
```

Adding a skill = writing `skills/<name>/SKILL.md` with frontmatter (`name` + `description` required, `argument-hint` optional) and a body. No code changes needed.

## License

MIT · skill workflow designs derived from oh-my-codex (MIT); see NOTICE and THIRD_PARTY_NOTICES.md.
