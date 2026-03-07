import * as cheerio from "cheerio";
import { login, client, getSubmitPage } from "../codeforcesClient.js";

export async function submitSolution(contestId, index, code, languageId) {

  await login();

  const submitHtml = await getSubmitPage(contestId);

  const $ = cheerio.load(submitHtml);
  const csrf = $('meta[name="X-Csrf-Token"]').attr("content");

  const form = new URLSearchParams();

  form.append("csrf_token", csrf);
  form.append("action", "submitSolutionFormSubmitted");
  form.append("submittedProblemIndex", index);
  form.append("programTypeId", languageId);
  form.append("source", code);

  await client.post(
    `https://codeforces.com/contest/${contestId}/submit`,
    form,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  /*
  obtener submissionId desde la página de status
  */

  const statusPage =
    await client.get(`https://codeforces.com/contest/${contestId}/my`);

  const $$ = cheerio.load(statusPage.data);

  const submissionRow =
    $$("table.status-frame-datatable tr[data-submission-id]").first();

  const submissionId =
    submissionRow.attr("data-submission-id");

  return {
    status: "submitted",
    submissionId
  };

}


export async function getSubmissionResult(contestId, submissionId) {

  const res =
    await client.get(`https://codeforces.com/api/contest.status?contestId=${contestId}&from=1&count=20`);

  const submissions = res.data.result;

  const sub =
    submissions.find(s => s.id == submissionId);

  if (!sub) {
    return { verdict: "Pending" };
  }

  return {
    verdict: sub.verdict || "Running",
    time: sub.timeConsumedMillis,
    memory: sub.memoryConsumedBytes
  };

}