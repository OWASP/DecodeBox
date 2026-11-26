#!/usr/bin/env python3
"""Offline gh executable used only by the release CLI integration tests."""
import hashlib
import json
import os
import sys
from pathlib import Path

file = Path(os.environ["FAKE_GH_STATE"])
state = json.loads(file.read_text())
release = state["release"]
args = sys.argv[1:]
repo = "repos/OWASP/DecodeBox/"
tag = release["tag_name"]
data = json.load(sys.stdin) if "--input" in args else None
state["calls"].append([args, data])


def finish(value="", code=0):
    file.write_text(json.dumps(state))
    if isinstance(value, bytes):
        sys.stdout.buffer.write(value)
    else:
        print(value if isinstance(value, str) else json.dumps(value))
    sys.exit(code)


name = f"OWASP-DecodeBox-Standalone-{tag}.html"
if args[:2] == ["release", "upload"]:
    assert args == ["release", "upload", tag, str(file.parent / name), "--clobber"]
    if state.get("fault") == "upload":
        finish(code=1)
    blob = (file.parent / name).read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    if state.get("fault") == "digest":
        digest = "0" * 64
    release["assets"] = [dict(id=73, name=name, state="uploaded", size=len(blob), digest="sha256:" + digest)]
    finish()
if args == ["api", "-H", "Accept: application/octet-stream", repo + "releases/assets/73"]:
    finish((file.parent / name).read_bytes())
if args == ["api", repo + "releases/tags/" + tag]:
    finish(release)
if args[:2] != ["api", "--method"]:
    finish("Unexpected invocation", 2)
method, endpoint = args[2:4]
assert args[4:] == ([] if method == "GET" else ["--input", "-"])
assert endpoint.startswith(repo)
route = endpoint[len(repo):]
if state.get("fault") == "invalid JSON":
    finish("{")
if method == "GET" and route in (f"releases/{release['id']}", "releases/tags/" + tag):
    if state.get("fault") == "concurrent edit" and route == f"releases/{release['id']}":
        release["name"] = "Edited during contributor lookup"
    finish(release)
if method == "POST" and route == "releases/generate-notes":
    assert data == {"tag_name": tag, "previous_tag_name": "v0.1.1"}
    if state.get("fault") == "contributors":
        finish(code=1)
    line = "* @alice made their first contribution in https://github.com/OWASP/DecodeBox/pull/31"
    finish({"body": "## New Contributors\n" + line + "\n" + line})
if method == "GET" and route == "pulls/31":
    finish(dict(number=31, user=dict(login="alice"), base=dict(ref="main", repo=dict(full_name="OWASP/DecodeBox")),
                merged_at="2026-11-20T00:00:00Z"))
if method == "PATCH" and route == f"releases/{release['id']}":
    assert set(data) in ({"body"}, {"name", "body"})
    if state.get("fault") == "reject PATCH":
        finish(code=1)
    release.update(data)
    if state.get("fault") == "lose PATCH response":
        finish(code=1)
    if state.get("fault") == "invalid PATCH reply":
        finish({})
    finish(release)
finish("Unexpected route", 2)
