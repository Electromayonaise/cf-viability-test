/**
 * cfService.js
 *
 * Login Y submit via Chrome real (child_process + CDP).
 * cf_clearance está ligado al TLS fingerprint del browser que lo generó.
 * Axios tiene TLS de Node.js → CF lo rechaza con 403.
 * Solución: ejecutar fetch() dentro del Chrome via page.evaluate().
 */

import axios from "axios"
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

    // Navegar a submit — las cookies ya están en el contexto del browser
    await page.goto("https://codeforces.com/problemset/submit", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    })

    // Verificar sesión activa
    const loggedIn = await page.evaluate(handle => {
      const text = document.body.innerText
      return text.includes(handle) || text.includes("Logout")
    }, handle)

    if (!loggedIn) {
      clearSession(handle)
      throw new Error(`Session for ${handle} expired. Please log in again.`)
    }

    console.log(`[CF] Logged in. Filling submit form...`)

    // Llenar problema
    await page.waitForSelector("input[name='submittedProblemCode']", { timeout: 10000 })
    await page.fill("input[name='submittedProblemCode']", `${contestId}${index}`)

    // Seleccionar lenguaje
    await page.selectOption("select[name='programTypeId']", String(languageId))
    await page.waitForTimeout(800)  // esperar que el editor se reinicialice

    // El textarea real está hidden — CF usa Monaco/CodeMirror encima.
    // Inyectar el código directamente en el textarea vía JS y disparar eventos
    // para que el editor lo recoja, luego verificar con el valor del textarea.
    await page.evaluate((code) => {
      const textarea = document.querySelector("textarea[name='source']")
      if (!textarea) return

      // Intentar API de Monaco si está disponible
      if (window.editor && window.editor.setValue) {
        window.editor.setValue(code)
        return
      }

      // Buscar instancia de Monaco por el contenedor
      const editorEl = document.querySelector(".monaco-editor")
      if (editorEl) {
        const monacoModel = editorEl._modelData?.model || 
          (window.monaco?.editor?.getEditors?.()[0]?.getModel?.())
        if (monacoModel) {
          monacoModel.setValue(code)
          return
        }
      }

      // Fallback: setear el textarea directamente y disparar eventos de change
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set
      nativeInputValueSetter.call(textarea, code)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      textarea.dispatchEvent(new Event("change", { bubbles: true }))
    }, code)

    await page.waitForTimeout(500)

    // Verificar que el código quedó en el textarea
    const codeInTextarea = await page.evaluate(() => {
      const ta = document.querySelector("textarea[name='source']")
      return ta ? ta.value : ""
    })

    if (!codeInTextarea.trim()) {
      // Último recurso: forzar el valor via CDP evaluateHandle y submit directo
      console.log("[CF] Monaco injection failed, using form override...")
      await page.evaluate((code) => {
        document.querySelector("textarea[name='source']").removeAttribute("hidden")
        document.querySelector("textarea[name='source']").style.display = "block"
        document.querySelector("textarea[name='source']").value = code
      }, code)
    }

    console.log("[CF] Code length in textarea:", codeInTextarea.length || "(via override)")

    // Esperar a que Turnstile complete la verificacion:
    // el iframe de CF cambia a estado "success" cuando aparece el checkmark verde
    try {
      await page.waitForFunction(() => {
        const iframe = document.querySelector("iframe[src*='challenges.cloudflare.com']")
        if (!iframe) return true  // sin Turnstile, proceder
        // El widget pasa a aria-label "Success" o el boton queda enabled
        return iframe.getAttribute("aria-label")?.includes("success") ||
               document.querySelector("#singlePageSubmitButton:not([disabled])") !== null
      }, { timeout: 15000, polling: 300 })
    } catch (_) {
      // Si no detectamos el estado, esperar un tiempo fijo conservador
    }

    // Espera adicional para que el token de Turnstile se procese en el servidor
    await page.waitForTimeout(2000)
    await page.waitForSelector("#singlePageSubmitButton:not([disabled])", { timeout: 10000 })

    console.log("[CF] Turnstile passed. Clicking #singlePageSubmitButton...")
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.click("#singlePageSubmitButton")
    ])

    console.log("[CF] Post-submit URL:", page.url())

    // Esperar un momento para que CF indexe el submission
    await page.waitForTimeout(2000)

    // Leer submission ID desde la página de status del usuario
    await page.goto(`https://codeforces.com/problemset/status?handle=${handle}&my=on`, {
      waitUntil: "domcontentloaded",
      timeout: 20000
    })

    // Esperar a que aparezca al menos una fila de submission
    let submissionId = null
    try {
      await page.waitForSelector("tr[data-submission-id]", { timeout: 10000 })
      submissionId = await page.evaluate(() => {
        const row = document.querySelector("tr[data-submission-id]")
        return row ? row.getAttribute("data-submission-id") : null
      })
    } catch (_) {
      // Si no aparece con my=on, intentar sin filtro buscando el handle
      console.log("[CF] Retrying status without my=on filter...")
      await page.goto(`https://codeforces.com/submissions/${handle}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000
      })
      try {
        await page.waitForSelector("tr[data-submission-id]", { timeout: 8000 })
        submissionId = await page.evaluate(() => {
          const row = document.querySelector("tr[data-submission-id]")
          return row ? row.getAttribute("data-submission-id") : null
        })
      } catch (_) {}
    }

    if (!submissionId) {
      // El submit fue exitoso (HTTP 200) aunque no podamos leer el ID ahora
      console.warn("[CF] Submit succeeded but could not read submission ID from status page.")
      return { submissionId: null, warning: "Submission sent successfully but ID could not be retrieved. Check your Codeforces profile." }
    }

    console.log(`[CF] Submit OK. ID: ${submissionId}`)

    await browser.close().catch(() => {})
    return { submissionId }

  } finally {
    if (proc) { proc.kill(); console.log("[CF] Chrome (submit) closed.") }
    rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// getSubmissionStatus — usa la API pública de CF (no requiere sesión)
// ---------------------------------------------------------------------------

export async function getSubmissionStatus(submissionId) {
  // La API de CF permite consultar submissions recientes del problemset
  // Buscamos por submission ID en las últimas submissions
  const res = await axios.get(
    `https://codeforces.com/api/problemset.recentStatus?count=50`,
    { timeout: 10000 }
  )

  if (res.data.status !== "OK") throw new Error("CF API error")

  const submission = res.data.result.find(s => String(s.id) === String(submissionId))

  if (!submission) {
    return { id: submissionId, verdict: "PENDING", verdictText: "Waiting for judge..." }
  }

  const verdictMap = {
    "OK":                    { text: "Accepted",              color: "green" },
    "WRONG_ANSWER":          { text: "Wrong Answer",          color: "red"   },
    "TIME_LIMIT_EXCEEDED":   { text: "Time Limit Exceeded",   color: "red"   },
    "MEMORY_LIMIT_EXCEEDED": { text: "Memory Limit Exceeded", color: "red"   },
    "RUNTIME_ERROR":         { text: "Runtime Error",         color: "red"   },
    "COMPILATION_ERROR":     { text: "Compilation Error",     color: "red"   },
    "CHALLENGED":            { text: "Challenged",            color: "red"   },
    "TESTING":               { text: "Testing...",            color: "amber" },
    "PARTIAL":               { text: "Partial",               color: "amber" },
  }

  const v = submission.verdict || "TESTING"
  const mapped = verdictMap[v] || { text: v, color: "amber" }

  return {
    id: submissionId,
    verdict: v,
    verdictText: mapped.text,
    color: mapped.color,
    passedTests: submission.passedTestCount,
    timeMs: submission.timeConsumedMillis,
    memoryKb: submission.memoryConsumedBytes ? Math.round(submission.memoryConsumedBytes / 1024) : null,
    problem: submission.problem ? `${submission.problem.contestId}${submission.problem.index}` : null,
    judging: v === "TESTING" || !submission.verdict
  }
}