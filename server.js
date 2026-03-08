import express from "express"
import cors from "cors"
import bodyParser from "body-parser"
import config from "./config/config.js"

import { fetchProblem } from "./services/problemService.js"
import { loginCF, submitCF, hasSession, clearSession } from "./services/cfService.js"

const app = express()

app.use(cors())
app.use(bodyParser.json())
app.use(express.static("public"))

// Problema
app.get("/api/problem/:problemId", async (req, res) => {
  try {
    const problem = await fetchProblem(req.params.problemId)
    res.json(problem)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// Lenguajes
app.get("/api/languages", (req, res) => {
  res.json([
    { id: 54, name: "GNU C++17" },
    { id: 71, name: "Python 3" },
    { id: 73, name: "PyPy 3" },
    { id: 60, name: "Java 11" },
    { id: 74, name: "GNU C++20" }
  ])
})

// Login — abre browser visible para que el usuario resuelva Turnstile
app.post("/api/login", async (req, res) => {
  try {
    const { handle, password } = req.body
    if (!handle || !password) {
      return res.status(400).json({ error: "handle y password requeridos" })
    }
    const result = await loginCF(handle, password)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// Verificar si un usuario ya tiene sesion activa
app.get("/api/session/:handle", (req, res) => {
  const active = hasSession(req.params.handle)
  res.json({ handle: req.params.handle, active })
})

// Eliminar sesion de un usuario
app.delete("/api/session/:handle", (req, res) => {
  const deleted = clearSession(req.params.handle)
  res.json({ handle: req.params.handle, deleted })
})

// Submit
app.post("/api/submit", async (req, res) => {
  try {
    const { handle, contestId, index, code, languageId } = req.body
    if (!handle) {
      return res.status(400).json({ error: "handle requerido para submit" })
    }
    const result = await submitCF(contestId, index, code, languageId, handle)
    res.json(result)
  } catch (err) {
    console.error(err)
    // Si la sesion expiro, informar al cliente para que re-autentique
    const sessionExpired = err.message.includes("expirada") || err.message.includes("login primero")
    res.status(sessionExpired ? 401 : 500).json({
      error: err.message,
      sessionExpired
    })
  }
})

app.listen(config.server.port, () => {
  console.log("Server running on port", config.server.port)
})
