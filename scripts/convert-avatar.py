import sys
import zipfile
import shutil
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path.cwd()
PUBLIC_DIR = ROOT / "public"
WORK_DIR = ROOT / "_avatar_work"
OUT_DIR = PUBLIC_DIR / "avatar"
OUT_FILE = OUT_DIR / "model.glb"

ZIP_PATTERNS = [
    "*FBX*.zip",
    "*OBJ*.zip",
    "*fbx*.zip",
    "*obj*.zip",
]


def log(message):
    print(f"[avatar-build] {message}", flush=True)


def clean_dirs():
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def find_zip_files():
    found = []

    for pattern in ZIP_PATTERNS:
        found.extend(PUBLIC_DIR.glob(pattern))

    unique = []
    seen = set()

    for path in found:
        if path.name not in seen:
            unique.append(path)
            seen.add(path.name)

    return unique


def extract_zips(zip_files):
    for zip_path in zip_files:
        target = WORK_DIR / zip_path.stem
        target.mkdir(parents=True, exist_ok=True)

        log(f"Extracting {zip_path.name}")

        with zipfile.ZipFile(zip_path,
