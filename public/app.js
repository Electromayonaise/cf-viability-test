async function loadProblem() {

  const problemId =
    document.getElementById("problemInput").value

  const res =
    await fetch(`/api/problem/${problemId}`)

  const data =
    await res.json()

  await loadLanguages()

  const container =
    document.getElementById("problemContainer")

  const tagsHtml =
    data.tags.map(t => `<span class="tag">${t}</span>`).join(" ")

  let statement = data.statement

  statement = statement
    .replace(/\$\$\$/g, "\\(")
    .replace(/\\\((.*?)\\\(/g, "\\($1\\)")

  container.innerHTML = `

  <div class="problem-title">
    ${data.title}
  </div>

  <div class="problem-meta">

    <div><b>Contest:</b> ${data.contestName}</div>

    <div><b>Difficulty:</b> ${data.rating}</div>

    <div><b>Tags:</b> ${tagsHtml}</div>

  </div>

  <div class="problem-body cf-statement">
    ${statement}
  </div>

  <div class="problem-link">
    <a target="_blank" href="${data.link}">
      View on Codeforces
    </a>
  </div>

  `

  if (window.MathJax) {
    MathJax.typeset()
  }

}


async function loadLanguages() {

  const res =
    await fetch("/api/languages")

  const langs =
    await res.json()

  const select =
    document.getElementById("language")

  select.innerHTML = ""

  langs.forEach(lang => {

    const opt =
      document.createElement("option")

    opt.value = lang.id
    opt.textContent = lang.name

    select.appendChild(opt)

  })

}


async function submitSolution() {

  const code =
    document.getElementById("code").value

  const languageId =
    document.getElementById("language").value

  const problemId =
    document.getElementById("problemInput").value

  const match =
    problemId.replace("-", "").match(/(\d+)([A-Z0-9]+)/i)

  const contestId = match[1]
  const index = match[2]

  const res =
    await fetch("/api/submit", {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        contestId,
        index,
        code,
        languageId
      })

    })

  const data = await res.json()

  const box = document.createElement("div")

  box.id = "resultBox"

  box.innerHTML =
    `<b>Status:</b> Submitted`

  document
    .getElementById("submitSection")
    .appendChild(box)

  pollVerdict(contestId, data.submissionId)

}


async function pollVerdict(contestId, submissionId) {

  const interval =
    setInterval(async () => {

      const res =
        await fetch(`/api/verdict/${contestId}/${submissionId}`)

      const data =
        await res.json()

      document.getElementById("resultBox").innerHTML =
        `<b>Status:</b> ${data.verdict}`

      if (data.verdict !== "Running" && data.verdict !== "Pending") {

        clearInterval(interval)

      }

    }, 2000)

}