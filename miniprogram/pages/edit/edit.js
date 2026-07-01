const { fetchFundSearch } = require("../../utils/api");
const { getState, saveState, removeHolding } = require("../../utils/storage");

let searchTimer = null;

Page({
  data: {
    keyword: "",
    searching: false,
    suggestions: [],
    holdings: []
  },

  onShow() {
    this.loadHoldings();
  },

  loadHoldings() {
    this.setData({ holdings: getState().holdings || [] });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (searchTimer) clearTimeout(searchTimer);
    if (!keyword.trim()) {
      this.setData({ suggestions: [], searching: false });
      return;
    }
    searchTimer = setTimeout(() => this.search(keyword), 350);
  },

  search(keyword) {
    const currentCodes = (getState().holdings || []).map((item) => item.code);
    this.setData({ searching: true });
    fetchFundSearch(keyword)
      .then((list) => {
        const suggestions = list
          .filter((item) => currentCodes.indexOf(item.CODE) === -1)
          .slice(0, 12)
          .map((item) => ({
            code: item.CODE,
            name: item.NAME,
            type: item.FundType || item.FTYPE || "基金"
          }));
        this.setData({ suggestions, searching: false });
      })
      .catch(() => {
        this.setData({ suggestions: [], searching: false });
        wx.showToast({ title: "搜索失败", icon: "none" });
      });
  },

  addFund(event) {
    const { code, name } = event.currentTarget.dataset;
    const state = getState();
    const exists = state.holdings.some((item) => item.code === code);
    if (!exists) {
      state.holdings.push({ code, name, num: "0", cost: "" });
      saveState(state);
    }
    this.setData({ keyword: "", suggestions: [], holdings: state.holdings });
    wx.showToast({ title: exists ? "已在自选" : "已添加", icon: "none" });
  },

  onNumInput(event) {
    this.updateHolding(event.currentTarget.dataset.code, { num: event.detail.value });
  },

  onCostInput(event) {
    this.updateHolding(event.currentTarget.dataset.code, { cost: event.detail.value });
  },

  updateHolding(code, patch) {
    const state = getState();
    state.holdings = state.holdings.map((item) => item.code === code ? { ...item, ...patch } : item);
    saveState(state);
    this.setData({ holdings: state.holdings });
  },

  removeFund(event) {
    const code = event.currentTarget.dataset.code;
    const name = event.currentTarget.dataset.name || code;
    wx.showModal({
      title: "移除自选",
      content: name,
      confirmColor: "#c73636",
      success: (res) => {
        if (!res.confirm) return;
        const state = removeHolding(code);
        this.setData({ holdings: state.holdings });
      }
    });
  }
});