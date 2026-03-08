// ── State ────────────────────────────────────────────────
let currentHandle = null
let pollInterval = null
let currentSubmissionId = null

// ── Tabs ─────────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById("pane-editor").classList.toggle("active", tab === "editor")
  document.getElementById("pane-editor").classList.toggle("hidden", tab !== "editor")
  document.getElementById("pane-result").classList.toggle("active", tab === "result")
  document.getElementById("pane-result").classList.toggle("hidden", tab !== "result")
  document.getElementById("tab-editor").classList.toggle("active", tab === "editor")
  document.getElementById("tab-result").classList.toggle("active", tab === "result")
}

// ── Status banner ─────────────────────────────────────────
function setStatus(msg, type = "info") {
  const el = document.getElementById("statusBanner")
  el.textContent = msg
  el.className = `status-banner ${type}`
  el.classList.remove("hidden")
}

function clearStatus() {
  document.getElementById("statusBanner").classList.add("hidden")
}

function setModalStatus(msg, type = "info") {
  const el = document.getElementById("modalStatus")
  el.textContent = msg
  el.className = `modal-status ${type}`
  el.classList.remove("hidden")
}

// ── Session UI ────────────────────────────────────────────
function setLoggedIn(handle) {
  currentHandle = handle
  document.getElementById("userHandle").textContent = handle
  document.getElementById("userChip").classList.remove("hidden")
  document.getElementById("loginBtn").classList.add("hidden")
  document.getElementById("connectBtn").classList.add("hidden")
  document.getElementById("submitBtn").classList.remove("hidden")
}

function setLoggedOut() {
  currentHandle = null
  document.getElementById("userChip").classList.add("hidden")
  document.getElementById("loginBtn").classList.remove("hidden")
  document.getElementById("connectBtn").classList.remove("hidden")
  document.getElementById("submitBtn").classList.add("hidden")
  clearStatus()
}

// ── Modal ─────────────────────────────────────────────────
function startLogin() {
  document.getElementById("loginModal").classList.remove("hidden")
  document.getElementById("cfHandle").focus()
  document.getElementById("modalStatus").classList.add("hidden")
  document.getElementById("modalLoginBtn").disabled = false
  document.getElementById("modalLoginBtn").textContent = "Open Browser & Login"
}

function closeModal() {
  document.getElementById("loginModal").classList.add("hidden")
}

async function doLogin() {
  const handle = document.getElementById("cfHandle").value.trim()
  const password = document.getElementById("cfPassword").value
  if (!handle || !password) { setModalStatus("Handle and password are required.", "error"); return }

  const btn = document.getElementById("modalLoginBtn")
  btn.disabled = true
  btn.textContent = "Opening browser..."
  setModalStatus("A Chrome window will open. Complete the CAPTCHA if shown, then log in.", "info")

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, password })
    })
    const data = await res.json()
    if (res.ok) {
      setModalStatus(`Connected as ${handle}`, "ok")
      setTimeout(() => {
        closeModal()
        setLoggedIn(handle)
        setStatus(`Session active — submitting as ${handle}`, "ok")
      }, 800)
    } else {
      setModalStatus("Login failed: " + data.error, "error")
      btn.disabled = false
      btn.textContent = "Open Browser & Login"
    }
  } catch (err) {
    setModalStatus("Connection error: " + err.message, "error")
    btn.disabled = false
    btn.textContent = "Open Browser & Login"
  }
}

async function logout() {
  if (currentHandle) await fetch(`/api/session/${currentHandle}`, { method: "DELETE" }).catch(() => {})
  setLoggedOut()
}

// ── Problem loading ───────────────────────────────────────
async function loadProblem() {
  const problemId = document.getElementById("problemInput").value.trim()
  if (!problemId) return

  const container = document.getElementById("problemContainer")
  container.innerHTML = `<div class="empty-state"><p style="color:var(--muted)">Loading...</p></div>`

  try {
    const [problemRes] = await Promise.all([
      fetch(`/api/problem/${problemId}`),
      loadLanguages()
    ])
    const data = await problemRes.json()
    if (!problemRes.ok) throw new Error(data.error || "Failed to load problem")

    const tagsHtml = data.tags.map(t => `<span class="tag">${t}</span>`).join("")

    container.innerHTML = `
      <div class="problem-header">
        <div class="problem-title">${data.title}</div>
        <div class="problem-meta">
          <div><b>Contest</b> ${data.contestName}</div>
          <div><b>Difficulty</b> ${data.rating}</div>
          <div class="tags">${tagsHtml}</div>
        </div>
      </div>
      <div class="cf-statement">${data.statement}</div>
      <div class="problem-link" style="margin-top:24px">
        <a href="${data.link}" target="_blank">View on Codeforces ↗</a>
      </div>
    `

    // MathJax: $$$...$$$  delimiters configured in index.html
    if (window.MathJax?.typesetPromise) {
      MathJax.typesetPromise([container]).catch(console.error)
    }

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">${err.message}</p></div>`
  }
}

async function loadLanguages() {
  const res = await fetch("/api/languages")
  const langs = await res.json()
  const select = document.getElementById("language")
  select.innerHTML = ""
  langs.forEach(lang => {
    const opt = document.createElement("option")
    opt.value = lang.id
    opt.textContent = lang.name
    select.appendChild(opt)
  })
}

// ── Verdict polling ───────────────────────────────────────
function startVerdictPolling(submissionId) {
  currentSubmissionId = submissionId
  if (pollInterval) clearInterval(pollInterval)

  const resultTab = document.getElementById("tab-result")
  resultTab.disabled = false
  switchTab("result")

  document.getElementById("verdictCard").innerHTML = `
    <div class="verdict-spinner">
      <div class="spinner"></div>
      <span>Judging submission #${submissionId}...</span>
    </div>
  `
  document.getElementById("verdictMeta").classList.add("hidden")
  document.getElementById("cfLink").classList.add("hidden")

  const poll = async () => {
    try {
      const res = await fetch(`/api/verdict/${submissionId}`)
      const data = await res.json()
      renderVerdict(data)
      if (!data.judging) clearInterval(pollInterval)
    } catch (_) {}
  }

  poll()
  pollInterval = setInterval(poll, 2500)
}

function renderVerdict(data) {
  const card = document.getElementById("verdictCard")
  const meta = document.getElementById("verdictMeta")
  const link = document.getElementById("cfLink")

  if (data.judging) {
    card.innerHTML = `
      <div class="verdict-spinner">
        <div class="spinner"></div>
        <span>Judging... (test ${data.passedTests ?? 0})</span>
      </div>
    `
    return
  }

  card.innerHTML = `
    <div class="verdict-text ${data.color}">${data.verdictText}</div>
    <div class="verdict-id">Submission #${data.id}</div>
  `

  if (data.timeMs != null || data.memoryKb != null) {
    meta.classList.remove("hidden")
    meta.innerHTML = `
      ${data.timeMs != null ? `
        <div class="verdict-stat">
          <div class="verdict-stat-label">Time</div>
          <div class="verdict-stat-value">${data.timeMs} ms</div>
        </div>` : ""}
      ${data.memoryKb != null ? `
        <div class="verdict-stat">
          <div class="verdict-stat-label">Memory</div>
          <div class="verdict-stat-value">${data.memoryKb} KB</div>
        </div>` : ""}
    `
  }

  if (data.id) {
    link.href = `https://codeforces.com/problemset/submission/${data.problem?.split(/(\d+)/)[1] || ""}/${data.id}`
    link.classList.remove("hidden")
  }
}

// ── Submit ────────────────────────────────────────────────
async function submitSolution() {
  if (!currentHandle) { startLogin(); return }

  const code = document.getElementById("code").value.trim()
  const languageId = document.getElementById("language").value
  const problemId = document.getElementById("problemInput").value.trim()

  if (!code) { setStatus("Paste your solution first.", "error"); return }

  const match = problemId.replace("-", "").match(/(\d+)([A-Z0-9]+)/i)
  if (!match) { setStatus("Invalid problem ID.", "error"); return }

  const btn = document.getElementById("submitBtn")
  btn.disabled = true
  btn.textContent = "Submitting..."
  setStatus("Opening browser to submit...", "info")

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: currentHandle, contestId: match[1], index: match[2], code, languageId })
    })
    const data = await res.json()

    if (res.ok && data.submissionId) {
      setStatus(`Submitted! ID: ${data.submissionId}`, "ok")
      startVerdictPolling(data.submissionId)
    } else if (res.ok) {
      setStatus("Submitted! Check your Codeforces profile.", "ok")
    } else if (res.status === 401) {
      setLoggedOut()
      setStatus("Session expired. Please log in again.", "error")
    } else {
      setStatus("Error: " + data.error, "error")
    }
  } catch (err) {
    setStatus("Network error: " + err.message, "error")
  } finally {
    btn.disabled = false
    btn.textContent = "Submit Solution"
  }
}

// ── Keyboard shortcuts ────────────────────────────────────
document.getElementById("problemInput").addEventListener("keydown", e => {
  if (e.key === "Enter") loadProblem()
})
document.getElementById("loginModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal()
})
document.getElementById("cfPassword").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin()
})

loadLanguages()