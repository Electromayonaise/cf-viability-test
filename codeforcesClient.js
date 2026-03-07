import * as cheerio from "cheerio";
import config from "./config/config.js";
import { createSession } from "./sessionManager.js";

const { client } = createSession();

let logged = false;

export async function login() {
  if (logged) return;

  const loginPage = await client.get(`${config.codeforces.baseUrl}/enter`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  const $ = cheerio.load(loginPage.data);
  const csrf = $('meta[name="X-Csrf-Token"]').attr("content");

  const form = new URLSearchParams();

  form.append("csrf_token", csrf);
  form.append("action", "enter");
  form.append("handleOrEmail", config.codeforces.handle);
  form.append("password", config.codeforces.password);
  form.append("remember", "on");

  await client.post(`${config.codeforces.baseUrl}/enter`, form, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0"
    }
  });

  logged = true;
}

export async function getProblem(contestId, index) {

  const url = `${config.codeforces.baseUrl}/contest/${contestId}/problem/${index}`;

  const res = await client.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  return res.data;
}

export async function getSubmitPage(contestId) {

  const url = `${config.codeforces.baseUrl}/contest/${contestId}/submit`;

  const res = await client.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  return res.data;
}

export { client };