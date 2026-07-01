const { fetchFundQuotes, fetchFundNetHistory } = require("../../utils/api");
const { getState } = require("../../utils/storage");
const { normalizeFund, applyHistoryFallback, appendLiveEstimateToHistory, formatDecimal, formatPercent, valueClass } = require("../../utils/format");

Page({
  data: {
    loading: false,
    holdings: [],
    selectedCode: "",
    selectedFund: null,
    history: [],
    error: ""
  },

  onShow() {
    const state = getState();
    const holdings = state.holdings || [];
    const selectedCode = this.data.selectedCode || (holdings[0] && holdings[0].code) || "";
    this.setData({ holdings, selectedCode });
    if (selectedCode) this.loadFund(selectedCode);
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.loadFund(this.data.selectedCode).then(done).catch(done);
  },

  changeFund(event) {
    const code = event.currentTarget.dataset.code;
    if (!code || code === this.data.selectedCode) return;
    this.setData({ selectedCode: code });
    this.loadFund(code);
  },

  loadFund(code) {
    if (!code) {
      this.setData({ selectedFund: null, history: [], error: "请先添加自选基金" });
      return Promise.resolve();
    }
    const holding = (getState().holdings || []).find((item) => item.code === code) || { code };
    this.setData({ loading: true, error: "" });
    return Promise.all([
      fetchFundQuotes([code]).catch(() => []),
      fetchFundNetHistory(code, "3y").catch(() => [])
    ]).then(([quotes, rows]) => {
      const raw = Array.isArray(quotes) && quotes[0] ? quotes[0] : null;
      const normalizedFund = raw
        ? normalizeFund(raw, holding)
        : normalizeFund({ FCODE: code, SHORTNAME: holding.name || code, PDATE: "--", NAV: "--", GSZ: "--", GSZZL: "--", GZTIME: "--" }, holding);
      const selectedFund = applyHistoryFallback(normalizedFund, rows);
      const liveRows = appendLiveEstimateToHistory(rows, selectedFund);
      const history = (Array.isArray(liveRows) ? liveRows : []).slice(-30).reverse().map((item) => ({
        date: item.FSRQ,
        dwjz: formatDecimal(item.DWJZ),
        ljjz: formatDecimal(item.LJJZ),
        rate: formatPercent(item.JZZZL),
        estimated: !!item.estimated,
        rateClass: valueClass(item.JZZZL)
      }));
      this.setData({ selectedFund, history, loading: false, error: raw ? "" : "行情暂时不可用" });
    }).catch(() => {
      this.setData({ loading: false, error: "加载失败" });
    });
  },

  openDetail() {
    if (!this.data.selectedCode) return;
    wx.navigateTo({ url: `/pages/detail/detail?code=${this.data.selectedCode}` });
  }
});