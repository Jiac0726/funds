const { fetchFundQuotes, fetchFundNetHistory, fetchFundBaseInfo, fetchFundPositions } = require("../../utils/api");
const { getState } = require("../../utils/storage");
const {
  normalizeFund,
  buildHoldingHistory,
  appendLiveEstimateToHistory,
  applyHistoryFallback,
  formatMoney,
  formatDecimal,
  formatPercent,
  valueClass
} = require("../../utils/format");

function formatScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value || "--";
  if (Math.abs(num) >= 100000000) return `${(num / 100000000).toFixed(2)}亿`;
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(2)}万`;
  return formatDecimal(num);
}

function buildInfoRows(info = {}) {
  return [
    { label: "基金类型", value: info.FTYPE },
    { label: "基金公司", value: info.JJGS },
    { label: "基金经理", value: info.JJJL },
    { label: "交易状态", value: [info.SGZT, info.SHZT].filter(Boolean).join(" / ") },
    { label: "基金规模", value: formatScale(info.ENDNAV) },
    { label: "累计净值", value: formatDecimal(info.LJJZ) },
    { label: "净值日期", value: info.FSRQ }
  ].filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
}

function buildRankRows(info = {}) {
  return [
    { label: "近1月", rate: formatPercent(info.SYL_Y), rank: info.RANKM, rateClass: valueClass(info.SYL_Y) },
    { label: "近3月", rate: formatPercent(info.SYL_3Y), rank: info.RANKQ, rateClass: valueClass(info.SYL_3Y) },
    { label: "近6月", rate: formatPercent(info.SYL_6Y), rank: info.RANKHY, rateClass: valueClass(info.SYL_6Y) },
    { label: "近1年", rate: formatPercent(info.SYL_1N), rank: info.RANKY, rateClass: valueClass(info.SYL_1N) }
  ].filter((item) => item.rate !== undefined && item.rate !== null && item.rate !== "");
}

function displayCalculationRows(series) {
  return [...series].reverse().map((item) => ({
    date: item.date,
    shares: item.shares.toFixed(2),
    amount: formatMoney(item.amount),
    gain: Number.isFinite(item.gain) ? formatMoney(item.gain) : "--",
    rate: Number.isFinite(item.rate) ? formatPercent(item.rate) : "--",
    gainClass: Number.isFinite(item.gain) ? valueClass(item.gain) : "flat"
  }));
}

function chartSummary(series) {
  const points = series.filter((item) => Number.isFinite(item.gain));
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const values = points.map((item) => item.gain);
  return {
    latest: formatMoney(latest.gain),
    latestClass: valueClass(latest.gain),
    highest: formatMoney(Math.max(...values)),
    lowest: formatMoney(Math.min(...values)),
    startDate: points[0].date,
    endDate: latest.date
  };
}

function safePercent(value) {
  const num = Number(value);
  return Number.isFinite(num) ? formatPercent(num) : "--";
}

function comparePositionText(item) {
  if (item.periodChangeType === "新增") return "新增";
  const num = Number(item.periodChange);
  if (!Number.isFinite(num)) return "--";
  if (num === 0) return "0.00%";
  return `${num > 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function displayFundPositions(raw = {}) {
  const stocks = (Array.isArray(raw.stockPositions) ? raw.stockPositions : []).map((item, index) => ({
    rank: item.rank || index + 1,
    code: item.code || "--",
    name: item.name || item.code || "--",
    ratioValue: Number.isFinite(Number(item.ratio)) ? Number(item.ratio) : 0,
    ratio: safePercent(item.ratio),
    price: Number.isFinite(Number(item.price)) ? formatDecimal(item.price) : "--",
    quoteChangeRate: safePercent(item.quoteChangeRate),
    quoteClass: valueClass(item.quoteChangeRate),
    compare: comparePositionText(item),
    compareClass: item.periodChangeType === "新增" ? "up" : valueClass(item.periodChange)
  }));
  const total = Number.isFinite(Number(raw.totalStockRatio))
    ? Number(raw.totalStockRatio)
    : stocks.reduce((sum, item) => sum + item.ratioValue, 0);
  return {
    expansion: raw.expansion || "--",
    expansionText: raw.expansion ? `截止 ${raw.expansion}` : "暂无披露日期",
    totalRatio: safePercent(total),
    stocks
  };
}

Page({
  data: {
    code: "",
    fund: null,
    baseInfo: {},
    infoRows: [],
    rankRows: [],
    history: [],
    calculationRows: [],
    chartSeries: [],
    chartSummary: null,
    transactionCount: 0,
    positionInfo: displayFundPositions(),
    loading: false,
    error: ""
  },

  onLoad(options) {
    this.setData({ code: options.code || "" });
  },

  onShow() {
    if (this.data.code) this.refresh(this.data.code);
  },

  refresh(code = this.data.code) {
    if (this.data.loading) return Promise.resolve();
    const state = getState();
    const holding = (state.holdings || []).find((item) => item.code === code) || { code, transactions: [] };
    this.setData({ loading: true, error: "" });

    const quoteTask = fetchFundQuotes([code]).catch((err) => ({ error: err }));
    const historyTask = fetchFundNetHistory(code, "3y").catch(() => []);
    const infoTask = fetchFundBaseInfo(code).catch(() => ({}));
    const positionTask = fetchFundPositions(code).catch(() => ({}));

    return Promise.all([quoteTask, historyTask, infoTask, positionTask])
      .then(([quoteRaw, historyRaw, baseInfo, positionRaw]) => {
        const raw = Array.isArray(quoteRaw) && quoteRaw[0] ? quoteRaw[0] : null;
        const normalizedFund = raw
          ? normalizeFund(raw, holding)
          : normalizeFund({ FCODE: code, SHORTNAME: holding.name || code, PDATE: "--", NAV: "--", GSZ: "--", GSZZL: "--", GZTIME: "--" }, holding);
        const fund = applyHistoryFallback(normalizedFund, historyRaw);
        const liveHistoryRows = appendLiveEstimateToHistory(historyRaw, fund);
        const holdingHistory = buildHoldingHistory(liveHistoryRows, holding, 3);
        const chartSeries = holdingHistory
          .filter((item) => Number.isFinite(item.gain))
          .map((item) => ({ date: item.date, gain: item.gain }));
        const history = (Array.isArray(liveHistoryRows) ? liveHistoryRows : [])
          .slice(-18)
          .reverse()
          .map((item) => ({
            date: item.FSRQ,
            dwjz: formatDecimal(item.DWJZ),
            ljjz: formatDecimal(item.LJJZ),
            rate: formatPercent(item.JZZZL),
            estimated: !!item.estimated,
            rateClass: valueClass(item.JZZZL)
          }));

        return new Promise((resolve) => {
          this.setData({
            fund,
            history,
            calculationRows: displayCalculationRows(holdingHistory),
            chartSeries,
            chartSummary: chartSummary(holdingHistory),
            transactionCount: (holding.transactions || []).length,
            positionInfo: displayFundPositions(positionRaw || {}),
            baseInfo: baseInfo || {},
            infoRows: buildInfoRows(baseInfo || {}),
            rankRows: buildRankRows(baseInfo || {}),
            loading: false,
            error: raw || fund.isHistoricalFallback ? "" : "行情暂时不可用"
          }, () => {
            this.drawProfitChart(chartSeries);
            resolve();
          });
        });
      })
      .catch(() => {
        this.setData({ loading: false, error: "加载失败" });
      });
  },

  drawProfitChart(series) {
    if (!Array.isArray(series) || series.length < 2) return;
    wx.createSelectorQuery()
      .in(this)
      .select("#profitChart")
      .boundingClientRect((rect) => {
        if (!rect || !rect.width || !rect.height) return;
        const context = wx.createCanvasContext("profitChart", this);
        const padding = { left: 16, right: 16, top: 18, bottom: 18 };
        const values = series.map((item) => item.gain);
        const min = Math.min(0, ...values);
        const max = Math.max(0, ...values);
        const span = max - min || 1;
        const width = rect.width - padding.left - padding.right;
        const height = rect.height - padding.top - padding.bottom;
        const x = (index) => padding.left + (series.length === 1 ? 0 : (index / (series.length - 1)) * width);
        const y = (value) => padding.top + ((max - value) / span) * height;

        context.clearRect(0, 0, rect.width, rect.height);
        context.beginPath();
        context.setStrokeStyle("#d9e1ea");
        context.setLineWidth(1);
        context.moveTo(padding.left, y(0));
        context.lineTo(rect.width - padding.right, y(0));
        context.stroke();

        context.beginPath();
        context.setStrokeStyle("#276ef1");
        context.setLineWidth(2);
        series.forEach((item, index) => {
          if (index === 0) context.moveTo(x(index), y(item.gain));
          else context.lineTo(x(index), y(item.gain));
        });
        context.stroke();
        context.draw();
      })
      .exec();
  },

  goTransactions() {
    if (!this.data.code) return;
    wx.navigateTo({ url: `/pages/transactions/transactions?code=${this.data.code}` });
  }
});