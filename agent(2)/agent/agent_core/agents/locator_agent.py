from typing import Any, Dict, List, Optional, Tuple

from agent_core.skills.registry import resolve_skill


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/").lower().strip("/")


def _real_file_matches(file_path: str, search_terms: List[str]) -> bool:
    normalized = _normalize_path(file_path)
    basename = normalized.rsplit("/", 1)[-1]
    stem = basename.rsplit(".", 1)[0]

    for term in search_terms:
        normalized_term = _normalize_path(term)
        term_basename = normalized_term.rsplit("/", 1)[-1]
        if not normalized_term:
            continue
        if normalized.endswith(normalized_term):
            return True
        if basename == term_basename:
            return True
        if term_basename and term_basename in basename:
            return True
        if stem and stem in normalized_term:
            return True

    return False


def _append_text_terms(terms: List[str], text: str, max_terms: int = 20) -> None:
    for raw_token in (text or "").replace("\\", "/").replace("-", " ").replace("_", " ").split():
        token = raw_token.strip(".,;:!?()[]{}'\"").lower()
        if len(token) < 3:
            continue
        if token in terms:
            continue
        terms.append(token)
        if len(terms) >= max_terms:
            return


def _extract_search_terms(
    plan: Optional[Dict[str, Any]],
    user_input: str = "",
    matched_skill: Optional[Dict[str, Any]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
    historical_recall: Optional[Dict[str, Any]] = None,
) -> List[str]:
    matched_skill = resolve_skill(matched_skill)
    terms: List[str] = []
    if isinstance(plan, dict):
        for item in plan.get("target_files_hint") or []:
            if isinstance(item, str) and item.strip():
                terms.append(item.strip())
        for item in plan.get("target_file_patterns") or []:
            if isinstance(item, str) and item.strip():
                terms.append(item.strip())
        _append_text_terms(terms, str(plan.get("task_name", "")))
        for field in ("steps", "acceptance_criteria", "context_rules"):
            for item in plan.get(field) or []:
                if isinstance(item, str):
                    _append_text_terms(terms, item)

    if isinstance(matched_skill, dict):
        _append_text_terms(terms, str(matched_skill.get("name", "")))
        _append_text_terms(terms, str(matched_skill.get("description", "")))
        for keyword in matched_skill.get("keywords", []) or []:
            if isinstance(keyword, str) and keyword.strip() and keyword.lower() not in terms:
                terms.append(keyword.lower())
        for item in matched_skill.get("target_file_patterns", []) or []:
            if isinstance(item, str) and item.strip() and item not in terms:
                terms.append(item)
        if isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit":
            metadata = plan.get("metadata") if isinstance(plan, dict) and isinstance(plan.get("metadata"), dict) else {}
            scope = str(metadata.get("conduit_scope") or "").lower()
            fields = ["conduit_frontend_patterns"] if scope == "frontend" else ["conduit_backend_patterns"] if scope == "backend" else ["conduit_backend_patterns", "conduit_frontend_patterns"]
            for field in fields:
                for item in matched_skill.get(field, []) or []:
                    if isinstance(item, str) and item.strip() and item not in terms:
                        terms.append(item)
        for item in matched_skill.get("context_rules", []) or []:
            if isinstance(item, str):
                _append_text_terms(terms, item)

    if isinstance(historical_recall, dict):
        for item in historical_recall.get("reusable_file_hints", []) or []:
            if isinstance(item, str) and item.strip() and item not in terms:
                terms.append(item)

    for raw_token in (user_input or "").replace("\\", "/").split():
        token = raw_token.strip(".,;:!?()[]{}'\"")
        if "." in token or "/" in token:
            terms.append(token)
    _append_text_terms(terms, user_input)

    lowered_input = (user_input or "").lower()
    language_extensions = {
        "python": ".py",
        "javascript": ".js",
        "typescript": ".ts",
        "react": ".jsx",
    }
    for language, extension in language_extensions.items():
        if language in lowered_input:
            terms.append(extension)

    return terms


def _conduit_search_roots(plan: Optional[Dict[str, Any]]) -> List[str]:
    scope = ""
    if isinstance(plan, dict):
        metadata = plan.get("metadata") if isinstance(plan.get("metadata"), dict) else {}
        scope = str(metadata.get("conduit_scope") or "").lower()
    backend_roots = ["backend/src", "backend/models", "backend/routes", "backend/controllers"]
    frontend_roots = ["frontend/src"]
    roots = backend_roots + frontend_roots
    if scope == "frontend":
        roots = frontend_roots
        package_roots = ["frontend/package.json", "package.json"]
    elif scope == "backend":
        roots = backend_roots
        package_roots = ["backend/package.json", "package.json"]
    else:
        package_roots = ["frontend/package.json", "backend/package.json", "package.json"]
    result = list(roots)
    result.extend(package_roots)
    return result


def _score_path_match(file_path: str, search_terms: List[str]) -> Tuple[int, List[str]]:
    normalized = _normalize_path(file_path)
    basename = normalized.rsplit("/", 1)[-1]
    score = 0
    matched_terms: List[str] = []

    for term in search_terms:
        normalized_term = _normalize_path(term)
        if not normalized_term:
            continue
        term_basename = normalized_term.rsplit("/", 1)[-1]
        matched = False
        if normalized.endswith(normalized_term):
            score += 5
            matched = True
        elif basename == term_basename:
            score += 4
            matched = True
        elif term_basename and term_basename in basename:
            score += 3
            matched = True
        elif normalized_term in normalized:
            score += 2
            matched = True
        if matched and normalized_term not in matched_terms:
            matched_terms.append(normalized_term)

    return score, matched_terms


def _score_content_match(content: str, search_terms: List[str]) -> Tuple[int, List[str], str]:
    lowered = (content or "").lower()
    score = 0
    matched_terms: List[str] = []

    for term in search_terms:
        normalized_term = str(term or "").lower().strip()
        if len(normalized_term) < 3:
            continue
        if normalized_term in lowered:
            score += 2
            if normalized_term not in matched_terms:
                matched_terms.append(normalized_term)

    preview = ""
    if matched_terms:
        for line in (content or "").splitlines():
            lowered_line = line.lower()
            if any(term in lowered_line for term in matched_terms):
                preview = line.strip()[:160]
                break

    return score, matched_terms, preview


def _locate_real_repo_files(
    plan: Optional[Dict[str, Any]],
    repo_adapter,
    user_input: str = "",
    matched_skill: Optional[Dict[str, Any]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
    historical_recall: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if repo_adapter is None or not getattr(repo_adapter, "is_real_repo", False) or not hasattr(repo_adapter, "list_files"):
        return None

    listed_results = []
    if isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit":
        for root in _conduit_search_roots(plan):
            result = repo_adapter.list_files(root)
            if isinstance(result, dict) and result.get("ok") is True:
                listed_results.append(result)
        listed = listed_results[0] if listed_results else repo_adapter.list_files()
    else:
        listed = repo_adapter.list_files()
        if isinstance(listed, dict) and listed.get("ok") is True:
            listed_results.append(listed)

    if not listed_results and (not isinstance(listed, dict) or listed.get("ok") is not True):
        return {
            "located": False,
            "files": [],
            "strategy": "real_repo",
            "mode": listed.get("mode") if isinstance(listed, dict) else "real_repo_readonly",
            "error": listed.get("error") if isinstance(listed, dict) else "Unable to list repository files",
            "scanned_count": 0,
        }

    real_files = []
    seen_paths = set()
    for listed_result in listed_results:
        for item in listed_result.get("files", []) or []:
            relative_path = item.get("path") if isinstance(item, dict) else str(item)
            if relative_path in seen_paths:
                continue
            seen_paths.add(relative_path)
            real_files.append(item)
    terms = _extract_search_terms(plan, user_input, matched_skill, repo_profile=repo_profile, historical_recall=historical_recall)
    matches = []

    if not terms:
        return {
            "located": False,
            "files": [],
            "strategy": "real_repo",
            "mode": listed.get("mode", "real_repo_readonly"),
            "scanned_count": len(real_files),
        }

    for item in real_files:
        if isinstance(item, dict):
            relative_path = item.get("path", "")
            resolved_path = item.get("resolved_path")
        else:
            relative_path = str(item)
            resolved_path = None

        path_score, path_terms = _score_path_match(relative_path, terms)
        content_score = 0
        content_terms: List[str] = []
        content_preview = ""
        read_error = None

        if hasattr(repo_adapter, "read_file"):
            read_result = repo_adapter.read_file(relative_path)
            if isinstance(read_result, dict) and read_result.get("ok") is True:
                content_score, content_terms, content_preview = _score_content_match(
                    read_result.get("content", ""),
                    terms,
                )
            elif isinstance(read_result, dict):
                read_error = read_result.get("error")

        total_score = path_score + content_score
        if total_score <= 0:
            continue

        reasons = []
        if path_score > 0:
            reasons.append("path")
        if content_score > 0:
            reasons.append("content")

        matches.append(
            {
                "path": resolved_path or relative_path,
                "relative_path": relative_path,
                "reason": "Real repository file matched locator search terms",
                "match_reasons": reasons,
                "matched_terms": path_terms + [term for term in content_terms if term not in path_terms],
                "score": total_score,
                "confidence": min(0.95, 0.5 + (total_score * 0.05)),
            }
        )
        if content_preview:
            matches[-1]["content_preview"] = content_preview
        if read_error:
            matches[-1]["read_error"] = read_error

    matches.sort(key=lambda item: (-item.get("score", 0), item.get("relative_path", "")))
    return {
        "located": bool(matches),
        "files": matches,
        "strategy": "conduit_repo" if isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit" else "real_repo",
        "mode": listed.get("mode", "real_repo_readonly"),
        "scanned_count": len(real_files),
        "search_terms": terms,
        "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
    }


def locate_files(
    plan: Optional[Dict[str, Any]],
    matched_skill: Optional[Dict[str, Any]] = None,
    repo_adapter=None,
    user_input: str = "",
    repo_profile: Optional[Dict[str, Any]] = None,
    historical_recall: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    matched_skill = resolve_skill(matched_skill)
    real_result = _locate_real_repo_files(plan, repo_adapter, user_input, matched_skill, repo_profile=repo_profile, historical_recall=historical_recall)
    if real_result is not None:
        return real_result

    target_files = None
    if isinstance(plan, dict):
        target_files = plan.get("target_files_hint") or []

    if isinstance(target_files, list) and target_files:
        files = [
            {
                "path": item,
                "reason": "File candidate from plan target_files_hint",
                "confidence": 0.75,
            }
            for item in target_files
            if isinstance(item, str) and item.strip()
        ]
        return {"located": True, "files": files, "strategy": "plan_hint"}

    if isinstance(historical_recall, dict) and historical_recall.get("reusable_file_hints"):
        files = [
            {
                "path": item,
                "reason": "File candidate from historical recall reusable_file_hints",
                "confidence": 0.68,
            }
            for item in historical_recall.get("reusable_file_hints", []) or []
            if isinstance(item, str) and item.strip()
        ]
        if files:
            return {"located": True, "files": files, "strategy": "historical_recall"}

    if isinstance(matched_skill, dict):
        patterns = matched_skill.get("target_file_patterns") or matched_skill.get("target_modules") or []
        files = [
            {
                "path": item,
                "reason": "File candidate from matched skill target_file_patterns",
                "confidence": 0.7,
            }
            for item in patterns
            if isinstance(item, str) and item.strip()
        ]
        if files:
            return {
                "located": True,
                "files": files,
                "strategy": "skill_default",
                "context_rules": list(matched_skill.get("context_rules") or []),
            }

    return {"located": False, "files": [], "strategy": "fallback"}
