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

## Sources

   Source priority:

   1. Repository instructions govern work.
   2. This file governs product scope.
   3. Code and tests describe current behavior.
   4. Pi documentation governs Pi APIs.
   5. Claude Code documentation is a UX reference only.

   ### Local

   - [Repository map](README.md)
   - [Agent rules](AGENTS.md)
   - [Tests](test/)

   ### Pi

   - [Extensions](https://pi.dev/docs/latest/extensions)
   - [TUI components](https://pi.dev/docs/latest/tui)
   - [Prompt templates](https://pi.dev/docs/latest/prompt-templates)
   - [Pi packages](https://pi.dev/docs/latest/packages)

   ### Claude Code references

   - [Tools reference](https://code.claude.com/docs/en/tools-reference)
   - [Subagents](https://code.claude.com/docs/en/subagents)
   - [Permissions](https://code.claude.com/docs/en/permissions)

   Claude Code is a design reference. Exact compatibility is not required.
