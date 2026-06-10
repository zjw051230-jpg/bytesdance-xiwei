from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional


def _empty_profile(repo_path: str = "", repo_type: str = "generic", error: str = None) -> Dict[str, Any]:
    profile = {
        "repo_type": repo_type,
        "repo_path": repo_path or "",
        "exists": False,
        "frontend_root": None,
        "backend_root": None,
        "package_managers": [],
        "available_scripts": {},
        "detected_frameworks": [],
        "key_files": [],
        "conduit_checks": {
            "has_frontend_package_json": False,
            "has_backend_package_json": False,
            "has_react_or_vite": False,
            "has_express_or_sequelize": False,
            "has_conduit_structure": False,
        },
    }
    if error:
        profile["error"] = error
    return profile


def _read_package_json(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _scripts(package_data: Dict[str, Any]) -> Dict[str, str]:
    scripts = package_data.get("scripts") if isinstance(package_data, dict) else {}
    if not isinstance(scripts, dict):
        return {}
    return {str(key): str(value) for key, value in scripts.items()}


def _dependency_names(package_data: Dict[str, Any]) -> set:
    names = set()
    for field in ("dependencies", "devDependencies", "peerDependencies"):
        values = package_data.get(field) if isinstance(package_data, dict) else {}
        if isinstance(values, dict):
            names.update(str(name).lower() for name in values)
    return names


def _add_frameworks(frameworks: List[str], names: set) -> None:
    checks = {
        "react": {"react"},
        "vite": {"vite", "@vitejs/plugin-react"},
        "express": {"express"},
        "sequelize": {"sequelize", "sequelize-cli"},
    }
    for framework, packages in checks.items():
        if names.intersection(packages) and framework not in frameworks:
            frameworks.append(framework)


def _package_managers(root: Path) -> List[str]:
    managers = []
    if (root / "package-lock.json").exists():
        managers.append("npm")
    if (root / "yarn.lock").exists():
        managers.append("yarn")
    if (root / "pnpm-lock.yaml").exists():
        managers.append("pnpm")
    if not managers and any((root / item).exists() for item in ("package.json", "frontend/package.json", "backend/package.json")):
        managers.append("npm")
    return managers


def _key_file(root: Path, relative: str, key_files: List[str]) -> bool:
    exists = (root / relative).exists()
    if exists and relative not in key_files:
        key_files.append(relative)
    return exists


def profile_repo(repo_path: Optional[str]) -> Dict[str, Any]:
    raw_path = str(repo_path or "").strip()
    if not raw_path:
        return _empty_profile(repo_type="generic")

    root = Path(raw_path).expanduser()
    try:
        resolved = root.resolve()
    except OSError as exc:
        return _empty_profile(raw_path, repo_type="invalid", error=str(exc))

    if not resolved.exists() or not resolved.is_dir():
        return _empty_profile(str(resolved), repo_type="invalid", error=f"repo path does not exist: {raw_path}")

    profile = _empty_profile(str(resolved), repo_type="generic")
    profile["exists"] = True

    key_files: List[str] = []
    frontend_package = resolved / "frontend" / "package.json"
    backend_package = resolved / "backend" / "package.json"
    root_package = resolved / "package.json"

    frontend_data = _read_package_json(frontend_package) if frontend_package.exists() else {}
    backend_data = _read_package_json(backend_package) if backend_package.exists() else {}
    root_data = _read_package_json(root_package) if root_package.exists() else {}

    available_scripts = {}
    for name, data in (("root", root_data), ("frontend", frontend_data), ("backend", backend_data)):
        script_map = _scripts(data)
        if script_map:
            available_scripts[name] = script_map

    frameworks: List[str] = []
    for data in (root_data, frontend_data, backend_data):
        _add_frameworks(frameworks, _dependency_names(data))

    has_frontend_package = _key_file(resolved, "frontend/package.json", key_files)
    has_backend_package = _key_file(resolved, "backend/package.json", key_files)
    _key_file(resolved, "frontend/vite.config.js", key_files)
    _key_file(resolved, "frontend/vite.config.ts", key_files)
    _key_file(resolved, "frontend/src/main.jsx", key_files)
    _key_file(resolved, "frontend/src/main.tsx", key_files)
    _key_file(resolved, "backend/src/app.js", key_files)
    _key_file(resolved, "backend/src/server.js", key_files)
    _key_file(resolved, "backend/models/index.js", key_files)
    _key_file(resolved, "backend/src/models/index.js", key_files)
    _key_file(resolved, "backend/routes", key_files)
    _key_file(resolved, "backend/controllers", key_files)

    has_react_or_vite = "react" in frameworks or "vite" in frameworks or any(
        item.startswith("frontend/vite.config") for item in key_files
    )
    has_express_or_sequelize = "express" in frameworks or "sequelize" in frameworks
    has_conduit_structure = has_frontend_package and has_backend_package and has_react_or_vite and has_express_or_sequelize

    profile.update(
        {
            "repo_type": "conduit" if has_conduit_structure else "generic",
            "frontend_root": "frontend" if (resolved / "frontend").is_dir() else None,
            "backend_root": "backend" if (resolved / "backend").is_dir() else None,
            "package_managers": _package_managers(resolved),
            "available_scripts": available_scripts,
            "detected_frameworks": frameworks,
            "key_files": key_files,
            "conduit_checks": {
                "has_frontend_package_json": has_frontend_package,
                "has_backend_package_json": has_backend_package,
                "has_react_or_vite": has_react_or_vite,
                "has_express_or_sequelize": has_express_or_sequelize,
                "has_conduit_structure": has_conduit_structure,
            },
        }
    )
    return profile


def repo_path_from_runtime(requirement_dsl: Optional[Dict[str, Any]] = None) -> str:
    if isinstance(requirement_dsl, dict) and requirement_dsl.get("target_repo"):
        return str(requirement_dsl.get("target_repo") or "")
    return os.getenv("AGENT_REPO_ROOT", "")


def profile_runtime_repo(requirement_dsl: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return profile_repo(repo_path_from_runtime(requirement_dsl))
