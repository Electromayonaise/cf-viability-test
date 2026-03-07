import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import config from "./config/config.js";

import { fetchProblem } from "./services/problemService.js";
import { submitSolution, getSubmissionResult } from "./services/submissionService.js";

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

app.get("/api/problem/:problemId", async (req, res) => {

  try {

    const { problemId } = req.params;

    const problem = await fetchProblem(problemId);

    res.json(problem);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});


/*
Lenguajes soportados por Codeforces
*/

app.get("/api/languages", (req, res) => {

  res.json([

    { id: 54, name: "GNU C++17" },
    { id: 89, name: "GNU C++20" },
    { id: 50, name: "GNU C11" },
    { id: 71, name: "Python 3" },
    { id: 70, name: "PyPy 3" },
    { id: 60, name: "Java 11" },
    { id: 62, name: "Kotlin" },
    { id: 73, name: "Rust" },
    { id: 50, name: "Go" },
    { id: 43, name: "C#" }

  ]);

});


app.post("/api/submit", async (req, res) => {

  try {

    const { contestId, index, code, languageId } = req.body;

    const result =
      await submitSolution(contestId, index, code, languageId);

    res.json(result);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: err.message });

  }

});


app.get("/api/verdict/:contestId/:submissionId", async (req, res) => {

  try {

    const { contestId, submissionId } = req.params;

    const result =
      await getSubmissionResult(contestId, submissionId);

    res.json(result);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: err.message });

  }

});

app.listen(config.server.port, () => {
  console.log("Server running on port", config.server.port);
});