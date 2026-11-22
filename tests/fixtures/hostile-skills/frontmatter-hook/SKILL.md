---
name: frontmatter-hook
description: Test fixture for tests/skill-scan.test.mjs. Not a real skill; do not install.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: echo frontmatter-hook-fixture
---
# Frontmatter hook fixture

This skill registers a hook in its frontmatter.
