// BoardCtrl – Firebase v9 modular; roles from Firestore users/{uid}.role only

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp, Timestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, signOut, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJk3o9KTrgpO5zb33oEBlmzDg_7YOZOIU",
  authDomain: "dictbulletin-30f00.firebaseapp.com",
  projectId: "dictbulletin-30f00",
  storageBucket: "dictbulletin-30f00.firebasestorage.app",
  messagingSenderId: "610920742264",
  appId: "1:610920742264:web:66a1f8a354f7c7e1229c8d",
  measurementId: "G-0LB8KEC0M5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

let posts = [], auditLog = [], usersList = [];
let currentUser = null, currentRole = null, activeView = "dashboard";
let currentFilter = "all", searchTerm = "", unsubscribers = [];

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toJsDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch { return null; }
  }
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toDatetimeLocal(value) {
  const d = toJsDate(value);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getCurrentUserLabel() {
  return currentUser ? currentUser.email || currentUser.uid : "";
}

function canModify(createdBy) {
  if (currentRole === "admin") return true;
  if (currentRole === "editor") return createdBy === getCurrentUserLabel();
  return false;
}

function docToPost(snap) {
  const d = snap.data();
  return {
    id: snap.id,
    postType: d.postType || "announcement",
    title: d.title || "",
    content: d.content || "",
    urgent: !!d.urgent,
    pinned: !!d.pinned,
    location: d.location || "",
    priority: d.priority || "normal",
    hasSchedule: !!d.hasSchedule,
    start: d.start,
    end: d.end,
    createdBy: d.createdBy || "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

function buildPostPayload(vals) {
  const hasBoth = !!(vals.start && vals.end);
  const payload = {
    postType: vals.postType,
    title: vals.title,
    content: vals.content || "",
    urgent: !!vals.urgent,
    pinned: !!vals.pinned,
    location: vals.location || "",
    priority: vals.priority || "normal",
    hasSchedule: hasBoth,
    updatedAt: serverTimestamp()
  };
  if (hasBoth) {
    payload.start = Timestamp.fromDate(new Date(vals.start));
    payload.end = Timestamp.fromDate(new Date(vals.end));
  }
  return payload;
}

async function addAuditLog(action) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "auditLog"), {
      user: getCurrentUserLabel(),
      action,
      timestamp: serverTimestamp()
    });
  } catch (err) { console.error("Audit log write failed:", err); }
}

async function ensureUserAndGetRole(uid, email) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, { email: email || "", username: email || uid, role: "editor" });
    return "editor";
  }
  return snap.data().role === "admin" ? "admin" : "editor";
}

function showLoginError(msg) {
  const el = document.getElementById("loginError");
  el.style.display = "block";
  el.textContent = msg;
}
function clearLoginError() {
  const el = document.getElementById("loginError");
  el.style.display = "none";
  el.textContent = "";
}
function showLogin() {
  document.getElementById("loginOverlay").style.display = "flex";
  document.getElementById("mainApp").style.display = "none";
}
function showApp() {
  document.getElementById("loginOverlay").style.display = "none";
  document.getElementById("mainApp").style.display = "flex";
}
function updateUserUI() {
  const label = getCurrentUserLabel();
  document.getElementById("mainUserName").textContent = label;
  document.getElementById("sidebarUser").textContent = label;
  document.getElementById("sidebarRole").textContent = currentRole || "-";
  document.querySelector(".app").classList.toggle("editor-mode", currentRole === "editor");
}

function unsubscribeAll() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
}

function subscribeFirestore() {
  unsubscribeAll();
  unsubscribers.push(onSnapshot(collection(db, "posts"), (snap) => {
    posts = snap.docs.map(docToPost);
    render();
  }, (err) => console.error("Posts listener error:", err)));

  if (currentRole === "admin") {
    unsubscribers.push(onSnapshot(
      query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(100)),
      (snap) => {
        auditLog = snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, user: data.user || "", action: data.action || "", timestamp: toJsDate(data.timestamp) };
        });
        render();
      },
      (err) => console.error("Audit log listener error:", err)
    ));
    unsubscribers.push(onSnapshot(collection(db, "users"), (snap) => {
      usersList = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          username: data.username || data.email || d.id,
          email: data.email || "",
          role: data.role === "admin" ? "admin" : "editor"
        };
      });
      render();
    }, (err) => console.error("Users listener error:", err)));
  }
}

async function handleAuthState(user) {
  if (!user) {
    currentUser = null;
    currentRole = null;
    posts = [];
    auditLog = [];
    usersList = [];
    unsubscribeAll();
    showLogin();
    return;
  }
  currentUser = user;
  try {
    currentRole = await ensureUserAndGetRole(user.uid, user.email);
  } catch (err) {
    console.error("Failed to load user role:", err);
    showLoginError(err.message || "Could not load user profile.");
    try { await signOut(auth); } catch (e) { console.error(e); }
    return;
  }
  updateUserUI();
  showApp();
  subscribeFirestore();
  setView("dashboard");
}

function scheduleStatusText(startStr, endStr) {
  if (startStr && endStr) {
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      return "Scheduled: " + s.toLocaleString() + " to " + e.toLocaleString();
    }
  }
  return "No schedule set";
}

function showScheduleModal(currentStart, currentEnd, onSave) {
  const startVal = currentStart ? toDatetimeLocal(currentStart) : toDatetimeLocal(new Date());
  const endVal = currentEnd ? toDatetimeLocal(currentEnd) : toDatetimeLocal(new Date(Date.now() + 3600000));
  const now = new Date().toISOString().slice(0, 16);
  const modalHtml = `
        <div class="modal-overlay" id="scheduleModalOverlay" style="z-index: 1100;">
            <div class="modal" style="max-width: 450px;">
                <h3>Set Schedule</h3>
                <div class="range-row">
                    <div><label>Start</label><input type="datetime-local" id="scheduleStart" value="${startVal}" min="${now}"></div>
                    <div><label>End</label><input type="datetime-local" id="scheduleEnd" value="${endVal}" min="${now}"></div>
                </div>
                <div class="modal-actions">
                    <button class="btn" id="scheduleCancel">Cancel</button>
                    <button class="btn btn-primary" id="scheduleSave">Save</button>
                </div>
            </div>
        </div>
    `;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  const modalDiv = document.getElementById("scheduleModalOverlay");
  document.getElementById("scheduleCancel").onclick = () => modalDiv.remove();
  document.getElementById("scheduleSave").onclick = () => {
    const start = document.getElementById("scheduleStart").value;
    const end = document.getElementById("scheduleEnd").value;
    if (!start || !end) {
      alert("Both Start and End are required.");
      return;
    }
    modalDiv.remove();
    onSave(start, end);
  };
}

function showPostModal(title, postData, onSave) {
  const type = postData.postType || "announcement";
  const scheduleDraft = {
    start: postData.start ? toDatetimeLocal(postData.start) : "",
    end: postData.end ? toDatetimeLocal(postData.end) : ""
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "postModalOverlay";
  const modal = document.createElement("div");
  modal.className = "modal";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  modal.appendChild(h3);

  function addField(labelText, inputEl) {
    const group = document.createElement("div");
    group.className = "field-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    group.append(label, inputEl);
    modal.appendChild(group);
  }

  const typeSelect = document.createElement("select");
  typeSelect.id = "modal_type";
  ["announcement", "memo", "order", "travel"].forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v === "announcement" ? "Announcement" : v === "memo" ? "Memo" : v === "order" ? "Office Order" : "Travel Order";
    if (v === type) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  addField("Post Type", typeSelect);

  const titleInput = document.createElement("input");
  titleInput.id = "modal_title";
  titleInput.value = postData.title || "";
  addField("Title", titleInput);

  const contentInput = document.createElement("textarea");
  contentInput.id = "modal_content";
  contentInput.rows = 4;
  contentInput.placeholder = "Write the full description here...";
  contentInput.value = postData.content || "";
  contentInput.required = true;
  contentInput.style.width = "100%";
  contentInput.style.padding = "8px";
  contentInput.style.borderRadius = "12px";
  contentInput.style.border = "1px solid var(--border)";
  contentInput.style.background = "var(--bg)";
  contentInput.style.fontFamily = "inherit";
  contentInput.style.resize = "vertical";
  addField("Description", contentInput);

  const contentError = document.createElement("p");
  contentError.style.display = "none";
  contentError.style.margin = "4px 0 0";
  contentError.style.fontSize = "0.85rem";
  contentError.style.color = "#b91c1c";
  modal.appendChild(contentError);

  function addRadioFieldGroup(labelText, radioName, yesChecked) {
    const group = document.createElement("div");
    group.className = "field-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    group.appendChild(label);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "1rem";
    row.style.marginTop = "4px";

    [["yes", "Yes", yesChecked], ["no", "No", !yesChecked]].forEach(([val, text, checked]) => {
      const wrap = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = val;
      if (checked) radio.checked = true;
      wrap.append(radio, document.createTextNode(" " + text));
      row.appendChild(wrap);
    });

    group.appendChild(row);
    modal.appendChild(group);
  }

  addRadioFieldGroup("Urgent", "urgentRadio", !!postData.urgent);
  addRadioFieldGroup("Pinned", "pinnedRadio", !!postData.pinned);

  const locationInput = document.createElement("input");
  locationInput.id = "modal_location";
  locationInput.value = postData.location || "";
  addField("Location", locationInput);

  const prioritySelect = document.createElement("select");
  prioritySelect.id = "modal_priority";
  [["high", "High"], ["normal", "Normal"], ["low", "Low"]].forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    const p = postData.priority || "normal";
    if (val === p || (val === "normal" && !p)) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  addField("Priority", prioritySelect);

  const scheduleGroup = document.createElement("div");
  scheduleGroup.className = "field-group";
  const scheduleLabel = document.createElement("label");
  scheduleLabel.textContent = "Schedule";
  scheduleGroup.appendChild(scheduleLabel);

  const scheduleStatus = document.createElement("div");
  scheduleStatus.id = "scheduleStatus";
  scheduleStatus.className = "schedule-status";
  scheduleStatus.textContent = scheduleStatusText(scheduleDraft.start, scheduleDraft.end);
  scheduleGroup.appendChild(scheduleStatus);

  const openScheduleBtn = document.createElement("button");
  openScheduleBtn.type = "button";
  openScheduleBtn.id = "openScheduleBtn";
  openScheduleBtn.className = "schedule-button";
  const updateScheduleBtnLabel = () => {
    openScheduleBtn.textContent =
      scheduleDraft.start && scheduleDraft.end ? "Edit Schedule" : "Add Schedule";
  };
  updateScheduleBtnLabel();
  openScheduleBtn.onclick = () => {
    showScheduleModal(scheduleDraft.start, scheduleDraft.end, (start, end) => {
      scheduleDraft.start = start;
      scheduleDraft.end = end;
      scheduleStatus.textContent = scheduleStatusText(scheduleDraft.start, scheduleDraft.end);
      updateScheduleBtnLabel();
    });
  };
  scheduleGroup.appendChild(openScheduleBtn);
  modal.appendChild(scheduleGroup);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save";
  actions.append(cancelBtn, saveBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  cancelBtn.onclick = closeModal;
  saveBtn.onclick = async () => {
    const vals = {
      postType: typeSelect.value,
      title: titleInput.value.trim(),
      content: contentInput.value.trim(),
      urgent: overlay.querySelector('input[name="urgentRadio"]:checked').value === "yes",
      pinned: overlay.querySelector('input[name="pinnedRadio"]:checked').value === "yes",
      location: locationInput.value.trim(),
      priority: prioritySelect.value,
      start: scheduleDraft.start,
      end: scheduleDraft.end
    };
    contentError.style.display = "none";
    if (!vals.title) { alert("Title is required."); return; }
    if (!vals.content) {
      contentError.textContent = "Description is required.";
      contentError.style.display = "block";
      contentInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await onSave(vals);
      closeModal();
    } catch (err) {
      console.error(err);
      alert(err.message || "Save failed.");
      saveBtn.disabled = false;
    }
  };
}

async function newPost() {
  showPostModal("Create New Post", { postType: "announcement", urgent: false, pinned: false, location: "", priority: "normal", content: "" }, async (vals) => {
    const payload = buildPostPayload(vals);
    payload.createdBy = getCurrentUserLabel();
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "posts"), payload);
    await addAuditLog(`created ${vals.postType} "${vals.title}"`);
  });
}

async function editPost(id) {
  const post = posts.find((p) => p.id === id);
  if (!post || !canModify(post.createdBy)) { alert("Not allowed"); return; }
  showPostModal("Edit Post", post, async (vals) => {
    const payload = buildPostPayload(vals);
    if (!payload.hasSchedule) {
      payload.start = deleteField();
      payload.end = deleteField();
    }
    await updateDoc(doc(db, "posts", id), payload);
    await addAuditLog(`edited ${vals.postType} "${vals.title}"`);
  });
}

async function deletePost(id) {
  const post = posts.find((p) => p.id === id);
  if (!post || !canModify(post.createdBy)) { alert("Not allowed"); return; }
  if (!confirm(`Delete "${post.title}"?`)) return;
  try {
    await deleteDoc(doc(db, "posts", id));
    await addAuditLog(`deleted ${post.postType} "${post.title}"`);
  } catch (err) { alert(err.message || "Delete failed."); }
}

async function toggleUrgent(id) {
  const post = posts.find((p) => p.id === id);
  if (!post || !canModify(post.createdBy)) return;
  try {
    await updateDoc(doc(db, "posts", id), { urgent: !post.urgent, updatedAt: serverTimestamp() });
    await addAuditLog(`${post.urgent ? "Unurgent" : "Urgent"} ${post.title}`);
  } catch (err) { alert(err.message || "Update failed."); }
}

async function togglePinned(id) {
  const post = posts.find((p) => p.id === id);
  if (!post || !canModify(post.createdBy)) return;
  try {
    await updateDoc(doc(db, "posts", id), { pinned: !post.pinned, updatedAt: serverTimestamp() });
    await addAuditLog(`${post.pinned ? "Unpinned" : "Pinned"} ${post.title}`);
  } catch (err) { alert(err.message || "Update failed."); }
}

function renderDashboard() {
  const urgentCount = posts.filter((p) => p.urgent).length;
  const scheduledCount = posts.filter((p) => p.hasSchedule).length;

  const recentRows = auditLog.slice(0, 5).map((l) => {
    const ts = l.timestamp ? escapeHtml(l.timestamp.toLocaleTimeString()) : "";
    return `<tr><td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(l.user)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(l.action)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${ts}ns<\/td></td>`;
  }).join("");

  const activitySection = currentRole === "admin"
    ? `<tr><div class="section-header">Recent Activity</div><div class="section-content">
        <table class="data-table"><thead><tr><th>User</th><th>Action</th><th>Time</th></tr></thead>
        <tbody>${recentRows || '<td><td colspan="3">No activity yet<\/td><\/tr>'}</tbody>
        </table></div></td>`
    : "";

  let postsSection = "";
  if (currentRole === "editor") {
    const allPostsRows = posts.map((p) => {
      const created = toJsDate(p.createdAt);
      const createdStr = created ? created.toLocaleDateString() : "";
      const id = escapeHtml(p.id);
      const editable = canModify(p.createdBy);
      return `<tr>
        <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(p.title)}</td>
        <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(p.postType)}</td>
        <td style="border:1px solid var(--border);padding:0.5rem;">${createdStr}</td>
        <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(p.createdBy)}</td>
        <td style="border:1px solid var(--border);padding:0.5rem;">
          ${editable ? `<button class="btn" data-action="edit" data-id="${id}">Edit</button>` : ""}
          ${editable ? `<button class="btn" data-action="delete" data-id="${id}">Delete</button>` : ""}
        </td>
      </tr>`;
    }).join("");

    postsSection = `<td>
      <div class="section-header">All Posts</div>
      <div class="section-content">
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Title</th><th>Type</th><th>Created</th><th>Created By</th><th>Actions</th></tr></thead>
          <tbody>${allPostsRows || '<td><td colspan="5">No posts yet<\/td><\/tr>'}</tbody>
        </table>
      </div>
    </td>`;
  }

  let statsHtml = `
    <table class="dashboard-table">
      <tr>
        <td colspan="${currentRole === "admin" ? 1 : 2}">
          <div class="section-header">Overview</div>
          <div class="section-content">
            <div style="display:flex;gap:1rem;justify-content:space-around;">
              <div><div class="stat-number">${posts.length}</div><div>Total Posts</div></div>
              <div><div class="stat-number">${urgentCount}</div><div>Urgent</div></div>
              <div><div class="stat-number">${scheduledCount}</div><div>With Schedule</div></div>
            </div>
          </div>
        </td>
        ${activitySection}
      </tr>
      ${postsSection}
  `;

  if (currentRole === "admin") {
    statsHtml += `<tr><td colspan="2"><div class="section-header">Quick Actions</div><div class="section-content"><button class="btn btn-primary" id="quickNewPost">+ New Post</button></div><\/td><\/tr>`;
  }
  statsHtml += `<\/table>`;

  document.getElementById("viewContainer").innerHTML = statsHtml;
  document.getElementById("quickNewPost")?.addEventListener("click", newPost);
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { id, action } = btn.dataset;
      if (action === "edit") editPost(id);
      else if (action === "delete") deletePost(id);
    });
  });
}

function renderPosts() {
  const filtered = posts.filter((p) => {
    if (currentFilter !== "all" && p.postType !== currentFilter) return false;
    if (searchTerm && !p.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const cards = filtered.map((post) => {
    const editable = canModify(post.createdBy);
    let scheduleInfo = "";
    if (post.hasSchedule && post.start && post.end) {
      const s = toJsDate(post.start), e = toJsDate(post.end);
      if (s && e) {
        scheduleInfo = `<div style="margin-top:6px;padding-top:4px;border-top:1px solid var(--border);">
          ${escapeHtml(s.toLocaleString())} to ${escapeHtml(e.toLocaleString())}</div>`;
      }
    }
    let locationPriority = "";
    if (post.location || post.priority) {
      locationPriority = `<div style="font-size:0.7rem;color:var(--text-secondary);margin-top:4px;">
        ${escapeHtml(post.location || "No location")} | ${escapeHtml(post.priority || "No priority")}</div>`;
    }
    const created = toJsDate(post.createdAt);
    const createdStr = created ? created.toLocaleString() : "";
    const id = escapeHtml(post.id);
    return `<div class="post-card">
      <div><span class="post-type-badge badge-${escapeHtml(post.postType)}">${escapeHtml(post.postType)}</span>
        ${post.urgent ? '<span class="badge-urgent">Urgent</span> ' : ""}
        ${post.pinned ? '<span class="badge-pinned">Pinned</span>' : ""}</div>
      <div style="font-weight:600;margin:6px 0;">${escapeHtml(post.title)}</div>
      <div style="font-size:0.7rem;">Created: ${escapeHtml(createdStr)}</div>
      ${locationPriority}${scheduleInfo}
      <div style="font-size:0.7rem;">by ${escapeHtml(post.createdBy)}</div>
      ${editable ? `<div style="margin-top:10px;">
        <button class="btn" data-action="edit" data-id="${id}">Edit</button>
        <button class="btn" data-action="urgent" data-id="${id}">${post.urgent ? "Unurgent" : "Urgent"}</button>
        <button class="btn" data-action="pin" data-id="${id}">${post.pinned ? "Unpin" : "Pin"}</button>
        <button class="btn" data-action="delete" data-id="${id}">Delete</button></div>` : "<div><em>Read only</em></div>"}
    </div>`;
  }).join("");

  document.getElementById("viewContainer").innerHTML = `
    <table class="dashboard-table"><tr><td>
      <div class="section-header"><span>All Posts</span><button class="btn btn-primary" id="newPostBtn">+ New Post</button></div>
      <div class="section-content">
        <div class="filter-bar">${["all", "announcement", "memo", "order", "travel"].map((f) =>
          `<div class="filter-chip ${currentFilter === f ? "active" : ""}" data-filter="${escapeHtml(f)}">${escapeHtml(f === "all" ? "All" : f)}</div>`
        ).join("")}</div>
        <input type="text" id="postSearch" placeholder="Search by title..." style="width:100%;padding:6px;margin-bottom:1rem;border-radius:20px;border:1px solid var(--border);background:var(--bg);">
        <div id="postsList">${cards || '<div style="text-align:center;padding:2rem;">No posts match</div>'}</div>
      </div><\/td><\/tr>
    <\/table>`;

  document.getElementById("newPostBtn")?.addEventListener("click", newPost);
  document.getElementById("postSearch")?.addEventListener("input", (e) => { searchTerm = e.target.value; renderPosts(); });
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => { currentFilter = chip.dataset.filter; renderPosts(); });
  });
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { id, action } = btn.dataset;
      if (action === "edit") editPost(id);
      else if (action === "delete") deletePost(id);
      else if (action === "urgent") toggleUrgent(id);
      else if (action === "pin") togglePinned(id);
    });
  });
}

function renderActivity() {
  if (currentRole !== "admin") {
    document.getElementById("viewContainer").innerHTML = '<div class="empty-state">Access denied</div>';
    return;
  }
  const rows = auditLog.map((l) => {
    const ts = l.timestamp ? escapeHtml(l.timestamp.toLocaleString()) : "";
    return `<tr><td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(l.user)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(l.action)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${ts}ns<\/td><tr>`;
  }).join("");
  document.getElementById("viewContainer").innerHTML = `
    <table class="dashboard-table"><tr><td><div class="section-header">Activity Log</div>
    <div class="section-content"><table class="data-table">
    <thead><tr><th>User</th><th>Action</th><th>Timestamp</th></tr></thead>
    <tbody>${rows || '<td><td colspan="3">No activity yet<\/td><\/tr>'}</tbody></table></div><\/td><\/tr><\/table>`;
}

function showCreateUserModal() {
  // Remove existing modal if any
  const existing = document.getElementById("createUserModalOverlay");
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal-overlay" id="createUserModalOverlay" style="z-index: 1200;">
      <div class="modal" style="max-width: 450px;">
        <h3>Create Editor User</h3>
        <div class="field-group">
          <label>Email</label>
          <input type="email" id="newUserEmail" placeholder="editor@example.com">
          <div id="emailError" class="field-error" style="display:none;"></div>
        </div>
        <div class="field-group">
          <label>Password</label>
          <input type="password" id="newUserPassword" placeholder="at least 6 characters">
          <div id="passwordError" class="field-error" style="display:none;"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="cancelCreateUserBtn">Cancel</button>
          <button class="btn btn-primary" id="confirmCreateUserBtn">Create User</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  const modalDiv = document.getElementById("createUserModalOverlay");
  const emailInput = document.getElementById("newUserEmail");
  const passwordInput = document.getElementById("newUserPassword");
  const emailError = document.getElementById("emailError");
  const passwordError = document.getElementById("passwordError");

  function clearErrors() {
    emailError.style.display = "none";
    passwordError.style.display = "none";
  }

  function hideErrorOnInput() {
    emailInput.addEventListener("input", () => { emailError.style.display = "none"; });
    passwordInput.addEventListener("input", () => { passwordError.style.display = "none"; });
  }
  hideErrorOnInput();

  modalDiv.addEventListener("click", (e) => {
    if (e.target === modalDiv) modalDiv.remove();
  });

  document.getElementById("cancelCreateUserBtn").onclick = () => modalDiv.remove();
  document.getElementById("confirmCreateUserBtn").onclick = async () => {
    clearErrors();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    let isValid = true;

    if (!email || !email.includes("@")) {
      emailError.textContent = "Valid email is required.";
      emailError.style.display = "block";
      isValid = false;
    }
    if (!password || password.length < 6) {
      passwordError.textContent = "Password must be at least 6 characters.";
      passwordError.style.display = "block";
      isValid = false;
    }
    if (!isValid) return;

    const createBtn = document.getElementById("confirmCreateUserBtn");
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      // Create Firestore user document with role "editor"
      await setDoc(doc(db, "users", uid), {
        email: email,
        username: email.split("@")[0],
        role: "editor"
      });
      await addAuditLog(`Created new editor user: ${email}`);
      alert(`✅ User created successfully!\n\nEmail: ${email}\nRole: editor`);
      modalDiv.remove();
    } catch (err) {
      console.error(err);
      let message = err.message;
      if (err.code === "auth/email-already-in-use") {
        message = "Email already registered. Use a different email.";
      } else if (err.code === "auth/weak-password") {
        message = "Password is too weak (minimum 6 characters).";
      }
      alert(`❌ Error: ${message}`);
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = "Create User";
    }
  };
}

function renderUsers() {
  if (currentRole !== "admin") return;
  const rows = usersList.map((u) => {
    const uid = escapeHtml(u.id);
    return `<tr><td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(u.username)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(u.email)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">${escapeHtml(u.role)}</td>
      <td style="border:1px solid var(--border);padding:0.5rem;">
        ${u.role !== "admin" ? `<button class="btn" data-promote="${uid}">Make Admin</button>
        <button class="btn" data-remove-user="${uid}">Remove</button>` : "-"}
      </td>
    </tr>`;
  }).join("");

  document.getElementById("viewContainer").innerHTML = `
    <table class="dashboard-table">
      <tr>
        <td>
          <div class="section-header">
            <span>Users</span>
            <button class="btn btn-primary" id="createUserBtn">+ Create User</button>
          </div>
          <div class="section-content">
            <table class="data-table">
              <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
              <tbody>${rows || '<td><td colspan="4">No users in collection<\/td><\/tr>'}</tbody>
            </table>
          </div>
        <\/td>
      <\/tr>
    <\/table>`;

  document.getElementById("createUserBtn")?.addEventListener("click", showCreateUserModal);
  document.querySelectorAll("[data-promote]").forEach((btn) => {
    btn.addEventListener("click", () => promoteUser(btn.dataset.promote));
  });
  document.querySelectorAll("[data-remove-user]").forEach((btn) => {
    btn.addEventListener("click", () => deleteUser(btn.dataset.removeUser));
  });
}

async function promoteUser(id) {
  const u = usersList.find((x) => x.id === id);
  if (!u || u.role === "admin") return;
  try {
    await updateDoc(doc(db, "users", id), { role: "admin" });
    await addAuditLog(`Promoted ${u.email} to admin`);
    alert("Role updated in Firestore. The user must sign out and sign back in for the new role to take effect.");
  } catch (err) { alert(err.message || "Promotion failed."); }
}

async function deleteUser(id) {
  if (!confirm("Remove this user record from Firestore?")) return;
  try {
    await deleteDoc(doc(db, "users", id));
    await addAuditLog("Removed user record");
  } catch (err) { alert(err.message || "Remove failed."); }
}

function render() {
  if (activeView === "dashboard") renderDashboard();
  else if (activeView === "posts") renderPosts();
  else if (activeView === "activity") renderActivity();
  else if (activeView === "users") renderUsers();
}

function setView(view) {
  if (currentRole === "editor" && ["activity", "users"].includes(view)) {
    alert("Access denied");
    return;
  }
  activeView = view;
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("active");
  render();
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  clearLoginError();
  try {
    await signInWithEmailAndPassword(auth, document.getElementById("loginEmail").value.trim(), document.getElementById("loginPassword").value);
  } catch (err) { showLoginError(err.message); }
});

document.getElementById("googleLoginBtn").addEventListener("click", async () => {
  clearLoginError();
  try { await signInWithPopup(auth, googleProvider); }
  catch (err) { showLoginError(err.message); }
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (err) { console.error(err); }
});

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => setView(el.dataset.view));
});

document.getElementById("globalSearch")?.addEventListener("input", (e) => {
  searchTerm = e.target.value;
  if (activeView === "posts") renderPosts();
});

onAuthStateChanged(auth, handleAuthState);