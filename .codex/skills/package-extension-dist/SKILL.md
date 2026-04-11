---
name: package-extension-dist
description: Package the current repository state into a Chrome extension distribution zip. Use when Codex needs to build, rebuild, refresh, or verify the release archive for this project before local testing, Chrome Web Store upload, or handoff.
---

# Package Extension Dist

Package this repository into a release zip using the bundled script at `scripts/build_dist.py`.

## Workflow

1. Confirm the repo root contains `manifest.json`.
2. Read `manifest.json` and note the current `name` and `version`.
3. Run `python .codex/skills/package-extension-dist/scripts/build_dist.py`.
4. Check the reported output path and file count.
5. Inspect the zip if the user asked for verification, or if the manifest changed in a way that could alter the file set.

## What The Script Does

- Include `manifest.json`.
- Include local files referenced by the manifest, including icons, popup HTML, options page, background scripts, service worker, content scripts, and content-script CSS.
- Parse packaged HTML files and include their local `script src` and stylesheet `href` dependencies.
- Write the archive to `dist/<extension-name-slug>.zip`.
- Exclude repo-only files such as `.git`, existing `dist` outputs, screenshots, and docs unless the manifest or packaged HTML explicitly references them.

## Verification

After packaging, verify these points before calling it done:

1. The zip has `manifest.json` at the archive root, not nested under an extra folder.
2. The zip contains the current popup, options, content script, settings module, and icons used by the manifest.
3. The zip does not contain `dist/`, `.git/`, or unrelated repo files.
4. If the user is preparing a store upload, remind them that packaging is separate from store listing assets like screenshots and promo graphics.

## Project Notes

- This repo is a plain Manifest V3 extension with no build system.
- The expected output for the current project is `dist/stop-youtube-reruns.zip`.
- If new manifest keys are added later that point at more packaged files, extend `scripts/build_dist.py` instead of hand-zipping files.
