"""Lychee config for a Release Please PR whose new tag has not been published."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def manifest_tag(content):
    version = json.loads(content)["."]
    if not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}", version):
        raise ValueError("Expected a stable release version in the root manifest")
    return f"v{version}"


def pending_remap(base, repository):
    if not re.fullmatch(r"[a-f0-9]{40}", base):
        raise ValueError("Expected the release PR base commit SHA")
    manifest = ".release-please-manifest.json"
    previous = manifest_tag(subprocess.check_output(["git", "show", f"{base}:{manifest}"]))
    pending = manifest_tag(Path(manifest).read_text(encoding="utf-8"))
    # Published comparisons always get their ordinary check (including scheduled runs).
    if pending == previous or subprocess.run(
        ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{pending}"]
    ).returncode == 0:
        return []
    subprocess.run(["git", "rev-parse", "--verify", f"refs/tags/{previous}^{{commit}}"],
                   check=True, stdout=subprocess.DEVNULL)
    compare = f"https://github.com/{repository}/compare/{previous}..."
    return [f"^{re.escape(compare + pending)}$ {compare}{base}"]


if __name__ == "__main__":
    print("remap = " + json.dumps(pending_remap(sys.argv[1], os.environ["GITHUB_REPOSITORY"])))
