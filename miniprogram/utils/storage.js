const STORAGE_KEY = "funds-mini-state";

const DEFAULT_STATE = {
  holdings: [
    {
      code: "001618",
      name: "汇添富中证新能源汽车产业指数(LOF)A",
      num: "0",
      cost: "",
      profitStartDate: "",
      profitStartAmount: "",
      profitStartShares: "",
      profitStartNav: "",
      transactions: []
    }
  ],
  indexSecids: ["1.000001", "1.000300", "0.399001", "0.399006"],
  settings: {
    showEstimate: true,
    sortKey: "default",
    dataSource: "eastmoney"
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanDate(value) {
  const match = String(value || "").trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function cleanPositive(value) {
  const text = String(value === undefined || value === null ? "" : value).replace(/[,，￥¥元份\s]/g, "");
  const num = Number(text);
  return Number.isFinite(num) && num > 0 ? text : "";
}

function cleanTransaction(item) {
  if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))) return null;
  const shares = Number(item.shares);
  const amount = Number(item.amount);
  const price = Number(item.price);
  if (!Number.isFinite(shares) || shares <= 0) return null;
  const normalizedAmount = Number.isFinite(amount) && amount > 0
    ? amount
    : Number.isFinite(price) && price > 0
    ? shares * price
    : 0;
  if (!normalizedAmount) return null;
  return {
    id: String(item.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    kind: item.kind === "open" ? "open" : "add",
    date: String(item.date),
    shares: String(shares),
    amount: normalizedAmount.toFixed(2),
    price: (normalizedAmount / shares).toFixed(4),
    note: String(item.note || "").trim().slice(0, 40)
  };
}

function cleanHolding(item) {
  if (!item || item.code === undefined || item.code === null) return null;
  const code = String(item.code).trim();
  if (!/^\d{6}$/.test(code)) return null;
  const transactions = (Array.isArray(item.transactions) ? item.transactions : [])
    .map(cleanTransaction)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const profitStartDate = cleanDate(item.profitStartDate || item.importDate || item.importedAt);
  const profitStartAmount = cleanPositive(item.profitStartAmount || item.importAmount || item.baseAmount);
  const profitStartShares = cleanPositive(item.profitStartShares || item.importShares || item.baseShares);
  let profitStartNav = cleanPositive(item.profitStartNav || item.importNav || item.baseNav);
  const amount = Number(profitStartAmount);
  const shares = Number(profitStartShares);
  if (!profitStartNav && Number.isFinite(amount) && amount > 0 && Number.isFinite(shares) && shares > 0) {
    profitStartNav = String(amount / shares);
  }
  return {
    code,
    name: item.name ? String(item.name).trim() : "",
    num: item.num === undefined || item.num === null ? "0" : String(item.num),
    cost: item.cost === undefined || item.cost === null ? "" : String(item.cost),
    profitStartDate,
    profitStartAmount,
    profitStartShares,
    profitStartNav,
    transactions
  };
}

function normalizeState(input = {}) {
  const source = input.state && typeof input.state === "object" ? input.state : input;
  const defaults = clone(DEFAULT_STATE);
  const holdings = Array.isArray(source.holdings)
    ? source.holdings.map(cleanHolding).filter(Boolean)
    : defaults.holdings;
  const seen = {};
  const uniqueHoldings = holdings.filter((item) => {
    if (seen[item.code]) return false;
    seen[item.code] = true;
    return true;
  });

  const indexSecids = Array.isArray(source.indexSecids) && source.indexSecids.length
    ? source.indexSecids.map((item) => String(item)).filter(Boolean)
    : defaults.indexSecids;

  return {
    holdings: uniqueHoldings.length ? uniqueHoldings : defaults.holdings,
    indexSecids,
    settings: {
      ...defaults.settings,
      ...(source.settings || {}),
      dataSource: ["eastmoney", "fundgz", "tushare"].includes(source.settings && source.settings.dataSource)
        ? source.settings.dataSource
        : defaults.settings.dataSource
    }
  };
}

function getState() {
  return normalizeState(wx.getStorageSync(STORAGE_KEY) || {});
}

function saveState(state) {
  const normalized = normalizeState(state);
  wx.setStorageSync(STORAGE_KEY, normalized);
  return normalized;
}

function updateState(updater) {
  const next = updater(getState());
  return saveState(next);
}

function resetState() {
  return saveState(clone(DEFAULT_STATE));
}

function upsertHolding(input) {
  return updateState((state) => {
    const next = cleanHolding(input);
    if (!next) return state;
    const current = state.holdings.find((item) => item.code === next.code);
    if (current) {
      Object.assign(current, next);
    } else {
      state.holdings.push(next);
    }
    return state;
  });
}

function removeHolding(code) {
  return updateState((state) => {
    state.holdings = state.holdings.filter((item) => item.code !== code);
    return state;
  });
}

function addHoldingTransaction(code, input) {
  return updateState((state) => {
    const holding = state.holdings.find((item) => item.code === code);
    const transaction = cleanTransaction(input);
    if (!holding || !transaction) return state;
    holding.transactions = [...(holding.transactions || []), transaction]
      .sort((a, b) => a.date.localeCompare(b.date));
    return state;
  });
}

function removeHoldingTransaction(code, transactionId) {
  return updateState((state) => {
    const holding = state.holdings.find((item) => item.code === code);
    if (!holding) return state;
    holding.transactions = (holding.transactions || []).filter((item) => item.id !== transactionId);
    return state;
  });
}

function setDataSource(dataSource) {
  return updateState((state) => {
    state.settings.dataSource = ["eastmoney", "fundgz", "tushare"].includes(dataSource)
      ? dataSource
      : "eastmoney";
    return state;
  });
}

function setSortKey(sortKey) {
  return updateState((state) => {
    state.settings.sortKey = sortKey || "default";
    return state;
  });
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_STATE,
  getState,
  saveState,
  updateState,
  resetState,
  normalizeState,
  upsertHolding,
  removeHolding,
  addHoldingTransaction,
  removeHoldingTransaction,
  setDataSource,
  setSortKey
};