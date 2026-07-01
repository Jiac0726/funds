const http = require("node:http");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8080);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const CACHE_DISABLED = process.env.CACHE_DISABLED === "1";
const VISION_PROVIDER = (process.env.VISION_PROVIDER || "chat-json").toLowerCase();
const VISION_API_URL = process.env.VISION_API_URL || "";
const VISION_API_KEY = process.env.VISION_API_KEY || "";
const VISION_MODEL = process.env.VISION_MODEL || "";
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024);
const UNLIMITED_OCR_SERVER = (process.env.UNLIMITED_OCR_SERVER || "vllm").toLowerCase();
const UNLIMITED_OCR_MAX_TOKENS = Number(process.env.UNLIMITED_OCR_MAX_TOKENS || 8192);
const UNLIMITED_OCR_NGRAM_SIZE = Number(process.env.UNLIMITED_OCR_NGRAM_SIZE || 35);
const UNLIMITED_OCR_WINDOW_SIZE = Number(process.env.UNLIMITED_OCR_WINDOW_SIZE || 128);
const UNLIMITED_OCR_IMAGE_MODE = process.env.UNLIMITED_OCR_IMAGE_MODE || "gundam";
const UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR = process.env.UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR || "";
const TUSHARE_API_URL = process.env.TUSHARE_API_URL || "https://api.tushare.pro";
const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || "";
const WX_APPID = process.env.WX_APPID || "";
const WX_APP_SECRET = process.env.WX_APP_SECRET || "";
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || "";
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 30 * 24 * 60 * 60);

const cache = new Map();

function json(res, status, body, extraHeaders = {}) {
  const payload = status === 204 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": ALLOW_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    ...extraHeaders
  });
  res.end(payload);
}

function fail(res, status, message, detail) {
  json(res, status, {
    ok: false,
    error: message,
    detail: detail ? String(detail).slice(0, 240) : undefined
  });
}

function pickCache(key) {
  if (CACHE_DISABLED) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function putCache(key, data, ttlSeconds) {
  if (CACHE_DISABLED || ttlSeconds <= 0) return;
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

function cleanCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) cache.delete(key);
  }
}

setInterval(cleanCache, 60 * 1000).unref();

function assertFundCode(code) {
  if (!/^\d{6}$/.test(code || "")) {
    const error = new Error("Invalid fund code");
    error.status = 400;
    throw error;
  }
  return code;
}

function parseCodes(value) {
  const codes = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!codes.length || codes.length > 200) {
    const error = new Error("Invalid fund code list");
    error.status = 400;
    throw error;
  }
  codes.forEach(assertFundCode);
  return codes.join(",");
}

function parseSecids(value) {
  const secids = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!secids.length || secids.length > 50 || secids.some((item) => !/^[0-9A-Z.]+$/.test(item))) {
    const error = new Error("Invalid secid list");
    error.status = 400;
    throw error;
  }
  return secids.join(",");
}

function parseRange(value) {
  const range = String(value || "y").trim();
  return /^[a-zA-Z0-9_-]{1,12}$/.test(range) ? range : "y";
}

function parseDataSource(value) {
  const source = String(value || "eastmoney").trim().toLowerCase();
  if (!["eastmoney", "fundgz", "tushare"].includes(source)) {
    const error = new Error("Invalid data source");
    error.status = 400;
    throw error;
  }
  return source;
}

function eastmoneyHeaders() {
  return {
    "accept": "application/json,text/plain,*/*",
    "user-agent": "Mozilla/5.0 funds-mini-proxy/0.1",
    "referer": "https://fund.eastmoney.com/"
  };
}

async function fetchJson(url, ttlSeconds) {
  const key = url.toString();
  const cached = pickCache(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: eastmoneyHeaders(),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Upstream HTTP ${response.status}`);
      error.status = 502;
      error.detail = text;
      throw error;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      error.status = 502;
      error.detail = text;
      throw error;
    }
    putCache(key, data, ttlSeconds);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function withTimestamp(url) {
  url.searchParams.set("_", Date.now().toString());
  return url;
}

function buildSearchUrl(key) {
  const upstream = withTimestamp(new URL("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx"));
  upstream.searchParams.set("m", "9");
  upstream.searchParams.set("key", key);
  return upstream;
}

function buildQuotesUrl(codes) {
  const upstream = withTimestamp(new URL("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo"));
  upstream.searchParams.set("pageIndex", "1");
  upstream.searchParams.set("pageSize", "200");
  upstream.searchParams.set("plat", "Android");
  upstream.searchParams.set("appType", "ttjj");
  upstream.searchParams.set("product", "EFund");
  upstream.searchParams.set("Version", "1");
  upstream.searchParams.set("deviceid", "server-proxy");
  upstream.searchParams.set("Fcodes", codes);
  return upstream;
}

function buildFundPositionUrl(code) {
  const upstream = withTimestamp(new URL("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition"));
  upstream.searchParams.set("FCODE", code);
  upstream.searchParams.set("deviceid", "Wap");
  upstream.searchParams.set("plat", "Wap");
  upstream.searchParams.set("product", "EFund");
  upstream.searchParams.set("version", "2.0.0");
  upstream.searchParams.set("Uid", "");
  return upstream;
}

function buildStockQuoteUrl(secids) {
  const upstream = withTimestamp(new URL("https://push2.eastmoney.com/api/qt/ulist.np/get"));
  upstream.searchParams.set("fields", "f1,f2,f3,f4,f12,f13,f14,f292");
  upstream.searchParams.set("fltt", "2");
  upstream.searchParams.set("secids", secids);
  upstream.searchParams.set("deviceid", "Wap");
  upstream.searchParams.set("plat", "Wap");
  upstream.searchParams.set("product", "EFund");
  upstream.searchParams.set("version", "2.0.0");
  upstream.searchParams.set("Uid", "");
  return upstream;
}

function fundPositionSecid(row) {
  const exchange = String(row && row.NEWTEXCH || "").trim();
  const code = String(row && row.GPDM || "").trim();
  return exchange && code ? `${exchange}.${code}` : "";
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapFundPositionData(positionPayload, stockQuotes = []) {
  const datas = positionPayload && positionPayload.Datas && typeof positionPayload.Datas === "object"
    ? positionPayload.Datas
    : {};
  const rawStocks = Array.isArray(datas.fundStocks) ? datas.fundStocks : [];
  const quoteByCode = (Array.isArray(stockQuotes) ? stockQuotes : []).reduce((map, row) => {
    const code = row && row.f12;
    if (code) map[String(code)] = row;
    return map;
  }, {});
  const stockPositions = rawStocks.map((row, index) => {
    const code = String(row.GPDM || "").trim();
    const quote = quoteByCode[code] || {};
    return {
      rank: index + 1,
      code,
      name: String(row.GPJC || quote.f14 || "").trim(),
      secid: fundPositionSecid(row),
      ratio: finiteNumber(row.JZBL),
      price: finiteNumber(quote.f2),
      quoteChangeRate: finiteNumber(quote.f3),
      periodChange: finiteNumber(row.PCTNVCHG),
      periodChangeType: String(row.PCTNVCHGTYPE || "").trim()
    };
  });
  const totalStockRatio = stockPositions.reduce((sum, item) => sum + (Number.isFinite(item.ratio) ? item.ratio : 0), 0);
  return {
    ok: true,
    expansion: String(positionPayload && positionPayload.Expansion || datas.Expansion || "").trim(),
    totalStockRatio,
    stockPositions
  };
}

async function fetchFundPositionData(code) {
  const positionPayload = await fetchJson(buildFundPositionUrl(code), 3600);
  const rawStocks = positionPayload && positionPayload.Datas && Array.isArray(positionPayload.Datas.fundStocks)
    ? positionPayload.Datas.fundStocks
    : [];
  const secids = rawStocks.map(fundPositionSecid).filter(Boolean).join(",");
  if (!secids) return mapFundPositionData(positionPayload, []);
  try {
    const stockPayload = await fetchJson(buildStockQuoteUrl(secids), 10);
    const stockQuotes = stockPayload && stockPayload.data && Array.isArray(stockPayload.data.diff)
      ? stockPayload.data.diff
      : [];
    return mapFundPositionData(positionPayload, stockQuotes);
  } catch (error) {
    return mapFundPositionData(positionPayload, []);
  }
}

function parseFundGzPayload(text) {
  const match = String(text || "").match(/jsonpgz\((\{.*\})\)\s*;?/s);
  if (!match) throw new Error("Invalid FundGZ response");
  return JSON.parse(match[1]);
}

async function fetchFundGzQuote(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, {
      headers: eastmoneyHeaders(),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`FundGZ HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }
    const raw = parseFundGzPayload(text);
    return {
      FCODE: raw.fundcode || code,
      SHORTNAME: raw.name || "",
      PDATE: raw.jzrq || "--",
      NAV: raw.dwjz || null,
      GSZ: raw.gsz || null,
      GSZZL: raw.gszzl || null,
      GZTIME: raw.gztime || "--"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFundGzQuotes(codes) {
  const rows = await Promise.all(codes.map((code) => fetchFundGzQuote(code).catch(() => null)));
  return { Datas: rows.filter(Boolean) };
}

function compactDate(date) {
  return String(date || "").replace(/-/g, "");
}

function dashedDate(date) {
  const text = String(date || "");
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
}

function chinaDateString(date = new Date()) {
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 10);
}

function quoteEstimateDate(row) {
  const match = String(row && row.GZTIME || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function hasLiveEstimate(row, today = chinaDateString()) {
  const gsz = Number(row && row.GSZ);
  const rate = Number(row && row.GSZZL);
  return quoteEstimateDate(row) === today && ((Number.isFinite(gsz) && gsz > 0) || Number.isFinite(rate));
}

function mergeFundGzQuoteRows(primaryRows, fallbackRows, today = chinaDateString()) {
  const primaryList = Array.isArray(primaryRows) ? primaryRows : [];
  const fallbackByCode = (Array.isArray(fallbackRows) ? fallbackRows : []).reduce((map, row) => {
    const code = row && row.FCODE;
    if (code && hasLiveEstimate(row, today)) map[code] = row;
    return map;
  }, {});
  const seen = {};
  const merged = primaryList.map((row) => {
    const code = row && row.FCODE;
    if (code) seen[code] = true;
    const fallback = code && fallbackByCode[code];
    if (!fallback || hasLiveEstimate(row, today)) return row;
    return {
      ...fallback,
      ...row,
      SHORTNAME: row.SHORTNAME || fallback.SHORTNAME,
      PDATE: row.PDATE || fallback.PDATE,
      NAV: row.NAV || fallback.NAV,
      GSZ: fallback.GSZ,
      GSZZL: fallback.GSZZL,
      GZTIME: fallback.GZTIME,
      ESTIMATE_SOURCE: "fundgz"
    };
  });
  Object.keys(fallbackByCode).forEach((code) => {
    if (!seen[code]) merged.push({ ...fallbackByCode[code], ESTIMATE_SOURCE: "fundgz" });
  });
  return merged;
}

async function withFundGzEstimateFallback(body, codes) {
  const rows = Array.isArray(body && body.Datas) ? body.Datas : [];
  const targetCodes = (Array.isArray(codes) ? codes : [])
    .filter((code) => {
      const current = rows.find((row) => row && row.FCODE === code);
      return !hasLiveEstimate(current);
    });
  if (!targetCodes.length) return body;
  try {
    const fallback = await fetchFundGzQuotes(targetCodes);
    return {
      ...body,
      Datas: mergeFundGzQuoteRows(rows, fallback.Datas)
    };
  } catch (error) {
    return body;
  }
}

function dateMonthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function tushareRows(payload) {
  const fields = payload && payload.data && Array.isArray(payload.data.fields) ? payload.data.fields : [];
  const items = payload && payload.data && Array.isArray(payload.data.items) ? payload.data.items : [];
  return items.map((values) => fields.reduce((row, field, index) => {
    row[field] = values[index];
    return row;
  }, {}));
}

async function callTushare(apiName, params, fields) {
  if (!TUSHARE_TOKEN) {
    const error = new Error("Tushare data source is not configured");
    error.status = 503;
    error.detail = "Set TUSHARE_TOKEN on the server.";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(TUSHARE_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_name: apiName,
        token: TUSHARE_TOKEN,
        params,
        fields
      }),
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok || Number(payload.code) !== 0) {
      const error = new Error(payload.msg || `Tushare HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }
    return tushareRows(payload);
  } finally {
    clearTimeout(timer);
  }
}

function mapTushareNavRows(rows, code) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      date: dashedDate(row.nav_date),
      nav: Number(row.unit_nav),
      accumNav: Number(row.accum_nav)
    }))
    .filter((row) => row.date && Number.isFinite(row.nav) && row.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((row, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    return {
      FCODE: code,
      FSRQ: row.date,
      DWJZ: String(row.nav),
      LJJZ: Number.isFinite(row.accumNav) ? String(row.accumNav) : "",
      JZZZL: previous ? (((row.nav - previous.nav) / previous.nav) * 100).toFixed(4) : "0"
    };
  });
}

async function fetchTushareHistory(code, range) {
  const months = range === "3y" ? 3 : range === "6y" ? 6 : range === "y" ? 1 : 12;
  const rows = await callTushare(
    "fund_nav",
    {
      ts_code: `${code}.OF`,
      start_date: dateMonthsAgo(months),
      end_date: compactDate(new Date().toISOString().slice(0, 10))
    },
    "ts_code,ann_date,nav_date,unit_nav,accum_nav,accum_div,net_asset,total_netasset,adj_nav"
  );
  return { Datas: mapTushareNavRows(rows, code) };
}

async function fetchTushareQuotes(codes) {
  const result = [];
  for (const code of codes) {
    const history = await fetchTushareHistory(code, "y");
    const rows = history.Datas || [];
    const latest = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    if (!latest) continue;
    result.push({
      FCODE: code,
      SHORTNAME: "",
      PDATE: latest.FSRQ,
      NAV: latest.DWJZ,
      GSZ: null,
      GSZZL: null,
      GZTIME: "--",
      NAVCHGRT: previous ? latest.JZZZL : null
    });
  }
  return { Datas: result };
}

function authConfigured() {
  return !!(WX_APPID && WX_APP_SECRET && AUTH_TOKEN_SECRET.length >= 32);
}

function encodeTokenPart(value) {
  return Buffer.from(value).toString("base64url");
}

function createAuthToken(openid, secret = AUTH_TOKEN_SECRET, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!openid || !secret || secret.length < 32) throw new Error("Auth token secret is not configured");
  const payload = encodeTokenPart(JSON.stringify({
    oid: openid,
    iat: nowSeconds,
    exp: nowSeconds + AUTH_TOKEN_TTL_SECONDS
  }));
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAuthToken(token, secret = AUTH_TOKEN_SECRET, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret || secret.length < 32) {
    const error = new Error("Invalid login token");
    error.status = 401;
    throw error;
  }
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], "base64url");
  } catch (decodeError) {
    actual = Buffer.alloc(0);
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    const error = new Error("Invalid login token");
    error.status = 401;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (decodeError) {
    const error = new Error("Invalid login token");
    error.status = 401;
    throw error;
  }
  if (!payload.oid || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
    const error = new Error("Login token expired");
    error.status = 401;
    throw error;
  }
  return payload;
}

function publicUser(openid) {
  return {
    id: crypto.createHash("sha256").update(`funds-mini:${openid}`).digest("hex").slice(0, 16)
  };
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function requireAuth(req) {
  return verifyAuthToken(bearerToken(req));
}

async function exchangeWechatCode(code) {
  if (!authConfigured()) {
    const error = new Error("WeChat login is not configured");
    error.status = 503;
    error.detail = "Set WX_APPID, WX_APP_SECRET and AUTH_TOKEN_SECRET on the server.";
    throw error;
  }
  if (!code || typeof code !== "string" || code.length > 128) {
    const error = new Error("Invalid WeChat login code");
    error.status = 400;
    throw error;
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", WX_APPID);
  url.searchParams.set("secret", WX_APP_SECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const result = await response.json();
    if (!response.ok || result.errcode || !result.openid || !result.session_key) {
      const error = new Error(result.errmsg || "WeChat login failed");
      error.status = 502;
      throw error;
    }
    return { openid: result.openid };
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Request body too large");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buffer) {
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    error.status = 400;
    error.message = "Invalid JSON body";
    throw error;
  }
}

function parseMultipart(req, buffer) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!match) {
    const error = new Error("Missing multipart boundary");
    error.status = 400;
    throw error;
  }
  const boundary = match[1] || match[2];
  const raw = buffer.toString("latin1");
  const marker = `--${boundary}`;
  const parts = raw.split(marker).slice(1, -1);
  const files = [];
  const fields = {};

  for (const part of parts) {
    const trimmed = part.startsWith("\r\n") ? part.slice(2) : part;
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = trimmed.slice(0, headerEnd);
    let dataText = trimmed.slice(headerEnd + 4);
    if (dataText.endsWith("\r\n")) dataText = dataText.slice(0, -2);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText);
    if (!disposition) continue;
    const nameMatch = /name="([^"]+)"/.exec(disposition[1]);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/.exec(disposition[1]);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const content = Buffer.from(dataText, "latin1");
    if (filenameMatch) {
      files.push({
        fieldName: nameMatch[1],
        filename: filenameMatch[1],
        contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
        buffer: content
      });
    } else {
      fields[nameMatch[1]] = content.toString("utf8");
    }
  }
  return { files, fields };
}

function cleanNumeric(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).replace(/[,，￥¥元份%\s]/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function cleanName(value) {
  return String(value || "")
    .replace(/支付宝|详情|估值|收益|净值/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function compactName(value) {
  return cleanName(value).replace(/\s+/g, "");
}

function isLikelyFundName(line) {
  const text = compactName(line);
  if (text.length < 4 || text.length > 60) return false;
  if (/^(全部|名称|金额|日收益|收益明细|交易记录|持有收益|累计收益|以上|余额宝|灵活取用|本页面|该页面)/.test(text)) return false;
  if (/进阶理财|金选|定投|稳健理财|固收|灵活取用/.test(text) && !/[A-Za-z]|ETF|QDII|LOF|FOF|混合|债券|股票|联接|配置|量化|持有期|主题/.test(text)) return false;
  return /ETF|QDII|LOF|FOF|指数|混合|债券|股票|货币|联接|配置|量化|持有期|主题|增强|优选|成长|标普|中证|军工|互联网|电池|电网|尊睿/.test(text);
}

function extractAmountCandidate(line) {
  const text = String(line || "").trim();
  if (!text || /%|占比|名称|金额|收益|排序|基金|理财|定投|金选|稳健|固收|黄金/.test(text)) return "";
  const match = text.match(/(?:^|\s)(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(?:\s|$)/);
  return cleanNumeric(match && match[1]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
}

function extractLabeledNumeric(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}[^\\d+\\-]{0,40}([+\\-]?[\\d,.]+)`, "i");
    const match = String(text || "").match(pattern);
    const value = cleanNumeric(match && match[1]);
    if (value) return value;
  }
  return "";
}

function nearbyFundName(lines, index, code) {
  const sameLine = cleanName((lines[index] || "").split(code)[0]);
  if (isLikelyFundName(sameLine)) return sameLine;
  for (let cursor = index - 1; cursor >= Math.max(0, index - 6); cursor -= 1) {
    if (isLikelyFundName(lines[cursor])) return cleanName(lines[cursor]);
  }
  return sameLine;
}

function parseAlipayTextHeuristic(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = [];
  const warnings = [];

  lines.forEach((line, index) => {
    const matches = line.match(/\b\d{6}\b/g);
    if (!matches) return;
    for (const code of matches) {
      const windowText = lines.slice(Math.max(0, index - 6), Math.min(lines.length, index + 30)).join("\n");
      const name = nearbyFundName(lines, index, code);
      const shares = extractLabeledNumeric(windowText, ["持有份额", "锁定份额", "份额"]);
      const cost = extractLabeledNumeric(windowText, ["持仓成本价", "持仓成本", "成本净值", "成本价"]);
      const amount = extractLabeledNumeric(windowText, ["持有金额", "金额(元)", "金额（元）", "市值", "资产"]);
      items.push({ code, name, shares, cost, amount, sourceText: windowText.slice(0, 300) });
    }
  });

  lines.forEach((line, index) => {
    if (!isLikelyFundName(line)) return;
    const nearbyCode = lines.slice(index, Math.min(lines.length, index + 3)).some((value) => /\b\d{6}\b/.test(value));
    if (nearbyCode) return;
    const name = cleanName(line);
    let amount = "";
    const windowLines = lines.slice(index, Math.min(lines.length, index + 8));
    for (let offset = 1; offset < windowLines.length; offset += 1) {
      if (isLikelyFundName(windowLines[offset])) break;
      amount = extractAmountCandidate(windowLines[offset]);
      if (amount) break;
    }
    if (amount) {
      items.push({ code: "", name, amount, sourceText: windowLines.join("\n").slice(0, 300) });
    }
  });

  if (!items.length) {
    warnings.push("未在文本中识别到基金持仓；支付宝全部持有页如不显示代码，建议使用已配置视觉模型的截图识别。请核对识别结果后再导入。");
  }

  return { items, warnings };
}
function extractJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  return JSON.parse(raw);
}

function aiPromptText() {
  return [
    "你是支付宝基金持仓截图识别助手。",
    "从支付宝‘全部持有’或‘资产详情’截图以及 OCR 文本中识别用户持有的基金。只输出 JSON，不要输出解释。",
    "支付宝列表表头通常是：名称/金额、日收益、持有收益、累计收益。每个基金名称下方第一列数字是持有金额 amount；不要把日收益、持有收益、累计收益识别为 amount。",
    "支付宝资产详情页中：金额(元)或持有金额是 amount，持有份额或锁定份额是 shares，持仓成本价是 cost。基金净值不是 cost，不要混淆；待确认金额、收益金额和收益率都不要写入这些字段。",
    "JSON 格式：{\"items\":[{\"code\":\"6位基金代码，没看到则空字符串\",\"name\":\"基金名称\",\"shares\":\"持有份额，没看到则空字符串\",\"cost\":\"持仓成本价或成本净值，没看到则空字符串\",\"amount\":\"持有金额\"}],\"warnings\":[\"需要用户确认的问题\"]}",
    "要求：只识别基金持仓，不识别余额宝、广告、指数行情、理财推荐或页面说明；数字去掉逗号、人民币符号和单位；不要编造基金代码；如果看不清请放入 warnings。"
  ].join("\n");
}

function visionHeaders() {
  const headers = { "content-type": "application/json" };
  if (VISION_API_KEY) headers.authorization = `Bearer ${VISION_API_KEY}`;
  return headers;
}

function assertVisionConfigured() {
  if (!VISION_API_URL || !VISION_MODEL) {
    const error = new Error("AI vision is not configured");
    error.status = 501;
    error.detail = "Set VISION_API_URL and VISION_MODEL on the server. Use VISION_PROVIDER=unlimited-ocr for Baidu Unlimited-OCR.";
    throw error;
  }
}

function chatCompletionText(data) {
  const choice = data && data.choices && data.choices[0];
  return choice && choice.message ? choice.message.content : choice && choice.text ? choice.text : "";
}

async function postVisionBody(body) {
  assertVisionConfigured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 6);
  try {
    const response = await fetch(VISION_API_URL, {
      method: "POST",
      headers: visionHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      const error = new Error(`Vision API HTTP ${response.status}`);
      error.status = 502;
      error.detail = responseText;
      throw error;
    }
    return JSON.parse(responseText);
  } finally {
    clearTimeout(timer);
  }
}

async function callVisionModel({ image, text }) {
  const content = [{ type: "text", text: `${aiPromptText()}\n\nOCR 文本：\n${text || ""}` }];
  if (image) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.contentType || "image/jpeg"};base64,${image.buffer.toString("base64")}`
      }
    });
  }

  const data = await postVisionBody({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract structured data from Chinese financial screenshots and return strict JSON." },
      { role: "user", content }
    ]
  });
  const contentText = chatCompletionText(data);
  if (!contentText) {
    const error = new Error("Vision API returned empty content");
    error.status = 502;
    error.detail = JSON.stringify(data).slice(0, 1000);
    throw error;
  }
  return extractJsonObject(contentText);
}

function cleanUnlimitedOcrText(value) {
  return String(value || "")
    .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, "\n")
    .replace(/<\|ref\|>/g, "")
    .replace(/<\|\/ref\|>/g, "\n")
    .replace(/<\|[^|]+\|>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unlimitedOcrRequestBody({ image }) {
  const imageContent = {
    type: "image_url",
    image_url: {
      url: `data:${image.contentType || "image/jpeg"};base64,${image.buffer.toString("base64")}`
    }
  };
  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "<image>document parsing." },
          imageContent
        ]
      }
    ],
    max_tokens: UNLIMITED_OCR_MAX_TOKENS,
    temperature: 0,
    skip_special_tokens: false
  };

  if (UNLIMITED_OCR_SERVER === "sglang") {
    body.images_config = { image_mode: UNLIMITED_OCR_IMAGE_MODE };
    body.custom_params = {
      ngram_size: UNLIMITED_OCR_NGRAM_SIZE,
      window_size: UNLIMITED_OCR_WINDOW_SIZE
    };
    if (UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR) {
      body.custom_logit_processor = UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR;
    }
  } else {
    body.vllm_xargs = {
      ngram_size: UNLIMITED_OCR_NGRAM_SIZE,
      window_size: UNLIMITED_OCR_WINDOW_SIZE
    };
  }

  return body;
}

async function callUnlimitedOcr({ image }) {
  const data = await postVisionBody(unlimitedOcrRequestBody({ image }));
  const contentText = chatCompletionText(data);
  if (!contentText) {
    const error = new Error("Unlimited-OCR returned empty content");
    error.status = 502;
    error.detail = JSON.stringify(data).slice(0, 1000);
    throw error;
  }
  return cleanUnlimitedOcrText(contentText);
}

async function parseScreenshotWithConfiguredEngine({ image, text }) {
  if (VISION_PROVIDER === "unlimited-ocr") {
    const ocrText = await callUnlimitedOcr({ image });
    const parsed = parseAlipayTextHeuristic([text, ocrText].filter(Boolean).join("\n"));
    return { parsed, engine: "unlimited-ocr" };
  }
  return { parsed: await callVisionModel({ image, text }), engine: "chat-json" };
}
async function resolveCodeByName(name) {
  const key = String(name || "").trim();
  if (!key) return null;
  const data = await fetchJson(buildSearchUrl(key), 300);
  const rows = Array.isArray(data.Datas) ? data.Datas : [];
  const exact = rows.find((item) => item.NAME === key || key.includes(item.NAME) || item.NAME.includes(key));
  const best = exact || rows[0];
  return best && best.CODE ? { code: best.CODE, name: best.NAME } : null;
}

async function enrichImportedItems(rawItems, rawWarnings = []) {
  const warnings = [...rawWarnings];
  const seen = new Set();
  const items = [];

  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    let code = String(raw.code || raw.fundcode || "").trim();
    let name = String(raw.name || "").trim();
    if (code && !/^\d{6}$/.test(code)) code = "";
    if (!code && name) {
      try {
        const resolved = await resolveCodeByName(name);
        if (resolved) {
          code = resolved.code;
          if (!name) name = resolved.name;
          warnings.push(`已按名称匹配基金代码：${name} -> ${code}，请确认。`);
        }
      } catch (error) {
        warnings.push(`基金名称匹配失败：${name}`);
      }
    }
    if (!code && !name) continue;
    if (code && seen.has(code)) continue;
    if (code) seen.add(code);
    if (!code) {
      warnings.push(`${name || "未命名基金"} 未匹配到基金代码，请在导入表单里补充 6 位代码。`);
    }
    items.push({
      code,
      name,
      shares: cleanNumeric(raw.shares || raw.num || raw.share),
      cost: cleanNumeric(raw.cost || raw.costNav || raw.holdingCost),
      amount: cleanNumeric(raw.amount || raw.marketValue || raw.value),
      sourceText: String(raw.sourceText || "").slice(0, 300),
      unresolved: !code
    });
  }

  const amountOnlyCodes = items.filter((item) => item.code && !item.shares && item.amount).map((item) => item.code);
  if (amountOnlyCodes.length) {
    try {
      const quoteData = await fetchJson(buildQuotesUrl(amountOnlyCodes.join(",")), 20);
      const quoteByCode = (quoteData.Datas || []).reduce((map, quote) => {
        map[quote.FCODE] = quote;
        return map;
      }, {});
      for (const item of items) {
        if (item.shares || !item.amount) continue;
        const quote = quoteByCode[item.code];
        const nav = Number(quote && quote.NAV);
        const amount = Number(item.amount);
        if (Number.isFinite(nav) && nav > 0 && Number.isFinite(amount)) {
          item.shares = (amount / nav).toFixed(2);
          item.estimatedShares = true;
          item.estimatedNav = String(nav);
          warnings.push(`${item.name || item.code} 未识别到份额，已按持有金额/最新净值估算份额。`);
        }
      }
    } catch (error) {
      warnings.push("部分基金只识别到金额，份额估算失败，请手动补充。 ");
    }
  }

  return { items, warnings };
}

async function routeGet(req, reqUrl) {
  const { pathname, searchParams } = reqUrl;

  if (pathname === "/health") {
    return { status: 200, body: { ok: true, service: "funds-api-proxy", time: new Date().toISOString() } };
  }

  if (pathname === "/api/auth/status") {
    return { status: 200, body: { ok: true, available: authConfigured() } };
  }

  if (pathname === "/api/auth/me") {
    const session = requireAuth(req);
    return { status: 200, body: { ok: true, user: publicUser(session.oid), expiresAt: session.exp } };
  }

  if (pathname === "/api/data-sources") {
    return {
      status: 200,
      body: {
        ok: true,
        sources: [
          { id: "eastmoney", label: "东方财富", available: true, supportsEstimate: true },
          { id: "fundgz", label: "天天基金估值", available: true, supportsEstimate: true },
          { id: "tushare", label: "Tushare净值", available: !!TUSHARE_TOKEN, supportsEstimate: false }
        ]
      }
    };
  }

  if (pathname === "/api/funds/search") {
    const key = String(searchParams.get("key") || "").trim();
    if (!key) return { status: 200, body: { Datas: [] } };
    return { status: 200, body: await fetchJson(buildSearchUrl(key), 300) };
  }

  if (pathname === "/api/funds/quotes") {
    const codes = parseCodes(searchParams.get("codes")).split(",");
    const source = parseDataSource(searchParams.get("source"));
    if (source === "fundgz") {
      return { status: 200, body: await fetchFundGzQuotes(codes) };
    }
    if (source === "tushare") {
      return { status: 200, body: await fetchTushareQuotes(codes) };
    }
    const body = await fetchJson(buildQuotesUrl(codes.join(",")), 20);
    return { status: 200, body: await withFundGzEstimateFallback(body, codes) };
  }

  if (pathname === "/api/index/quotes") {
    const secids = parseSecids(searchParams.get("secids"));
    const upstream = withTimestamp(new URL("https://push2.eastmoney.com/api/qt/ulist.np/get"));
    upstream.searchParams.set("fltt", "2");
    upstream.searchParams.set("fields", "f2,f3,f4,f12,f13,f14");
    upstream.searchParams.set("secids", secids);
    return { status: 200, body: await fetchJson(upstream, 10) };
  }

  const netHistoryMatch = pathname.match(/^\/api\/funds\/(\d{6})\/net-history$/);
  if (netHistoryMatch) {
    const code = assertFundCode(netHistoryMatch[1]);
    const range = parseRange(searchParams.get("range"));
    const source = parseDataSource(searchParams.get("source"));
    if (source === "tushare") {
      return { status: 200, body: await fetchTushareHistory(code, range) };
    }
    const upstream = withTimestamp(new URL("https://fundmobapi.eastmoney.com/FundMApi/FundNetDiagram.ashx"));
    upstream.searchParams.set("FCODE", code);
    upstream.searchParams.set("RANGE", range);
    upstream.searchParams.set("deviceid", "Wap");
    upstream.searchParams.set("plat", "Wap");
    upstream.searchParams.set("product", "EFund");
    upstream.searchParams.set("version", "2.0.0");
    return { status: 200, body: await fetchJson(upstream, 0) };
  }

  const positionMatch = pathname.match(/^\/api\/funds\/(\d{6})\/positions$/);
  if (positionMatch) {
    const code = assertFundCode(positionMatch[1]);
    return { status: 200, body: await fetchFundPositionData(code) };
  }

  const baseInfoMatch = pathname.match(/^\/api\/funds\/(\d{6})\/base-info$/);
  if (baseInfoMatch) {
    const code = assertFundCode(baseInfoMatch[1]);
    const upstream = withTimestamp(new URL("https://fundmobapi.eastmoney.com/FundMApi/FundBaseTypeInformation.ashx"));
    upstream.searchParams.set("FCODE", code);
    upstream.searchParams.set("deviceid", "Wap");
    upstream.searchParams.set("plat", "Wap");
    upstream.searchParams.set("product", "EFund");
    upstream.searchParams.set("version", "2.0.0");
    upstream.searchParams.set("Uid", "");
    return { status: 200, body: await fetchJson(upstream, 1800) };
  }

  return { status: 404, body: { ok: false, error: "Not found" } };
}

async function routePost(req, reqUrl) {
  const { pathname } = reqUrl;

  if (pathname === "/api/auth/wechat") {
    const body = parseJsonBody(await readBody(req, 64 * 1024));
    const session = await exchangeWechatCode(body.code);
    const token = createAuthToken(session.openid);
    const payload = verifyAuthToken(token);
    return {
      status: 200,
      body: {
        ok: true,
        token,
        expiresAt: payload.exp,
        user: publicUser(session.openid)
      }
    };
  }

  if (pathname === "/api/auth/logout") {
    requireAuth(req);
    return { status: 200, body: { ok: true } };
  }

  if (pathname === "/api/import/alipay-text") {
    const body = parseJsonBody(await readBody(req, 1024 * 1024));
    const heuristic = parseAlipayTextHeuristic(body.text || "");
    let parsed = heuristic;
    if (VISION_PROVIDER !== "unlimited-ocr" && VISION_API_URL && VISION_MODEL) {
      try {
        parsed = await callVisionModel({ text: body.text || "" });
      } catch (error) {
        heuristic.warnings.push(`AI 文本识别失败，已使用基础规则解析：${error.message}`);
        parsed = heuristic;
      }
    }
    const result = await enrichImportedItems(parsed.items, parsed.warnings || []);
    return { status: 200, body: { ok: true, source: "text", ...result } };
  }

  if (pathname === "/api/import/alipay-screenshot") {
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const { files, fields } = parseMultipart(req, body);
    const image = files.find((file) => file.fieldName === "image") || files[0];
    if (!image) {
      const error = new Error("Missing image file");
      error.status = 400;
      throw error;
    }
    const { parsed, engine } = await parseScreenshotWithConfiguredEngine({ image, text: fields.text || "" });
    const result = await enrichImportedItems(parsed.items, parsed.warnings || []);
    return { status: 200, body: { ok: true, source: "screenshot", engine, ...result } };
  }

  return { status: 404, body: { ok: false, error: "Not found" } };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const result = req.method === "GET"
      ? await routeGet(req, reqUrl)
      : req.method === "POST"
      ? await routePost(req, reqUrl)
      : { status: 405, body: { ok: false, error: "Method not allowed" } };
    json(res, result.status, result.body);
  } catch (error) {
    fail(res, error.status || 500, error.message || "Internal error", error.detail || error.stack);
  }
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`funds-api-proxy listening on ${PORT}`);
  });
}

module.exports = {
  parseAlipayTextHeuristic,
  parseFundGzPayload,
  mergeFundGzQuoteRows,
  mapFundPositionData,
  mapTushareNavRows,
  createAuthToken,
  verifyAuthToken,
  publicUser
};