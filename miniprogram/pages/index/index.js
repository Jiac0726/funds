const { fetchFundQuotes, fetchIndexQuotes, fetchFundNetHistory } = require("../../utils/api");
const { getState, setSortKey } = require("../../utils/storage");
const { normalizeFund, applyHistoryFallback, summarize, valueClass, formatDecimal, formatPercent, toNumber } = require("../../utils/format");

const AUTO_REFRESH_MS = 30 * 1000;

const SORT_OPTIONS = [
  { key: "default", label: "默认" },
  { key: "rate_desc", label: "涨幅" },
  { key: "day_gain_desc", label: "日收益" },
  { key: "cost_gain_desc", label: "持有收益" },
  { key: "amount_desc", label: "金额" }
];

const MARKET_MODULES = [
  { key: "overview", label: "总览" },
  { key: "funds", label: "自选基金" },
  { key: "index", label: "指数行情" },
  { key: "watch", label: "异动观察" }
];

function fallbackFund(holding) {
  const item = normalizeFund(
    {
      FCODE: holding.code,
      SHORTNAME: holding.name || holding.code,
      PDATE: "--",
      NAV: "--",
      GSZ: "--",
      GSZZL: "--",
      GZTIME: "--"
    },
    holding
  );
  item.missing = true;
  return item;
}

function sortFunds(funds, sortKey) {
  const list = [...funds];
  const desc = (field) => list.sort((a, b) => toNumber(b[field]) - toNumber(a[field]));
  switch (sortKey) {
    case "rate_desc":
      return desc("gszzl");
    case "day_gain_desc":
      return desc("dayGainValue");
    case "cost_gain_desc":
      return desc("costGainValue");
    case "amount_desc":
      return desc("amountValue");
    default:
      return list;
  }
}

function moduleSummary(summary, funds, indexList) {
  const unavailable = funds.filter((item) => item.hasDayGain === false).length;
  const estimated = funds.filter((item) => item.isEstimated).length;
  const strongestFund = [...funds]
    .filter((item) => item.hasDayGain)
    .sort((a, b) => toNumber(b.gszzl) - toNumber(a.gszzl))[0];
  const weakestFund = [...funds]
    .filter((item) => item.hasDayGain)
    .sort((a, b) => toNumber(a.gszzl) - toNumber(b.gszzl))[0];
  const strongestIndex = [...indexList]
    .sort((a, b) => toNumber(String(b.rate).replace("%", "")) - toNumber(String(a.rate).replace("%", "")))[0];
  return [
    {
      key: "asset",
      title: "持仓资产",
      value: summary.totalAmount,
      sub: `${funds.length} 只基金`,
      valueClass: "flat"
    },
    {
      key: "gain",
      title: summary.dayGainLabel,
      value: summary.totalDayGain,
      sub: `日收益率 ${summary.dayRate}`,
      valueClass: summary.totalDayGainClass
    },
    {
      key: "estimate",
      title: "盘中估值",
      value: `${estimated} / ${funds.length}`,
      sub: unavailable ? `${unavailable} 只等待估值` : "估值状态正常",
      valueClass: unavailable ? "flat" : "up"
    },
    {
      key: "index",
      title: "指数领涨",
      value: strongestIndex ? strongestIndex.rate : "--",
      sub: strongestIndex ? strongestIndex.name : "暂无指数数据",
      valueClass: strongestIndex ? strongestIndex.valueClass : "flat"
    },
    {
      key: "strong",
      title: "持仓领涨",
      value: strongestFund ? strongestFund.gszzlText : "--",
      sub: strongestFund ? strongestFund.name : "暂无可用估值",
      valueClass: strongestFund ? strongestFund.valueClass : "flat"
    },
    {
      key: "weak",
      title: "持仓领跌",
      value: weakestFund ? weakestFund.gszzlText : "--",
      sub: weakestFund ? weakestFund.name : "暂无可用估值",
      valueClass: weakestFund ? weakestFund.valueClass : "flat"
    }
  ];
}

function watchList(funds) {
  const sorted = [...funds]
    .filter((item) => item.hasDayGain || item.hasCostGain)
    .sort((a, b) => Math.abs(toNumber(b.dayGainValue)) - Math.abs(toNumber(a.dayGainValue)));
  return sorted.slice(0, 5).map((item) => ({
    code: item.code,
    name: item.name,
    rate: item.gszzlText,
    dayGain: item.dayGain,
    costGain: item.costGain,
    status: item.quoteStatusText || "行情正常",
    valueClass: item.dayGainClass
  }));
}

Page({
  data: {
    loading: false,
    funds: [],
    indexList: [],
    summary: summarize([]),
    marketModules: MARKET_MODULES,
    activeModule: "overview",
    moduleCards: [],
    watchItems: [],
    lastUpdated: "--",
    autoRefreshSeconds: AUTO_REFRESH_MS / 1000,
    error: "",
    sortOptions: SORT_OPTIONS,
    sortKey: "default"
  },

  onShow() {
    const state = getState();
    this.setData({ sortKey: state.settings.sortKey || "default" });
    this.startAutoRefresh();
    this.refresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.autoRefreshTimer = setInterval(() => {
      if (!this.data.loading) this.refresh();
    }, AUTO_REFRESH_MS);
  },

  stopAutoRefresh() {
    if (!this.autoRefreshTimer) return;
    clearInterval(this.autoRefreshTimer);
    this.autoRefreshTimer = null;
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.refresh().then(done).catch(done);
  },

  refresh() {
    if (this.data.loading) return Promise.resolve();
    const state = getState();
    const holdings = state.holdings || [];
    const codes = holdings.map((item) => item.code);
    const sortKey = state.settings.sortKey || this.data.sortKey || "default";
    this.setData({ loading: true, error: "", sortKey });

    const indexTask = fetchIndexQuotes(state.indexSecids).catch((err) => ({ error: err }));
    const fundTask = fetchFundQuotes(codes).catch((err) => ({ error: err }));

    return Promise.all([indexTask, fundTask])
      .then(([indexRaw, fundRaw]) => {
        const hasError = indexRaw && indexRaw.error || fundRaw && fundRaw.error;
        const errorDetail = hasError && (hasError.errMsg || hasError.message || String(hasError));
        const quoteList = Array.isArray(fundRaw) ? fundRaw : [];
        const quoteByCode = quoteList.reduce((map, item) => {
          map[item.FCODE] = item;
          return map;
        }, {});
        const funds = holdings.map((holding) => {
          const raw = quoteByCode[holding.code];
          return raw ? normalizeFund(raw, holding) : fallbackFund(holding);
        });
        const indexList = Array.isArray(indexRaw)
          ? indexRaw.map((item) => ({
              code: `${item.f13}.${item.f12}`,
              name: item.f14,
              price: formatDecimal(item.f2),
              change: formatDecimal(item.f4),
              rate: formatPercent(item.f3),
              valueClass: valueClass(item.f3)
            }))
          : [];

        return Promise.all(funds.map((fund) => fund.hasDayGain ? Promise.resolve([]) : fetchFundNetHistory(fund.code, "3y").catch(() => [])))
          .then((historyRows) => {
            const calculatedFunds = funds.map((fund, index) => applyHistoryFallback(fund, historyRows[index]));
            const summary = summarize(calculatedFunds);
            this.setData({
              funds: sortFunds(calculatedFunds, sortKey),
              indexList,
              summary,
              moduleCards: moduleSummary(summary, calculatedFunds, indexList),
              watchItems: watchList(calculatedFunds),
              lastUpdated: this.formatNow(),
              loading: false,
              error: hasError ? `部分数据暂时不可用：${errorDetail || "请求失败"}` : ""
            });
          });
      })
      .catch(() => {
        this.setData({ loading: false, error: "刷新失败" });
      });
  },

  changeSort(event) {
    const sortKey = event.currentTarget.dataset.key || "default";
    setSortKey(sortKey);
    this.setData({ sortKey, funds: sortFunds(this.data.funds, sortKey) });
  },

  changeModule(event) {
    const key = event.currentTarget.dataset.key || "overview";
    this.setData({ activeModule: key });
  },

  formatNow() {
    const date = new Date();
    const pad = (num) => String(num).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  goEdit() {
    wx.navigateTo({ url: "/pages/edit/edit" });
  },

  openDetail(event) {
    const code = event.currentTarget.dataset.code;
    if (!code) return;
    wx.navigateTo({ url: `/pages/detail/detail?code=${code}` });
  }
});
