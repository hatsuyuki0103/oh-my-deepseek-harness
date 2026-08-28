# oh-my-deepseek-harness

OMX-style workflow skills, rewritten for [DeepSeek Harness](https://www.deepseekharness.com).

Adapted from the skill designs of [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) (MIT) and rewritten around DeepSeek Harness native capabilities:

- `omx question` → `ask_user_question` structured per-round questioning
- Codex goal mode → DSH `create_goal` / `get_goal` / `update_goal`
- native subagent role routing → `subagent` / `subagent_fork` + role prompts
- tmux team orchestration → `workflow` tool + background jobs
- `omx ralph` CLI → DSH native `ralph` tool
- `.omx/` workspace conventions (context / interviews / specs / plans) preserved

**Vision is supported**: `visual-ralph` (implement or restyle frontend UI against an approved reference / URL baseline, with DSH vision model + `read_image` structured verdict and pixel iteration, leaving reusable design tokens). visual-verdict / frontend-ui-ux / vision are OMX-internal mechanisms and were not ported standalone; hud is terminal-HUD orchestration and does not depend on a vision model — not included yet.

## Bundled skills

| Skill | Description |
|---|---|
| `deep-interview` | Socratic deep interview: per-round structured questions + ambiguity scoring, converging to an executable spec |

(v0.1.0 pilot; ralplan / ralph / plan / autopilot / team / ultrawork / code-review / security-review / analyze / tdd / visual-ralph ... are on the roadmap.)

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
