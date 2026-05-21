"use strict";

const API = "/api";

const CATEGORY_LABELS = {
  fishing: "🎣 Fishing",
  hunting: "🦌 Hunting",
  ramps:   "⚓ Boat Ramps",
  camping: "🏕️ Camping",
  general: "💬 General",
};

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

let currentCategory = "all";
let currentPostId   = null;

// ── BOOT ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadFeed();
  bindEvents();
  bindImagePicker();
});

function bindEvents() {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => setCategory(chip.dataset.cat));
  });

  document.querySelectorAll("[data-action='new-post']").forEach(el => {
    el.addEventListener("click", openNewPost);
  });

  document.getElementById("modal-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById("modal-close-btn").addEventListener("click", closeModal);

  document.getElementById("post-form").addEventListener("submit", submitPost);

  // Body char counter
  const bodyTA    = document.getElementById("post-body");
  const bodyCount = document.getElementById("body-count");
  bodyTA.addEventListener("input", () => {
    const n = bodyTA.value.length;
    bodyCount.textContent = `${n} / 5000`;
    bodyCount.classList.toggle("warn", n > 4500);
  });

  document.getElementById("detail-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeDetail();
  });
}

// ── IMAGE PICKER ─────────────────────────────────────────
function bindImagePicker() {
  const input   = document.getElementById("post-images");
  const preview = document.getElementById("image-preview");

  input.addEventListener("change", () => {
    preview.innerHTML = "";
    const files = Array.from(input.files).slice(0, 4);

    if (files.length === 0) return;

    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = e => {
        const wrap = document.createElement("div");
        wrap.className = "img-thumb-wrap";
        wrap.innerHTML = `
          <img src="${e.target.result}" class="img-thumb" alt="Preview ${i + 1}">
          <span class="img-thumb-size">${formatBytes(file.size)}</span>`;
        preview.appendChild(wrap);
      };
      reader.readAsDataURL(file);
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── FEED ────────────────────────────────────────────────
async function loadFeed() {
  showSkeletons();
  try {
    const url = currentCategory === "all"
      ? `${API}/posts`
      : `${API}/posts?category=${currentCategory}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const posts = await res.json();
    renderFeed(posts);
  } catch (err) {
    showFeedError(err.message);
  }
}

function renderFeed(posts) {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  if (!posts.length) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌿</div>
        <p>No reports yet for this category.</p>
        <p>Be the first to share one!</p>
      </div>`;
    return;
  }

  posts.forEach(post => {
    const card = document.createElement("div");
    card.className = `post-card cat-${post.category}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="cat-badge ${post.category}">${CATEGORY_LABELS[post.category] || post.category}</span>
        ${post.area ? `<span class="card-area">📍 ${esc(post.area)}</span>` : ""}
      </div>
      <div class="card-title">${esc(post.title)}</div>
      <div class="card-body-preview">${esc(post.body)}</div>
      <div class="card-footer">
        <span class="card-author">by ${esc(post.name)}</span>
        <span style="display:flex;align-items:center;gap:0.75rem;">
          <span>${formatDate(post.created_at)}</span>
          <span class="reply-count">💬 ${post.reply_count}</span>
          ${post.image_count > 0 ? `<span class="img-count">📷 ${post.image_count}</span>` : ""}
        </span>
      </div>`;
    card.addEventListener("click", () => openPost(post.id));
    feed.appendChild(card);
  });
}

function showSkeletons() {
  const feed = document.getElementById("feed");
  feed.innerHTML = Array.from({ length: 4 }, () => `
    <div class="skeleton-card">
      <div class="skel skel-h" style="width:30%"></div>
      <div class="skel skel-title"></div>
      <div class="skel skel-body"></div>
      <div class="skel skel-body"></div>
      <div class="skel skel-body"></div>
    </div>`).join("");
}

function showFeedError(msg) {
  document.getElementById("feed").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <p>Could not load reports.</p>
      <p style="font-size:.85rem;margin-top:.4rem;">${esc(msg)}</p>
    </div>`;
}

function setCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll(".chip").forEach(c => {
    c.classList.toggle("active", c.dataset.cat === cat);
  });
  loadFeed();
}

// ── DETAIL PANEL ────────────────────────────────────────
async function openPost(id) {
  currentPostId = id;
  const overlay = document.getElementById("detail-overlay");
  const panel   = document.getElementById("detail-panel");
  const content = document.getElementById("detail-content");

  content.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--gray)">Loading…</div>`;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => panel.classList.add("open"));

  try {
    const res = await fetch(`${API}/posts/${id}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const post = await res.json();
    renderDetail(post);
  } catch (err) {
    content.innerHTML = `<div style="padding:2rem;text-align:center;color:#c62828">Failed to load: ${esc(err.message)}</div>`;
  }
}

function renderDetail(post) {
  const content = document.getElementById("detail-content");

  // Image gallery
  const imagesHtml = post.images && post.images.length
    ? `<div class="post-images">
        ${post.images.map((url, i) => `
          <a href="${url}" target="_blank" rel="noopener" class="post-img-link">
            <img src="${url}" alt="Photo ${i + 1}" class="post-img" loading="lazy">
          </a>`).join("")}
       </div>`
    : "";

  const repliesHtml = post.replies.length
    ? post.replies.map(r => `
        <div class="reply">
          <div class="reply-meta">
            <span class="reply-author">${esc(r.name)}</span>
            &nbsp;·&nbsp; ${formatDate(r.created_at)}
          </div>
          <div class="reply-body">${esc(r.body)}</div>
        </div>`).join("")
    : `<p style="color:var(--gray);font-size:.88rem;margin-bottom:.75rem;">No replies yet — be the first!</p>`;

  content.innerHTML = `
    <div class="panel-handle"></div>
    <div class="panel-header">
      <div class="panel-header-left">
        <div class="panel-cat-row">
          <span class="cat-badge ${post.category}">${CATEGORY_LABELS[post.category] || post.category}</span>
          ${post.area ? `<span class="panel-area">📍 ${esc(post.area)}</span>` : ""}
        </div>
        <div class="panel-title">${esc(post.title)}</div>
        <div class="panel-meta">by ${esc(post.name)} &nbsp;·&nbsp; ${formatDate(post.created_at)}</div>
      </div>
      <button class="panel-close" id="detail-close-btn" aria-label="Close">✕</button>
    </div>
    ${imagesHtml}
    <div class="panel-body">${esc(post.body)}</div>
    <div class="replies-section">
      <h3>${post.replies.length} ${post.replies.length === 1 ? "Reply" : "Replies"}</h3>
      ${repliesHtml}
    </div>
    <div class="reply-form-wrap">
      <h4>Add a Reply</h4>
      <form id="reply-form" novalidate>
        <div class="form-row two-col">
          <div class="form-group">
            <label for="reply-name">Your Name *</label>
            <input type="text" id="reply-name" placeholder="John Smith" required>
          </div>
          <div class="form-group">
            <label for="reply-email">Email * <span style="font-weight:400;color:var(--gray)">(not shown)</span></label>
            <input type="email" id="reply-email" placeholder="you@email.com" required>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:.5rem;">
          <label for="reply-body">Reply *</label>
          <textarea id="reply-body" rows="3" placeholder="Share your knowledge…" required maxlength="2000"></textarea>
          <span class="char-count" id="reply-count">0 / 2000</span>
        </div>
        <button type="submit" class="btn-submit" id="reply-submit-btn">Post Reply</button>
      </form>
    </div>`;

  document.getElementById("detail-close-btn").addEventListener("click", closeDetail);

  const replyBody  = document.getElementById("reply-body");
  const replyCount = document.getElementById("reply-count");
  replyBody.addEventListener("input", () => {
    const n = replyBody.value.length;
    replyCount.textContent = `${n} / 2000`;
    replyCount.classList.toggle("warn", n > 1800);
  });

  document.getElementById("reply-form").addEventListener("submit", e => submitReply(post.id, e));
}

function closeDetail() {
  const overlay = document.getElementById("detail-overlay");
  const panel   = document.getElementById("detail-panel");
  panel.classList.remove("open");
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  currentPostId = null;
}

// ── NEW POST MODAL ───────────────────────────────────────
function openNewPost() {
  document.getElementById("post-form").reset();
  document.getElementById("body-count").textContent = "0 / 5000";
  document.getElementById("body-count").classList.remove("warn");
  document.getElementById("post-error").textContent = "";
  document.getElementById("image-preview").innerHTML = "";
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("post-name").focus();
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

async function submitPost(e) {
  e.preventDefault();
  const errEl = document.getElementById("post-error");
  errEl.textContent = "";

  const body = {
    name:     document.getElementById("post-name").value.trim(),
    email:    document.getElementById("post-email").value.trim(),
    category: document.getElementById("post-category").value,
    area:     document.getElementById("post-area").value.trim(),
    title:    document.getElementById("post-title").value.trim(),
    body:     document.getElementById("post-body").value.trim(),
  };

  const missing = ["name","email","category","title","body"].filter(k => !body[k]);
  if (missing.length) {
    errEl.textContent = `Please fill in: ${missing.join(", ")}.`;
    return;
  }

  // Validate images before submitting
  const imageFiles = Array.from(document.getElementById("post-images").files).slice(0, 4);
  const oversized  = imageFiles.filter(f => f.size > 8 * 1024 * 1024);
  if (oversized.length) {
    errEl.textContent = `Image "${oversized[0].name}" exceeds the 8 MB limit.`;
    return;
  }

  const btn = document.getElementById("post-submit-btn");
  btn.disabled = true;
  btn.textContent = "Posting…";

  try {
    // 1 — create the post
    const res = await fetch(`${API}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data.detail;
      errEl.textContent = Array.isArray(detail)
        ? detail.map(d => d.msg).join("; ")
        : (detail || `Error ${res.status}`);
      return;
    }

    const postId = data.id;

    // 2 — upload images (if any), sequentially
    if (imageFiles.length) {
      btn.textContent = `Uploading photos (0/${imageFiles.length})…`;
      for (let i = 0; i < imageFiles.length; i++) {
        btn.textContent = `Uploading photos (${i + 1}/${imageFiles.length})…`;
        const fd = new FormData();
        fd.append("file", imageFiles[i]);
        const imgRes = await fetch(`${API}/posts/${postId}/images`, {
          method: "POST",
          body: fd,
        });
        if (!imgRes.ok) {
          const imgData = await imgRes.json().catch(() => ({}));
          // Non-fatal — post exists, just warn
          errEl.textContent = `Post saved, but photo ${i + 1} failed: ${imgData.detail || "upload error"}`;
          break;
        }
      }
    }

    closeModal();
    showStatusMsg("✅ Report posted! Thanks for sharing with the community.");
    loadFeed();
  } catch (err) {
    errEl.textContent = "Network error — please try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
}

async function submitReply(postId, e) {
  e.preventDefault();
  const btn = document.getElementById("reply-submit-btn");

  const body = {
    name:  document.getElementById("reply-name").value.trim(),
    email: document.getElementById("reply-email").value.trim(),
    body:  document.getElementById("reply-body").value.trim(),
  };

  const missing = ["name","email","body"].filter(k => !body[k]);
  if (missing.length) {
    alert(`Please fill in: ${missing.join(", ")}.`);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Posting…";

  try {
    const res = await fetch(`${API}/posts/${postId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      const detail = data.detail;
      alert(Array.isArray(detail) ? detail.map(d => d.msg).join("; ") : (detail || `Error ${res.status}`));
      return;
    }
    await openPost(postId);
    const panel = document.getElementById("detail-panel");
    panel.scrollTop = panel.scrollHeight;
  } catch (err) {
    alert("Network error — please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Post Reply";
  }
}

// ── HELPERS ─────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(isoStr) {
  if (!isoStr) return "";
  const date    = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z");
  const now     = new Date();
  const diffMs  = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60)  return "just now";
  if (diffMin < 60)  return `${diffMin} min ago`;
  if (diffHr < 24)   return `${diffHr} hr ago`;
  if (diffDay < 7)   return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function showStatusMsg(msg, isError = false) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 6000);
}
