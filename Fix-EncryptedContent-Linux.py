#!/usr/bin/env python3
"""
Fix-EncryptedContent v4 session-locator — Linux + DiveeOI (opencode fork).
Rescues sessions poisoned by stale reasoning signatures.

Usage:
  python3 Fix-EncryptedContent-Linux.py
  python3 Fix-EncryptedContent-Linux.py --dir /home/aboood/.local/share/opencode
  python3 Fix-EncryptedContent-Linux.py --bin diveeoi --no-pause

Safety: timestamped backup of DB + storage first. Nothing deleted.
Stdlib only. Quit the target app (TUI + workers) before running.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime

APP = "Fix-EncryptedContent v4 session-locator (Linux + DiveeOI)"

SIG_KEY_RE = re.compile(r"signature|encrypted|item_?id|reasoning.?encrypted", re.IGNORECASE)
THINK_TYPES = {"reasoning", "thinking", "redacted_thinking", "reasoning_content"}
META_KEYS = {"metadata", "providermetadata", "provideroptions"}
KEEP_KEYS = {"id", "messageid", "message_id", "sessionid", "session_id",
             "callid", "call_id", "toolcallid", "tool_call_id", "text",
             "thinking", "time", "type", "tool", "input", "output"}
PREFILTER_WORDS = ("reasoning", "thinking", "redacted", "signature",
                   "encrypted_content", "encryptedcontent", "providermetadata")

FILE_STORE_SUBDIRS = (
    os.path.join("storage", "part"),
    os.path.join("storage", "parts"),
    os.path.join("storage", "message"),
    os.path.join("storage", "messages"),
    os.path.join("storage", "session"),
    os.path.join("storage", "sessions"),
    "parts", "messages", "sessions", "session",
)

LOG_LINES = []


def log(msg=""):
    print(msg, flush=True)
    LOG_LINES.append(msg)


def pause_exit():
    try:
        if sys.stdin.isatty():
            input("  Press ENTER to close... ")
    except (EOFError, KeyboardInterrupt):
        pass


def run_quiet(cmd, timeout=20):
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return proc.stdout.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def candidate_data_dirs(extra_names=()):
    home = os.path.expanduser("~")
    names = ["opencode"] + ["diveeoi"] + [n for n in extra_names if n and n.lower() not in ("opencode", "diveeoi")]
    dirs = []
    xdg = os.environ.get("XDG_DATA_HOME", "")
    if xdg:
        for n in names:
            dirs.append(os.path.join(xdg, n))
    for n in names:
        dirs.append(os.path.join(home, ".local", "share", n))
    for n in names:
        dirs.append(os.path.join(home, "." + n))
    for env in ("LOCALAPPDATA", "APPDATA"):
        base = os.environ.get(env, "")
        if base:
            for n in names:
                dirs.append(os.path.join(base, n))
    seen, out = set(), []
    for c in dirs:
        c = os.path.normpath(c)
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def resolve_bin(name):
    return shutil.which(name)


DB_NAME_PATTERNS = ("opencode-dev.db", "opencode.db", "opencode-local.db", "opencode-main.db")


def _find_db_in_dir(d):
    for pat in DB_NAME_PATTERNS:
        p = os.path.join(d, pat)
        if os.path.isfile(p):
            return p, pat
    # Fallback: any opencode*.db
    try:
        for entry in os.listdir(d):
            if entry.endswith(".db") and entry.startswith("opencode"):
                return os.path.join(d, entry), entry
    except Exception:
        pass
    return None, None


def true_data_dir(bin_name="opencode", forced_dir=None):
    if forced_dir:
        d = os.path.normpath(os.path.expandvars(os.path.expanduser(forced_dir.strip('" '))))
        db_path, db_name = _find_db_in_dir(d)
        if db_path:
            return d, "explicit-dir(db:%s)" % db_name
        if os.path.isdir(d):
            return d, "explicit-dir(stores)"
        log("  [ERROR] not a usable data dir: %s" % forced_dir)
        return None, "none"
    exe = resolve_bin(bin_name)
    extra = [bin_name.lower()] if bin_name.lower() not in ("opencode", "diveeoi") else []
    if exe:
        log("  CLI command: %s" % exe)
        out = run_quiet([exe, "db", "path"])
        if out:
            first = out.splitlines()[0].strip().strip('"').strip("'")
            if os.path.isfile(first):
                log("  CLI reports DB: %s" % first)
                return os.path.dirname(first), "cli"
            if os.path.isdir(first):
                db_path, db_name = _find_db_in_dir(first)
                if db_path:
                    log("  CLI reports dir with DB %s: %s" % (db_name, first))
                    return first, "cli"
            log("  (`%s db path` gave unusable: %.100s)" % (bin_name, out))
        else:
            log("  (`%s db path` gave no output - fork may not support it)" % bin_name)
    else:
        log("  (command `%s` not on PATH - searching known locations)" % bin_name)
    for d in candidate_data_dirs(extra):
        db_path, db_name = _find_db_in_dir(d)
        if db_path:
            log("  Found DB by search: %s (%s)" % (db_path, db_name))
            return d, "search"
    # Direct diveeoi fallback
    for d in candidate_data_dirs(["diveeoi"]):
        db_path, db_name = _find_db_in_dir(d)
        if db_path:
            log("  Found DiveeOI DB by search: %s (%s)" % (db_path, db_name))
            return d, "search-diveeoi"
    return None, "none"


def session_store_roots(extra_dir=None):
    roots = []
    for d in candidate_data_dirs():
        if os.path.isdir(d):
            roots.append(d)
    if extra_dir:
        extra_dir = os.path.normpath(os.path.expandvars(os.path.expanduser(extra_dir.strip('" '))))
        if os.path.isdir(extra_dir) and extra_dir not in roots:
            roots.append(extra_dir)
    return roots


def iter_session_files(roots):
    seen = set()
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            low = os.path.basename(dirpath).lower()
            if low in ("cache", "cacheddata", "gpu-cache", "dawncache",
                       "blob_storage", "node_modules", "logs", "crashpad", "snapshot"):
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d.lower() != "node_modules"]
            for name in filenames:
                ln = name.lower()
                keep = (ln.startswith("opencode") and ln.endswith(".db"))
                # Also .db-wal / .db-shm sidecars (backup handles, not edit)
                keep |= ln.endswith(".db-wal") or ln.endswith(".db-shm") or ln.endswith(".db-journal")
                keep |= ln.endswith(".dat") or ln.endswith(".vscdb")
                keep |= (ln.endswith(".json") and ("ses_" in ln or "session" in ln))
                keep |= ln.endswith(".jsonl")
                if not keep:
                    continue
                p = os.path.join(dirpath, name)
                if p in seen:
                    continue
                seen.add(p)
                try:
                    if os.path.getsize(p) > 300 * 1024 * 1024:
                        continue
                except Exception:
                    continue
                # Skip WAL/SHM from iteration for clean processing; backup handles them
                if ln.endswith("-wal") or ln.endswith("-shm") or ln.endswith("-journal"):
                    continue
                yield p


def locate_session(ses_id, roots):
    needle = ses_id.encode("utf-8", errors="replace")
    found, scanned = [], 0
    for path in iter_session_files(roots):
        scanned += 1
        try:
            with open(path, "rb") as fh:
                tail = b""
                while True:
                    chunk = fh.read(1 << 20)
                    if not chunk:
                        break
                    if needle in tail + chunk:
                        found.append(path)
                        break
                    tail = (tail + chunk)[-256:]
        except Exception:
            continue
    return found, scanned


def backup_db_file(db_path, ts):
    dest = db_path + "-rescue-backup-" + ts
    os.makedirs(dest, exist_ok=True)
    copied = []
    for suffix in ("", "-wal", "-shm", "-journal"):
        src = db_path + suffix
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, os.path.basename(src)))
            copied.append(os.path.basename(src))
    return dest, copied


def locate_and_fix(ses_id, extra_dir=None):
    if not ses_id:
        log("  No session id given - nothing to do.")
        return 1
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    roots = session_store_roots(extra_dir)
    log("  Searching %d store location(s) for %s ..." % (len(roots), ses_id))
    for r in roots:
        log("    - %s" % r)
    found, scanned = locate_session(ses_id, roots)
    log("  Scanned %d file(s)." % scanned)
    if not found:
        log("  NOT FOUND in any local store. The session may live server-side")
        log("  (synced/cloud session) - paste this log to your assistant.")
        return 1
    log("  Session lives in:")
    for f in found:
        log("    - %s" % f)
    log("")
    for f in found:
        fl = f.lower()
        if fl.endswith(".db") or fl.endswith(".vscdb"):
            dest, copied = backup_db_file(f, ts)
            log("  Backup -> %s (%s)" % (dest, ", ".join(copied)))
            try:
                st = sanitize_db(f)
            except sqlite3.OperationalError as exc:
                log("  [ERROR] database is locked (%s). Close the app, re-run." % exc)
                return 1
            log("  rows updated: %d, carriers fixed: %d" % (
                st["rows_updated"], st["carriers_scrubbed"]))
            if st["residue"]:
                log("  LEFTOVER keys (paste to your assistant):")
                for r in st["residue"][:20]:
                    log("    - %s" % r)
            if st["rows_updated"] == 0 and not st["residue"]:
                log("  (no poison shapes in this store - history here is clean)")
        elif fl.endswith(".json") or fl.endswith(".jsonl"):
            dest, copied = backup_db_file(f, ts)
            log("  Backup -> %s" % dest)
            res = scrub_json_file(f)
            log("  file fixed: %s" % bool(isinstance(res, tuple) and res[0]))
        else:
            log("  %s : binary app-internal format - cannot safely edit." % f)
            log("  Paste this path to your assistant for the manual step.")
    return 0


def target_running(exe_names):
    """Linux best-effort check for running CLI / worker processes."""
    running = []
    # Try pgrep first (fast, available on most distros)
    for name in exe_names:
        try:
            proc = subprocess.run(
                ["pgrep", "-i", "-f", name],
                capture_output=True, timeout=10
            )
            if proc.returncode == 0 and proc.stdout.strip():
                running.append(name)
                continue
        except Exception:
            pass
        # Fallback to ps + grep
        try:
            out = subprocess.run(
                ["ps", "aux"],
                capture_output=True, text=True, timeout=10
            ).stdout.lower() or ""
            low_name = name.lower()
            if low_name + "." in out or (low_name in out and ("opencode" in out or "diveeoi" in out)):
                # More precise: check if any line contains the binary name and is not our own python
                for line in out.splitlines():
                    if low_name in line and "python" not in line and "grep" not in line:
                        running.append(name)
                        break
        except Exception:
            pass
    # Deduplicate
    return list(dict.fromkeys(running))


def scrub_sig_tree(node):
    changed = False
    if isinstance(node, dict):
        for key in list(node.keys()):
            if SIG_KEY_RE.search(key) and key.lower() not in KEEP_KEYS:
                del node[key]
                changed = True
            elif scrub_sig_tree(node[key]):
                changed = True
    elif isinstance(node, list):
        for item in node:
            if scrub_sig_tree(item):
                changed = True
    return changed


def scrub_node(node):
    changed = False
    if isinstance(node, dict):
        ntype = str(node.get("type", "")).lower()
        if ntype in THINK_TYPES:
            for key in list(node.keys()):
                if key.lower() in META_KEYS and isinstance(node[key], dict):
                    if scrub_sig_tree(node[key]):
                        changed = True
                    if not node[key]:
                        del node[key]
                        changed = True
            for key in list(node.keys()):
                if (key.lower() not in KEEP_KEYS and key.lower() not in META_KEYS
                        and SIG_KEY_RE.search(key)):
                    del node[key]
                    changed = True
        else:
            for key in list(node.keys()):
                val = node[key]
                if key.lower() in META_KEYS and isinstance(val, dict):
                    if scrub_sig_tree(val):
                        changed = True
                    if not val:
                        del node[key]
                        changed = True
                elif scrub_node(val):
                    changed = True
    elif isinstance(node, list):
        for item in node:
            if scrub_node(item):
                changed = True
    return changed


def find_residue(node, hits, path=""):
    if isinstance(node, dict):
        ntype = str(node.get("type", "")).lower()
        in_carrier = ntype in THINK_TYPES
        for key, val in node.items():
            kl = key.lower()
            if (SIG_KEY_RE.search(key) and kl not in KEEP_KEYS
                    and (in_carrier or kl in META_KEYS or isinstance(val, (dict, list)))):
                preview = json.dumps(val, ensure_ascii=False)[:80]
                if len(json.dumps(val, ensure_ascii=False)) > 80:
                    preview += "..."
                hits.append("%s.%s = %s" % (path or "$", key, preview))
            find_residue(val, hits, "%s.%s" % (path or "$", key))
    elif isinstance(node, list):
        for i, item in enumerate(node[:50]):
            find_residue(item, hits, "%s[%d]" % (path or "$", i))


def has_prefilter(text):
    low = text.lower()
    return any(w in low for w in PREFILTER_WORDS)


def collect_session_ids(node, acc):
    if isinstance(node, dict):
        for key in ("sessionID", "session_id", "sessionId"):
            val = node.get(key)
            if isinstance(val, str) and val:
                acc.add(val)
        for value in node.values():
            collect_session_ids(value, acc)
    elif isinstance(node, list):
        for item in node:
            collect_session_ids(item, acc)


def backup_data_dir(datadir, ts):
    # Discover actual DB file in dir for naming
    db_path, db_name = _find_db_in_dir(datadir)
    dest = datadir + "-rescue-backup-" + ts
    os.makedirs(dest, exist_ok=True)
    copied = []
    if db_path:
        for suffix in ("", "-wal", "-shm", "-journal"):
            src = db_path + suffix
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(dest, os.path.basename(src)))
                copied.append(os.path.basename(src))
    # Also copy known fixed names in case of multi-DB env
    for name in ("opencode.db", "opencode.db-wal", "opencode.db-shm",
                 "opencode.db-journal", "auth.json"):
        src = os.path.join(datadir, name)
        if os.path.isfile(src):
            dst = os.path.join(dest, name)
            if not os.path.exists(dst):
                shutil.copy2(src, dst)
                copied.append(name)
    src = os.path.join(datadir, "storage")
    if os.path.isdir(src):
        shutil.copytree(src, os.path.join(dest, "storage"),
                        ignore=shutil.ignore_patterns("snapshot"), dirs_exist_ok=True)
        copied.append("storage/ (without snapshot/)")
    return dest, copied


def list_tables(con):
    return [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def sanitize_db(db_path):
    stats = {"tables_scanned": 0, "cells_scanned": 0, "rows_updated": 0,
             "carriers_scrubbed": 0, "sessions": set(), "skipped": [],
             "residue": []}
    con = sqlite3.connect(db_path, timeout=60)
    try:
        log("  Tables: %s" % ", ".join(list_tables(con)))
        for table in list_tables(con):
            try:
                cols = [(r[1], (r[2] or "").upper()) for r in
                        con.execute('PRAGMA table_info("%s")' % table.replace('"', '""'))]
            except Exception as exc:
                stats["skipped"].append("%s (pragma: %s)" % (table, exc))
                continue
            text_cols = [c for c, t in cols if ("CHAR" in t or "TEXT" in t
                                                or "CLOB" in t or "JSON" in t or t == "")]
            if not text_cols:
                continue
            try:
                sql = (con.execute("SELECT sql FROM sqlite_master WHERE name=?",
                                   (table,)).fetchone()[0] or "").upper()
            except Exception:
                sql = ""
            has_rowid = "WITHOUT ROWID" not in sql
            stats["tables_scanned"] += 1
            likes = []
            for c in text_cols:
                q = '"%s"' % c.replace('"', '""')
                likes.append("%s LIKE '%%reasoning%%'" % q)
                likes.append("%s LIKE '%%thinking%%'" % q)
                likes.append("%s LIKE '%%signature%%'" % q)
                likes.append("%s LIKE '%%encrypted%%'" % q)
            sel = (["rowid"] if has_rowid else []) + ['"%s"' % c.replace('"', '""')
                                                      for c in text_cols]
            try:
                cur = con.execute('SELECT %s FROM "%s" WHERE %s' % (
                    ", ".join(sel), table.replace('"', '""'), " OR ".join(likes)))
            except Exception as exc:
                stats["skipped"].append("%s (scan: %s)" % (table, exc))
                continue
            for row in cur.fetchall():
                for idx, col in enumerate(text_cols, start=1 if has_rowid else 0):
                    val = row[idx]
                    if not isinstance(val, str) or not has_prefilter(val):
                        continue
                    stats["cells_scanned"] += 1
                    try:
                        doc = json.loads(val)
                    except Exception:
                        continue
                    before = json.dumps(doc, sort_keys=True)
                    carriers = sum(before.count('"%s"' % t) for t in
                                   ('"type": "reasoning"', '"type": "thinking"',
                                    '"type": "redacted_thinking"'))
                    if not scrub_node(doc):
                        continue
                    if has_rowid:
                        con.execute('UPDATE "%s" SET "%s"=? WHERE rowid=?' % (
                            table.replace('"', '""'), col.replace('"', '""')),
                            (json.dumps(doc, ensure_ascii=False), row[0]))
                        stats["rows_updated"] += 1
                    stats["carriers_scrubbed"] += carriers
                    collect_session_ids(doc, stats["sessions"])
        con.commit()
        for table in list_tables(con):
            try:
                cols = [r[1] for r in con.execute(
                    'PRAGMA table_info("%s")' % table.replace('"', '""'))]
            except Exception:
                continue
            if not cols:
                continue
            likes = []
            for c in cols:
                q = '"%s"' % c.replace('"', '""')
                likes.append("%s LIKE '%%signature%%'" % q)
                likes.append("%s LIKE '%%encrypted_content%%'" % q)
            try:
                cur = con.execute('SELECT rowid, %s FROM "%s" WHERE %s LIMIT 20' % (
                    ", ".join('"%s"' % c.replace('"', '""') for c in cols),
                    table.replace('"', '""'), " OR ".join(likes)))
            except Exception:
                continue
            for row in cur.fetchall():
                for val in row[1:]:
                    if not isinstance(val, str) or not has_prefilter(val):
                        continue
                    try:
                        doc = json.loads(val)
                    except Exception:
                        continue
                    hits = []
                    find_residue(doc, hits)
                    for h in hits[:5]:
                        stats["residue"].append("%s rowid=%s :: %s" % (table, row[0], h))
        try:
            con.execute("PRAGMA integrity_check")
        except Exception:
            pass
        if stats["rows_updated"]:
            try:
                con.execute("VACUUM")
            except Exception:
                pass
    finally:
        con.close()
    return stats


def scrub_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except Exception:
        return False
    if not has_prefilter(text):
        return False
    if path.endswith(".jsonl"):
        lines = text.splitlines()
        changed_any = False
        out = []
        for line in lines:
            if not line.strip():
                out.append(line)
                continue
            try:
                doc = json.loads(line)
            except Exception:
                out.append(line)
                continue
            if scrub_node(doc):
                changed_any = True
                out.append(json.dumps(doc, ensure_ascii=False))
            else:
                out.append(line)
        if not changed_any:
            return False
        sessions = set()
        for line in out:
            try:
                collect_session_ids(json.loads(line), sessions)
            except Exception:
                pass
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out) + ("\n" if text.endswith("\n") else ""))
        return (True, sessions)
    try:
        doc = json.loads(text)
    except Exception:
        return False
    if not scrub_node(doc):
        return False
    sessions = set()
    collect_session_ids(doc, sessions)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
    return (True, sessions)


def sanitize_file_stores(datadir):
    stats = {"files_scanned": 0, "files_updated": 0, "sessions": set()}
    for sub in FILE_STORE_SUBDIRS:
        root = os.path.join(datadir, sub)
        if not os.path.isdir(root):
            continue
        for dirpath, _d, filenames in os.walk(root):
            for name in filenames:
                if not (name.endswith(".json") or name.endswith(".jsonl")):
                    continue
                stats["files_scanned"] += 1
                res = scrub_json_file(os.path.join(dirpath, name))
                if isinstance(res, tuple) and res[0]:
                    stats["files_updated"] += 1
                    stats["sessions"] |= res[1]
    return stats


def ask_menu():
    print("  What are we fixing today?")
    print("    [1] opencode / DiveeOI sessions  (STABLE)")
    print("    [2] Bosun workers                 (UNSTABLE)")
    try:
        choice = input("  Choice [1/2, Enter=1]: ").strip() or "1"
    except (EOFError, KeyboardInterrupt):
        return ("opencode", None)
    if choice == "2":
        return ("__bosun__", None)
    print("")
    print("  Target store:")
    print("    [1] Auto-detect (opencode / diveeoi)")
    print("    [2] Data folder directly")
    print("    [3] Find session id then fix")
    try:
        sub = input("  Choice [1/2/3, Enter=1]: ").strip() or "1"
    except (EOFError, KeyboardInterrupt):
        return ("opencode", None)
    if sub == "3":
        try:
            sid = input("  Session id (e.g. ses_...): ").strip()
        except (EOFError, KeyboardInterrupt):
            sid = ""
        return ("__locate__", sid or None)
    if sub == "2":
        try:
            folder = input("  Data folder path: ").strip()
        except (EOFError, KeyboardInterrupt):
            folder = ""
        return ("opencode", folder or None)
    return ("opencode", None)


def bosun_flow():
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log("=" * 70)
    log("  OPTION 2: Bosun workers  (UNSTABLE)")
    log("=" * 70)
    log("  Notes: workers share stock store; fresh runs have no history.")
    running = target_running(["opencode", "bosun", "diveeoi"])
    if running:
        log("  [!] Running: %s - close TUI/workers first (DB may lock)." % ", ".join(running))
        try:
            input("      Press ENTER once closed (Ctrl+C to abort)... ")
        except KeyboardInterrupt:
            log("Aborted - nothing was changed.")
            return 1
        log("")
    datadir, how = true_data_dir("opencode")
    if not datadir:
        log("  [ERROR] shared store not found - nothing to scrub.")
    else:
        log("  Shared store (%s): %s" % (how, datadir))
        dest, copied = backup_data_dir(datadir, ts)
        log("  Backup -> %s" % dest)
        db_path, _ = _find_db_in_dir(datadir)
        if db_path and os.path.isfile(db_path):
            try:
                st = sanitize_db(db_path)
            except sqlite3.OperationalError as exc:
                log("  [ERROR] database is locked (%s). Close apps, re-run." % exc)
                return 1
            log("  rows updated: %d, carriers fixed: %d" % (
                st["rows_updated"], st["carriers_scrubbed"]))
        fst = sanitize_file_stores(datadir)
        log("  files updated: %d" % fst["files_updated"])
    log("")
    log("  VERIFY (2 minutes, decides the case): re-delegate one trivial task.")
    return 0


def main():
    ap = argparse.ArgumentParser(prog="Fix-EncryptedContent-Linux.py")
    ap.add_argument("--bin", default=None,
                    help="CLI command of the install to repair (opencode/diveeoi)")
    ap.add_argument("--dir", default=None,
                    help="Data directory to repair directly")
    ap.add_argument("--find-session", default=None,
                    help="Locate which local store owns a session id, then fix it")
    ap.add_argument("--bosun", action="store_true",
                    help="Bosun worker path (UNSTABLE)")
    ap.add_argument("--no-pause", action="store_true",
                    help="Do not wait for ENTER at the end (terminal use)")
    args = ap.parse_args()

    no_pause = args.no_pause
    if args.find_session:
        code = locate_and_fix(args.find_session, args.dir)
        if not no_pause:
            pause_exit()
        try:
            # Linux log path: ~/Desktop if exists, else ~
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            log_dir = desktop if os.path.isdir(desktop) else os.path.expanduser("~")
            log_path = os.path.join(log_dir,
                                    "Fix-EncryptedContent-LOG-%s.txt" % datetime.now().strftime("%Y%m%d-%H%M%S"))
            with open(log_path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(LOG_LINES))
            print("\n  Log saved: %s" % log_path)
        except Exception:
            pass
        return code

    if args.bin is None and args.dir is None:
        if sys.stdin.isatty():
            args.bin, args.dir = ask_menu()
            if args.dir is None and args.bin is None:
                args.bin = "opencode"
        else:
            args.bin = "opencode"

    if args.bin == "__locate__":
        code = locate_and_fix(args.dir)
        if not no_pause:
            pause_exit()
        return code

    if args.bosun or args.bin == "__bosun__":
        code = bosun_flow()
        try:
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            log_dir = desktop if os.path.isdir(desktop) else os.path.expanduser("~")
            log_path = os.path.join(log_dir,
                                    "Fix-EncryptedContent-LOG-%s.txt" % datetime.now().strftime("%Y%m%d-%H%M%S"))
            with open(log_path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(LOG_LINES))
            print("")
            print("  Log saved: %s" % log_path)
        except Exception:
            pass
        if not no_pause:
            pause_exit()
        return code

    if args.bin is None:
        args.bin = "opencode"

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log("=" * 70)
    log("  %s  (%s)" % (APP, ts))
    log("  Target: %s" % (("folder " + args.dir) if args.dir else ("command `" + args.bin + "`")))
    log("=" * 70)
    log("")

    watch = [w for w in ((["opencode", args.bin] if not args.dir else [args.bin])) if w]
    running = target_running(dict.fromkeys([w.lower() for w in watch]))
    if running:
        log("  [!] These look RUNNING: %s" % ", ".join(running))
        log("      Close the app and any workers first - the DB may be locked")
        log("      and new poison can be written mid-fix.")
        log("")
        try:
            input("      Press ENTER once closed (Ctrl+C to abort)... ")
        except KeyboardInterrupt:
            log("Aborted - nothing was changed.")
            return 1
        log("")

    datadir, how = true_data_dir(args.bin, args.dir)
    if not datadir:
        log("  [ERROR] No session database found.")
        if not args.dir:
            log("  For DiveeOI, try: --dir /home/aboood/.local/share/opencode")
            log("  Or: --bin diveeoi")
        return 1
    log("  Using data dir (%s): %s" % (how, datadir))
    log("")

    dest, copied = backup_data_dir(datadir, ts)
    log("  Backup -> %s" % dest)
    log("  Backed up: %s" % (", ".join(copied) if copied else "(no DB/storage found?)"))
    log("")

    # Discover actual DB file for processing
    db_path, db_name = _find_db_in_dir(datadir)
    if not db_path:
        log("  [ERROR] No .db file found in %s" % datadir)
        return 1
    log("  DB file (%s): %s" % (db_name, db_path))
    log("")

    sessions = set()
    total_rows = total_files = total_carriers = 0
    residue = []

    if db_path and os.path.isfile(db_path):
        log("  Scanning session database (%s)..." % db_name)
        try:
            st = sanitize_db(db_path)
        except sqlite3.OperationalError as exc:
            log("  [ERROR] database is locked (%s)." % exc)
            log("  Close the app fully and run again. Backup kept at:")
            log("    %s" % dest)
            return 1
        log("    tables scanned : %d" % st["tables_scanned"])
        log("    rows updated   : %d" % st["rows_updated"])
        log("    carriers fixed : %d" % st["carriers_scrubbed"])
        for s in st["skipped"]:
            log("    skipped: %s" % s)
        total_rows = st["rows_updated"]
        total_carriers = st["carriers_scrubbed"]
        sessions |= st["sessions"]
        residue = st["residue"]
        log("")

    log("  Scanning file-based session stores (.json/.jsonl)...")
    fst = sanitize_file_stores(datadir)
    log("    files updated  : %d" % fst["files_updated"])
    total_files = fst["files_updated"]
    sessions |= fst["sessions"]
    log("")

    log("=" * 70)
    if total_rows == 0 and total_files == 0:
        log("  No stale signatures found for this target - its sessions are clean.")
    else:
        log("  FIXED: %d DB row(s) + %d file(s), %d carriers scrubbed." % (
            total_rows, total_files, total_carriers))
        if sessions:
            log("  Sessions touched (%d):" % len(sessions))
            for s in sorted(sessions)[:25]:
                log("    - %s" % s)
        log("")
        log("  Kept verbatim: messages, thinking TEXT, tool calls + results,")
        log("  file edits, todos. Only stale encrypted blobs were removed.")
    if residue:
        log("")
        log("  LEFTOVER suspicious keys (paste these to your assistant):")
        for r in residue[:20]:
            log("    - %s" % r)
    log("")
    log("  Backup: %s" % dest)
    log("  Next: restart DiveeOI / opencode, resume old session.")
    log("  Repeat for each install (stock + modified forks) - separate stores.")
    log("=" * 70)

    try:
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        log_dir = desktop if os.path.isdir(desktop) else os.path.expanduser("~")
        log_path = os.path.join(log_dir,
                                "Fix-EncryptedContent-LOG-%s.txt" % ts)
        with open(log_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(LOG_LINES))
        log("")
        log("  Log saved: %s" % log_path)
    except Exception:
        pass

    if not no_pause:
        pause_exit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
