import os
import uuid
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator, model_validator
from PIL import Image
import io

DB_PATH    = os.getenv("DB_PATH",    "/opt/tips-board/tips.db")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/opt/tips-board/uploads"))

VALID_CATEGORIES  = {"fishing", "hunting", "ramps", "camping", "general"}
ALLOWED_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXTS      = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_BYTES   = 8 * 1024 * 1024   # 8 MB
MAX_IMAGES_PER_POST = 4

app = FastAPI(title="South Georgia Field Reports API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded images at /uploads/
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


def get_db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            email       TEXT NOT NULL,
            category    TEXT NOT NULL,
            area        TEXT,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS replies (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            email       TEXT NOT NULL,
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS post_images (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()


init_db()


# ── Pydantic models ──────────────────────────────────────────────────────────

class PostIn(BaseModel):
    name: str
    email: str
    category: str
    area: Optional[str] = ""
    title: str
    body: str

    @field_validator("name", "email", "title", "body", mode="before")
    @classmethod
    def strip_and_require(cls, v):
        return (v or "").strip()

    @field_validator("area", mode="before")
    @classmethod
    def strip_area(cls, v):
        return (v or "").strip()

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(cls, v):
        v = (v or "").strip().lower()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v

    @model_validator(mode="after")
    def check_required(self):
        for field in ("name", "email", "title", "body"):
            if not getattr(self, field):
                raise ValueError(f"{field} is required")
        if self.body and len(self.body) > 5000:
            raise ValueError("body must be 5000 characters or fewer")
        return self


class ReplyIn(BaseModel):
    name: str
    email: str
    body: str

    @field_validator("name", "email", "body", mode="before")
    @classmethod
    def strip_and_require(cls, v):
        return (v or "").strip()

    @model_validator(mode="after")
    def check_required(self):
        for field in ("name", "email", "body"):
            if not getattr(self, field):
                raise ValueError(f"{field} is required")
        if self.body and len(self.body) > 2000:
            raise ValueError("body must be 2000 characters or fewer")
        return self


# ── Helpers ──────────────────────────────────────────────────────────────────

def now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def images_for_post(conn, post_id: int) -> list[str]:
    rows = conn.execute(
        "SELECT filename FROM post_images WHERE post_id = ? ORDER BY id ASC",
        (post_id,),
    ).fetchall()
    return [f"/uploads/{r['filename']}" for r in rows]


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/posts")
def list_posts(category: str = Query("all")):
    conn = get_db()
    try:
        if category and category != "all":
            if category not in VALID_CATEGORIES:
                raise HTTPException(status_code=400, detail="Invalid category")
            rows = conn.execute(
                """
                SELECT p.id, p.name, p.category, p.area, p.title, p.body, p.created_at,
                       COUNT(DISTINCT r.id) AS reply_count,
                       COUNT(DISTINCT i.id) AS image_count
                FROM posts p
                LEFT JOIN replies r ON r.post_id = p.id
                LEFT JOIN post_images i ON i.post_id = p.id
                WHERE p.category = ?
                GROUP BY p.id
                ORDER BY p.created_at DESC
                """,
                (category,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT p.id, p.name, p.category, p.area, p.title, p.body, p.created_at,
                       COUNT(DISTINCT r.id) AS reply_count,
                       COUNT(DISTINCT i.id) AS image_count
                FROM posts p
                LEFT JOIN replies r ON r.post_id = p.id
                LEFT JOIN post_images i ON i.post_id = p.id
                GROUP BY p.id
                ORDER BY p.created_at DESC
                """
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/posts/{post_id}")
def get_post(post_id: int):
    conn = get_db()
    try:
        post = conn.execute(
            "SELECT id, name, category, area, title, body, created_at FROM posts WHERE id = ?",
            (post_id,),
        ).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        replies = conn.execute(
            "SELECT id, name, body, created_at FROM replies WHERE post_id = ? ORDER BY created_at ASC",
            (post_id,),
        ).fetchall()
        result = dict(post)
        result["replies"] = [dict(r) for r in replies]
        result["images"]  = images_for_post(conn, post_id)
        return result
    finally:
        conn.close()


@app.post("/api/posts", status_code=201)
def create_post(data: PostIn):
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO posts (name, email, category, area, title, body, created_at) VALUES (?,?,?,?,?,?,?)",
            (data.name, data.email, data.category, data.area, data.title, data.body, now_iso()),
        )
        conn.commit()
        return {"id": cur.lastrowid, "message": "Post submitted!"}
    finally:
        conn.close()


@app.post("/api/posts/{post_id}/images", status_code=201)
async def upload_image(post_id: int, file: UploadFile = File(...)):
    # Validate post exists
    conn = get_db()
    try:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")

        # Check image count
        count = conn.execute(
            "SELECT COUNT(*) FROM post_images WHERE post_id = ?", (post_id,)
        ).fetchone()[0]
        if count >= MAX_IMAGES_PER_POST:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {MAX_IMAGES_PER_POST} images per post",
            )

        # Validate MIME type
        if file.content_type not in ALLOWED_MIMETYPES:
            raise HTTPException(
                status_code=400,
                detail="Only JPEG, PNG, and WebP images are allowed",
            )

        # Read and check size
        contents = await file.read()
        if len(contents) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail="Image must be under 8 MB")

        # Verify it's actually a valid image via Pillow
        try:
            img = Image.open(io.BytesIO(contents))
            img.verify()
        except Exception:
            raise HTTPException(status_code=400, detail="File is not a valid image")

        # Save with a UUID filename to prevent path traversal / collisions
        ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
        ext = ext_map[file.content_type]
        filename = f"{uuid.uuid4().hex}{ext}"
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        (UPLOAD_DIR / filename).write_bytes(contents)

        conn.execute(
            "INSERT INTO post_images (post_id, filename, created_at) VALUES (?,?,?)",
            (post_id, filename, now_iso()),
        )
        conn.commit()
        return {"filename": filename, "url": f"/uploads/{filename}"}
    finally:
        conn.close()


@app.post("/api/posts/{post_id}/replies", status_code=201)
def create_reply(post_id: int, data: ReplyIn):
    conn = get_db()
    try:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        conn.execute(
            "INSERT INTO replies (post_id, name, email, body, created_at) VALUES (?,?,?,?,?)",
            (post_id, data.name, data.email, data.body, now_iso()),
        )
        conn.commit()
        return {"message": "Reply added!"}
    finally:
        conn.close()
