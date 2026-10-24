#!/usr/bin/env python3

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import json
import math
import re
import shutil
import sqlite3
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable


COMMON_FRONTMATTER_ORDER = [
    "id",
    "type",
    "schema_version",
    "status",
    "created_at",
    "updated_at",
    "updated_by",
    "owner",
    "tags",
    "related_files",
    "related_decisions",
    "related_incidents",
    "source_logs",
    "superseded_by",
    "review_after",
    "verified_by",
    "verified_at",
    "verified_content_sha256",
    "verification_evidence",
]

REQUIRED_KEYS = [
    "id",
    "type",
    "schema_version",
    "status",
    "created_at",
    "updated_at",
    "updated_by",
    "owner",
]

STATUS_DEFAULTS = {
    "current-state": "active",
    "next-steps": "active",
    "related-memory": "active",
    "session": "complete",
    "decision": "accepted",
    "incident": "open",
}

TYPE_TO_TEMPLATE = {
    "current-state": "current-state.md",
    "next-steps": "next-steps.md",
    "related-memory": "related-memory.md",
    "session": "session.md",
    "decision": "decision.md",
    "incident": "incident.md",
}

SESSION_FILE_RE = re.compile(r"^session-\d{4}-\d{2}-\d{2}-\d{4}\.md$")
SESSION_ID_RE = re.compile(r"^session-\d{4}-\d{2}-\d{2}-\d{4}$")
SESSION_BARE_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{4}$")
DECISION_FILE_RE = re.compile(r"^decision-\d{3}\.md$")
DECISION_ID_RE = re.compile(r"^decision-\d{3}$")
INCIDENT_FILE_RE = re.compile(r"^\d{8}-[a-z0-9-]+\.md$")
INCIDENT_ID_RE = re.compile(r"^incident-\d{8}-[a-z0-9-]+$")
LOG_FILE_RE = re.compile(r"^\d{8}-\d{2}\.log$")
LEGACY_LOG_FILE_RE = re.compile(r"^(\d{8})\.log$")
SOURCE_LOG_RE = re.compile(r"^\.aimem/logs/\d{8}-\d{2}\.log$")

INDEX_RECOMMEND_SESSION_THRESHOLD = 10
INDEX_RECOMMEND_ARTIFACT_THRESHOLD = 25
SINGLETON_LINE_WARNING_THRESHOLD = 150
NEXT_STEPS_ACTION_WARNING_THRESHOLD = 20
STARTUP_DIGEST_WORD_TARGET = 450
STARTUP_WORD_WARNING_THRESHOLD = 2500
STARTUP_DIGEST_PATH = ".aimem/startup-digest.md"
CAPABILITY_REPORT_PATH = ".aimem/capabilities/latest.md"
RELATED_MEMORY_PATH = ".aimem/related-memory.md"
FAILURE_LEDGER_PATH = ".aimem/observations/failures.jsonl"
CONSUMER_REGISTRY_PATH = ".aimem/consumers.json"
RECALL_DEFAULT_LIMIT = 8
RECALL_DEFAULT_TOKEN_BUDGET = 1500
RECALL_STOP_WORDS = {
    "a", "about", "an", "and", "are", "as", "at", "be", "by", "did", "do",
    "does", "for", "from", "had", "has", "have", "how", "i", "in", "is", "it",
    "of", "on", "or", "our", "the", "their", "this", "to", "was", "were", "what",
    "when", "where", "which", "who", "why", "with", "you", "your",
    "current", "currently", "now", "status", "today", "live", "next", "todo",
    "plan", "planned", "pending", "blocked", "history", "historical", "happened",
    "session", "previously", "decision", "decide", "chosen", "rationale",
}


@dataclasses.dataclass
class Frontmatter:
    values: dict[str, object]
    key_order: list[str]


@dataclasses.dataclass
class Artifact:
    root: Path
    path: Path
    rel_path: str
    artifact_type: str
    expected_id: str | None
    frontmatter: Frontmatter | None
    body: str
    text: str

    @property
    def values(self) -> dict[str, object]:
        return self.frontmatter.values if self.frontmatter else {}


@dataclasses.dataclass
class Issue:
    level: str
    code: str
    path: str
    message: str
    hint: str | None = None


@dataclasses.dataclass
class Action:
    kind: str
    path: str
    message: str
    apply: callable | None = None


@dataclasses.dataclass
class ValidationResult:
    root: Path
    issues: list[Issue]
    artifacts: list[Artifact]
    log_paths: list[Path]

    def error_count(self) -> int:
        return sum(1 for issue in self.issues if issue.level == "error")

    def warning_count(self) -> int:
        return sum(1 for issue in self.issues if issue.level == "warning")


@dataclasses.dataclass
class RecallResult:
    artifact_id: str
    artifact_type: str
    role: str
    status: str
    updated_at: str
    path: str
    heading: str
    excerpt: str
    score: float
    related_files: list[str]
    superseded_by: str = ""
    replacement_path: str = ""
    review_after: str = ""
    review_due: bool = False
    verification: str = "unverified"
    verified_by: str = ""
    verified_at: str = ""
    verification_evidence: list[str] = dataclasses.field(default_factory=list)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage aimem project memory validation, migration, health, and indexing."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser(
        "init",
        help="Create or refresh aimem files in a target project.",
    )
    init_parser.add_argument(
        "target_dir",
        nargs="?",
        default=".",
        help="Project root to initialize or refresh; defaults to the current directory.",
    )
    init_parser.add_argument(
        "--force-singletons",
        action="store_true",
        help="Overwrite .aimem/current-state.md and .aimem/next-steps.md from templates.",
    )
    init_parser.add_argument(
        "--update-agents",
        action="store_true",
        help="Overwrite AGENTS.md from this aimem distribution when it already exists.",
    )
    init_parser.add_argument(
        "--skip-health",
        action="store_true",
        help="Do not print the post-init health check.",
    )
    init_parser.add_argument(
        "--no-register",
        action="store_true",
        help="Do not register or audit the target in the distribution project’s consumer registry.",
    )
    init_parser.set_defaults(func=cmd_init)

    validate_parser = subparsers.add_parser("validate", help="Validate the .aimem state in a project.")
    add_root_argument(validate_parser)
    validate_parser.set_defaults(func=cmd_validate)

    health_parser = subparsers.add_parser("health", help="Summarize memory health and indexing recommendations.")
    add_root_argument(health_parser)
    health_parser.set_defaults(func=cmd_health)

    startup_digest_parser = subparsers.add_parser(
        "startup-digest",
        help="Write a compact derived startup digest from current-state and next-steps.",
    )
    add_root_argument(startup_digest_parser)
    startup_digest_parser.set_defaults(func=cmd_startup_digest)

    failure_record_parser = subparsers.add_parser("failure-record", help="Append a structured memory-system failure observation.")
    failure_record_parser.add_argument("--type", required=True, dest="failure_type")
    failure_record_parser.add_argument("--location", required=True)
    failure_record_parser.add_argument("--observed", required=True)
    failure_record_parser.add_argument("--expected", default="")
    failure_record_parser.add_argument("--query", default="")
    failure_record_parser.add_argument("--reason", default="", dest="suspected_reason")
    failure_record_parser.add_argument("--severity", choices=("low", "medium", "high", "critical"), default="medium")
    failure_record_parser.add_argument("--confidence", choices=("low", "medium", "high"), default="medium")
    failure_record_parser.add_argument("--evidence", action="append", default=[])
    failure_record_parser.add_argument("--json", action="store_true")
    add_root_argument(failure_record_parser)
    failure_record_parser.set_defaults(func=cmd_failure_record)

    failure_list_parser = subparsers.add_parser("failure-list", help="List recorded failure observations.")
    failure_list_parser.add_argument("--type", dest="failure_type", default="")
    failure_list_parser.add_argument("--location", default="")
    failure_list_parser.add_argument("--limit", type=int, default=50)
    failure_list_parser.add_argument("--json", action="store_true")
    add_root_argument(failure_list_parser)
    failure_list_parser.set_defaults(func=cmd_failure_list)

    failure_summary_parser = subparsers.add_parser("failure-summary", help="Group repeated failure observations for investigation.")
    failure_summary_parser.add_argument("--min-count", type=int, default=1)
    failure_summary_parser.add_argument("--json", action="store_true")
    add_root_argument(failure_summary_parser)
    failure_summary_parser.set_defaults(func=cmd_failure_summary)

    consumer_register_parser = subparsers.add_parser("consumer-register", help="Register a project consuming this memory distribution.")
    consumer_register_parser.add_argument("target_dir")
    consumer_register_parser.add_argument("--id", dest="consumer_id", default="")
    consumer_register_parser.add_argument("--label", default="")
    consumer_register_parser.add_argument("--memory-version", default="")
    consumer_register_parser.add_argument("--registry", default="")
    consumer_register_parser.set_defaults(func=cmd_consumer_register)

    consumer_audit_parser = subparsers.add_parser("consumer-audit", help="Check whether registered consumer paths are reachable.")
    consumer_audit_parser.add_argument("--registry", default="")
    consumer_audit_parser.add_argument("--json", action="store_true")
    consumer_audit_parser.set_defaults(func=cmd_consumer_audit)

    consumer_list_parser = subparsers.add_parser("consumer-list", help="List registered consumers and their last known status.")
    consumer_list_parser.add_argument("--registry", default="")
    consumer_list_parser.add_argument("--json", action="store_true")
    consumer_list_parser.set_defaults(func=cmd_consumer_list)

    update_parser = subparsers.add_parser(
        "update",
        help="Refresh reachable registered consumers from this distribution project.",
    )
    update_parser.add_argument("--registry", default="", help="Consumer registry; defaults to .aimem/consumers.json in this project.")
    update_parser.add_argument("--skip-health", action="store_true", help="Do not validate updated consumers after refresh.")
    update_parser.set_defaults(func=cmd_update)

    migrate_parser = subparsers.add_parser(
        "migrate",
        help="Normalize legacy .aimem artifacts. Defaults to dry-run.",
    )
    add_root_argument(migrate_parser)
    migrate_parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply deterministic migration changes instead of only reporting them.",
    )
    migrate_parser.set_defaults(func=cmd_migrate)

    index_init_parser = subparsers.add_parser("index-init", help="Create the optional .aimem/memory.db schema.")
    add_root_argument(index_init_parser)
    index_init_parser.add_argument("--force", action="store_true", help="Recreate the database even if it exists.")
    index_init_parser.set_defaults(func=cmd_index_init)

    index_status_parser = subparsers.add_parser("index-status", help="Show derived index status.")
    add_root_argument(index_status_parser)
    index_status_parser.set_defaults(func=cmd_index_status)

    index_build_parser = subparsers.add_parser("index-build", help="Rebuild .aimem/memory.db from markdown.")
    add_root_argument(index_build_parser)
    index_build_parser.set_defaults(func=cmd_index_build)

    index_drop_empty_parser = subparsers.add_parser(
        "index-drop-empty",
        help="Delete .aimem/memory.db only when it exists and has no indexed artifacts.",
    )
    add_root_argument(index_drop_empty_parser)
    index_drop_empty_parser.set_defaults(func=cmd_index_drop_empty)

    recall_parser = subparsers.add_parser(
        "recall",
        help="Return a small authority-aware context package from durable project memory.",
    )
    recall_parser.add_argument("query", help="Question or topic to recall.")
    add_root_argument(recall_parser)
    recall_parser.add_argument("--limit", type=int, default=RECALL_DEFAULT_LIMIT, help="Maximum result sections.")
    recall_parser.add_argument(
        "--max-tokens",
        type=int,
        default=RECALL_DEFAULT_TOKEN_BUDGET,
        help="Approximate maximum tokens in the complete result package.",
    )
    recall_parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    recall_parser.add_argument(
        "--no-refresh",
        action="store_true",
        help="Refuse absent or stale indexes instead of rebuilding derived SQLite state.",
    )
    recall_parser.set_defaults(func=cmd_recall)

    hash_parser = subparsers.add_parser(
        "verification-hash", help="Print a content hash for a reviewed artefact; does not verify or write it."
    )
    hash_parser.add_argument("path", help="Durable artefact path, relative to the project root.")
    add_root_argument(hash_parser)
    hash_parser.set_defaults(func=cmd_verification_hash)

    normalize_bodies_parser = subparsers.add_parser(
        "normalize-bodies",
        help="Normalize legacy artifact body headings into the current template structure.",
    )
    add_root_argument(normalize_bodies_parser)
    normalize_bodies_parser.add_argument(
        "--from-git-head",
        action="store_true",
        help="Read artifact bodies from git HEAD when possible before normalizing them.",
    )
    normalize_bodies_parser.set_defaults(func=cmd_normalize_bodies)

    normalize_one_parser = subparsers.add_parser(
        "normalize-one-from-git",
        help="Normalize one artifact using a source body read from a git HEAD path.",
    )
    add_root_argument(normalize_one_parser)
    normalize_one_parser.add_argument("artifact_path", help="Current artifact path, relative to the project root or absolute.")
    normalize_one_parser.add_argument("git_path", help="Artifact path to read from git HEAD, relative to the project root.")
    normalize_one_parser.set_defaults(func=cmd_normalize_one_from_git)

    rename_session_parser = subparsers.add_parser(
        "rename-session",
        help="Rename a legacy session artifact to a canonical session id.",
    )
    add_root_argument(rename_session_parser)
    rename_session_parser.add_argument("session_path", help="Path to the legacy session file, relative to the project root or absolute.")
    rename_session_parser.add_argument("new_id", help="Canonical session id such as session-2026-04-03-1822.")
    rename_session_parser.set_defaults(func=cmd_rename_session)

    rename_decision_parser = subparsers.add_parser(
        "rename-decision",
        help="Rename a legacy decision artifact and update related references.",
    )
    add_root_argument(rename_decision_parser)
    rename_decision_parser.add_argument("decision_path", help="Path to the legacy decision file, relative to the project root or absolute.")
    rename_decision_parser.add_argument("new_id", help="Canonical decision id such as decision-001.")
    rename_decision_parser.set_defaults(func=cmd_rename_decision)

    return parser


def add_root_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Project root containing .aimem/ and .aimem-spec/.",
    )


def cmd_init(args: argparse.Namespace) -> int:
    source_root = get_distribution_root()
    target_root = resolve_target_dir(args.target_dir)
    report = init_project(
        source_root=source_root,
        target_root=target_root,
        force_singletons=args.force_singletons,
        update_agents=args.update_agents,
    )
    print_init_report(target_root, report)

    if not args.no_register and target_root != source_root:
        registry_path = source_root / CONSUMER_REGISTRY_PATH
        register_consumer_target(registry_path, target_root)
        audited = audit_consumers(registry_path)
        reachable = sum(1 for item in audited["consumers"].values() if item.get("status") == "reachable")
        print(f"Consumer registry: {reachable}/{len(audited['consumers'])} reachable ({registry_path.relative_to(source_root)})")

    if not args.skip_health:
        root = resolve_root(str(target_root))
        print("Running aimem health check...")
        result = validate_root(root)
        print_health(root, result)
        return 1 if result.error_count() else 0
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    print_validation(result)
    return 1 if result.error_count() else 0


def cmd_health(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    print_health(root, result)
    return 1 if result.error_count() else 0


def cmd_startup_digest(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    write_startup_digest(root, result)
    print(f"Wrote {STARTUP_DIGEST_PATH}")
    return 1 if result.error_count() else 0


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def failure_fingerprint(record: dict[str, object]) -> str:
    raw = "|".join(str(record.get(key, "")).strip().lower() for key in ("type", "location", "query", "expected"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def failure_ledger_path(root: Path) -> Path:
    return root / FAILURE_LEDGER_PATH


def load_failure_records(root: Path) -> list[dict[str, object]]:
    path = failure_ledger_path(root)
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            records.append(item)
    return records


def record_failure(root: Path, *, failure_type: str, location: str, observed: str,
                   expected: str = "", query: str = "", suspected_reason: str = "",
                   severity: str = "medium", confidence: str = "medium",
                   evidence: list[str] | None = None) -> dict[str, object]:
    record = {
        "failure_id": f"failure-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        "observed_at": utc_now(),
        "type": failure_type.strip(),
        "location": location.strip(),
        "query": query.strip(),
        "observed": observed.strip(),
        "expected": expected.strip(),
        "suspected_reason": suspected_reason.strip(),
        "severity": severity,
        "confidence": confidence,
        "evidence": [item.strip() for item in (evidence or []) if item.strip()],
        "status": "observed",
    }
    record["fingerprint"] = failure_fingerprint(record)
    path = failure_ledger_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    return record


def cmd_failure_record(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    record = record_failure(root, failure_type=args.failure_type, location=args.location,
                           observed=args.observed, expected=args.expected, query=args.query,
                           suspected_reason=args.suspected_reason, severity=args.severity,
                           confidence=args.confidence, evidence=args.evidence)
    if args.json:
        print(json.dumps(record, indent=2, sort_keys=True))
    else:
        print(f"Recorded {record['failure_id']} ({record['fingerprint']}) in {FAILURE_LEDGER_PATH}")
    return 0


def cmd_failure_list(args: argparse.Namespace) -> int:
    records = load_failure_records(resolve_root(args.root))
    if args.failure_type:
        records = [r for r in records if r.get("type") == args.failure_type]
    if args.location:
        records = [r for r in records if r.get("location") == args.location]
    records = records[-args.limit:] if args.limit > 0 else []
    if args.json:
        print(json.dumps(records, indent=2, sort_keys=True))
    elif records:
        for r in records:
            print(f"{r.get('observed_at', '?')} {r.get('failure_id', '?')} {r.get('type', '?')} @ {r.get('location', '?')} [{r.get('severity', '?')}] {r.get('observed', '')}")
    else:
        print("No failure observations recorded.")
    return 0


def failure_summary(root: Path) -> list[dict[str, object]]:
    groups: dict[str, dict[str, object]] = {}
    for record in load_failure_records(root):
        fp = str(record.get("fingerprint", "unknown"))
        group = groups.setdefault(fp, {"fingerprint": fp, "count": 0, "type": record.get("type", ""),
                                      "location": record.get("location", ""), "severity": record.get("severity", "medium"),
                                      "first_observed_at": record.get("observed_at", ""), "last_observed_at": record.get("observed_at", ""),
                                      "latest_observed": record.get("observed", ""), "latest_reason": record.get("suspected_reason", ""), "evidence": []})
        group["count"] = int(group["count"]) + 1
        group["last_observed_at"] = record.get("observed_at", "")
        group["latest_observed"] = record.get("observed", "")
        if record.get("suspected_reason"):
            group["latest_reason"] = record.get("suspected_reason", "")
        for item in record.get("evidence", []):
            if item not in group["evidence"]:
                group["evidence"].append(item)
    return sorted(groups.values(), key=lambda item: (-int(item["count"]), str(item["last_observed_at"])))


def cmd_failure_summary(args: argparse.Namespace) -> int:
    summary = [item for item in failure_summary(resolve_root(args.root)) if int(item["count"]) >= max(args.min_count, 1)]
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    elif summary:
        for item in summary:
            print(f"{item['count']}x {item['fingerprint']} ({item['type']} @ {item['location']}; {item['severity']})")
            print(f"  latest: {item['latest_observed']}")
            if item["latest_reason"]:
                print(f"  hypothesis: {item['latest_reason']}")
    else:
        print("No failure groups meet the requested threshold.")
    return 0


def resolve_registry_path(raw: str) -> Path:
    path = Path(raw).expanduser() if raw else Path.cwd() / CONSUMER_REGISTRY_PATH
    path = path.resolve()
    if path.exists() and path.is_dir():
        path = path / CONSUMER_REGISTRY_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_consumer_registry(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"schema_version": 1, "updated_at": utc_now(), "consumers": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SystemExit(f"{path}: consumer registry is unreadable")
    if not isinstance(value, dict) or not isinstance(value.get("consumers", {}), dict):
        raise SystemExit(f"{path}: consumer registry has an invalid schema")
    return value


def save_consumer_registry(path: Path, registry: dict[str, object]) -> None:
    registry["updated_at"] = utc_now()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def audit_consumers(path: Path) -> dict[str, object]:
    registry = load_consumer_registry(path)
    checked = utc_now()
    for consumer in registry["consumers"].values():
        target = Path(str(consumer.get("path", ""))).expanduser()
        try:
            if not target.exists():
                status = "missing"
            elif not target.is_dir():
                status = "invalid"
            elif not (target / ".aimem").is_dir():
                status = "invalid"
            else:
                status = "reachable"
        except OSError:
            status = "unavailable"
        consumer["status"] = status
        consumer["last_checked"] = checked
    save_consumer_registry(path, registry)
    return registry


def register_consumer_target(path: Path, target: Path, consumer_id: str = "", label: str = "", memory_version: str = "") -> dict[str, object]:
    registry = load_consumer_registry(path)
    consumer_id = consumer_id.strip() or target.name
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", consumer_id):
        raise SystemExit("consumer id must contain only letters, numbers, dots, underscores, and hyphens")
    now = utc_now()
    old = registry["consumers"].get(consumer_id, {})
    registry["consumers"][consumer_id] = {
        "consumer_id": consumer_id, "label": label or old.get("label", ""), "path": str(target),
        "registered_at": old.get("registered_at", now), "last_seen": now, "last_checked": now,
        "status": "reachable" if (target / ".aimem").is_dir() else "invalid",
        "memory_version": memory_version or old.get("memory_version", ""),
    }
    save_consumer_registry(path, registry)
    return registry["consumers"][consumer_id]


def cmd_consumer_register(args: argparse.Namespace) -> int:
    target = resolve_target_dir(args.target_dir)
    path = resolve_registry_path(args.registry)
    register_consumer_target(path, target, args.consumer_id, args.label, args.memory_version)
    print(f"Registered consumer `{args.consumer_id.strip() or target.name}` at {target}")
    return 0


def cmd_consumer_audit(args: argparse.Namespace) -> int:
    registry = audit_consumers(resolve_registry_path(args.registry))
    consumers = list(registry["consumers"].values())
    if args.json:
        print(json.dumps(consumers, indent=2, sort_keys=True))
    elif consumers:
        for consumer in consumers:
            print(f"{consumer['consumer_id']}: {consumer['status']} — {consumer['path']}")
    else:
        print("No consumers registered.")
    return 0


def cmd_consumer_list(args: argparse.Namespace) -> int:
    registry = load_consumer_registry(resolve_registry_path(args.registry))
    consumers = list(registry["consumers"].values())
    if args.json:
        print(json.dumps(consumers, indent=2, sort_keys=True))
    elif consumers:
        for consumer in consumers:
            print(f"{consumer['consumer_id']}: {consumer.get('status', 'unknown')} — {consumer.get('path', '')}")
    else:
        print("No consumers registered.")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    source_root = get_distribution_root()
    registry_path = resolve_registry_path(args.registry)
    registry = audit_consumers(registry_path)
    consumers = list(registry["consumers"].values())
    reachable = [consumer for consumer in consumers if consumer.get("status") == "reachable"]
    skipped = [consumer for consumer in consumers if consumer.get("status") != "reachable"]
    if not reachable:
        print("No reachable consumers to update.")
        if skipped:
            print(f"Skipped {len(skipped)} non-reachable consumer(s).")
        return 0

    updated = 0
    for consumer in sorted(reachable, key=lambda item: str(item.get("consumer_id", ""))):
        target = Path(str(consumer["path"])).resolve()
        if target == source_root:
            print(f"- {consumer['consumer_id']}: source distribution; already current")
            continue
        actions = init_project(source_root=source_root, target_root=target, force_singletons=False, update_agents=False)
        updated += 1
        changed = sum(1 for action in actions if action.kind not in {"skip"})
        print(f"- {consumer['consumer_id']}: refreshed {changed} managed item(s); AGENTS.md preserved")
        if not args.skip_health:
            result = validate_root(target)
            print(f"  validation: {result.error_count()} error(s), {result.warning_count()} warning(s)")
    print(f"Updated {updated} consumer(s); skipped {len(skipped)} non-reachable consumer(s).")
    return 0


def cmd_migrate(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    actions, manual_items = plan_migration(root)
    if not actions and not manual_items:
        print(f"{root}: no migration actions needed")
        return 0

    header = "Applying deterministic migration actions" if args.apply else "Planned deterministic migration actions"
    print(f"{header} for {root}")
    for action in actions:
        print(f"- {action.kind}: {action.path}: {action.message}")
    if manual_items:
        print("Manual review required:")
        for item in manual_items:
            print(f"- {item.path}: {item.message}")

    if args.apply:
        for action in actions:
            if action.apply is not None:
                action.apply()
        print(f"Applied {len(actions)} action(s).")
        return 0

    print(f"Dry-run only. Re-run with --apply to execute {len(actions)} action(s).")
    return 0


def cmd_index_init(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    db_path = root / ".aimem" / "memory.db"
    if db_path.exists() and not args.force:
        print(f"{db_path} already exists")
        return 0
    ensure_db_schema(root, force=args.force)
    print(f"Initialized {db_path}")
    return 0


def cmd_index_status(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    status = get_index_status(root, result.artifacts)
    print_index_status(root, status)
    return 1 if status["state"] in {"invalid", "stale"} else 0


def cmd_index_build(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    if result.error_count():
        print_validation(result)
        print("Refusing to build index while validation errors exist.")
        return 1
    build_index(root, result.artifacts)
    print(f"Rebuilt {(root / '.aimem' / 'memory.db')}")
    return 0


def cmd_index_drop_empty(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    status = get_index_status(root, result.artifacts)
    db_path = root / ".aimem" / "memory.db"
    if status["state"] != "empty":
        print(f"Did not remove {db_path}: state is `{status['state']}`")
        return 0
    db_path.unlink()
    print(f"Removed empty index {db_path}")
    return 0


def cmd_recall(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    validation = validate_root(root)
    if validation.error_count():
        print_validation(validation)
        print("Refusing recall while validation errors exist.", file=sys.stderr)
        return 1
    if args.limit < 1 or args.max_tokens < 100:
        print("Recall requires --limit >= 1 and --max-tokens >= 100.", file=sys.stderr)
        return 2

    status = get_index_status(root, validation.artifacts)
    refreshed = False
    if status["state"] in {"absent", "empty", "stale"}:
        if args.no_refresh:
            print(f"Recall index is {status['state']}: {status['message']}", file=sys.stderr)
            return 1
        build_index(root, validation.artifacts)
        refreshed = True
        status = get_index_status(root, validation.artifacts)
    if status["state"] != "healthy":
        print(f"Recall index is {status['state']}: {status['message']}", file=sys.stderr)
        return 1

    results = recall(root, validation.artifacts, args.query, args.limit, args.max_tokens)
    if args.json:
        payload = {
            "query": args.query,
            "index_refreshed": refreshed,
            "budget_tokens": args.max_tokens,
            "estimated_tokens": estimate_recall_tokens(results),
            "results": [dataclasses.asdict(item) for item in results],
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0 if results else 1

    if not results:
        print(f"No relevant durable memory found for {args.query!r}. Widen or rephrase the query.")
        return 1
    refresh_note = "refreshed" if refreshed else "healthy"
    print(f"Recall for {args.query!r} (index {refresh_note}; budget ~{args.max_tokens} tokens)")
    print("Authority: present truth overrides older decisions and historical context.")
    for item in results:
        print(f"\n- [{item.role}] {item.artifact_id} > {item.heading}")
        print(f"  source: {item.path} | {item.status} | updated {item.updated_at or 'unknown'}")
        for note in recall_metadata_notes(item):
            print(f"  {note}")
        print(f"  {item.excerpt}")
        if item.related_files:
            print(f"  references: {', '.join(item.related_files)}")
    print(f"\nEstimated result size: ~{estimate_recall_tokens(results)} tokens")
    return 0


def cmd_verification_hash(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    path = (root / args.path).resolve()
    artifact = next((a for a in collect_artifacts(root, []) if a.path.resolve() == path), None)
    if artifact is None or artifact.frontmatter is None:
        print("Expected a durable artefact with parseable frontmatter.", file=sys.stderr)
        return 1
    print(verification_hash(artifact))
    return 0


def cmd_normalize_bodies(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    result = validate_root(root)
    changed = 0
    for artifact in result.artifacts:
        if artifact.frontmatter is None:
            continue
        source_body = artifact.body
        if args.from_git_head:
            git_body = read_git_head_body(root, artifact.rel_path)
            if git_body is not None:
                source_body = git_body
        source_artifact = dataclasses.replace(artifact, body=source_body)
        normalized_body = normalize_artifact_body(source_artifact)
        if normalized_body is None or normalized_body == artifact.body:
            continue
        rewrite_artifact_with_body(artifact, dict(artifact.values), normalized_body)
        changed += 1
        print(f"Normalized body: {artifact.rel_path}")
    print(f"Normalized {changed} artifact body/bodies in {root}")
    return 0


def cmd_normalize_one_from_git(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    artifact = resolve_artifact_path(root, args.artifact_path)
    if artifact.frontmatter is None:
        raise SystemExit(f"{artifact.rel_path}: missing valid frontmatter")
    git_body = read_git_head_body(root, args.git_path)
    if git_body is None:
        raise SystemExit(f"{args.git_path}: could not read body from git HEAD")
    source_artifact = dataclasses.replace(artifact, body=git_body)
    normalized_body = normalize_artifact_body(source_artifact)
    if normalized_body is None:
        raise SystemExit(f"{artifact.rel_path}: artifact type `{artifact.artifact_type}` is not supported for body normalization")
    rewrite_artifact_with_body(artifact, dict(artifact.values), normalized_body)
    print(f"Normalized body from git HEAD: {artifact.rel_path} <= {args.git_path}")
    return 0


def cmd_rename_session(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    new_id = args.new_id.strip()
    if not SESSION_ID_RE.match(new_id):
        raise SystemExit(f"{new_id}: expected a canonical session id like `session-YYYY-MM-DD-HHMM`")
    artifact = resolve_artifact_path(root, args.session_path, expected_type="session")
    if artifact.frontmatter is None:
        raise SystemExit(f"{artifact.rel_path}: missing valid frontmatter")

    values = dict(artifact.values)
    old_id = as_str(values.get("id"))
    values["id"] = new_id
    new_path = artifact.path.with_name(f"{new_id}.md")
    if new_path.exists() and new_path != artifact.path:
        raise SystemExit(f"{new_path}: target already exists")
    body = rewrite_session_heading(artifact.body, old_id, new_id)
    rewrite_artifact_with_body(artifact, values, body, new_path)
    print(f"Renamed {artifact.rel_path} -> {new_path.relative_to(root).as_posix()} with id `{new_id}`")
    return 0


def cmd_rename_decision(args: argparse.Namespace) -> int:
    root = resolve_root(args.root)
    new_id = args.new_id.strip()
    if not DECISION_ID_RE.match(new_id):
        raise SystemExit(f"{new_id}: expected a canonical decision id like `decision-001`")
    artifact = resolve_artifact_path(root, args.decision_path, expected_type="decision")
    if artifact.frontmatter is None:
        raise SystemExit(f"{artifact.rel_path}: missing valid frontmatter")

    old_id = as_str(artifact.values.get("id"))
    old_rel_path = artifact.rel_path
    values = dict(artifact.values)
    values["id"] = new_id
    new_path = artifact.path.with_name(f"{new_id}.md")
    if new_path.exists() and new_path != artifact.path:
        raise SystemExit(f"{new_path}: target already exists")
    body = rewrite_decision_heading(artifact.body, new_id)
    rewrite_artifact_with_body(artifact, values, body, new_path)
    update_related_references_after_decision_rename(root, old_id, new_id, old_rel_path, new_path.relative_to(root).as_posix())
    print(f"Renamed {old_rel_path} -> {new_path.relative_to(root).as_posix()} with id `{new_id}`")
    return 0


def resolve_root(root_arg: str) -> Path:
    root = Path(root_arg).expanduser().resolve()
    if not (root / ".aimem").exists():
        raise SystemExit(f"{root}: missing .aimem/")
    if not (root / ".aimem-spec").exists():
        raise SystemExit(f"{root}: missing .aimem-spec/")
    return root


def resolve_target_dir(target_arg: str) -> Path:
    target = Path(target_arg).expanduser()
    if not target.exists():
        raise SystemExit(f"{target}: target directory does not exist")
    if not target.is_dir():
        raise SystemExit(f"{target}: target is not a directory")
    return target.resolve()


def get_distribution_root() -> Path:
    script_path = Path(__file__).resolve()
    root = script_path.parent.parent
    required_paths = [
        root / ".aimem-spec" / "templates" / "current-state.md",
        root / ".aimem-spec" / "templates" / "next-steps.md",
        root / ".aimem-spec" / "templates" / "related-memory.md",
        root / ".aimem-spec" / "templates" / "capabilities.md",
        root / "AGENTS.md",
        root / "scripts" / "aimem.py",
    ]
    missing = [path for path in required_paths if not path.exists()]
    if missing:
        joined = ", ".join(str(path) for path in missing)
        raise SystemExit(f"{root}: cannot use as aimem distribution; missing {joined}")
    return root


def init_project(
    source_root: Path,
    target_root: Path,
    force_singletons: bool = False,
    update_agents: bool = False,
) -> list[Action]:
    actions: list[Action] = []

    ensure_directory(target_root / ".aimem", actions)
    for child in ["logs", "sessions", "decisions", "incidents", "observations"]:
        directory = target_root / ".aimem" / child
        ensure_directory(directory, actions)
        ensure_text_file(directory / ".gitkeep", "", actions)
    ensure_directory(target_root / ".aimem" / "capabilities", actions)

    copy_tree_files(source_root / ".aimem-spec", target_root / ".aimem-spec", actions)

    scripts_dir = target_root / "scripts"
    ensure_directory(scripts_dir, actions)
    copy_file_if_changed(source_root / "scripts" / "aimem.py", scripts_dir / "aimem.py", actions)

    agents_path = target_root / "AGENTS.md"
    if update_agents or not agents_path.exists():
        copy_file_if_changed(source_root / "AGENTS.md", agents_path, actions)
    else:
        actions.append(Action("skip", "AGENTS.md", "already exists; use --update-agents to overwrite"))

    templates_dir = target_root / ".aimem-spec" / "templates"
    copy_template_singleton(
        templates_dir / "current-state.md",
        target_root / ".aimem" / "current-state.md",
        force_singletons,
        actions,
    )
    copy_template_singleton(
        templates_dir / "next-steps.md",
        target_root / ".aimem" / "next-steps.md",
        force_singletons,
        actions,
    )
    copy_template_if_missing(
        templates_dir / "related-memory.md",
        target_root / RELATED_MEMORY_PATH,
        actions,
    )
    copy_template_if_missing(
        templates_dir / "capabilities.md",
        target_root / CAPABILITY_REPORT_PATH,
        actions,
    )

    result = validate_root(target_root)
    write_startup_digest(target_root, result)
    actions.append(Action("update-file", STARTUP_DIGEST_PATH, "refreshed derived startup digest"))

    return actions


def ensure_directory(path: Path, actions: list[Action]) -> None:
    if path.exists():
        if not path.is_dir():
            raise SystemExit(f"{path}: exists but is not a directory")
        return
    path.mkdir(parents=True, exist_ok=True)
    actions.append(Action("create-dir", path.as_posix(), "created directory"))


def ensure_text_file(path: Path, text: str, actions: list[Action]) -> None:
    if path.exists():
        if not path.is_file():
            raise SystemExit(f"{path}: exists but is not a file")
        return
    path.write_text(text, encoding="utf-8")
    actions.append(Action("create-file", path.as_posix(), "created file"))


def copy_file_if_changed(source: Path, target: Path, actions: list[Action]) -> None:
    if target.exists() and not target.is_file():
        raise SystemExit(f"{target}: exists but is not a file")
    if target.exists() and target.read_bytes() == source.read_bytes():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    existed = target.exists()
    shutil.copy2(source, target)
    action = "update-file" if existed else "create-file"
    message = "updated from aimem distribution" if existed else "created from aimem distribution"
    actions.append(Action(action, target.as_posix(), message))


def copy_tree_files(source_dir: Path, target_dir: Path, actions: list[Action]) -> None:
    for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
        rel_path = source.relative_to(source_dir)
        copy_file_if_changed(source, target_dir / rel_path, actions)


def copy_template_singleton(source: Path, target: Path, force: bool, actions: list[Action]) -> None:
    if not source.exists():
        raise SystemExit(f"{source}: required template is missing")
    if target.exists() and not force:
        actions.append(Action("skip", target.as_posix(), "already exists; use --force-singletons to overwrite"))
        return
    copy_file_if_changed(source, target, actions)


def copy_template_if_missing(source: Path, target: Path, actions: list[Action]) -> None:
    if not source.exists():
        raise SystemExit(f"{source}: required template is missing")
    if target.exists():
        actions.append(Action("skip", target.as_posix(), "already exists; preserved local runtime observations"))
        return
    copy_file_if_changed(source, target, actions)


def print_init_report(target_root: Path, actions: list[Action]) -> None:
    print(f"Initialized or refreshed aimem in {target_root}")
    if not actions:
        print("- no file changes needed")
        return
    for action in actions:
        try:
            path = Path(action.path)
            display_path = path.relative_to(target_root).as_posix() if path.is_absolute() else action.path
        except ValueError:
            display_path = action.path
        print(f"- {action.kind}: {display_path}: {action.message}")


def resolve_artifact_path(root: Path, raw_path: str, expected_type: str | None = None) -> Artifact:
    path = Path(raw_path)
    if not path.is_absolute():
        path = (root / raw_path).resolve()
    if not path.exists():
        raise SystemExit(f"{path}: file does not exist")
    rel_path = path.relative_to(root).as_posix()
    inferred_type = expected_type
    if inferred_type is None:
        if rel_path == ".aimem/current-state.md":
            inferred_type = "current-state"
        elif rel_path == ".aimem/next-steps.md":
            inferred_type = "next-steps"
        elif rel_path.startswith(".aimem/sessions/"):
            inferred_type = "session"
        elif rel_path.startswith(".aimem/decisions/"):
            inferred_type = "decision"
        elif rel_path.startswith(".aimem/incidents/"):
            inferred_type = "incident"
        else:
            raise SystemExit(f"{path}: cannot infer artifact type from path")
    return load_artifact(root, path, inferred_type, None)


def validate_root(root: Path) -> ValidationResult:
    issues: list[Issue] = []
    artifacts = collect_artifacts(root, issues)
    logs_dir = root / ".aimem" / "logs"
    log_paths = sorted(logs_dir.glob("*.log"))

    ids: dict[str, list[str]] = {}
    valid_ids: set[str] = set()
    for artifact in artifacts:
        fm = artifact.frontmatter
        if not fm:
            issues.append(
                Issue(
                    "warning",
                    "unindexed-artifact",
                    artifact.rel_path,
                    "artifact has no parseable frontmatter and is excluded from derived retrieval",
                )
            )
            continue
        values = fm.values
        artifact_id = as_str(values.get("id"))
        if artifact_id:
            ids.setdefault(artifact_id, []).append(artifact.rel_path)
            valid_ids.add(artifact_id)

        for key in REQUIRED_KEYS:
            if key not in values:
                issues.append(Issue("error", "missing-frontmatter-key", artifact.rel_path, f"missing required key `{key}`"))

        if artifact.artifact_type == "session" and "source_logs" not in values:
            issues.append(Issue("error", "missing-source-logs", artifact.rel_path, "session artifact is missing `source_logs`"))

        expected_type = artifact.artifact_type
        actual_type = as_str(values.get("type"))
        if actual_type and actual_type != expected_type:
            issues.append(
                Issue(
                    "error",
                    "type-mismatch",
                    artifact.rel_path,
                    f"`type` is `{actual_type}` but path requires `{expected_type}`",
                )
            )

        artifact_id = as_str(values.get("id"))
        if artifact.expected_id and artifact_id and artifact_id != artifact.expected_id:
            issues.append(
                Issue(
                    "error",
                    "id-mismatch",
                    artifact.rel_path,
                    f"`id` is `{artifact_id}` but expected `{artifact.expected_id}` for this path",
                )
            )

        check_template_sections(root, artifact, issues)
        check_source_logs(root, artifact, issues)
        check_hygiene_limits(artifact, issues)

    for artifact_id, paths in ids.items():
        if len(paths) > 1:
            joined = ", ".join(paths)
            for path in paths:
                issues.append(
                    Issue("error", "duplicate-id", path, f"`id` `{artifact_id}` is duplicated across: {joined}")
                )

    for artifact in artifacts:
        if not artifact.frontmatter:
            continue
        related_decisions = ensure_list(artifact.values.get("related_decisions"))
        related_incidents = ensure_list(artifact.values.get("related_incidents"))
        for rel_id in related_decisions + related_incidents:
            if rel_id and rel_id not in valid_ids:
                issues.append(
                    Issue(
                        "warning",
                        "unresolved-related-artifact",
                        artifact.rel_path,
                        f"related artifact `{rel_id}` does not resolve to a known durable artifact",
                    )
                )

    check_memory_metadata(artifacts, issues)

    for log_path in log_paths:
        if not LOG_FILE_RE.match(log_path.name):
            issues.append(
                Issue(
                    "error",
                    "bad-log-name",
                    log_path.relative_to(root).as_posix(),
                    "log file does not match `.aimem/logs/YYYYMMDD-NN.log`",
                )
            )

    footprint = get_startup_footprint(root)
    if footprint["standard_words"] > STARTUP_WORD_WARNING_THRESHOLD:
        issues.append(
            Issue(
                "warning",
                "large-startup-footprint",
                ".aimem",
                f"standard startup reads {footprint['standard_words']} words; refresh and read `.aimem/startup-digest.md` first",
            )
        )

    return ValidationResult(root=root, issues=issues, artifacts=artifacts, log_paths=log_paths)


VERIFICATION_KEYS = ("verified_by", "verified_at", "verified_content_sha256", "verification_evidence")


def verification_hash(artifact: Artifact) -> str:
    # Bookkeeping changes do not renew or invalidate a content review.
    excluded = set(VERIFICATION_KEYS) | {
        "id", "schema_version", "created_at", "updated_at", "updated_by", "owner", "review_after"
    }
    content = {
        "body": artifact.body.strip(),
        "metadata": {k: v for k, v in artifact.values.items() if k not in excluded and v not in ("", [])},
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def review_is_due(artifact: Artifact) -> bool:
    value = as_str(artifact.values.get("review_after"))
    try:
        return dt.date.fromisoformat(value) <= dt.datetime.now(dt.timezone.utc).date()
    except ValueError:
        return False


def verification_state(artifact: Artifact) -> str:
    values = artifact.values
    if not any(values.get(k) for k in VERIFICATION_KEYS):
        return "unverified"
    if not all(values.get(k) for k in VERIFICATION_KEYS):
        return "incomplete"
    return "recorded-current" if values["verified_content_sha256"] == verification_hash(artifact) else "stale"


def check_memory_metadata(artifacts: list[Artifact], issues: list[Issue]) -> None:
    by_id = {as_str(a.values.get("id")): a for a in artifacts if a.frontmatter}
    for artifact in artifacts:
        if not artifact.frontmatter:
            continue
        values = artifact.values

        def report(level: str, code: str, message: str) -> None:
            issues.append(Issue(level, code, artifact.rel_path, message))

        for key in ("superseded_by", "review_after", "verified_by", "verified_at", "verified_content_sha256"):
            if key in values and not isinstance(values[key], str):
                report("error", "invalid-memory-metadata", f"`{key}` must be a scalar string")
        target = as_str(values.get("superseded_by"))
        if target:
            replacement = by_id.get(target)
            if artifact.artifact_type != "decision" or not replacement or replacement.artifact_type != "decision":
                report("error", "invalid-supersession", "`superseded_by` must link a decision to an existing decision ID")
            if as_str(values.get("status")) != "superseded":
                report("error", "invalid-supersession-status", "a decision with `superseded_by` must have status `superseded`")
            seen = {as_str(values.get("id"))}
            cursor = target
            while cursor and cursor in by_id:
                if cursor in seen:
                    report("error", "supersession-cycle", "supersession links must not contain self-links or cycles")
                    break
                seen.add(cursor)
                cursor = as_str(by_id[cursor].values.get("superseded_by"))
        elif artifact.artifact_type == "decision" and values.get("status") == "superseded":
            report("warning", "missing-successor", "superseded decision has no replacement pointer; add `superseded_by` when known")

        review_after = as_str(values.get("review_after"))
        if review_after:
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", review_after):
                    raise ValueError
                dt.date.fromisoformat(review_after)
            except ValueError:
                report("error", "invalid-review-date", "`review_after` must be a real YYYY-MM-DD date")
            else:
                if review_is_due(artifact):
                    report("warning", "review-due", f"review due since {review_after}; recheck evidence, not an assertion that content is false")

        if any(values.get(k) for k in VERIFICATION_KEYS):
            if not all(values.get(k) for k in VERIFICATION_KEYS):
                report("error", "incomplete-verification", "verification requires verified_by, verified_at, verified_content_sha256 and verification_evidence")
            actor = as_str(values.get("verified_by"))
            if actor and not re.fullmatch(r"(?:human|agent|process):\S+", actor):
                report("error", "invalid-verifier", "`verified_by` must use human:<id>, agent:<id> or process:<id>")
            when = as_str(values.get("verified_at"))
            if when and parse_datetime(when) is None:
                report("error", "invalid-verification-date", "`verified_at` must be an ISO date or timestamp")
            digest = as_str(values.get("verified_content_sha256"))
            if digest and not re.fullmatch(r"[a-f0-9]{64}", digest):
                report("error", "invalid-verification-hash", "`verified_content_sha256` must be a lowercase SHA-256 hash")
            evidence = values.get("verification_evidence")
            if evidence and (not isinstance(evidence, list) or not all(isinstance(e, str) and e.strip() for e in evidence)):
                report("error", "invalid-verification-evidence", "`verification_evidence` must be a non-empty list of evidence references")
            if verification_state(artifact) == "stale":
                report("warning", "stale-verification", "recorded verification covers different content; recheck before claiming current verification")


def collect_artifacts(root: Path, issues: list[Issue]) -> list[Artifact]:
    aimem_dir = root / ".aimem"
    artifacts: list[Artifact] = []

    singleton_expectations = [
        ("current-state.md", "current-state", "current-state"),
        ("next-steps.md", "next-steps", "next-steps"),
    ]
    for file_name, artifact_type, expected_id in singleton_expectations:
        path = aimem_dir / file_name
        if not path.exists():
            issues.append(Issue("error", "missing-singleton", f".aimem/{file_name}", "required singleton file is missing"))
        else:
            artifacts.append(load_artifact(root, path, artifact_type, expected_id))

    related_memory_path = aimem_dir / "related-memory.md"
    if related_memory_path.exists():
        artifacts.append(load_artifact(root, related_memory_path, "related-memory", "related-memory"))

    for path in sorted((aimem_dir / "sessions").glob("*.md")):
        expected_id = path.stem if SESSION_FILE_RE.match(path.name) else None
        if not SESSION_FILE_RE.match(path.name):
            issues.append(
                Issue(
                    "error",
                    "bad-session-name",
                    path.relative_to(root).as_posix(),
                    "session file does not match `.aimem/sessions/session-YYYY-MM-DD-HHMM.md`",
                )
            )
        artifacts.append(load_artifact(root, path, "session", expected_id))

    for path in sorted((aimem_dir / "decisions").glob("*.md")):
        expected_id = path.stem if DECISION_FILE_RE.match(path.name) else None
        if not DECISION_FILE_RE.match(path.name):
            issues.append(
                Issue(
                    "error",
                    "bad-decision-name",
                    path.relative_to(root).as_posix(),
                    "decision file does not match `.aimem/decisions/decision-001.md`",
                )
            )
        artifacts.append(load_artifact(root, path, "decision", expected_id))

    for path in sorted((aimem_dir / "incidents").glob("*.md")):
        expected_id = f"incident-{path.stem}" if INCIDENT_FILE_RE.match(path.name) else None
        if not INCIDENT_FILE_RE.match(path.name):
            issues.append(
                Issue(
                    "error",
                    "bad-incident-name",
                    path.relative_to(root).as_posix(),
                    "incident file does not match `.aimem/incidents/YYYYMMDD-short-slug.md`",
                )
            )
        artifacts.append(load_artifact(root, path, "incident", expected_id))

    return artifacts


def load_artifact(root: Path, path: Path, artifact_type: str, expected_id: str | None) -> Artifact:
    text = path.read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(text)
    return Artifact(
        root=root,
        path=path,
        rel_path=path.relative_to(root).as_posix(),
        artifact_type=artifact_type,
        expected_id=expected_id,
        frontmatter=frontmatter,
        body=body,
        text=text,
    )


def parse_frontmatter(text: str) -> tuple[Frontmatter | None, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, text

    closing_index = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            closing_index = idx
            break
    if closing_index is None:
        return None, text

    fm_lines = lines[1:closing_index]
    values: dict[str, object] = {}
    key_order: list[str] = []
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        if not line.strip():
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        key_order.append(key)
        if raw_value:
            values[key] = parse_frontmatter_value(raw_value)
            i += 1
            continue

        block_items = []
        j = i + 1
        while j < len(fm_lines):
            candidate = fm_lines[j]
            if re.match(r"^\s*-\s+", candidate):
                block_items.append(re.sub(r"^\s*-\s+", "", candidate).strip())
                j += 1
                continue
            break
        if block_items:
            values[key] = block_items
            i = j
        else:
            values[key] = ""
            i += 1

    body = "\n".join(lines[closing_index + 1 :])
    if text.endswith("\n"):
        body += "\n"
    return Frontmatter(values=values, key_order=key_order), body


def parse_frontmatter_value(raw_value: str) -> object:
    raw_value = raw_value.strip()
    if raw_value == "[]":
        return []
    if raw_value.startswith("[") and raw_value.endswith("]"):
        inner = raw_value[1:-1].strip()
        if not inner:
            return []
        return [part.strip() for part in inner.split(",")]
    return raw_value


def render_frontmatter(frontmatter: Frontmatter) -> str:
    seen = set()
    ordered_keys = []
    for key in COMMON_FRONTMATTER_ORDER + frontmatter.key_order:
        if key in frontmatter.values and key not in seen:
            ordered_keys.append(key)
            seen.add(key)
    for key in frontmatter.values:
        if key not in seen:
            ordered_keys.append(key)
            seen.add(key)

    lines = ["---"]
    for key in ordered_keys:
        value = frontmatter.values[key]
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                for item in value:
                    lines.append(f"  - {item}")
        elif value == "":
            lines.append(f"{key}:")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def rewrite_artifact(artifact: Artifact, values: dict[str, object], new_path: Path | None = None) -> None:
    assert artifact.frontmatter is not None
    updated_frontmatter = Frontmatter(values=values, key_order=artifact.frontmatter.key_order)
    new_text = render_frontmatter(updated_frontmatter) + artifact.body.lstrip("\n")
    target_path = new_path or artifact.path
    target_path.write_text(new_text, encoding="utf-8")
    if new_path and new_path != artifact.path:
        artifact.path.unlink()


def rewrite_artifact_with_body(artifact: Artifact, values: dict[str, object], body: str, new_path: Path | None = None) -> None:
    assert artifact.frontmatter is not None
    updated_frontmatter = Frontmatter(values=values, key_order=artifact.frontmatter.key_order)
    normalized_body = body.lstrip("\n")
    target_path = new_path or artifact.path
    target_path.write_text(render_frontmatter(updated_frontmatter) + normalized_body, encoding="utf-8")
    if new_path and new_path != artifact.path:
        artifact.path.unlink()


def check_template_sections(root: Path, artifact: Artifact, issues: list[Issue]) -> None:
    if artifact.frontmatter is None:
        issues.append(Issue("error", "missing-frontmatter", artifact.rel_path, "missing valid frontmatter block"))
        return

    template_name = TYPE_TO_TEMPLATE.get(artifact.artifact_type)
    if not template_name:
        return
    template_path = root / ".aimem-spec" / "templates" / template_name
    if not template_path.exists():
        issues.append(
            Issue(
                "warning",
                "missing-template",
                template_path.relative_to(root).as_posix(),
                f"template for `{artifact.artifact_type}` artifact is missing",
            )
        )
        return
    template_text = template_path.read_text(encoding="utf-8")
    _, template_body = parse_frontmatter(template_text)
    expected_h1, expected_h2 = extract_headings(template_body)
    actual_h1, actual_h2 = extract_headings(artifact.body)

    if not actual_h1:
        issues.append(Issue("error", "missing-h1", artifact.rel_path, "missing first H1 heading"))
    elif expected_h1 and actual_h1 != expected_h1 and artifact.artifact_type in {"current-state", "next-steps"}:
        issues.append(
            Issue(
                "warning",
                "unexpected-h1",
                artifact.rel_path,
                f"first H1 heading is `{actual_h1}` but expected `{expected_h1}`",
            )
        )

    missing_sections = [heading for heading in expected_h2 if heading not in actual_h2]
    for heading in missing_sections:
        issues.append(
            Issue(
                "warning",
                "missing-section",
                artifact.rel_path,
                f"missing required section `## {heading}`",
            )
        )


def extract_headings(body: str) -> tuple[str | None, list[str]]:
    h1 = None
    h2: list[str] = []
    for line in body.splitlines():
        if line.startswith("# ") and h1 is None:
            h1 = line[2:].strip()
        elif line.startswith("## "):
            h2.append(line[3:].strip())
    return h1, h2


def parse_body_sections(body: str) -> tuple[str | None, str, list[tuple[str, str]]]:
    lines = body.splitlines()
    title: str | None = None
    preamble: list[str] = []
    sections: list[tuple[str, str]] = []
    current_heading: str | None = None
    current_lines: list[str] = []
    saw_title = False

    for line in lines:
        heading_match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading_match:
            heading_text = heading_match.group(2).strip()
            if not saw_title:
                title = heading_text
                saw_title = True
                continue
            if current_heading is not None:
                sections.append((current_heading, "\n".join(current_lines).rstrip() + ("\n" if current_lines else "")))
            current_heading = heading_text
            current_lines = []
            continue

        if not saw_title:
            continue
        if current_heading is None:
            preamble.append(line)
        else:
            current_lines.append(line)

    if saw_title and current_heading is not None:
        sections.append((current_heading, "\n".join(current_lines).rstrip() + ("\n" if current_lines else "")))

    preamble_text = "\n".join(preamble).rstrip()
    if preamble_text:
        preamble_text += "\n"
    return title, preamble_text, sections


def normalize_artifact_body(artifact: Artifact) -> str | None:
    if artifact.artifact_type == "current-state":
        return normalize_body_from_sections(
            artifact.body,
            title="Current State",
            order=[
                "Summary",
                "Active Problems",
                "Open Questions",
                "Known Risks",
                "Current Priorities",
                "Handoff Notes",
            ],
            heading_map={
                "summary": "Summary",
                "active problems": "Active Problems",
                "open questions": "Open Questions",
                "known risks": "Known Risks",
                "current priorities": "Current Priorities",
                "handoff notes": "Handoff Notes",
            },
            preamble_target="Summary",
        )
    if artifact.artifact_type == "next-steps":
        return normalize_body_from_sections(
            artifact.body,
            title="Next Steps",
            order=[
                "Immediate Next Actions",
                "Pending Decisions",
                "Blocked Or Waiting",
                "Later",
                "Notes",
            ],
            heading_map={
                "immediate next actions": "Immediate Next Actions",
                "pending decisions": "Pending Decisions",
                "blocked or waiting": "Blocked Or Waiting",
                "later": "Later",
                "notes": "Notes",
            },
            preamble_target="Immediate Next Actions",
        )
    if artifact.artifact_type == "session":
        session_id = as_str(artifact.values.get("id")).removeprefix("session-")
        return normalize_body_from_sections(
            artifact.body,
            title=f"Session {session_id}" if session_id else "Session",
            order=[
                "Summary",
                "Work Done",
                "Decisions Made",
                "Files Touched",
                "References",
                "Open Questions",
                "Next Actions",
                "Handoff Notes",
            ],
            heading_map={
                "summary": "Summary",
                "work done": "Work Done",
                "what was done": "Summary",
                "what happened": "Work Done",
                "changes applied": "Work Done",
                "modified files": "Files Touched",
                "new files": "Files Touched",
                "files touched": "Files Touched",
                "decisions": "Decisions Made",
                "key decisions": "Decisions Made",
                "decisions made": "Decisions Made",
                "references": "References",
                "open items": "Open Questions",
                "known gaps": "Open Questions",
                "open questions": "Open Questions",
                "next actions": "Next Actions",
                "handoff notes": "Handoff Notes",
                "outcome": "Summary",
                "root causes": "Handoff Notes",
            },
            preamble_target="Summary",
        )
    if artifact.artifact_type == "decision":
        return normalize_body_from_sections(
            artifact.body,
            title=f"Decision {as_str(artifact.values.get('id')).removeprefix('decision-') or '001'}",
            order=[
                "Summary",
                "Context",
                "Decision",
                "Rationale",
                "Alternatives Considered",
                "Consequences",
                "References",
            ],
            heading_map={
                "summary": "Summary",
                "context": "Context",
                "decision": "Decision",
                "rationale": "Rationale",
                "alternatives considered": "Alternatives Considered",
                "consequences": "Consequences",
                "references": "References",
            },
            preamble_target="Decision",
            copy_preamble_to="Summary",
        )
    return None


def normalize_body_from_sections(
    body: str,
    title: str,
    order: list[str],
    heading_map: dict[str, str],
    preamble_target: str | None = None,
    copy_preamble_to: str | None = None,
) -> str:
    old_title, preamble, sections = parse_body_sections(body)
    if old_title is None:
        return body

    collected: dict[str, list[str]] = {heading: [] for heading in order}
    extras: list[tuple[str, str]] = []

    if preamble.strip():
        if preamble_target:
            collected[preamble_target].append(preamble.strip())
        if copy_preamble_to and copy_preamble_to in collected and copy_preamble_to != preamble_target:
            collected[copy_preamble_to].append(preamble.strip())

    for heading, content in sections:
        canonical = heading_map.get(heading.strip().lower())
        if canonical:
            if content.strip():
                collected[canonical].append(content.strip())
        else:
            extras.append((heading.strip(), content.strip()))

    rendered_sections = [f"# {title}", ""]
    for canonical in order:
        rendered_sections.append(f"## {canonical}")
        rendered_sections.append("")
        content_blocks = [block for block in collected[canonical] if block]
        if content_blocks:
            rendered_sections.append("\n\n".join(content_blocks))
        else:
            rendered_sections.append("- None recorded.")
        rendered_sections.append("")

    if extras:
        rendered_sections.append("## Legacy Notes")
        rendered_sections.append("")
        for heading, content in extras:
            rendered_sections.append(f"### {heading}")
            rendered_sections.append("")
            rendered_sections.append(content if content else "- None recorded.")
            rendered_sections.append("")

    return "\n".join(rendered_sections).rstrip() + "\n"


def rewrite_session_heading(body: str, old_id: str, new_id: str) -> str:
    lines = body.splitlines()
    new_lines = []
    replaced = False
    old_suffix = old_id.removeprefix("session-") if old_id else ""
    new_suffix = new_id.removeprefix("session-")
    for line in lines:
        if not replaced and line.startswith("# "):
            heading = line[2:].strip()
            if heading == f"Session {old_suffix}" or heading == f"Session {old_id}" or heading == f"Session {old_suffix.removeprefix('session-')}":
                line = f"# Session {new_suffix}"
                replaced = True
        new_lines.append(line)
    return "\n".join(new_lines) + ("\n" if body.endswith("\n") else "")


def rewrite_decision_heading(body: str, new_id: str) -> str:
    lines = body.splitlines()
    new_lines = []
    replaced = False
    decision_number = new_id.removeprefix("decision-")
    for line in lines:
        if not replaced and line.startswith("# "):
            line = f"# Decision {decision_number}"
            replaced = True
        new_lines.append(line)
    return "\n".join(new_lines) + ("\n" if body.endswith("\n") else "")


def check_source_logs(root: Path, artifact: Artifact, issues: list[Issue]) -> None:
    if artifact.artifact_type != "session" or artifact.frontmatter is None:
        return

    source_logs = ensure_list(artifact.values.get("source_logs"))
    for source_log in source_logs:
        if not SOURCE_LOG_RE.match(source_log):
            issues.append(
                Issue(
                    "error",
                    "bad-source-log",
                    artifact.rel_path,
                    f"`source_logs` entry `{source_log}` must match `.aimem/logs/YYYYMMDD-NN.log`",
                )
            )
            continue
        if not (root / source_log).exists():
            issues.append(
                Issue(
                    "warning",
                    "missing-source-log-file",
                    artifact.rel_path,
                    f"`source_logs` entry `{source_log}` does not exist on disk",
                )
            )


def ensure_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [as_str(item) for item in value if as_str(item)]
    scalar = as_str(value)
    return [scalar] if scalar else []


def as_str(value: object | None) -> str:
    if value is None:
        return ""
    return str(value).strip()


def print_validation(result: ValidationResult) -> None:
    print(f"Validation for {result.root}")
    if not result.issues:
        print("OK: no issues found")
        return
    grouped = Counter(issue.level for issue in result.issues)
    print(f"Issues: {grouped.get('error', 0)} error(s), {grouped.get('warning', 0)} warning(s)")
    for issue in sorted(result.issues, key=lambda item: (item.level != "error", item.path, item.code)):
        print(f"- {issue.level.upper()} [{issue.code}] {issue.path}: {issue.message}")
        if issue.hint:
            print(f"  hint: {issue.hint}")


def print_health(root: Path, result: ValidationResult) -> None:
    current_state = next((artifact for artifact in result.artifacts if artifact.artifact_type == "current-state"), None)
    next_steps = next((artifact for artifact in result.artifacts if artifact.artifact_type == "next-steps"), None)
    session_count = sum(1 for artifact in result.artifacts if artifact.artifact_type == "session")
    durable_count = len(result.artifacts)
    status = get_index_status(root, result.artifacts)
    footprint = get_startup_footprint(root)

    print(f"Health for {root}")
    print(f"- validation: {result.error_count()} error(s), {result.warning_count()} warning(s)")
    print(f"- durable artifacts: {durable_count}")
    print(f"- sessions: {session_count}")
    print(f"- logs: {len(result.log_paths)}")
    print(f"- current-state updated_at: {get_updated_at(current_state)}")
    print(f"- next-steps updated_at: {get_updated_at(next_steps)}")
    print(f"- index: {status['state']}: {status['message']}")
    print(
        "- startup footprint: "
        f"{footprint['standard_words']} words (~{footprint['standard_tokens']} tokens) standard; "
        f"{footprint['digest_words']} words (~{footprint['digest_tokens']} tokens) with digest"
    )

    hygiene_items = get_hygiene_summary(current_state, next_steps)
    if hygiene_items:
        print("- memory hygiene warnings:")
        for item in hygiene_items:
            print(f"  - {item}")

    stale_items = []
    for label, artifact in [("current-state", current_state), ("next-steps", next_steps)]:
        stale_days = age_in_days(get_updated_at(artifact))
        if stale_days is not None and stale_days > 30:
            stale_items.append(f"{label} is {stale_days} day(s) old")
    if stale_items:
        print("- staleness warnings:")
        for item in stale_items:
            print(f"  - {item}")

    recommendation = get_index_recommendation(result.artifacts, status)
    if recommendation:
        print(f"- recommendation: {recommendation}")

    footprint_items = get_footprint_warnings(footprint)
    if footprint_items:
        print("- startup footprint warnings:")
        for item in footprint_items:
            print(f"  - {item}")

    review_issues = [issue for issue in result.issues if issue.code in {"review-due", "stale-verification"}]
    if review_issues:
        print("- reviews needing attention:")
        for issue in review_issues:
            print(f"  - {issue.path}: {issue.message}")

    if result.issues:
        print("- top issues:")
        for issue in sorted(result.issues, key=lambda item: (item.level != "error", item.path, item.code))[:10]:
            print(f"  - {issue.level.upper()} {issue.path}: {issue.message}")


def write_startup_digest(root: Path, result: ValidationResult) -> None:
    current_state = next((artifact for artifact in result.artifacts if artifact.artifact_type == "current-state"), None)
    next_steps = next((artifact for artifact in result.artifacts if artifact.artifact_type == "next-steps"), None)
    digest_path = root / STARTUP_DIGEST_PATH
    digest_path.parent.mkdir(parents=True, exist_ok=True)
    digest_path.write_text(render_startup_digest(root, current_state, next_steps, result), encoding="utf-8")


def render_startup_digest(
    root: Path,
    current_state: Artifact | None,
    next_steps: Artifact | None,
    result: ValidationResult,
) -> str:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    lines = [
        "# Startup Digest",
        "",
        f"_Generated: {now}_",
        "",
        "Derived startup summary. If it conflicts with source memory, trust `current-state.md` and `next-steps.md`.",
        "",
        "## Health",
        "",
        f"- Validation: {result.error_count()} error(s), {result.warning_count()} warning(s)",
        f"- Durable artifacts: {len(result.artifacts)}",
        f"- Sessions: {sum(1 for artifact in result.artifacts if artifact.artifact_type == 'session')}",
        f"- Logs: {len(result.log_paths)}",
    ]

    status = get_index_status(root, result.artifacts)
    lines.append(f"- Index: {status['state']}: {status['message']}")

    if current_state is not None:
        lines.extend(
            [
                "",
                "## Current State",
                "",
                *digest_items(current_state, ["Summary", "Active Problems", "Known Risks", "Current Priorities", "Handoff Notes"], limit=5),
            ]
        )

    if next_steps is not None:
        lines.extend(
            [
                "",
                "## Next Steps",
                "",
                *digest_items(next_steps, ["Immediate Next Actions", "Pending Decisions", "Blocked Or Waiting"], limit=5),
            ]
        )

    lines.extend(
        [
            "",
            "## Retrieval",
            "",
            "- Read full singleton/session/decision/incident files only when the task needs more context.",
        ]
    )

    text = "\n".join(lines).rstrip() + "\n"
    words = count_words(text)
    if words <= STARTUP_DIGEST_WORD_TARGET:
        return text

    trimmed = trim_digest_to_target(lines)
    return trimmed


def digest_items(artifact: Artifact, section_names: list[str], limit: int) -> list[str]:
    _, _, sections = parse_body_sections(artifact.body)
    by_name = {heading: body for heading, body in sections}
    items: list[str] = []

    for section_name in section_names:
        body = by_name.get(section_name, "")
        for item in extract_digest_lines(body):
            items.append(item)
            if len(items) >= limit:
                return items

    return items if items else ["- No digestible items found; read the source file if needed."]


def extract_digest_lines(body: str) -> list[str]:
    items: list[str] = []
    current: str | None = None
    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if line.startswith("- "):
            if current is not None:
                items.append(shorten_words(current, 28))
            current = line
            continue
        if current is not None and line.startswith("  - "):
            current = f"{current} {line.strip()}"
    if current is not None:
        items.append(shorten_words(current, 28))
    return items


def trim_digest_to_target(lines: list[str]) -> str:
    kept: list[str] = []
    for line in lines:
        if line.startswith("- ") and count_words("\n".join(kept + [line])) > STARTUP_DIGEST_WORD_TARGET:
            continue
        kept.append(line)
    return "\n".join(kept).rstrip() + "\n"


def shorten_words(text: str, limit: int) -> str:
    words = text.split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]).rstrip(".,;:") + "..."


def get_startup_footprint(root: Path) -> dict[str, int]:
    agents_words = count_words_path(root / "AGENTS.md")
    current_words = count_words_path(root / ".aimem" / "current-state.md")
    next_words = count_words_path(root / ".aimem" / "next-steps.md")
    digest_words = count_words_path(root / STARTUP_DIGEST_PATH)
    standard_words = agents_words + current_words + next_words
    digest_start_words = agents_words + digest_words if digest_words else standard_words
    return {
        "agents_words": agents_words,
        "current_words": current_words,
        "next_words": next_words,
        "digest_file_words": digest_words,
        "standard_words": standard_words,
        "digest_words": digest_start_words,
        "standard_tokens": estimate_tokens_from_words(standard_words),
        "digest_tokens": estimate_tokens_from_words(digest_start_words),
    }


def get_footprint_warnings(footprint: dict[str, int]) -> list[str]:
    items: list[str] = []
    if footprint["standard_words"] > STARTUP_WORD_WARNING_THRESHOLD:
        items.append(
            f"standard startup reads {footprint['standard_words']} words; prefer `.aimem/startup-digest.md` for routine startup"
        )
    if footprint["digest_file_words"] == 0:
        items.append("startup digest is missing; run `python3 scripts/aimem.py startup-digest`")
    return items


def count_words_path(path: Path) -> int:
    if not path.exists() or not path.is_file():
        return 0
    return count_words(path.read_text(encoding="utf-8"))


def count_words(text: str) -> int:
    return len(re.findall(r"\S+", text))


def estimate_tokens_from_words(words: int) -> int:
    return math.ceil(words * 4 / 3)


def get_updated_at(artifact: Artifact | None) -> str:
    if artifact is None or artifact.frontmatter is None:
        return "missing"
    return as_str(artifact.values.get("updated_at")) or "missing"


def age_in_days(value: str) -> int | None:
    if not value or value == "missing":
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return (dt.datetime.now(dt.timezone.utc) - parsed).days


def parse_datetime(value: str) -> dt.datetime | None:
    value = value.strip()
    if not value:
        return None
    candidates = [value]
    if value.endswith("Z"):
        candidates.append(value[:-1] + "+00:00")
    for candidate in candidates:
        try:
            parsed = dt.datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc)
        except ValueError:
            pass
    try:
        parsed_date = dt.date.fromisoformat(value)
        return dt.datetime.combine(parsed_date, dt.time.min, tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def recall(
    root: Path,
    artifacts: list[Artifact],
    query: str,
    limit: int = RECALL_DEFAULT_LIMIT,
    max_tokens: int = RECALL_DEFAULT_TOKEN_BUDGET,
) -> list[RecallResult]:
    tokens = recall_tokens(query)
    if not tokens:
        return []
    artifact_by_key = {
        as_str(artifact.values.get("id")): artifact
        for artifact in artifacts
        if artifact.frontmatter is not None
    }
    db_path = root / ".aimem" / "memory.db"
    fts_query = " OR ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT artifact_key, bm25(artifact_fts, 0.0, 5.0, 3.0, 1.0) AS rank
            FROM artifact_fts
            WHERE artifact_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, max(40, limit * 10)),
        ).fetchall()

    ranked_sections: list[RecallResult] = []
    added_successors: set[str] = set()
    for position, (artifact_key, _rank) in enumerate(rows):
        artifact = artifact_by_key.get(str(artifact_key))
        if artifact is None:
            continue
        matches = rank_artifact_sections(artifact, query, tokens, position)
        ranked_sections.extend(matches)
        # Follow only explicit successor chains, even when the replacement uses new vocabulary.
        successor = as_str(artifact.values.get("superseded_by"))
        seen = {str(artifact_key)}
        while successor and successor in artifact_by_key and successor not in seen:
            seen.add(successor)
            replacement = artifact_by_key[successor]
            if successor not in added_successors:
                ranked_sections.extend(rank_artifact_sections(replacement, query, tokens, position, linked=True)[:1])
                added_successors.add(successor)
            successor = as_str(replacement.values.get("superseded_by"))
    for item in ranked_sections:
        replacement = artifact_by_key.get(item.superseded_by)
        if replacement:
            item.replacement_path = replacement.rel_path
    ranked_sections.sort(key=lambda item: (-item.score, item.path, item.heading))
    return select_recall_results(ranked_sections, query, limit, max_tokens)


def recall_tokens(text: str) -> list[str]:
    raw = re.findall(r"[a-z0-9][a-z0-9_.#$-]*", text.lower())
    useful = [recall_stem(token) for token in raw if token not in RECALL_STOP_WORDS and len(token) > 1]
    source = useful or raw
    return list(dict.fromkeys(source))


def recall_stem(token: str) -> str:
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"
    for suffix in ("ing", "ed"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    if token.endswith("s") and not token.endswith("ss") and len(token) > 4:
        return token[:-1]
    return token


def split_markdown_sections(body: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = []
    heading = "Document"
    lines: list[str] = []
    for line in body.splitlines():
        match = re.match(r"^(#{2,4})\s+(.+?)\s*$", line)
        if match:
            if any(item.strip() for item in lines):
                sections.append((heading, lines))
            heading = match.group(2).strip()
            lines = []
            continue
        if line.startswith("# "):
            continue
        lines.append(line)
    if any(item.strip() for item in lines):
        sections.append((heading, lines))
    return [(name, "\n".join(content).strip()) for name, content in sections if "\n".join(content).strip()]


def rank_artifact_sections(
    artifact: Artifact,
    query: str,
    tokens: list[str],
    fts_position: int,
    linked: bool = False,
) -> list[RecallResult]:
    values = artifact.values
    artifact_id = as_str(values.get("id"))
    artifact_type = artifact.artifact_type
    updated_at = as_str(values.get("updated_at"))
    status = as_str(values.get("status"))
    role = "historical-context" if status in {"superseded", "deprecated"} else recall_role(artifact_type)
    type_score = {
        "current-state": 2.2,
        "decision": 1.8,
        "next-steps": 1.6,
        "incident": 1.3,
        "session": 0.4,
    }.get(artifact_type, 0.2)
    intent_score = recall_intent_boost(query, artifact_type)
    status_score = 0.2 if status in {"active", "accepted", "open", "complete"} else -0.5
    recency_score = recall_recency_score(updated_at, artifact_type)
    fts_score = 1.0 / (1.0 + fts_position * 0.15)
    related_files = ensure_list(values.get("related_files"))
    results: list[RecallResult] = []

    for heading, section_text in split_markdown_sections(artifact.body):
        searchable = f"{heading}\n{section_text}".lower()
        matched = [token for token in tokens if token in searchable]
        if not matched and not linked:
            continue
        coverage = len(set(matched)) / max(1, len(tokens))
        occurrences = sum(searchable.count(token) for token in set(matched))
        heading_hits = sum(1 for token in set(matched) if token in heading.lower())
        phrase_bonus = 1.0 if query.strip().lower() in searchable else 0.0
        section_bonus = 0.0
        if heading.lower() == "summary":
            section_bonus += 0.35
        if artifact_type == "decision" and heading.lower() in {"decision", "summary", "rationale"}:
            section_bonus += 0.45
        if artifact_type == "session" and heading.lower() in {"summary", "decisions made", "work done"}:
            section_bonus += 0.45
        if heading.lower() in {"files touched", "references"}:
            section_bonus -= 1.2
        score = (
            coverage * 5.0
            + min(math.log1p(occurrences), 1.5)
            + min(heading_hits * 0.5, 1.0)
            + phrase_bonus
            + section_bonus
            + type_score
            + intent_score
            + status_score
            + recency_score
            + fts_score
        )
        results.append(
            RecallResult(
                artifact_id=artifact_id,
                artifact_type=artifact_type,
                role=role,
                status=status,
                updated_at=updated_at,
                path=artifact.rel_path,
                heading=heading,
                excerpt=best_recall_excerpt(section_text, tokens, 760),
                score=round(score, 4),
                related_files=select_related_files(related_files, tokens, 2),
                superseded_by=as_str(values.get("superseded_by")),
                review_after=as_str(values.get("review_after")),
                review_due=review_is_due(artifact),
                verification=verification_state(artifact),
                verified_by=as_str(values.get("verified_by")),
                verified_at=as_str(values.get("verified_at")),
                verification_evidence=ensure_list(values.get("verification_evidence")),
            )
        )
    return results


def recall_role(artifact_type: str) -> str:
    return {
        "current-state": "present-truth",
        "next-steps": "planned-work",
        "decision": "accepted-decision",
        "incident": "incident-evidence",
        "session": "historical-context",
    }.get(artifact_type, "supporting-context")


def recall_intent_boost(query: str, artifact_type: str) -> float:
    words = set(re.findall(r"[a-z]+", query.lower()))
    boosts = {
        "decision": ({"why", "decision", "decide", "chosen", "rationale"}, 1.0),
        "current-state": ({"current", "currently", "now", "status", "today", "live"}, 1.0),
        "next-steps": ({"next", "todo", "plan", "planned", "pending", "blocked"}, 1.0),
        "incident": ({"incident", "failure", "failed", "bug", "security", "regression"}, 1.0),
        "session": ({"history", "historical", "happened", "session", "previously"}, 0.8),
    }
    trigger, value = boosts.get(artifact_type, (set(), 0.0))
    return value if words & trigger else 0.0


def recall_recency_score(updated_at: str, artifact_type: str) -> float:
    if artifact_type not in {"session", "incident"}:
        return 0.0
    parsed = parse_datetime(updated_at)
    if parsed is None:
        return 0.0
    days = max(0, (dt.datetime.now(dt.timezone.utc) - parsed).days)
    if days <= 30:
        return 0.6
    if days <= 90:
        return 0.35
    if days <= 365:
        return 0.15
    return 0.0


def best_recall_excerpt(text: str, tokens: list[str], max_chars: int) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= max_chars:
        return compact
    lower = compact.lower()
    positions = [lower.find(token) for token in tokens if lower.find(token) >= 0]
    centre = min(positions) if positions else 0
    start = max(0, centre - max_chars // 3)
    end = min(len(compact), start + max_chars)
    if end - start < max_chars:
        start = max(0, end - max_chars)
    if start:
        next_space = compact.find(" ", start)
        if next_space >= 0 and next_space < end:
            start = next_space + 1
    if end < len(compact):
        prior_space = compact.rfind(" ", start, end)
        if prior_space > start:
            end = prior_space
    return ("…" if start else "") + compact[start:end].strip() + ("…" if end < len(compact) else "")


def select_related_files(paths: list[str], tokens: list[str], limit: int) -> list[str]:
    matching = [path for path in paths if any(token in path.lower() for token in tokens)]
    return matching[:limit]


def select_recall_results(candidates: list[RecallResult], query: str, limit: int, max_tokens: int) -> list[RecallResult]:
    candidates = sorted(
        candidates,
        key=lambda item: (item.status in {"superseded", "deprecated"}, recall_type_priority(query, item.artifact_type), -item.score, item.path, item.heading),
    )
    selected: list[RecallResult] = []
    per_artifact: Counter[str] = Counter()
    per_type: Counter[str] = Counter()
    used_tokens = 55
    for candidate in candidates:
        artifact_cap = 2 if candidate.artifact_type in {"current-state", "next-steps"} else 1
        if per_artifact[candidate.artifact_id] >= artifact_cap:
            continue
        if candidate.artifact_type == "session" and per_type["session"] >= 2:
            continue
        if any(recall_text_overlap(candidate.excerpt, item.excerpt) > 0.72 for item in selected):
            continue
        overhead = recall_result_overhead(candidate)
        remaining = max_tokens - used_tokens - overhead
        if remaining < 45:
            continue
        excerpt = candidate.excerpt
        if estimate_tokens(excerpt) > remaining:
            excerpt = best_recall_excerpt(excerpt, recall_tokens(excerpt), remaining * 4)
        item = dataclasses.replace(candidate, excerpt=excerpt)
        item_tokens = overhead + estimate_tokens(excerpt)
        if used_tokens + item_tokens > max_tokens:
            continue
        selected.append(item)
        used_tokens += item_tokens
        per_artifact[item.artifact_id] += 1
        per_type[item.artifact_type] += 1
        if len(selected) >= limit:
            break
    return selected


def recall_type_priority(query: str, artifact_type: str) -> int:
    words = set(re.findall(r"[a-z]+", query.lower()))
    if words & {"history", "historical", "happened", "session", "previously"}:
        order = ["current-state", "session", "decision", "incident", "next-steps"]
    elif words & {"why", "decision", "decide", "chosen", "rationale"}:
        order = ["current-state", "decision", "session", "incident", "next-steps"]
    elif words & {"next", "todo", "plan", "planned", "pending", "blocked"}:
        order = ["next-steps", "current-state", "decision", "incident", "session"]
    elif words & {"current", "currently", "now", "status", "today", "live"}:
        order = ["current-state", "next-steps", "decision", "incident", "session"]
    else:
        order = ["current-state", "decision", "next-steps", "incident", "session"]
    try:
        return order.index(artifact_type)
    except ValueError:
        return len(order)


def recall_text_overlap(left: str, right: str) -> float:
    left_words = set(recall_tokens(left))
    right_words = set(recall_tokens(right))
    if not left_words or not right_words:
        return 0.0
    return len(left_words & right_words) / len(left_words | right_words)


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def recall_metadata_notes(item: RecallResult) -> list[str]:
    notes = []
    if item.superseded_by:
        notes.append(f"superseded by {item.superseded_by}: {item.replacement_path}")
    if item.review_after:
        notes.append(f"review {'due' if item.review_due else 'after'} {item.review_after}; due means recheck, not false")
    if item.verification != "unverified":
        notes.append(f"verification {item.verification}: {item.verified_by} at {item.verified_at}")
        notes.extend(f"verification evidence: {ref}" for ref in item.verification_evidence)
    return notes


def recall_result_overhead(item: RecallResult) -> int:
    return (45 + sum(estimate_tokens(path) for path in item.related_files)
            + sum(estimate_tokens(note) for note in recall_metadata_notes(item)))


def estimate_recall_tokens(results: list[RecallResult]) -> int:
    total = 55
    for item in results:
        total += recall_result_overhead(item) + estimate_tokens(item.excerpt)
    return total


def get_index_status(root: Path, artifacts: list[Artifact]) -> dict[str, object]:
    db_path = root / ".aimem" / "memory.db"
    if not db_path.exists():
        return {"state": "absent", "message": "index database is not present"}

    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            tables = {row[0] for row in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"artifacts", "artifact_fts"}.issubset(tables):
                return {"state": "invalid", "message": "database lacks required artifact or FTS tables"}
            rows = cursor.execute(
                """
                SELECT a.artifact_key, a.type, a.status, a.path, a.updated_at, f.body
                FROM artifacts a
                LEFT JOIN artifact_fts f ON f.rowid = a.id
                """
            ).fetchall()
    except sqlite3.Error as exc:
        return {"state": "invalid", "message": f"database could not be read: {exc}"}

    row_count = len(rows)
    indexable_artifacts = [artifact for artifact in artifacts if artifact.frontmatter is not None]
    durable_count = len(indexable_artifacts)
    if row_count == 0 and durable_count > 0:
        return {"state": "empty", "message": "database exists but no markdown artifacts have been indexed"}
    if row_count != durable_count:
        return {"state": "stale", "message": f"database has {row_count} indexed row(s) but {durable_count} durable artifact(s) exist"}
    indexed = {str(row[0]): row for row in rows}
    changed: list[str] = []
    for artifact in indexable_artifacts:
        artifact_key = as_str(artifact.values.get("id"))
        row = indexed.get(artifact_key)
        if row is None:
            changed.append(artifact.rel_path)
            continue
        if (
            str(row[1]) != artifact.artifact_type
            or str(row[2]) != as_str(artifact.values.get("status"))
            or str(row[3]) != artifact.rel_path
            or str(row[4] or "") != as_str(artifact.values.get("updated_at"))
            or str(row[5] or "") != artifact.body
        ):
            changed.append(artifact.rel_path)
    if changed:
        preview = ", ".join(changed[:3])
        suffix = f" and {len(changed) - 3} more" if len(changed) > 3 else ""
        return {"state": "stale", "message": f"indexed content differs from markdown for {preview}{suffix}"}
    excluded = len(artifacts) - durable_count
    suffix = f"; {excluded} artifact(s) without parseable frontmatter are excluded" if excluded else ""
    return {"state": "healthy", "message": f"database has {row_count} indexed artifact(s){suffix}"}


def get_index_recommendation(artifacts: list[Artifact], status: dict[str, object]) -> str | None:
    session_count = sum(1 for artifact in artifacts if artifact.artifact_type == "session")
    durable_count = len(artifacts)
    recommended = (
        session_count >= INDEX_RECOMMEND_SESSION_THRESHOLD
        or durable_count >= INDEX_RECOMMEND_ARTIFACT_THRESHOLD
    )

    state = status["state"]
    if state in {"empty", "stale"}:
        return "rebuild or remove the optional sqlite index so it stops drifting from markdown"
    if state == "absent" and recommended:
        return "indexing is now worth enabling; run `python3 scripts/aimem.py index-build`"
    if state == "healthy":
        return None
    if state == "absent":
        return "indexing is not necessary yet"
    if state == "invalid":
        return "delete and rebuild the optional sqlite index from markdown"
    return None


def check_hygiene_limits(artifact: Artifact, issues: list[Issue]) -> None:
    if artifact.artifact_type not in {"current-state", "next-steps"}:
        return

    line_count = count_lines(artifact)
    if line_count > SINGLETON_LINE_WARNING_THRESHOLD:
        issues.append(
            Issue(
                "warning",
                "large-singleton",
                artifact.rel_path,
                f"singleton has {line_count} lines; keep live memory compact and move operational detail to canonical project data",
            )
        )

    if artifact.artifact_type == "next-steps":
        action_count = count_next_step_actions(artifact)
        if action_count > NEXT_STEPS_ACTION_WARNING_THRESHOLD:
            issues.append(
                Issue(
                    "warning",
                    "too-many-actions",
                    artifact.rel_path,
                    f"next-steps has {action_count} action entries; group routine operational follow-ups and keep details in their canonical tracker",
                )
            )


def get_hygiene_summary(current_state: Artifact | None, next_steps: Artifact | None) -> list[str]:
    items: list[str] = []
    for label, artifact in [("current-state", current_state), ("next-steps", next_steps)]:
        if artifact is None:
            continue
        line_count = count_lines(artifact)
        if line_count > SINGLETON_LINE_WARNING_THRESHOLD:
            items.append(f"{label} has {line_count} lines; consider compaction")

    if next_steps is not None:
        action_count = count_next_step_actions(next_steps)
        if action_count > NEXT_STEPS_ACTION_WARNING_THRESHOLD:
            items.append(f"next-steps has {action_count} action entries; group tracker-owned work")

    return items


def count_lines(artifact: Artifact) -> int:
    return len(artifact.path.read_text(encoding="utf-8").splitlines())


def count_next_step_actions(artifact: Artifact) -> int:
    text = artifact.path.read_text(encoding="utf-8")
    return len(re.findall(r"(?m)^- Action:", text))


def plan_migration(root: Path) -> tuple[list[Action], list[Issue]]:
    issues: list[Issue] = []
    artifacts = collect_artifacts(root, issues)
    actions: list[Action] = []
    manual_items: list[Issue] = []

    log_renames: dict[str, str] = {}
    for log_path in sorted((root / ".aimem" / "logs").glob("*.log")):
        match = LEGACY_LOG_FILE_RE.match(log_path.name)
        if not match:
            continue
        target_name = f"{match.group(1)}-01.log"
        target_path = log_path.with_name(target_name)
        if target_path.exists():
            manual_items.append(
                Issue("warning", "manual-log-rename", log_path.relative_to(root).as_posix(), f"cannot rename to `{target_name}` because it already exists")
            )
            continue
        log_renames[log_path.relative_to(root).as_posix()] = target_path.relative_to(root).as_posix()
        actions.append(
            Action(
                "rename-log",
                log_path.relative_to(root).as_posix(),
                f"rename to {target_path.relative_to(root).as_posix()}",
                apply=lambda src=log_path, dst=target_path: src.rename(dst),
            )
        )

    for artifact in artifacts:
        if artifact.frontmatter is None:
            manual_items.append(Issue("warning", "manual-frontmatter", artifact.rel_path, "missing or malformed frontmatter requires manual repair"))
            continue

        values = dict(artifact.values)
        changed = False

        if artifact.artifact_type == "session" and as_str(values.get("type")) == "session-summary":
            values["type"] = "session"
            changed = True

        for key in REQUIRED_KEYS:
            if key in values:
                continue
            if key == "schema_version":
                values[key] = "1"
            elif key == "status":
                values[key] = STATUS_DEFAULTS[artifact.artifact_type]
            elif key == "updated_at":
                values[key] = as_str(values.get("created_at"))
            else:
                values[key] = ""
            changed = True

        if artifact.artifact_type == "session" and "source_logs" not in values:
            values["source_logs"] = []
            changed = True

        normalized_source_logs = normalize_source_logs(values.get("source_logs"), log_renames)
        if normalized_source_logs is not None and normalized_source_logs != values.get("source_logs"):
            values["source_logs"] = normalized_source_logs
            changed = True

        normalized_related_decisions = normalize_related_ids(root, values.get("related_decisions"))
        if normalized_related_decisions is not None and normalized_related_decisions != values.get("related_decisions"):
            values["related_decisions"] = normalized_related_decisions
            changed = True

        normalized_related_incidents = normalize_related_ids(root, values.get("related_incidents"))
        if normalized_related_incidents is not None and normalized_related_incidents != values.get("related_incidents"):
            values["related_incidents"] = normalized_related_incidents
            changed = True

        new_path = get_migration_target_path(artifact, values, manual_items)
        if changed or new_path is not None:
            action_message_parts = []
            if changed:
                action_message_parts.append("normalize frontmatter")
            if new_path is not None:
                action_message_parts.append(f"rename to {new_path.relative_to(root).as_posix()}")
            actions.append(
                Action(
                    "rewrite-artifact",
                    artifact.rel_path,
                    "; ".join(action_message_parts),
                    apply=lambda art=artifact, vals=values, dst=new_path: rewrite_artifact(art, vals, dst),
                )
            )

    return actions, manual_items


def normalize_source_logs(value: object, log_renames: dict[str, str]) -> list[str] | None:
    if value is None:
        return None
    items = ensure_list(value)
    normalized = []
    changed = False
    for item in items:
        original = item
        item = item.strip()
        item = item.strip("[]")
        item = item.strip()
        if "/.aimem/logs/" in item:
            item = item[item.index("/.aimem/logs/") + 1 :]
        elif item.startswith("logs/"):
            item = ".aimem/" + item
        elif re.match(r"^\d{8}-\d{2}\.log$", item):
            item = ".aimem/logs/" + item
        elif LEGACY_LOG_FILE_RE.match(item):
            item = ".aimem/logs/" + LEGACY_LOG_FILE_RE.sub(r"\1-01.log", item)
        elif item.startswith(".aimem/logs/") and LEGACY_LOG_FILE_RE.match(Path(item).name):
            item = ".aimem/logs/" + LEGACY_LOG_FILE_RE.sub(r"\1-01.log", Path(item).name)
        if item in log_renames:
            item = log_renames[item]
        normalized.append(item)
        if item != original:
            changed = True
    return normalized if changed else items


def get_migration_target_path(artifact: Artifact, values: dict[str, object], manual_items: list[Issue]) -> Path | None:
    root = artifact.root
    artifact_id = as_str(values.get("id"))
    current_path = artifact.path
    if artifact.artifact_type == "session":
        if SESSION_ID_RE.match(artifact_id):
            target_path = current_path.with_name(f"{artifact_id}.md")
            if target_path != current_path:
                if target_path.exists():
                    manual_items.append(
                        Issue("warning", "manual-session-target", artifact.rel_path, f"cannot rename because `{target_path.name}` already exists")
                    )
                    return None
                return target_path
        elif SESSION_BARE_ID_RE.match(artifact_id):
            values["id"] = f"session-{artifact_id}"
            target_path = current_path.with_name(f"session-{artifact_id}.md")
            if target_path.exists():
                manual_items.append(
                    Issue("warning", "manual-session-target", artifact.rel_path, f"cannot rename because `{target_path.name}` already exists")
                )
                return None
            return target_path
        elif not SESSION_FILE_RE.match(current_path.name):
            manual_items.append(
                Issue(
                    "warning",
                    "manual-session-name",
                    artifact.rel_path,
                    "legacy session file lacks a canonical timestamped id; choose a `session-YYYY-MM-DD-HHMM` id manually",
                )
            )
    elif artifact.artifact_type == "decision":
        if DECISION_ID_RE.match(artifact_id):
            target_path = current_path.with_name(f"{artifact_id}.md")
            if target_path != current_path:
                if target_path.exists():
                    manual_items.append(
                        Issue("warning", "manual-decision-target", artifact.rel_path, f"cannot rename because `{target_path.name}` already exists")
                    )
                    return None
                return target_path
        elif not DECISION_FILE_RE.match(current_path.name):
            manual_items.append(
                Issue(
                    "warning",
                    "manual-decision-name",
                    artifact.rel_path,
                    "legacy decision ids should be migrated to `decision-NNN` manually to avoid breaking references unexpectedly",
                )
            )
    elif artifact.artifact_type == "incident":
        if INCIDENT_ID_RE.match(artifact_id):
            target_path = current_path.with_name(f"{artifact_id.removeprefix('incident-')}.md")
            if target_path != current_path:
                if target_path.exists():
                    manual_items.append(
                        Issue("warning", "manual-incident-target", artifact.rel_path, f"cannot rename because `{target_path.name}` already exists")
                    )
                    return None
                return target_path
        elif not INCIDENT_FILE_RE.match(current_path.name):
            manual_items.append(
                Issue(
                    "warning",
                    "manual-incident-name",
                    artifact.rel_path,
                    "legacy incident ids should be migrated to `incident-YYYYMMDD-slug` manually",
                )
            )
    else:
        _ = root
    return None


def normalize_related_ids(root: Path, value: object) -> list[str] | None:
    if value is None:
        return None
    items = ensure_list(value)
    normalized = []
    changed = False
    for item in items:
        candidate = item
        candidate_path = None
        if candidate.startswith("/"):
            candidate_path = Path(candidate)
        elif candidate.endswith(".md"):
            candidate_path = root / candidate
        if candidate_path and candidate_path.exists():
            frontmatter, _ = parse_frontmatter(candidate_path.read_text(encoding="utf-8"))
            if frontmatter is not None and as_str(frontmatter.values.get("id")):
                candidate = as_str(frontmatter.values.get("id"))
        normalized.append(candidate)
        if candidate != item:
            changed = True
    return normalized if changed else items


def update_related_references_after_decision_rename(
    root: Path,
    old_id: str,
    new_id: str,
    old_rel_path: str,
    new_rel_path: str,
) -> None:
    result = validate_root(root)
    old_abs_path = str((root / old_rel_path).resolve())
    new_abs_path = str((root / new_rel_path).resolve())
    for artifact in result.artifacts:
        if artifact.frontmatter is None or artifact.artifact_type == "decision" and artifact.rel_path == new_rel_path:
            continue
        values = dict(artifact.values)
        changed = False
        if values.get("superseded_by") == old_id:
            values["superseded_by"] = new_id
            changed = True
        for key in ("related_decisions", "related_incidents"):
            if key not in values:
                continue
            items = ensure_list(values.get(key))
            updated_items = []
            local_change = False
            for item in items:
                if item in {old_id, old_rel_path, old_abs_path}:
                    updated_items.append(new_id)
                    local_change = True
                else:
                    updated_items.append(item)
            if local_change:
                values[key] = updated_items
                changed = True
        if changed:
            rewrite_artifact(artifact, values)


def read_git_head_body(root: Path, rel_path: str) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "show", f"HEAD:{rel_path}"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    _, body = parse_frontmatter(proc.stdout)
    return body


def ensure_db_schema(root: Path, force: bool = False) -> Path:
    db_path = root / ".aimem" / "memory.db"
    if db_path.exists() and force:
        db_path.unlink()
    schema_sql = (root / ".aimem-spec" / "templates" / "schema_v1.sql").read_text(encoding="utf-8")
    conn = sqlite3.connect(db_path)
    conn.executescript(schema_sql)
    conn.commit()
    conn.close()
    return db_path


def build_index(root: Path, artifacts: list[Artifact]) -> None:
    db_path = ensure_db_schema(root, force=False)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    cursor = conn.cursor()
    cursor.execute("DELETE FROM artifact_tags")
    cursor.execute("DELETE FROM artifact_links")
    cursor.execute("DELETE FROM artifact_file_refs")
    cursor.execute("DELETE FROM artifact_external_refs")
    cursor.execute("DELETE FROM artifact_fts")
    cursor.execute("DELETE FROM artifacts")

    rows_by_key: dict[str, int] = {}
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    pending_links: list[tuple[str, list[str], list[str]]] = []

    for artifact in artifacts:
        if artifact.frontmatter is None:
            continue
        values = artifact.values
        artifact_key = as_str(values.get("id"))
        title, _ = extract_headings(artifact.body)
        summary = extract_summary(artifact.body)
        cursor.execute(
            """
            INSERT INTO artifacts (
                artifact_key, type, schema_version, status, path, owner, updated_by,
                created_at, updated_at, last_indexed_at, title, summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_key,
                as_str(values.get("type")),
                int(as_str(values.get("schema_version")) or "1"),
                as_str(values.get("status")),
                artifact.rel_path,
                as_str(values.get("owner")),
                as_str(values.get("updated_by")),
                as_str(values.get("created_at")),
                as_str(values.get("updated_at")),
                now,
                title or "",
                summary,
            ),
        )
        artifact_row_id = cursor.lastrowid
        rows_by_key[artifact_key] = artifact_row_id

        for tag in dict.fromkeys(ensure_list(values.get("tags"))):
            cursor.execute(
                "INSERT INTO artifact_tags (artifact_id, tag) VALUES (?, ?)",
                (artifact_row_id, tag),
            )
        for file_ref in dict.fromkeys(ensure_list(values.get("related_files"))):
            cursor.execute(
                "INSERT INTO artifact_file_refs (artifact_id, file_path) VALUES (?, ?)",
                (artifact_row_id, file_ref),
            )
        for ref_type, ref_value in dict.fromkeys(extract_external_refs(artifact.body)):
            cursor.execute(
                "INSERT INTO artifact_external_refs (artifact_id, ref_type, ref_value) VALUES (?, ?, ?)",
                (artifact_row_id, ref_type, ref_value),
            )
        cursor.execute(
            "INSERT INTO artifact_fts (rowid, artifact_key, title, summary, body) VALUES (?, ?, ?, ?, ?)",
            (artifact_row_id, artifact_key, title or "", summary, artifact.body),
        )
        pending_links.append(
            (
                artifact_key,
                ensure_list(values.get("related_decisions")),
                ensure_list(values.get("related_incidents")),
            )
        )

    for source_key, decision_ids, incident_ids in pending_links:
        source_row_id = rows_by_key.get(source_key)
        if source_row_id is None:
            continue
        for target_key in decision_ids:
            target_row_id = rows_by_key.get(target_key)
            if target_row_id is not None:
                cursor.execute(
                    "INSERT OR IGNORE INTO artifact_links (source_artifact_id, target_artifact_id, link_type) VALUES (?, ?, ?)",
                    (source_row_id, target_row_id, "related_decision"),
                )
        for target_key in incident_ids:
            target_row_id = rows_by_key.get(target_key)
            if target_row_id is not None:
                cursor.execute(
                    "INSERT OR IGNORE INTO artifact_links (source_artifact_id, target_artifact_id, link_type) VALUES (?, ?, ?)",
                    (source_row_id, target_row_id, "related_incident"),
                )

    conn.commit()
    conn.close()


def extract_summary(body: str) -> str:
    lines = body.splitlines()
    capture = False
    collected = []
    for line in lines:
        if line.startswith("## Summary"):
            capture = True
            continue
        if capture and line.startswith("## "):
            break
        if capture and line.strip():
            collected.append(line.strip("- ").strip())
    if collected:
        return " ".join(collected)[:500]
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped[:500]
    return ""


def extract_external_refs(body: str) -> Iterable[tuple[str, str]]:
    lines = body.splitlines()
    capture = False
    for line in lines:
        if line.startswith("## References"):
            capture = True
            continue
        if capture and line.startswith("## "):
            break
        if not capture:
            continue
        match = re.match(r"^-\s*([A-Za-z ]+):\s*(.*)$", line.strip())
        if not match:
            continue
        ref_type = match.group(1).strip().lower().replace(" ", "_")
        ref_value = match.group(2).strip()
        if ref_value:
            yield ref_type, ref_value


def print_index_status(root: Path, status: dict[str, object]) -> None:
    print(f"Index status for {root}")
    print(f"- state: {status['state']}")
    print(f"- message: {status['message']}")


if __name__ == "__main__":
    sys.exit(main())
