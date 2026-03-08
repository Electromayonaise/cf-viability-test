import express from "express"
import cors from "cors"
import bodyParser from "body-parser"
import config from "./config/config.js"

import { fetchProblem } from "./services/problemService.js"
import { loginCF, submitCF, hasSession, clearSession, getSubmissionStatus } from "./services/cfService.js"

const app = express()

app.use(cors())
app.use(bodyParser.json())
app.use(express.static("public"))

app.get("/api/problem/:problemId", async (req, res) => {
  try {
    res.json(await fetchProblem(req.params.problemId))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/languages", (req, res) => {
  res.json([
    { id: 54,  name: "GNU C++17" },
    { id: 74,  name: "GNU C++20" },
    { id: 71,  name: "Python 3"  },
    { id: 73,  name: "PyPy 3"    },
    { id: 60,  name: "Java 11"   }
  ])
})

app.post("/api/login", async (req, res) => {
  try {
    const { handle, password } = req.body
    if (!handle || !password) return res.status(400).json({ error: "handle and password required" })
    res.json({ success: true, ...(await loginCF(handle, password)) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/session/:handle", (req, res) => {
  res.json({ handle: req.params.handle, active: hasSession(req.params.handle) })
})

app.delete("/api/session/:handle", (req, res) => {
  res.json({ handle: req.params.handle, deleted: clearSession(req.params.handle) })
})

app.post("/api/submit", async (req, res) => {
  try {
    const { handle, contestId, index, code, languageId } = req.body
    if (!handle) return res.status(400).json({ error: "handle required" })
    const result = await submitCF(contestId, index, code, languageId, handle)
    res.json({ ...result, success: true })
  } catch (err) {
    console.error(err)
    const expired = err.message.includes("expired") || err.message.includes("log in")
    res.status(expired ? 401 : 500).json({ error: err.message, sessionExpired: expired })
  }
})

// Polling de veredicto para una submission
app.get("/api/verdict/:submissionId", async (req, res) => {
  try {
    const verdict = await getSubmissionStatus(req.params.submissionId)
    res.json(verdict)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(config.server.port, () => {
  console.log("Server running on port", config.server.port)
})