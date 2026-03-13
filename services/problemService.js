import axios from "axios"
import * as cheerio from "cheerio"

/*
  Cache for the two large API responses.
  These lists rarely change, so we hold them in memory
  and only re-fetch after CACHE_TTL milliseconds.
*/

const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const cache = {
  problems: { data: null, fetchedAt: 0 },
  contests: { data: null, fetchedAt: 0 },
}

async function getCachedProblems() {
  const now = Date.now()
  if (cache.problems.data && now - cache.problems.fetchedAt < CACHE_TTL) {
    return cache.problems.data
  }
  const res = await axios.get("https://codeforces.com/api/problemset.problems")
  cache.problems.data = res.data.result.problems
  cache.problems.fetchedAt = now
  return cache.problems.data
}

async function getCachedContests() {
  const now = Date.now()
  if (cache.contests.data && now - cache.contests.fetchedAt < CACHE_TTL) {
    return cache.contests.data
  }
  const res = await axios.get("https://codeforces.com/api/contest.list")
  cache.contests.data = res.data.result
  cache.contests.fetchedAt = now
  return cache.contests.data
}

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

  const mirrorUrl =
    `https://mirror.codeforces.com/contest/${contestId}/problem/${index}`

  /*
    Run all three independent fetches in parallel:
    - Cached problemset metadata
    - Cached contest list
    - Problem HTML from mirror
  */

  const [problems, contests, mirrorRes] = await Promise.all([
    getCachedProblems(),
    getCachedContests(),
    axios.get(mirrorUrl),
  ])

  const problemMeta =
    problems.find(p =>
      p.contestId == contestId && p.index === index
    )

  if (!problemMeta) {
    throw new Error("Problem not found in API")
  }

  const $ = cheerio.load(mirrorRes.data)

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

  const contest = contests.find(c => c.id == contestId)

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