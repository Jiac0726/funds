const https = require("https");

function get(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "user-agent": "Mozilla/5.0 MiniProgram CloudBase" }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(raw);
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

function getJson(url, timeout) {
  return get(url, timeout).then((raw) => JSON.parse(raw));
}

function now() {
  return Date.now();
}

function todayText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function quoteEstimateDate(row) {
  const match = String(row && row.GZTIME || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function hasLiveEstimate(row, today = todayText()) {
  const gsz = Number(row && row.GSZ);
  const rate = Number(row && row.GSZZL);
  return quoteEstimateDate(row) === today && ((Number.isFinite(gsz) && gsz > 0) || Number.isFinite(rate));
}

function parseFundGzPayload(text) {
  const match = String(text || "").match(/jsonpgz\((\{.*\})\)\s*;?/s);
  if (!match) throw new Error("invalid fundgz response");
  return JSON.parse(match[1]);
}

function mapFundGzQuote(raw, code) {
  return {
    FCODE: raw.fundcode || code,
    SHORTNAME: raw.name || "",
    PDATE: raw.jzrq || "--",
    NAV: raw.dwjz || null,
    GSZ: raw.gsz || null,
    GSZZL: raw.gszzl || null,
    GZTIME: raw.gztime || "--",
    ESTIMATE_SOURCE: "fundgz"
  };
}

function mergeFundGzQuoteRows(primaryRows, fallbackRows, today = todayText()) {
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
    if (!seen[code]) merged.push(fallbackByCode[code]);
  });
  return merged;
}

function fetchFundGzQuote(code) {
  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${now()}`;
  return get(url, 8000).then((data) => mapFundGzQuote(parseFundGzPayload(data), code));
}

function supplementWithFundGzEstimates(codes, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const targets = (codes || []).filter((code) => {
    const row = list.find((item) => item && item.FCODE === code);
    return !hasLiveEstimate(row);
  });
  if (!targets.length) return Promise.resolve(list);
  return Promise.all(targets.map((code) => fetchFundGzQuote(code).catch(() => null)))
    .then((fallbackRows) => mergeFundGzQuoteRows(list, fallbackRows.filter(Boolean)));
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positionSecid(row) {
  const exchange = String(row && row.NEWTEXCH || "").trim();
  const code = String(row && row.GPDM || row.code || "").trim();
  return exchange && code ? `${exchange}.${code}` : String(row && row.secid || "");
}

function normalizeFundPositionData(payload, stockQuotes = []) {
  const datas = payload && payload.Datas && typeof payload.Datas === "object" ? payload.Datas : {};
  const rawStocks = Array.isArray(datas.fundStocks) ? datas.fundStocks : [];
  const quoteByCode = (Array.isArray(stockQuotes) ? stockQuotes : []).reduce((map, row) => {
    if (row && row.f12) map[String(row.f12)] = row;
    return map;
  }, {});
  const stockPositions = rawStocks.map((row, index) => {
    const code = String(row.GPDM || "").trim();
    const quote = quoteByCode[code] || {};
    return {
      rank: index + 1,
      code,
      name: String(row.GPJC || quote.f14 || "").trim(),
      secid: positionSecid(row),
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
    expansion: String(payload && payload.Expansion || datas.Expansion || ""),
    totalStockRatio,
    stockPositions
  };
}

function fetchStockQuotes(secids) {
  const list = (secids || []).filter(Boolean).join(",");
  if (!list) return Promise.resolve([]);
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f12,f13,f14,f292&fltt=2&secids=${list}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&Uid=&_=${now()}`;
  return getJson(url).then((data) => (data && data.data && Array.isArray(data.data.diff) ? data.data.diff : []));
}

async function search(keyword) {
  const key = String(keyword || "").trim();
  if (!key) return { Datas: [] };
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=9&key=${encodeURIComponent(key)}&_=${now()}`;
  return getJson(url);
}

async function quotes(codes, source = "eastmoney") {
  const codeList = String(codes || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!codeList.length) return { Datas: [] };
  if (source === "fundgz") {
    const rows = await Promise.all(codeList.map((code) => fetchFundGzQuote(code).catch(() => null)));
    return { Datas: rows.filter(Boolean) };
  }
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=cloudbase&Fcodes=${codeList.join(",")}&_=${now()}`;
  const data = await getJson(url);
  const rows = await supplementWithFundGzEstimates(codeList, data && data.Datas ? data.Datas : []);
  return { ...data, Datas: rows };
}

async function indexQuotes(secids) {
  const list = String(secids || "").trim();
  if (!list) return { data: { diff: [] } };
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f13,f14&secids=${list}&_=${now()}`;
  return getJson(url);
}

async function netHistory(code, range = "y") {
  const fcode = String(code || "").trim();
  if (!fcode) return { Datas: [] };
  const url = `https://fundmobapi.eastmoney.com/FundMApi/FundNetDiagram.ashx?FCODE=${fcode}&RANGE=${range}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${now()}`;
  return getJson(url);
}

async function baseInfo(code) {
  const fcode = String(code || "").trim();
  if (!fcode) return { Datas: {} };
  const url = `https://fundmobapi.eastmoney.com/FundMApi/FundBaseTypeInformation.ashx?FCODE=${fcode}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${now()}`;
  return getJson(url);
}

async function positions(code) {
  const fcode = String(code || "").trim();
  if (!fcode) return { ok: true, expansion: "", totalStockRatio: 0, stockPositions: [] };
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${fcode}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&Uid=&_=${now()}`;
  const data = await getJson(url);
  const base = normalizeFundPositionData(data);
  const secids = base.stockPositions.map((item) => item.secid).filter(Boolean);
  if (!secids.length) return base;
  const stockQuotes = await fetchStockQuotes(secids).catch(() => []);
  return normalizeFundPositionData(data, stockQuotes);
}

exports.main = async (event) => {
  try {
    const action = event && event.action;
    let data;
    if (action === "search") data = await search(event.keyword || event.key);
    else if (action === "quotes") data = await quotes(event.codes, event.source);
    else if (action === "indexQuotes") data = await indexQuotes(event.secids);
    else if (action === "netHistory") data = await netHistory(event.code, event.range);
    else if (action === "baseInfo") data = await baseInfo(event.code);
    else if (action === "positions") data = await positions(event.code);
    else throw new Error("unknown action");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || "Cloud function failed" };
  }
};
