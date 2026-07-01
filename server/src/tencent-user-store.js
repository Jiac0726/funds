const crypto = require("node:crypto");

const SECRET_ID = process.env.TENCENT_COS_SECRET_ID || "";
const SECRET_KEY = process.env.TENCENT_COS_SECRET_KEY || "";
const BUCKET = process.env.TENCENT_COS_BUCKET || "";
const REGION = process.env.TENCENT_COS_REGION || "";
const PREFIX = String(process.env.TENCENT_COS_PREFIX || "funds-mini/users").replace(/^\/+|\/+$/g, "");

function configured() {
  return !!(SECRET_ID && SECRET_KEY && BUCKET && REGION);
}

function assertConfigured() {
  if (configured()) return;
  const error = new Error("Tencent COS user storage is not configured");
  error.status = 503;
  error.detail = "Set TENCENT_COS_SECRET_ID, TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET and TENCENT_COS_REGION.";
  throw error;
}

function userKey(openid) {
  const id = crypto.createHash("sha256").update(`funds-mini-state:${openid}`).digest("hex");
  return `${PREFIX}/${id}.json`;
}

function objectPath(key) {
  return "/" + String(key).split("/").map(encodeURIComponent).join("/");
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function hmacSha1(key, value) {
  return crypto.createHmac("sha1", key).update(value).digest("hex");
}

function authorization(method, path, host) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 900}`;
  const signKey = hmacSha1(SECRET_KEY, keyTime);
  const httpString = `${method.toLowerCase()}\n${path}\n\nhost=${host}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  return [
    "q-sign-algorithm=sha1",
    `q-ak=${SECRET_ID}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    "q-header-list=host",
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
}

async function requestObject(method, key, body) {
  assertConfigured();
  const host = `${BUCKET}.cos.${REGION}.myqcloud.com`;
  const path = objectPath(key);
  const response = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      host,
      authorization: authorization(method, path, host),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Tencent COS HTTP ${response.status}`);
    error.status = 502;
    error.detail = (await response.text()).slice(0, 1000);
    throw error;
  }
  return response;
}

async function loadUserState(openid) {
  const response = await requestObject("GET", userKey(openid));
  if (!response) return null;
  const payload = JSON.parse(await response.text());
  return payload && payload.state && typeof payload.state === "object" ? payload : null;
}

async function saveUserState(openid, state) {
  const payload = { version: 1, updatedAt: new Date().toISOString(), state };
  await requestObject("PUT", userKey(openid), JSON.stringify(payload));
  return payload;
}

module.exports = { configured, userKey, loadUserState, saveUserState, authorization };
