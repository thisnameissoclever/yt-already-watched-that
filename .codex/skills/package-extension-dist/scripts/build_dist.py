#!/usr/bin/env python3
"""
Build a Chrome extension distribution zip for this repository.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


ARCHIVE_EXTENSION = ".zip"
HTML_FILE_SUFFIXES = {".html", ".htm"}
LOCAL_PATH_PATTERN = re.compile(r"^(?![a-zA-Z][a-zA-Z0-9+.-]*:|//|#)(.+)$")


class LocalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        if tag == "script":
            src = attrs_map.get("src")
            if src:
                self.references.add(src)
        if tag == "link" and attrs_map.get("rel") == "stylesheet":
            href = attrs_map.get("href")
            if href:
                self.references.add(href)


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "extension-dist"


def is_local_reference(value: str) -> bool:
    return bool(LOCAL_PATH_PATTERN.match(value))


def normalize_reference(base_dir: Path, reference: str) -> Path:
    cleaned = reference.split("?", 1)[0].split("#", 1)[0]
    return (base_dir / cleaned).resolve()


def collect_manifest_paths(repo_root: Path, manifest: dict) -> set[Path]:
    discovered: set[Path] = {repo_root / "manifest.json"}

    def add_reference(reference: str, base_dir: Path | None = None) -> None:
        if not reference or not is_local_reference(reference):
            return
        root = base_dir or repo_root
        candidate = normalize_reference(root, reference)
        if candidate.is_file():
            discovered.add(candidate)
        else:
            raise FileNotFoundError(f"Referenced file not found: {candidate}")

    def add_icon_block(block: dict | None) -> None:
        if not isinstance(block, dict):
            return
        for path in block.values():
            if isinstance(path, str):
                add_reference(path)

    add_icon_block(manifest.get("icons"))

    action = manifest.get("action") or {}
    if isinstance(action, dict):
        popup = action.get("default_popup")
        if isinstance(popup, str):
            add_reference(popup)
        add_icon_block(action.get("default_icon"))

    for key in ("options_page", "devtools_page"):
        value = manifest.get(key)
        if isinstance(value, str):
            add_reference(value)

    background = manifest.get("background") or {}
    if isinstance(background, dict):
        for key in ("service_worker", "page"):
            value = background.get(key)
            if isinstance(value, str):
                add_reference(value)
        scripts = background.get("scripts")
        if isinstance(scripts, list):
            for entry in scripts:
                if isinstance(entry, str):
                    add_reference(entry)

    content_scripts = manifest.get("content_scripts") or []
    if isinstance(content_scripts, list):
        for block in content_scripts:
            if not isinstance(block, dict):
                continue
            for key in ("js", "css"):
                entries = block.get(key) or []
                if isinstance(entries, list):
                    for entry in entries:
                        if isinstance(entry, str):
                            add_reference(entry)

    web_accessible_resources = manifest.get("web_accessible_resources") or []
    if isinstance(web_accessible_resources, list):
        for resource_block in web_accessible_resources:
            if not isinstance(resource_block, dict):
                continue
            resources = resource_block.get("resources") or []
            if not isinstance(resources, list):
                continue
            for entry in resources:
                if not isinstance(entry, str):
                    continue
                if "*" in entry:
                    continue
                add_reference(entry)

    return discovered


def collect_html_dependencies(initial_paths: Iterable[Path], repo_root: Path) -> set[Path]:
    discovered = set(initial_paths)
    pending = [path for path in initial_paths if path.suffix.lower() in HTML_FILE_SUFFIXES]
    processed: set[Path] = set()

    while pending:
        html_path = pending.pop()
        if html_path in processed:
            continue
        processed.add(html_path)

        parser = LocalAssetParser()
        parser.feed(html_path.read_text(encoding="utf-8"))

        for reference in parser.references:
            if not is_local_reference(reference):
                continue
            candidate = normalize_reference(html_path.parent, reference)
            if not candidate.is_file():
                raise FileNotFoundError(f"Referenced HTML dependency not found: {candidate}")
            if repo_root not in candidate.parents and candidate != repo_root:
                raise ValueError(f"Dependency resolves outside repo root: {candidate}")
            if candidate not in discovered:
                discovered.add(candidate)
                if candidate.suffix.lower() in HTML_FILE_SUFFIXES:
                    pending.append(candidate)

    return discovered


def ensure_within_repo(repo_root: Path, files: Iterable[Path]) -> list[Path]:
    validated: list[Path] = []
    for path in files:
        resolved = path.resolve()
        if repo_root not in resolved.parents and resolved != repo_root:
            raise ValueError(f"Refusing to package file outside repo root: {resolved}")
        validated.append(resolved)
    return sorted(validated)


def build_archive(repo_root: Path, output_path: Path) -> tuple[Path, int]:
    manifest_path = repo_root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest.json not found in {repo_root}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_paths = collect_manifest_paths(repo_root, manifest)
    packaged_files = ensure_within_repo(
        repo_root,
        collect_html_dependencies(manifest_paths, repo_root),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in packaged_files:
            archive.write(file_path, arcname=file_path.relative_to(repo_root).as_posix())

    return output_path, len(packaged_files)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Chrome extension distribution zip.")
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root containing manifest.json. Defaults to the current directory.",
    )
    parser.add_argument(
        "--output",
        help="Optional output zip path. Defaults to dist/<slugified-extension-name>.zip",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()

    manifest_path = repo_root / "manifest.json"
    if not manifest_path.is_file():
        print(f"[ERROR] manifest.json not found in {repo_root}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    extension_name = manifest.get("name", "extension-dist")
    default_output = repo_root / "dist" / f"{slugify(extension_name)}{ARCHIVE_EXTENSION}"
    output_path = Path(args.output).resolve() if args.output else default_output

    try:
        archive_path, file_count = build_archive(repo_root, output_path)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    print(f"Created {archive_path}")
    print(f"Packaged {file_count} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
