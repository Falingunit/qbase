#!/usr/bin/env python3
"""
PYQ Scraper — fast, friendly CLI for downloading GetMarks chapterwise PQs.

Improvements in this version:
- Aggressive parallel fan-out for exams/subjects/chapters fetch + icon downloads
- Parallel question fetch + asset localization across chapters (bounded by workers)
- Single-writer DB (threads do HTTP+files; main thread commits) for safety
- One --out-dir for both DB and pyqs_assets (or PYQS_OUT_DIR env)
"""

from __future__ import annotations

import os
import re
import sys
import json
import time
import signal
import hashlib
import sqlite3
import mimetypes
import argparse
import threading
from typing import Iterable, Callable, Any, Tuple, List, Dict, Optional
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- Optional niceties (no hard dependency) ---
try:
    from tqdm import tqdm  # type: ignore
except Exception:
    tqdm = None  # Fallback to plain prints if missing

# ---------- Configuration & Paths (now dynamic) ----------

GETMARKS_BEARER = os.environ.get(
    "GETMARKS_AUTH_TOKEN",
    # NOTE: Keep ability to override via env var
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2OTkxNzVmNjcwMTY3ODUwOTBiZGI0ZiIsImlhdCI6MTc2MDE4ODAyOCwiZXhwIjoxNzYyNzgwMDI4fQ.v7tZWhoru3bC6c4H8RjtaGdkHm4luZQWvQ1kivF1Jl0",
)
HEADERS = {"Authorization": f"Bearer {GETMARKS_BEARER}"}

BASE = {
    "dashboard": "https://web.getmarks.app/api/v3/dashboard/platform/web",
    "exam_subjects": lambda exam_id: f"https://web.getmarks.app/api/v4/cpyqb/exam/{exam_id}",
    "subject_chapters": lambda exam_id, subject_id: f"https://web.getmarks.app/api/v4/cpyqb/exam/{exam_id}/subject/{subject_id}",
    "chapter_icon_src": lambda icon_name: f"https://web.getmarks.app/icons/exam/{icon_name}",
    "questions": lambda exam_id, subject_id, chapter_id: (
        f"https://web.getmarks.app/api/v4/cpyqb/exam/{exam_id}/subject/{subject_id}/chapter/{chapter_id}/questions"
    ),
}

# dynamic paths bound at runtime via set_output_root()
OUTPUT_ROOT = None  # type: Optional[str]
ASSETS_ROOT = None  # type: Optional[str]
DB_PATH = None      # type: Optional[str]

def set_output_root(out_dir: str):
    global OUTPUT_ROOT, ASSETS_ROOT, DB_PATH
    OUTPUT_ROOT = os.path.abspath(out_dir)
    ASSETS_ROOT = os.path.join(OUTPUT_ROOT, "pyqs_assets")
    DB_PATH = os.path.join(OUTPUT_ROOT, "pyqs_local.sqlite")

# Defaults if caller doesn't pass --out-dir
_default_out = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "backend")
)
set_output_root(os.environ.get("PYQS_OUT_DIR", _default_out))

# ---------- FS & networking ----------

def ensure_dirs():
    assert ASSETS_ROOT and DB_PATH, "Output paths not initialized"
    os.makedirs(ASSETS_ROOT, exist_ok=True)
    os.makedirs(os.path.join(ASSETS_ROOT, "icons", "exams"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS_ROOT, "icons", "subjects"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS_ROOT, "icons", "chapters"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS_ROOT, "images"), exist_ok=True)
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_session(max_retries: int = 3, backoff: float = 0.3, timeout: float = 30.0, pool_size: int = 128) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=max_retries,
        read=max_retries,
        connect=max_retries,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD"),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=pool_size, pool_maxsize=pool_size)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    s.headers.update(HEADERS)
    s.request_timeout = timeout  # custom attr we honor below
    return s

def req_json(session: requests.Session, url: str, params: dict | None = None) -> dict:
    r = session.get(url, params=params, timeout=getattr(session, "request_timeout", 30.0))
    r.raise_for_status()
    return r.json()

# ---------- helpers ----------

def sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()

def file_ext_from_url_or_ct(url: str, content_type: str | None) -> str:
    path = urlparse(url).path
    _, ext = os.path.splitext(path)
    if ext:
        return ext.lower()
    if content_type:
        if "image/png" in content_type: return ".png"
        if "image/jpeg" in content_type or "image/jpg" in content_type: return ".jpg"
        if "image/webp" in content_type: return ".webp"
        if "image/gif" in content_type: return ".gif"
        if "image/svg" in content_type: return ".svg"
    guessed, _ = mimetypes.guess_extension(content_type or "")  # type: ignore
    return guessed or ".img"

def resolve_chapter_icon_url(icon_name: str) -> str:
    s = str(icon_name or "").strip()
    if not s:
        return ""
    m = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*):/(?!/)(.+)$", s)
    if m:
        return f"{m.group(1)}://{m.group(2)}"
    if s.startswith("//"):
        return "https:" + s
    if s.startswith("http://") or s.startswith("https://"):
        return s
    return BASE["chapter_icon_src"](s)

# ---------- parallel asset download ----------

_download_lock = threading.Lock()

def _existing_file_with_basename(subdir: str, base_name: str) -> str | None:
    try:
        for fn in os.listdir(subdir):
            if fn == base_name or fn.startswith(base_name + "."):
                return os.path.join(subdir, fn)
    except FileNotFoundError:
        os.makedirs(subdir, exist_ok=True)
    return None

def download_image_under(session: requests.Session, dir_rel: str, url: str, name_hint: str | None = None) -> str:
    if not url:
        return ""
    assert ASSETS_ROOT, "ASSETS_ROOT not initialized"
    base_name = name_hint or sha1_hex(url)
    base_name = re.sub(r"[^A-Za-z0-9._-]", "_", base_name)
    subdir = os.path.join(ASSETS_ROOT, dir_rel)
    os.makedirs(subdir, exist_ok=True)

    # Already present?
    with _download_lock:
        ex = _existing_file_with_basename(subdir, base_name)
        if ex:
            rel = ex.replace(ASSETS_ROOT, "").lstrip(os.sep)
            return f"/pyqs-assets/{rel.replace(os.sep,'/')}"

    # Download outside lock
    r = session.get(url, stream=True, timeout=getattr(session, "request_timeout", 30.0))
    r.raise_for_status()
    ext = file_ext_from_url_or_ct(url, r.headers.get("content-type"))
    filename = f"{base_name}{ext}"
    abs_path = os.path.join(subdir, filename)

    # Double-check under lock to avoid races
    with _download_lock:
        if os.path.exists(abs_path):
            rel = abs_path.replace(ASSETS_ROOT, "").lstrip(os.sep)
            return f"/pyqs-assets/{rel.replace(os.sep,'/')}"
        with open(abs_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

    rel = abs_path.replace(ASSETS_ROOT, "").lstrip(os.sep)
    return f"/pyqs-assets/{rel.replace(os.sep,'/')}"

def replace_html_image_urls(session: requests.Session, html: str, dir_rel: str) -> tuple[str, list[str]]:
    if not html:
        return html, []
    urls: list[str] = []
    urls += re.findall(r"<img[^>]+src=\"([^\"]+)\"", html, flags=re.IGNORECASE)
    urls += re.findall(r"<img[^>]+src='([^']+)'", html, flags=re.IGNORECASE)
    urls += re.findall(r"url\(([^)]+)\)", html, flags=re.IGNORECASE)
    urls += [
        u for u in re.findall(r"<a[^>]+href=\"([^\"]+)\"", html, flags=re.IGNORECASE)
        if re.search(r"\.(png|jpe?g|gif|webp|svg)(\?.*)?$", u, flags=re.IGNORECASE)
    ]

    replaced: dict[str, str] = {}
    for u in urls:
        u2 = u.strip().strip('"').strip("'")
        if not u2.lower().startswith("http"):
            continue
        local = download_image_under(session, dir_rel, u2)
        replaced[u2] = local

    new_html = html
    for old, new in replaced.items():
        new_html = new_html.replace(old, new)
    return new_html, list(replaced.values())

# ---------- API wrappers ----------

def get_exams(session: requests.Session):
    data = req_json(session, BASE["dashboard"], params={"limit": 10000})
    items = data.get("data", {}).get("items", [])
    comp = next((i for i in items if i.get("componentTitle") == "ChapterwiseExams"), None)
    exams = []
    for ex in comp.get("items", []) if comp else []:
        exams.append({
            "id": ex.get("examId"),
            "name": ex.get("title"),
            "icon": (ex.get("icon", {}) or {}).get("dark") or (ex.get("icon", {}) or {}).get("light") or "",
        })
    return [e for e in exams if e.get("id") and e.get("name")]

def get_subjects(session: requests.Session, exam_id: str):
    data = req_json(session, BASE["exam_subjects"](exam_id), params={"limit": 10000})
    subjects = []
    for s in data.get("data", {}).get("subjects", []) or []:
        subjects.append({
            "id": s.get("_id"),
            "name": s.get("title"),
            "icon": s.get("icon") or "",
        })
    return [s for s in subjects if s.get("id") and s.get("name")]

def get_chapters(session: requests.Session, exam_id: str, subject_id: str):
    data = req_json(session, BASE["subject_chapters"](exam_id, subject_id), params={"limit": 10000})
    out = []
    arr = (((data.get("data") or {}).get("chapters") or {}).get("data") or [])
    for c in arr:
        out.append({
            "id": c.get("_id"),
            "name": c.get("title"),
            "icon_name": c.get("icon"),
            "total_questions": ((c.get("allPyqs") or {}).get("totalQs") or 0),
        })
    return [c for c in out if c.get("id") and c.get("name")]

def get_questions_raw(session: requests.Session, exam_id: str, subject_id: str, chapter_id: str):
    data = req_json(
        session,
        BASE["questions"](exam_id, subject_id, chapter_id),
        params={"limit": 10000, "hideOutOfSyllabus": "false"},
    )
    return data.get("data", {}).get("questions", []) or []

# ---------- Transformations ----------

def question_to_local_shape(q: dict) -> dict:
    def correct_letters(options: list[dict]):
        letters = ["A", "B", "C", "D"]
        res: list[str] = []
        for i, o in enumerate(options or []):
            if o.get("isCorrect"):
                res.append(letters[i] if i < len(letters) else str(i + 1))
        return res
    opts = q.get("options") or []
    return {
        "type": q.get("type"),
        "diffuculty": q.get("level"),
        "pyqInfo": ((q.get("previousYearPapers") or [{}])[0] or {}).get("title", ""),
        "qText": ((q.get("question") or {}).get("text") or ""),
        "qImage": ((q.get("question") or {}).get("image") or ""),
        "options": [{"oText": o.get("text", ""), "oImage": o.get("image", "")} for o in opts],
        "correctAnswer": q.get("correctValue") if q.get("type") == "numerical" else correct_letters(opts),
        "solution": {
            "sText": ((q.get("solution") or {}).get("text") or ""),
            "sImage": ((q.get("solution") or {}).get("image") or ""),
        },
    }

def localize_question_assets(session: requests.Session, exam_id: str, subject_id: str, chapter_id: str, q: dict, idx: int) -> dict:
    base_rel = os.path.join("images", "exam", str(exam_id), "subject", str(subject_id), "chapter", str(chapter_id))
    out = dict(q)

    if out.get("qImage"):
        out["qImage"] = download_image_under(session, base_rel, out["qImage"], name_hint=f"q_{idx:04d}")
    if out.get("solution", {}).get("sImage"):
        out["solution"]["sImage"] = download_image_under(session, base_rel, out["solution"]["sImage"], name_hint=f"sol_{idx:04d}")
    for i, opt in enumerate(out.get("options") or []):
        if opt.get("oImage"):
            opt["oImage"] = download_image_under(session, base_rel, opt["oImage"], name_hint=f"opt{i+1}_{idx:04d}")

    out["qText"], _ = replace_html_image_urls(session, out.get("qText", ""), base_rel)
    if out.get("solution"):
        out["solution"]["sText"], _ = replace_html_image_urls(session, out["solution"].get("sText", ""), base_rel)
    for i, opt in enumerate(out.get("options") or []):
        if opt.get("oText"):
            new_html, _ = replace_html_image_urls(session, opt.get("oText", ""), base_rel)
            opt["oText"] = new_html

    return out

# ---------- DB (single-writer) ----------

def db_connect():
    ensure_dirs()
    assert DB_PATH, "DB_PATH not initialized"
    con = sqlite3.connect(DB_PATH, timeout=30.0)
    con.execute("PRAGMA journal_mode = WAL;")
    con.execute("PRAGMA foreign_keys = ON;")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS exams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon_url TEXT,
          icon_path TEXT
        );
        CREATE TABLE IF NOT EXISTS subjects (
          id TEXT PRIMARY KEY,
          examId TEXT NOT NULL,
          name TEXT NOT NULL,
          icon_url TEXT,
          icon_path TEXT,
          FOREIGN KEY (examId) REFERENCES exams(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          examId TEXT NOT NULL,
          subjectId TEXT NOT NULL,
          name TEXT NOT NULL,
          icon_name TEXT,
          icon_path TEXT,
          total_questions INTEGER DEFAULT 0,
          FOREIGN KEY (examId) REFERENCES exams(id) ON DELETE CASCADE,
          FOREIGN KEY (subjectId) REFERENCES subjects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS questions (
          examId TEXT NOT NULL,
          subjectId TEXT NOT NULL,
          chapterId TEXT NOT NULL,
          idx INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (examId, subjectId, chapterId, idx),
          FOREIGN KEY (examId) REFERENCES exams(id) ON DELETE CASCADE,
          FOREIGN KEY (subjectId) REFERENCES subjects(id) ON DELETE CASCADE,
          FOREIGN KEY (chapterId) REFERENCES chapters(id) ON DELETE CASCADE
        );
        """
    )
    return con

def upsert_exam(cur, ex: dict):
    cur.execute(
        """
        INSERT INTO exams (id, name, icon_url, icon_path)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon_url=excluded.icon_url, icon_path=excluded.icon_path
        """,
        (str(ex["id"]), ex["name"], ex.get("icon") or "", ex.get("icon_path") or ""),
    )

def upsert_subject(cur, exam_id: str, s: dict):
    cur.execute(
        """
        INSERT INTO subjects (id, examId, name, icon_url, icon_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET examId=excluded.examId, name=excluded.name, icon_url=excluded.icon_url, icon_path=excluded.icon_path
        """,
        (str(s["id"]), str(exam_id), s["name"], s.get("icon") or "", s.get("icon_path") or ""),
    )

def upsert_chapter(cur, exam_id: str, subject_id: str, ch: dict):
    cur.execute(
        """
        INSERT INTO chapters (id, examId, subjectId, name, icon_name, icon_path, total_questions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET examId=excluded.examId, subjectId=excluded.subjectId, name=excluded.name, icon_name=excluded.icon_name, icon_path=excluded.icon_path, total_questions=excluded.total_questions
        """,
        (
            str(ch["id"]), str(exam_id), str(subject_id), ch["name"],
            ch.get("icon_name") or "", ch.get("icon_path") or "", int(ch.get("total_questions") or 0),
        ),
    )

def save_questions(cur, exam_id: str, subject_id: str, chapter_id: str, questions: list[dict]):
    cur.execute(
        "DELETE FROM questions WHERE examId=? AND subjectId=? AND chapterId=?",
        (str(exam_id), str(subject_id), str(chapter_id)),
    )
    cur.executemany(
        """
        INSERT INTO questions (examId, subjectId, chapterId, idx, data_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        [(str(exam_id), str(subject_id), str(chapter_id), idx, json.dumps(q, ensure_ascii=False))
         for idx, q in enumerate(questions)]
    )

# ---------- Progress helpers ----------

def pbar_or_print(iterable, total=None, desc: str = ""):
    if tqdm is not None:
        return tqdm(iterable, total=total, desc=desc, unit="it")
    class _Plain:
        def __init__(self, it, tot, desc):
            self.it = iter(it)
            self.count = 0
            self.total = tot
            self.desc = desc
        def __iter__(self):
            for x in self.it:
                self.count += 1
                if self.total:
                    sys.stdout.write(f"\r{self.desc}: {self.count}/{self.total}")
                else:
                    if self.count % 10 == 0:
                        sys.stdout.write(f"\r{self.desc}: {self.count}")
                sys.stdout.flush()
                yield x
            sys.stdout.write("\n")
        def update(self, n=1): pass
        def close(self): pass
    return _Plain(iterable, total, desc)

# ---------- Parallel utilities ----------

def _parallel_map(executor: ThreadPoolExecutor, fn: Callable[[Any], Any], items: Iterable[Any]) -> List[Any]:
    futures = [executor.submit(fn, it) for it in items]
    out: List[Any] = []
    for f in as_completed(futures):
        try:
            out.append(f.result())
        except Exception:
            # swallow to keep going; you can print/log if you like
            pass
    return out

# ---------- High-level ops (parallel fan-out) ----------

def _download_icon_if_any(session: requests.Session, kind: str, url_or_name: str, id_or_hint: str) -> str:
    """kind in {'exams','subjects','chapters'}; returns local path or ''."""
    if not url_or_name:
        return ""
    if kind == "chapters":
        url = resolve_chapter_icon_url(url_or_name)
        try:
            basename = os.path.basename(urlparse(url).path)
            hint = os.path.splitext(basename)[0] or str(id_or_hint)
        except Exception:
            hint = str(id_or_hint)
        return download_image_under(session, os.path.join("icons", "chapters"), url, name_hint=hint)
    elif kind == "exams":
        return download_image_under(session, os.path.join("icons", "exams"), url_or_name, name_hint=str(id_or_hint))
    elif kind == "subjects":
        return download_image_under(session, os.path.join("icons", "subjects"), url_or_name, name_hint=str(id_or_hint))
    return ""

def catalog_download(max_workers: int = 16):
    print("▶ Fetching exams, subjects, and chapters (catalog only)...")
    # make session pools proportionate to concurrency
    session = get_session(pool_size=max(64, max_workers*4))
    con = db_connect()
    cur = con.cursor()

    exams = get_exams(session)
    if not exams:
        print("No exams found.")
        return

    # parallel exam icons
    def _prep_exam(ex):
        ex2 = dict(ex)
        if ex.get("icon"):
            ex2["icon_path"] = _download_icon_if_any(session, "exams", ex["icon"], ex["id"])
        else:
            ex2["icon_path"] = ""
        return ex2

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        prepped_exams = _parallel_map(pool, _prep_exam, exams)

        # fan-out subjects in parallel
        def _fetch_subjects_for_exam(ex):
            subs = get_subjects(session, ex["id"]) or []
            # download subject icons in parallel
            def _prep_sub(s):
                s2 = dict(s)
                s2["icon_path"] = _download_icon_if_any(session, "subjects", s.get("icon") or "", s["id"]) if s.get("icon") else ""
                s2["exam_id"] = ex["id"]
                return s2
            return [ _prep_sub(s) for s in subs ]

        subjects_nested = _parallel_map(pool, _fetch_subjects_for_exam, prepped_exams)
        subjects = [s for group in subjects_nested for s in group]

        # fan-out chapters in parallel
        def _fetch_chapters_for_subject(s):
            chs = get_chapters(session, s["exam_id"], s["id"]) or []
            out = []
            for ch in chs:
                ch2 = dict(ch)
                ch2["icon_path"] = _download_icon_if_any(session, "chapters", ch.get("icon_name") or "", ch.get("id", ""))
                ch2["exam_id"] = s["exam_id"]
                ch2["subject_id"] = s["id"]
                out.append(ch2)
            return out

        chapters_nested = _parallel_map(pool, _fetch_chapters_for_subject, subjects)
        chapters = [c in group for group in chapters_nested for c in group] if chapters_nested else []
        # Small correction: list flatten with correct var
        chapters = []
        for group in chapters_nested:
            chapters.extend(group)

    # single-writer commits
    for ex in pbar_or_print(prepped_exams, total=len(prepped_exams), desc="DB (exams)"):
        upsert_exam(cur, ex)
    for s in pbar_or_print(subjects, total=len(subjects), desc="DB (subjects)"):
        upsert_subject(cur, s["exam_id"], s)
    for ch in pbar_or_print(chapters, total=len(chapters), desc="DB (chapters)"):
        upsert_chapter(cur, ch["exam_id"], ch["subject_id"], ch)
    con.commit()
    con.close()

    print("\n✅ Catalog download complete (no questions).")
    print(f"   DB: {DB_PATH}")
    print(f"   Assets: {ASSETS_ROOT}")

def _chapter_exists(cur, exam_id: str, subject_id: str, chapter_id: str) -> int:
    try:
        row = cur.execute(
            "SELECT COUNT(1) FROM questions WHERE examId=? AND subjectId=? AND chapterId=?",
            (str(exam_id), str(subject_id), str(chapter_id))
        ).fetchone()
        return int(row[0] or 0)
    except Exception:
        return 0

def _localize_chapter_questions_task(args: Tuple[requests.Session, str, str, str, bool, int]) -> Tuple[str, str, str, List[dict]]:
    session, exam_id, subject_id, chapter_id, force, max_workers = args
    # fetch questions (single request), then localize assets in parallel for this chapter
    raw = get_questions_raw(session, exam_id, subject_id, chapter_id) or []
    shaped = [question_to_local_shape(q) for q in raw]
    total = len(shaped)

    if not total:
        return exam_id, subject_id, chapter_id, []

    localized = [None] * total

    def _task(i_q):
        i, q = i_q
        return i, localize_question_assets(session, exam_id, subject_id, chapter_id, q, i)

    # inner pool per chapter (keeps fairness across many chapters)
    workers = min(max_workers, 32)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_task, (i, q)) for i, q in enumerate(shaped)]
        for fut in as_completed(futures):
            i, loc = fut.result()
            localized[i] = loc

    out = [x for x in localized if x is not None]
    return exam_id, subject_id, chapter_id, out

def single_chapter_download(exam_id: str | None, subject_id: str | None, chapter_id: str | None, max_workers: int = 16, force: bool = False):
    session = get_session(pool_size=max(64, max_workers*4))
    print("▶ Preparing single chapter download...")
    exams = get_exams(session)
    if not exams:
        print("No exams found.")
        return

    # Select helpers
    def choose(prompt: str, items: list[dict], key="name"):
        print(prompt)
        for i, it in enumerate(items, start=1):
            print(f"{i}. {it.get(key)} ({it.get('id')})")
        while True:
            try:
                sel = input(f"Choose 1..{len(items)}: ").strip()
                idx = int(sel) - 1
                if 0 <= idx < len(items):
                    return items[idx]
            except Exception:
                pass
            print("Invalid option. Try again.")

    ex = next((e for e in exams if exam_id and str(e["id"]) == str(exam_id)), None) or (choose("Exams:", exams, key="name"))
    print(f"✓ Exam: {ex['name']} ({ex['id']})")

    subjects = get_subjects(session, ex["id"]) or []
    su = next((s for s in subjects if subject_id and str(s["id"]) == str(subject_id)), None) or (choose("Subjects:", subjects, key="name"))
    print(f"✓ Subject: {su['name']} ({su['id']})")

    chapters = get_chapters(session, ex["id"], su["id"]) or []
    ch = next((c for c in chapters if chapter_id and str(c["id"]) == str(chapter_id)), None) or (choose("Chapters:", chapters, key="name"))
    print(f"✓ Chapter: {ch['name']} ({ch['id']})")

    con = db_connect()
    cur = con.cursor()

    # pre-download icons (parallel) just for cleanliness
    ex_row = dict(ex)
    ex_row["icon_path"] = _download_icon_if_any(session, "exams", ex.get("icon") or "", ex["id"]) if ex.get("icon") else ""
    upsert_exam(cur, ex_row)

    su_row = dict(su)
    su_row["icon_path"] = _download_icon_if_any(session, "subjects", su.get("icon") or "", su["id"]) if su.get("icon") else ""
    upsert_subject(cur, ex["id"], su_row)

    ch_row = dict(ch)
    ch_row["icon_path"] = _download_icon_if_any(session, "chapters", ch.get("icon_name") or "", ch.get("id",""))
    upsert_chapter(cur, ex["id"], su["id"], ch_row)
    con.commit()

    # Skip if already present
    count_existing = _chapter_exists(cur, ex["id"], su["id"], ch["id"])
    if count_existing > 0 and not force:
        print(f"⚠ Chapter already present with {count_existing} questions. Use --force to re-download.")
        con.close()
        return

    print("▶ Fetching questions & localizing assets...")
    _, _, _, localized = _localize_chapter_questions_task((session, ex["id"], su["id"], ch["id"], force, max_workers))

    save_questions(cur, ex["id"], su["id"], ch["id"], localized)
    cur.execute("UPDATE chapters SET total_questions = ? WHERE id = ?", (len(localized), str(ch["id"])))
    con.commit()
    con.close()

    print("\n✅ Done. Local DB and assets updated.")
    print(f"   DB: {DB_PATH}")
    print(f"   Assets: {ASSETS_ROOT}")
    print(f"   Saved {len(localized)} questions for '{ch['name']}'.")

def everything_download(max_workers: int = 16, force: bool = False):
    print("▶ Starting full dataset download (parallel fan-out)...")
    session = get_session(pool_size=max(128, max_workers*8))
    con = db_connect()
    cur = con.cursor()

    exams = get_exams(session)
    if not exams:
        print("No exams found.")
        return

    # Prepare exams with icons in parallel
    def _prep_exam(ex):
        ex2 = dict(ex)
        ex2["icon_path"] = _download_icon_if_any(session, "exams", ex.get("icon") or "", ex["id"]) if ex.get("icon") else ""
        return ex2

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        prepped_exams = _parallel_map(pool, _prep_exam, exams)

        # fan-out subjects
        def _fetch_subjects_for_exam(ex):
            subs = get_subjects(session, ex["id"]) or []
            def _prep_sub(s):
                s2 = dict(s)
                s2["icon_path"] = _download_icon_if_any(session, "subjects", s.get("icon") or "", s["id"]) if s.get("icon") else ""
                s2["exam_id"] = ex["id"]
                return s2
            return [_prep_sub(s) for s in subs]

        subjects_nested = _parallel_map(pool, _fetch_subjects_for_exam, prepped_exams)
        subjects: List[dict] = []
        for group in subjects_nested:
            subjects.extend(group)

        # fan-out chapters
        def _fetch_chapters_for_subject(s):
            chs = get_chapters(session, s["exam_id"], s["id"]) or []
            out = []
            for ch in chs:
                ch2 = dict(ch)
                ch2["icon_path"] = _download_icon_if_any(session, "chapters", ch.get("icon_name") or "", ch.get("id", ""))
                ch2["exam_id"] = s["exam_id"]
                ch2["subject_id"] = s["id"]
                out.append(ch2)
            return out

        chapters_nested = _parallel_map(pool, _fetch_chapters_for_subject, subjects)
        chapters: List[dict] = []
        for group in chapters_nested:
            chapters.extend(group)

    # Write catalog first
    for ex in pbar_or_print(prepped_exams, total=len(prepped_exams), desc="DB (exams)"):
        upsert_exam(cur, ex)
    for s in pbar_or_print(subjects, total=len(subjects), desc="DB (subjects)"):
        upsert_subject(cur, s["exam_id"], s)
    for ch in pbar_or_print(chapters, total=len(chapters), desc="DB (chapters)"):
        upsert_chapter(cur, ch["exam_id"], ch["subject_id"], ch)
    con.commit()

    # Prepare chapter tasks (skip existing unless --force)
    chapter_tasks: List[Tuple[requests.Session, str, str, str, bool, int]] = []
    for ch in chapters:
        if not force:
            existing = _chapter_exists(cur, ch["exam_id"], ch["subject_id"], ch["id"])
            if existing > 0:
                continue
        chapter_tasks.append((session, ch["exam_id"], ch["subject_id"], ch["id"], force, max_workers))

    # Parallelize all chapter question fetch + localization
    print(f"▶ Downloading questions & assets for {len(chapter_tasks)} chapters with up to {max_workers} workers...")
    localized_results: List[Tuple[str, str, str, List[dict]]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [pool.submit(_localize_chapter_questions_task, t) for t in chapter_tasks]
        bar = tqdm(total=len(futs), desc="Chapters", unit="ch") if tqdm else None
        for fut in as_completed(futs):
            try:
                res = fut.result()
                localized_results.append(res)
            except Exception:
                pass
            if bar: bar.update(1)
        if bar: bar.close()

    # Write all questions serially
    for (ex_id, su_id, ch_id, qs) in pbar_or_print(localized_results, total=len(localized_results), desc="DB (questions)"):
        if qs:
            save_questions(cur, ex_id, su_id, ch_id, qs)
            cur.execute("UPDATE chapters SET total_questions=? WHERE id=?", (len(qs), str(ch_id)))
    con.commit()
    con.close()

    print("\n✅ Everything downloaded successfully.")
    print(f"   DB: {DB_PATH}")
    print(f"   Assets: {ASSETS_ROOT}")

# ---------- CLI ----------

def handle_sigint(signum, frame):
    print("\nInterrupted. Exiting gracefully.")
    sys.exit(130)

def build_parser():
    p = argparse.ArgumentParser(
        prog="pyq-scraper",
        description="PYQ Scraper — download catalog or a single chapter of GetMarks PQs.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    # NEW: global out-dir
    p.add_argument(
        "--out-dir",
        default=os.environ.get("PYQS_OUT_DIR", _default_out),
        help="Directory where pyqs_assets/ and pyqs_local.sqlite are written",
    )

    sub = p.add_subparsers(dest="cmd")

    # Guided interactive
    guided = sub.add_parser("guided", help="Start interactive guided mode")
    guided.add_argument("--workers", type=int, default=16, help="Max worker threads for downloads")

    # Catalog only
    cat = sub.add_parser("catalog", help="Download catalog (exams/subjects/chapters) — no questions")
    cat.add_argument("--workers", type=int, default=16, help="Max worker threads for icon downloads")

    # Single chapter
    chap = sub.add_parser("chapter", help="Download a single chapter (questions + images)")
    chap.add_argument("--exam-id", help="Exam ID (skip interactive exam selection)")
    chap.add_argument("--subject-id", help="Subject ID (skip interactive subject selection)")
    chap.add_argument("--chapter-id", help="Chapter ID (skip interactive chapter selection)")
    chap.add_argument("--workers", type=int, default=16, help="Max worker threads for downloads")
    chap.add_argument("--force", action="store_true", help="Re-download even if already present")

    # Everything (full)
    allcmd = sub.add_parser("everything", help="Download ALL exams, subjects, chapters, and questions")
    allcmd.add_argument("--workers", type=int, default=16, help="Max worker threads for downloads")
    allcmd.add_argument("--force", action="store_true", help="Re-download chapters even if already present")

    return p

def run_guided(workers: int):
    print("╭──────────────────────────────────────────────╮")
    print("│                PYQ Scraper                   │")
    print("│          Pick an action to continue          │")
    print("╰──────────────────────────────────────────────╯")
    options = [
        "Download catalog (exams, subjects, chapters) — no questions",
        "Download a single chapter (questions + images)",
        "Download EVERYTHING (all exams, all questions)",
        "Exit",
    ]
    for i, name in enumerate(options, 1):
        print(f"{i}. {name}")
    while True:
        sel = input(f"Choose 1..{len(options)}: ").strip()
        if sel in {"1", "2", "3", "4"}:
            break
        print("Invalid option. Try again.")
    if sel == "1":
        catalog_download(max_workers=workers)
    elif sel == "2":
        single_chapter_download(None, None, None, max_workers=workers)
    elif sel == "3":
        everything_download(max_workers=workers)
    else:
        print("Bye!")

def main():
    signal.signal(signal.SIGINT, handle_sigint)
    parser = build_parser()
    args = parser.parse_args()

    # configure output root before anything else
    set_output_root(args.out_dir)
    ensure_dirs()

    # Default to guided if no subcommand
    if not args.cmd:
        run_guided(workers=16)
        return

    if args.cmd == "guided":
        catalog_download(max_workers=args.workers) if False else run_guided(workers=args.workers)  # keep guided
    elif args.cmd == "catalog":
        catalog_download(max_workers=args.workers)
    elif args.cmd == "chapter":
        single_chapter_download(
            exam_id=args.exam_id,
            subject_id=args.subject_id,
            chapter_id=args.chapter_id,
            max_workers=args.workers,
            force=args.force,
        )
    elif args.cmd == "everything":
        everything_download(max_workers=args.workers, force=args.force)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
