# Desired Config

This file is the frozen source of truth for this repository. Do not edit, expand, reformat, or regenerate it.

The final Pi config is minimal and contains only:

- Ponytail, to produce cleaner code.
- Caveman-style output and documentation: short, direct, concrete, and easy to act on.
- Todos with Claude Code-like UI and logic.
- A Claude Code-like ask-user tool.
- Subagents with Claude Code-like UI. Use subagents only to finish work faster by running independent work in parallel, including unblocked todo items.
- Goal mode, so long-running work continues until it is done or the user stops it.
- Web search that requires no API key or credentials.
- Practical command-line tools such as `rg`, `find`, and `jq`.
- These approved UI elements only: `□`, `■`, `☒`, `⎿`, `├`, `─`, `│`, `└` and Pi's default animated loader.

Prefer Pi built-ins, platform features, command-line tools, and small local implementations. Do not add or import a Pi extension or package when the needed behavior can reasonably be implemented locally.
