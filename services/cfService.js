/**
 * cfService.js
 *
 * Login Y submit via Chrome real (child_process + CDP).
 * cf_clearance está ligado al TLS fingerprint del browser que lo generó.
 * Axios tiene TLS de Node.js → CF lo rechaza con 403.
 * Solución: ejecutar fetch() dentro del Chrome via page.evaluate().
 */

import { chromium } from "playwright"
import { spawn } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { rm } from "fs/promises"
import { fileURLToPath } from "url"
import path from "path"
import crypto from "crypto"
import config from "../config/config.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS_DIR = path.join(__dirname, "../sessions")
const PROFILES_DIR = path.join(__dirname, "../.chrome-profiles")

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })
if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Session encryption
// ---------------------------------------------------------------------------

const KEY = crypto.scryptSync(
  process.env.SESSION_SECRET || "cf-club-secret-2024", "cf-salt", 32
)

function encrypt(text) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, iv)
  return iv.toString("hex") + ":" + Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("hex")
}

function decrypt(text) {
  const [ivHex, encHex] = text.split(":")
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, Buffer.from(ivHex, "hex"))
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8")
}

function sessionPath(handle) {
  return path.join(SESSIONS_DIR, `${handle.toLowerCase()}.json`)
}

function saveSession(handle, cookies) {
  writeFileSync(sessionPath(handle), encrypt(JSON.stringify({ cookies, savedAt: Date.now() })), "utf8")
  console.log(`[CF] Session saved for ${handle} (${cookies.length} cookies).`)
}

function loadSession(handle) {
  const p = sessionPath(handle)
  if (!existsSync(p)) return null
  try { return JSON.parse(decrypt(readFileSync(p, "utf8"))).cookies }
  catch (err) { console.warn(`[CF] Could not read session for ${handle}:`, err.message); return null }
}

export function hasSession(handle) { return existsSync(sessionPath(handle)) }

export function clearSession(handle) {
  const p = sessionPath(handle)
  if (existsSync(p)) { unlinkSync(p); return true }
  return false
}

// ---------------------------------------------------------------------------
// Detect system Chrome
// ---------------------------------------------------------------------------

function findSystemChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].filter(Boolean)
  for (const p of candidates) {
    try { if (existsSync(p)) { console.log("[CF] Chrome:", p); return p } } catch (_) {}
  }
  return null
}

// ---------------------------------------------------------------------------
// Launch Chrome and capture wsUrl from stderr
// ---------------------------------------------------------------------------

function launchChrome(chromePath, profileDir, cdpPort, url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--disable-extensions",
      url
    ], { stdio: ["ignore", "ignore", "pipe"] })

    proc.on("error", reject)

    let wsUrl = null
    const timeout = setTimeout(() => {
      if (!wsUrl) reject(new Error("Chrome did not expose CDP within 20 seconds"))
    }, 20000)

    proc.stderr.on("data", chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match && !wsUrl) {
        wsUrl = match[1]
        clearTimeout(timeout)
        console.log("[CF] CDP ready:", wsUrl)
        resolve({ proc, wsUrl })
      }
    })

    proc.on("exit", code => {
      if (!wsUrl) reject(new Error(`Chrome exited (${code}) before CDP was ready`))
    })
  })
}

// ---------------------------------------------------------------------------
// loginCF — Chrome visible, user completes login manually
// ---------------------------------------------------------------------------

export async function loginCF(handle, password) {
  console.log(`[CF] Launching Chrome for login: ${handle}`)

  const chromePath = config.cf?.chromePath || findSystemChrome()
  if (!chromePath) throw new Error("Google Chrome not found.")

  const CDP_PORT = 9222
  const profileDir = path.join(PROFILES_DIR, `login-${Date.now()}`)
  mkdirSync(profileDir, { recursive: true })

  let proc = null

  try {
    const launched = await launchChrome(chromePath, profileDir, CDP_PORT, "https://codeforces.com/enter?back=%2F")
    proc = launched.proc

    const browser = await chromium.connectOverCDP(launched.wsUrl)
    const context = browser.contexts()[0]
    const page = context.pages()[0] || await context.newPage()

    try {
      await page.waitForSelector("#handleOrEmail", { timeout: 8000 })
      await page.fill("#handleOrEmail", handle)
      await page.fill("#password", password)
      console.log("[CF] Credentials pre-filled.")
    } catch (_) {
      console.log("[CF] Form not ready yet — user fills manually.")
    }

    console.log("[CF] Waiting for login (max 3 min)...")
    await page.waitForFunction(
      () => !window.location.href.includes("/enter"),
      { timeout: 180000, polling: 500 }
    )
    await page.waitForTimeout(1500)
    console.log("[CF] Login successful. URL:", page.url())

    const cookies = await context.cookies("https://codeforces.com")
    if (!cookies.length) throw new Error("No cookies obtained after login")

    saveSession(handle, cookies)
    await browser.close().catch(() => {})
    return { success: true, cookieCount: cookies.length }

  } finally {
    if (proc) { proc.kill(); console.log("[CF] Chrome closed.") }
    rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// submitCF — Chrome headless, fetch() ejecutado dentro del browser
// El TLS es del Chrome real → cf_clearance es válido → sin 403
// ---------------------------------------------------------------------------

export async function submitCF(contestId, index, code, languageId, handle) {
  const cookies = loadSession(handle)
  if (!cookies) throw new Error(`No session for ${handle}. Please log in first.`)

  console.log(`[CF] Submitting ${contestId}${index} for ${handle} via Chrome headless...`)

  const chromePath = config.cf?.chromePath || findSystemChrome()
  if (!chromePath) throw new Error("Google Chrome not found.")

  const CDP_PORT = 9223  // puerto diferente al del login
  const profileDir = path.join(PROFILES_DIR, `submit-${Date.now()}`)
  mkdirSync(profileDir, { recursive: true })

  let proc = null

  try {
    const launched = await launchChrome(chromePath, profileDir, CDP_PORT, "about:blank")
    proc = launched.proc

    const browser = await chromium.connectOverCDP(launched.wsUrl)
    const context = browser.contexts()[0]

    // Restaurar cookies de sesión en el contexto del browser
    await context.addCookies(cookies.map(c => ({
      ...c,
      domain: c.domain || "codeforces.com"
    })))

    const page = context.pages()[0] || await context.newPage()

    // Navegar a la página de submit para obtener tokens CSRF
    await page.goto("https://codeforces.com/problemset/submit", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    })

    // Verificar que no hay challenge (sesión válida)
    const title = await page.title()
    if (title.includes("moment") || title.includes("Verification")) {
      clearSession(handle)
      throw new Error(`Session for ${handle} expired. Please log in again.`)
    }

    // Extraer CSRF token desde el DOM del browser
    const csrf = await page.evaluate(() => {
      return document.querySelector("meta[name='X-Csrf-Token']")?.getAttribute("content") ||
             document.querySelector("input[name='csrf_token']")?.value || ""
    })

    if (!csrf) {
      clearSession(handle)
      throw new Error(`Could not get CSRF token. Session for ${handle} may be expired.`)
    }

    const ftaa = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/var ftaa\s*=\s*["'](.*?)["\']/);
      return m ? m[1] : ""
    })
    const bfaa = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/var bfaa\s*=\s*["'](.*?)["\']/);
      return m ? m[1] : ""
    })

    console.log(`[CF] csrf=${csrf.slice(0,8)}... ftaa="${ftaa}"`)

    // Ejecutar el submit dentro del browser usando fetch() del browser
    // Esto garantiza que cf_clearance + TLS fingerprint coincidan
    const submitResult = await page.evaluate(async ({ csrf, contestId, index, languageId, code, ftaa, bfaa }) => {
      const form = new URLSearchParams()
      form.append("csrf_token", csrf)
      form.append("submittedProblemCode", `${contestId}${index}`)
      form.append("programTypeId", String(languageId))
      form.append("source", code)
      form.append("ftaa", ftaa)
      form.append("bfaa", bfaa)
      form.append("action", "submitSolutionFormSubmitted")
      form.append("tabSize", "4")
      form.append("_tta", "176")

      const res = await fetch(`/problemset/submit?csrf_token=${csrf}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": "https://codeforces.com/problemset/submit",
          "Origin": "https://codeforces.com"
        },
        body: form.toString(),
        credentials: "include"
      })

      return { status: res.status, ok: res.ok }
    }, { csrf, contestId, index, languageId, code, ftaa, bfaa })

    console.log(`[CF] Submit response: HTTP ${submitResult.status}`)

    if (!submitResult.ok && submitResult.status !== 200) {
      throw new Error(`Submit returned HTTP ${submitResult.status}`)
    }

    // Obtener submission ID de la página de status
    await page.goto(`https://codeforces.com/problemset/status?handle=${handle}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000
    })

    const submissionId = await page.evaluate(() => {
      const row = document.querySelector("tr[data-submission-id]")
      return row ? row.getAttribute("data-submission-id") : null
    })

    if (!submissionId) {
      throw new Error("Submission sent but ID not found in status page")
    }

    console.log(`[CF] Submit OK. ID: ${submissionId}`)

    await browser.close().catch(() => {})
    return { submissionId }

  } finally {
    if (proc) { proc.kill(); console.log("[CF] Chrome (submit) closed.") }
    rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}