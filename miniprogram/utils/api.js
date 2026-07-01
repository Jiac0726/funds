const { API_BASE_URL } = require("./config");
const { getState } = require("./storage");

const AUTH_TOKEN_KEY = "funds-mini-auth-token";

function getAuthToken() {
  return String(wx.getStorageSync(AUTH_TOKEN_KEY) || "");
}

function setAuthToken(token) {
  if (token) wx.setStorageSync(AUTH_TOKEN_KEY, token);
  else wx.removeStorageSync(AUTH_TOKEN_KEY);
}

function hasBackend() {
  return /^https?:\/\//.test(API_BASE_URL || "");
}

function selectedDataSource() {
  const state = getState();
  return state.settings && state.settings.dataSource || "eastmoney";
}

function ensureBackend() {
  if (!hasBackend()) {
    return Promise.reject(new Error("请先在 utils/config.js 配置 API_BASE_URL 后端域名"));
  }
  return Promise.resolve();
}

function buildApiUrl(path, params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  const base = hasBackend() ? API_BASE_URL.replace(/\/$/, "") : "";
  return `${base}${path}${query ? "?" + query : ""}`;
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
  if (!match) throw new Error("天天基金估值响应无效");
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
  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
  return request(url, { timeout: 8000 }).then((data) => mapFundGzQuote(parseFundGzPayload(data), code));
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
  if (payload && Array.isArray(payload.stockPositions)) {
    return {
      ok: true,
      expansion: String(payload.expansion || ""),
      totalStockRatio: finiteNumber(payload.totalStockRatio) || 0,
      stockPositions: payload.stockPositions.map((item, index) => ({
        rank: item.rank || index + 1,
        code: String(item.code || ""),
        name: String(item.name || ""),
        secid: String(item.secid || ""),
        ratio: finiteNumber(item.ratio),
        price: finiteNumber(item.price),
        quoteChangeRate: finiteNumber(item.quoteChangeRate),
        periodChange: finiteNumber(item.periodChange),
        periodChangeType: String(item.periodChangeType || "")
      }))
    };
  }

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
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f12,f13,f14,f292&fltt=2&secids=${list}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&Uid=&_=${Date.now()}`;
  return request(url).then((data) => (data && data.data && Array.isArray(data.data.diff) ? data.data.diff : []));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    const header = { ...(options.header || {}) };
    if (token) header.authorization = "Bearer " + token;
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      header,
      timeout: options.timeout || 12000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          if (res.statusCode === 401) setAuthToken("");
          const message = res.data && (res.data.error || res.data.detail) ? (res.data.error || res.data.detail) : "HTTP " + res.statusCode;
          reject(new Error(message));
        }
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

function postJson(path, data) {
  return ensureBackend().then(() => request(buildApiUrl(path), {
    method: "POST",
    data,
    header: { "content-type": "application/json" },
    timeout: 20000
  }));
}

function uploadImage(path, filePath, formData = {}) {
  return ensureBackend().then(() => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: buildApiUrl(path),
      filePath,
      name: "image",
      formData,
      timeout: 60000,
      success(res) {
        let data;
        try {
          data = JSON.parse(res.data || "{}");
        } catch (error) {
          reject(new Error("后端返回不是 JSON"));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || data.detail || `HTTP ${res.statusCode}`));
        }
      },
      fail: reject
    });
  }));
}

function fetchFundSearch(keyword) {
  const key = String(keyword || "").trim();
  if (!key) return Promise.resolve([]);
  const url = hasBackend()
    ? buildApiUrl("/api/funds/search", { key })
    : `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=9&key=${encodeURIComponent(key)}&_=${Date.now()}`;
  return request(url).then((data) => (data && data.Datas ? data.Datas : []));
}

function fetchFundQuotes(codes) {
  const codeList = (codes || []).filter(Boolean);
  const list = codeList.join(",");
  if (!list) return Promise.resolve([]);
  const source = selectedDataSource();
  if (!hasBackend() && source === "tushare") {
    return Promise.reject(new Error("当前数据源需要先配置后端域名"));
  }
  if (!hasBackend() && source === "fundgz") {
    return Promise.all(codeList.map((code) => fetchFundGzQuote(code).catch(() => null)))
      .then((rows) => rows.filter(Boolean));
  }
  const url = hasBackend()
    ? buildApiUrl("/api/funds/quotes", { codes: list, source })
    : `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=200&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=mini-program&Fcodes=${list}&_=${Date.now()}`;
  return request(url)
    .then((data) => (data && data.Datas ? data.Datas : []))
    .then((rows) => (!hasBackend() && source === "eastmoney" ? supplementWithFundGzEstimates(codeList, rows) : rows));
}

function fetchIndexQuotes(secids) {
  const list = (secids || []).filter(Boolean).join(",");
  if (!list) return Promise.resolve([]);
  const url = hasBackend()
    ? buildApiUrl("/api/index/quotes", { secids: list })
    : `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f13,f14&secids=${list}&_=${Date.now()}`;
  return request(url).then((data) => (data && data.data && data.data.diff ? data.data.diff : []));
}

function fetchFundNetHistory(code, range = "y") {
  if (!code) return Promise.resolve([]);
  const source = selectedDataSource();
  if (!hasBackend() && source === "tushare") {
    return Promise.reject(new Error("当前数据源需要先配置后端域名"));
  }
  const url = hasBackend()
    ? buildApiUrl(`/api/funds/${code}/net-history`, { range, source })
    : `https://fundmobapi.eastmoney.com/FundMApi/FundNetDiagram.ashx?FCODE=${code}&RANGE=${range}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${Date.now()}`;
  return request(url).then((data) => (data && data.Datas ? data.Datas : []));
}

function fetchFundBaseInfo(code) {
  if (!code) return Promise.resolve({});
  const url = hasBackend()
    ? buildApiUrl(`/api/funds/${code}/base-info`)
    : `https://fundmobapi.eastmoney.com/FundMApi/FundBaseTypeInformation.ashx?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${Date.now()}`;
  return request(url).then((data) => (data && data.Datas ? data.Datas : {}));
}

function fetchFundPositions(code) {
  if (!code) return Promise.resolve({ ok: true, expansion: "", totalStockRatio: 0, stockPositions: [] });
  if (hasBackend()) {
    return request(buildApiUrl(`/api/funds/${code}/positions`)).then((data) => normalizeFundPositionData(data));
  }
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&Uid=&_=${Date.now()}`;
  return request(url).then((data) => {
    const base = normalizeFundPositionData(data);
    const secids = base.stockPositions.map((item) => item.secid).filter(Boolean);
    if (!secids.length) return base;
    return fetchStockQuotes(secids)
      .then((stockQuotes) => normalizeFundPositionData(data, stockQuotes))
      .catch(() => base);
  });
}

function fetchAuthStatus() {
  if (!hasBackend()) return Promise.resolve({ available: false });
  return request(buildApiUrl("/api/auth/status"));
}

function fetchCurrentUser() {
  if (!getAuthToken()) return Promise.resolve(null);
  return ensureBackend()
    .then(() => request(buildApiUrl("/api/auth/me")))
    .then((data) => data && data.user ? data.user : null);
}

function wechatLogin() {
  return ensureBackend()
    .then(() => new Promise((resolve, reject) => {
      wx.login({
        timeout: 10000,
        success(result) {
          if (result.code) resolve(result.code);
          else reject(new Error(result.errMsg || "微信登录失败"));
        },
        fail: reject
      });
    }))
    .then((code) => postJson("/api/auth/wechat", { code }))
    .then((data) => {
      if (!data || !data.token || !data.user) throw new Error("登录响应无效");
      setAuthToken(data.token);
      return data.user;
    });
}

function wechatLogout() {
  const task = getAuthToken() && hasBackend()
    ? postJson("/api/auth/logout", {}).catch(() => null)
    : Promise.resolve();
  return task.then(() => {
    setAuthToken("");
    return true;
  });
}

function fetchDataSources() {
  if (!hasBackend()) {
    return Promise.resolve([
      { id: "eastmoney", label: "东方财富", available: true, supportsEstimate: true },
      { id: "fundgz", label: "天天基金估值", available: true, supportsEstimate: true },
      { id: "tushare", label: "Tushare净值", available: false, supportsEstimate: false }
    ]);
  }
  return request(buildApiUrl("/api/data-sources"))
    .then((data) => data && Array.isArray(data.sources) ? data.sources : []);
}

function importAlipayScreenshot(filePath, text = "") {
  return uploadImage("/api/import/alipay-screenshot", filePath, { text });
}

function parseAlipayText(text) {
  return postJson("/api/import/alipay-text", { text });
}

module.exports = {
  request,
  postJson,
  uploadImage,
  buildApiUrl,
  hasBackend,
  parseFundGzPayload,
  mergeFundGzQuoteRows,
  getAuthToken,
  setAuthToken,
  fetchAuthStatus,
  fetchCurrentUser,
  wechatLogin,
  wechatLogout,
  fetchFundSearch,
  fetchFundQuotes,
  fetchIndexQuotes,
  fetchFundNetHistory,
  fetchFundBaseInfo,
  fetchFundPositions,
  fetchDataSources,
  importAlipayScreenshot,
  parseAlipayText
};