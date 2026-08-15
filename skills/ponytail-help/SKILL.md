---
name: ponytail-help
description: Show a one-shot quick-reference for Ponytail levels, commands, configuration, and deactivation. Use for Ponytail help, command questions, or /ponytail-help. Does not change mode.
---

# Ponytail Help

Return a compact reference containing:

## Levels

- `/ponytail lite` — implement the request and mention the lazier alternative.
- `/ponytail` or `/ponytail full` — enforce YAGNI → reuse → stdlib → native → installed dependency → minimum code.
- `/ponytail ultra` — delete first and challenge speculative requirements.
- `/ponytail off` — disable the mode for this session.
- `/ponytail status` — show current and configured-default modes.
- `/ponytail default <lite|full|ultra|off>` — save the default.

## One-shot skills

- `/ponytail-review` — over-engineering review of the current diff.
- `/ponytail-audit` — whole-repository complexity audit.
- `/ponytail-debt` — collect `ponytail:` shortcuts.
- `/ponytail-gain` — published benchmark card.
- `/ponytail-help` — this reference.

Say `stop ponytail` or `normal mode` to deactivate. Resume with `/ponytail`.

Configuration uses `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, and `PONYTAIL_HIDE_STATUS`, with `~/.config/ponytail/config.json` (or the platform/XDG equivalent) as fallback:

```json
{ "defaultMode": "full", "quietStartup": false, "hideStatus": false }
```

Environment variables override the config file. This skill is display-only and must not alter mode or files.
