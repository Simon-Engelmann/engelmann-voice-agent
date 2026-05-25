import os
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
    print(f"[avatar-build] {message}")


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

        log(f"Extracting {zip_path} -> {target}")

        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(target)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_fbx(path):
    log(f"Importing FBX: {path}")
    bpy.ops.import_scene.fbx(filepath=str(path))


def import_obj(path):
    log(f"Importing OBJ: {path}")

    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=str(path))
    else:
        bpy.ops.import_scene.obj(filepath=str(path))


def choose_model_file():
    fbx_files = sorted(WORK_DIR.rglob("*.fbx"), key=lambda p: p.stat().st_size, reverse=True)
    obj_files = sorted(WORK_DIR.rglob("*.obj"), key=lambda p: p.stat().st_size, reverse=True)

    if fbx_files:
        return fbx_files[0]

    if obj_files:
        return obj_files[0]

    return None


def prepare_materials():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue

        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue

            mat.use_nodes = True

            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                if "Roughness" in bsdf.inputs:
                    bsdf.inputs["Roughness"].default_value = 0.58
                if "Metallic" in bsdf.inputs:
                    bsdf.inputs["Metallic"].default_value = 0.05


def center_and_scale():
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "ARMATURE"}]

    if not mesh_objects:
        log("No mesh/armature objects found for scaling.")
        return

    min_corner = Vector((999999, 999999, 999999))
    max_corner = Vector((-999999, -999999, -999999))

    for obj in mesh_objects:
        if obj.type != "MESH":
            continue

        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            min_corner.x = min(min_corner.x, world_corner.x)
            min_corner.y = min(min_corner.y, world_corner.y)
            min_corner.z = min(min_corner.z, world_corner.z)
            max_corner.x = max(max_corner.x, world_corner.x)
            max_corner.y = max(max_corner.y, world_corner.y)
            max_corner.z = max(max_corner.z, world_corner.z)

    size = max_corner - min_corner
    max_dim = max(size.x, size.y, size.z)

    if max_dim <= 0:
        log("Invalid model bounds.")
        return

    center = (min_corner + max_corner) * 0.5
    scale = 2.65 / max_dim

    empty = bpy.data.objects.new("AvatarRoot", None)
    bpy.context.collection.objects.link(empty)

    top_level = [obj for obj in bpy.context.scene.objects if obj.parent is None and obj.name != "AvatarRoot"]

    for obj in top_level:
        obj.parent = empty

    empty.location = (-center.x, -min_corner.y, -center.z)
    empty.scale = (scale, scale, scale)

    bpy.context.view_layer.update()

    log(f"Centered model. max_dim={max_dim:.3f}, scale={scale:.3f}")


def add_lights():
    light_data = bpy.data.lights.new("KeyLight", type="AREA")
    light_data.energy = 650
    light_data.size = 5

    light = bpy.data.objects.new("KeyLight", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (2.5, 4.0, 4.5)

    fill_data = bpy.data.lights.new("FillLight", type="POINT")
    fill_data.energy = 180

    fill = bpy.data.objects.new("FillLight", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (-3.0, 2.0, 3.0)


def export_glb():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        bpy.ops.file.pack_all()
    except Exception as error:
        log(f"Pack all skipped: {error}")

    export_kwargs = {
        "filepath": str(OUT_FILE),
        "export_format": "GLB",
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_animations": True,
        "export_apply": True,
    }

    try:
        bpy.ops.export_scene.gltf(
            **export_kwargs,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6
        )
    except TypeError:
        bpy.ops.export_scene.gltf(**export_kwargs)

    log(f"Exported {OUT_FILE}")


def main():
    clean_dirs()

    zip_files = find_zip_files()

    if not zip_files:
        log("No ZIP files found in public/")
        sys.exit(1)

    log("Found ZIP files:")
    for zip_path in zip_files:
        log(f"- {zip_path.name}")

    extract_zips(zip_files)
    reset_scene()

    model_file = choose_model_file()

    if not model_file:
        log("No FBX or OBJ file found after extraction.")
        sys.exit(1)

    if model_file.suffix.lower() == ".fbx":
        import_fbx(model_file)
    elif model_file.suffix.lower() == ".obj":
        import_obj(model_file)
    else:
        log(f"Unsupported model file: {model_file}")
        sys.exit(1)

    prepare_materials()
    center_and_scale()
    add_lights()
    export_glb()


if __name__ == "__main__":
    main()
