import axios from "axios"
import * as cheerio from "cheerio"

function parseProblemId(problemId) {

  const urlMatch = problemId.match(/problem\/(\d+)\/([A-Z0-9]+)/i)

  if (urlMatch) {
    return {
      contestId: urlMatch[1],
      index: urlMatch[2]
    }
  }

  const clean = problemId.replace("-", "")

  const match = clean.match(/(\d+)([A-Z0-9]+)/i)

  if (!match) {
    throw new Error("Invalid problem id")
  }

  return {
    contestId: match[1],
    index: match[2]
  }

}

export async function fetchProblem(problemId) {

  const { contestId, index } = parseProblemId(problemId)

  const apiRes =
    await axios.get("https://codeforces.com/api/problemset.problems")

  const problems = apiRes.data.result.problems

  const problemMeta =
    problems.find(p =>
      p.contestId == contestId && p.index === index
    )

  if (!problemMeta) {
    throw new Error("Problem not found in API")
  }

  const mirrorUrl =
    `https://mirror.codeforces.com/contest/${contestId}/problem/${index}`

  const res = await axios.get(mirrorUrl)

  const $ = cheerio.load(res.data)

  const statement = $(".problem-statement")

  if (!statement.length) {
    throw new Error("Problem statement not found")
  }

  /*
  limpiar basura visual
  */

  statement.find(".header").remove()
  statement.find(".nav-links").remove()
  statement.find(".title").remove()

  /*
  detectar ejemplos
  */

  let sample = statement.find(".sample-test")

  if (!sample.length) {
    sample = statement.find(".example")
  }

  if (sample.length) {

    console.log("Examples detected")

    sample.find(".input").each((i, el) => {

      const input = $(el)

      if (!input.find(".example-title").length) {

        input.prepend(
          `<div class="example-title">Input</div>`
        )

      }

    })

    sample.find(".output").each((i, el) => {

      const output = $(el)

      if (!output.find(".example-title").length) {

        output.prepend(
          `<div class="example-title">Output</div>`
        )

      }

    })

  }

  const contestRes =
    await axios.get("https://codeforces.com/api/contest.list")

  const contest =
    contestRes.data.result.find(c => c.id == contestId)

  return {

    title: `${index}. ${problemMeta.name}`,

    contestId,
    index,

    contestName: contest?.name || contestId,

    rating: problemMeta.rating || "unknown",

    tags: problemMeta.tags,

    statement: statement.html(),

    link:
      `https://codeforces.com/problemset/problem/${contestId}/${index}`

  }

}