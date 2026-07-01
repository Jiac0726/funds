const {
  getState,
  addHoldingTransaction,
  removeHoldingTransaction
} = require("../../utils/storage");
const { formatDecimal, formatMoney } = require("../../utils/format");

function today() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function displayTransaction(item) {
  return {
    ...item,
    kindText: item.kind === "open" ? "建仓" : "加仓",
    sharesText: formatDecimal(item.shares),
    amountText: formatMoney(item.amount),
    priceText: formatDecimal(item.price)
  };
}

Page({
  data: {
    code: "",
    holding: null,
    transactions: [],
    kind: "add",
    date: today(),
    maxDate: today(),
    shares: "",
    amount: "",
    price: "",
    note: ""
  },

  onLoad(options) {
    this.setData({ code: options.code || "" });
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const holding = (getState().holdings || []).find((item) => item.code === this.data.code) || null;
    const transactions = holding
      ? [...(holding.transactions || [])].sort((a, b) => b.date.localeCompare(a.date)).map(displayTransaction)
      : [];
    this.setData({
      holding: holding ? { ...holding, numText: formatDecimal(holding.num), costText: holding.cost ? formatDecimal(holding.cost) : "--" } : null,
      transactions,
      kind: transactions.length ? this.data.kind : "open"
    });
  },

  chooseKind(event) {
    this.setData({ kind: event.currentTarget.dataset.kind === "open" ? "open" : "add" });
  },

  onDateChange(event) {
    this.setData({ date: event.detail.value });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  saveTransaction() {
    const shares = Number(this.data.shares);
    let amount = Number(this.data.amount);
    const price = Number(this.data.price);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (Number.isFinite(price) && price > 0 && Number.isFinite(shares)) amount = price * shares;
    }
    if (!this.data.holding || !/^\d{4}-\d{2}-\d{2}$/.test(this.data.date) || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: "请填写日期、份额和金额", icon: "none" });
      return;
    }
    addHoldingTransaction(this.data.code, {
      kind: this.data.kind,
      date: this.data.date,
      shares,
      amount,
      price: amount / shares,
      note: this.data.note
    });
    this.setData({ shares: "", amount: "", price: "", note: "", kind: "add" });
    this.loadData();
    wx.showToast({ title: "已记录", icon: "success" });
  },

  removeTransaction(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: "删除记录",
      content: "删除后，历史收益将重新回算。",
      confirmColor: "#c73636",
      success: (result) => {
        if (!result.confirm) return;
        removeHoldingTransaction(this.data.code, id);
        this.loadData();
      }
    });
  }
});