---
description: Audit and simplify all repository Markdown
---
Read the whole repo first. Read code and tests. Code wins.

Preserve dirty user changes. Do not delete a Markdown file until code, tests, links, and package discovery prove it stale or unused.

Audit every `.md` file.

Before edits, print:

`file → keep / merge / delete / rewrite`

Then edit.

Rules:

- Keep one human entry point.
- Keep runtime Markdown only for a real command, role, or skill.
- Delete stale, duplicate, planned, and unused text.
- Merge files when one file can do the job.
- Use short sentences and exact paths.
- Link the entry point to source, tests, and runtime Markdown.
- Do not repeat code details.

Finish by checking links, paths, current behavior, remaining `.md` files, and the repository's documented check command. Report any check you cannot run.
