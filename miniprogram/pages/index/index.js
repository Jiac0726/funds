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

Page({
  data: {
    loading: false,
    funds: [],
    indexList: [],
    summary: summarize([]),
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
            this.setData({
              funds: sortFunds(calculatedFunds, sortKey),
              indexList,
              summary: summarize(calculatedFunds),
              lastUpdated: this.formatNow(),
              loading: false,
              error: hasError ? "部分数据暂时不可用" : ""
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