---
description: Audit and simplify all repository documentation
---
Analyze the whole repo first. Understand the current code before touching docs.

Then audit every `.md` file.

Goal:

* fewer docs
* no duplicate docs
* no stale docs
* no future / planned implementation
* code is source of truth
* merge or delete docs when possible
* keep only useful docs

Make docs agent-first:

* caveman language
* short sentences
* exact paths
* easy to scan
* easy to navigate
* link docs together
* one clear entry point
* no repeated info

Before editing, show:
`file → keep / merge / delete / rewrite`

Then make the changes.

Final check:

* docs match current code
* links work
* paths are correct
* no stale or speculative content
* no unnecessary `.md` files
