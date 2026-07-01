function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "" || value === "--") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 2) {
  return toNumber(value).toFixed(digits);
}

function formatDecimal(value, digits = 2) {
  const num = toNumber(value, NaN);
  return Number.isFinite(num) ? num.toFixed(digits) : "--";
}

function formatMoney(value) {
  const num = toNumber(value);
  const parts = num.toFixed(2).split(".");
  const sign = parts[0].startsWith("-") ? "-" : "";
  const integer = parts[0].replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${integer}.${parts[1]}`;
}

function formatPercent(value) {
  return `${round(value, 2)}%`;
}

function valueClass(value) {
  const num = toNumber(value);
  if (num > 0) return "up";
  if (num < 0) return "down";
  return "flat";
}

function validDateText(value) {
  const match = String(value || "").trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function holdingShares(item = {}) {
  const shares = toNumber(item.num, NaN);
  if (Number.isFinite(shares) && shares > 0) return shares;
  const startShares = toNumber(item.profitStartShares, NaN);
  return Number.isFinite(startShares) && startShares > 0 ? startShares : 0;
}

function normalizedTransactions(holding, latestDate, startDate = "") {
  const endDate = validDateText(latestDate) || "9999-12-31";
  const afterDate = validDateText(startDate);
  return (holding && Array.isArray(holding.transactions) ? holding.transactions : [])
    .map((item) => ({
      date: validDateText(item.date),
      shares: Math.max(0, toNumber(item.shares)),
      amount: Math.max(0, toNumber(item.amount))
    }))
    .filter((item) => item.date && item.date <= endDate && (!afterDate || item.date > afterDate) && item.shares > 0 && item.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function profitStartBasis(item = {}) {
  const date = validDateText(item.profitStartDate);
  const amount = toNumber(item.profitStartAmount, NaN);
  const shares = toNumber(item.profitStartShares, NaN);
  const nav = toNumber(item.profitStartNav, NaN);
  return {
    hasStart: !!date && Number.isFinite(amount) && amount > 0,
    date,
    amount,
    shares,
    nav
  };
}

function currentQuoteDate(item = {}) {
  return validDateText(item.gztime) || validDateText(item.jzrq);
}

function profitStartReady(item = {}) {
  const start = profitStartBasis(item);
  if (!start.hasStart) return true;
  const quoteDate = currentQuoteDate(item);
  return !!quoteDate && quoteDate >= start.date;
}

function currentCostBasis(item = {}) {
  const start = profitStartBasis(item);
  if (start.hasStart) {
    const latestDate = currentQuoteDate(item) || "9999-12-31";
    const transactions = normalizedTransactions(item, latestDate, start.date);
    const added = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    return start.amount + added;
  }

  const cost = toNumber(item.cost, NaN);
  if (!Number.isFinite(cost) || cost <= 0) return NaN;
  return cost * holdingShares(item);
}
function estimateDayGain(item) {
  const num = holdingShares(item);
  const nav = toNumber(item.dwjz, NaN);
  const gsz = toNumber(item.gsz, NaN);
  const rate = toNumber(item.gszzl, NaN);

  if (!num || !Number.isFinite(nav) || nav <= 0) return 0;
  if (item.hasReplace && Number.isFinite(rate)) {
    return (nav - nav / (1 + rate * 0.01)) * num;
  }
  if (Number.isFinite(gsz) && gsz > 0) {
    return (gsz - nav) * num;
  }
  if (Number.isFinite(rate)) {
    return nav * rate * 0.01 * num;
  }
  return 0;
}

function currentNav(item) {
  const estimatedNav = toNumber(item.gsz, NaN);
  if (Number.isFinite(estimatedNav) && estimatedNav > 0) return estimatedNav;
  return toNumber(item.dwjzValue !== undefined ? item.dwjzValue : item.dwjz);
}

function holdingAmount(item) {
  return currentNav(item) * holdingShares(item);
}

function costGain(item) {
  const start = profitStartBasis(item);
  if (start.hasStart && (!profitStartReady(item) || holdingShares(item) <= 0)) return NaN;
  const basis = currentCostBasis(item);
  if (!Number.isFinite(basis) || basis <= 0) return 0;
  return holdingAmount(item) - basis;
}

function costRate(item) {
  const gain = costGain(item);
  if (!Number.isFinite(gain)) return NaN;
  const basis = currentCostBasis(item);
  if (!Number.isFinite(basis) || basis <= 0) return 0;
  return (gain / basis) * 100;
}

function costGainLabelFor(item) {
  if (item.hasProfitStart) return item.isEstimated ? "导入后估算收益" : "导入后持有收益";
  return item.isEstimated ? "估算持有收益" : "持有收益";
}

function quoteStatusTextFor(item) {
  if (item.hasProfitStart && !item.profitStartReady) {
    return `收益起点为 ${item.profitStartText}，等待起点后的净值或盘中估值`;
  }
  if (item.hasDayGain) {
    return item.isEstimated && item.estimateSource === "fundgz" ? "已用天天基金估值补齐当天收益" : "";
  }
  return "暂无盘中估值，日收益暂不可用";
}
function normalizeFund(raw, holding = {}) {
  const pdate = raw.PDATE || "--";
  const gztime = raw.GZTIME || "--";
  const hasReplace = pdate !== "--" && gztime !== "--" && pdate === String(gztime).slice(0, 10);
  const nav = toNumber(raw.NAV, NaN);
  let estimatedNav = toNumber(raw.GSZ, NaN);
  let estimatedRate = toNumber(raw.GSZZL, NaN);
  if ((!Number.isFinite(estimatedNav) || estimatedNav <= 0) && Number.isFinite(estimatedRate) && Number.isFinite(nav) && nav > 0) {
    estimatedNav = nav * (1 + estimatedRate * 0.01);
  }
  if (!Number.isFinite(estimatedRate) && Number.isFinite(estimatedNav) && estimatedNav > 0 && Number.isFinite(nav) && nav > 0) {
    estimatedRate = ((estimatedNav - nav) / nav) * 100;
  }
  const item = {
    fundcode: raw.FCODE || holding.code,
    code: raw.FCODE || holding.code,
    name: raw.SHORTNAME || raw.NAME || holding.name || holding.code,
    jzrq: pdate,
    dwjz: Number.isFinite(nav) ? nav : null,
    gsz: Number.isFinite(estimatedNav) && estimatedNav > 0 ? estimatedNav : null,
    gszzl: Number.isFinite(estimatedRate) ? estimatedRate : null,
    gztime,
    num: holding.num || "0",
    cost: holding.cost || "",
    transactions: Array.isArray(holding.transactions) ? holding.transactions : [],
    profitStartDate: holding.profitStartDate || "",
    profitStartAmount: holding.profitStartAmount || "",
    profitStartShares: holding.profitStartShares || "",
    profitStartNav: holding.profitStartNav || "",
    estimateSource: raw.ESTIMATE_SOURCE || "",
    hasReplace
  };

  if (hasReplace) {
    const officialRate = toNumber(raw.NAVCHGRT, NaN);
    item.gsz = toNumber(raw.NAV, null);
    item.gszzl = Number.isFinite(officialRate) ? officialRate : null;
  }

  item.isEstimated = !hasReplace && Number.isFinite(estimatedNav) && estimatedNav > 0;
  item.hasDayGain = hasReplace
    ? Number.isFinite(toNumber(item.dwjz, NaN)) && Number.isFinite(toNumber(item.gszzl, NaN))
    : item.isEstimated && Number.isFinite(toNumber(item.dwjz, NaN));
  item.hasProfitStart = profitStartBasis(item).hasStart;
  item.profitStartText = item.hasProfitStart ? item.profitStartDate : "--";
  item.profitStartAmountText = item.hasProfitStart ? formatMoney(item.profitStartAmount) : "--";
  item.profitStartReady = profitStartReady(item);
  item.currentNavValue = currentNav(item);
  item.currentNav = item.currentNavValue ? formatDecimal(item.currentNavValue) : "--";
  item.currentNavLabel = item.isEstimated ? "实时估值" : "最新净值";
  item.amountLabel = item.isEstimated ? "估算持有金额" : "持有金额";
  item.dayGainLabel = item.isEstimated ? "估算日收益" : "日收益";
  item.costGainLabel = costGainLabelFor(item);
  item.quoteStatusText = quoteStatusTextFor(item);
  item.amountValue = holdingAmount(item);
  item.dayGainValue = item.hasDayGain ? estimateDayGain(item) : 0;
  item.costGainValue = costGain(item);
  item.costRateValue = costRate(item);
  item.hasCostGain = Number.isFinite(item.costGainValue) && Number.isFinite(item.costRateValue);
  item.amount = formatMoney(item.amountValue);
  item.dayGain = item.hasDayGain ? formatMoney(item.dayGainValue) : "--";
  item.costGain = item.hasCostGain ? formatMoney(item.costGainValue) : "--";
  item.costRate = item.hasCostGain ? formatPercent(item.costRateValue) : "--";
  item.gszText = item.isEstimated ? formatDecimal(item.gsz) : "--";
  item.gszzlText = item.hasDayGain ? formatPercent(item.gszzl) : "--";
  item.valueClass = item.hasDayGain ? valueClass(item.gszzl) : "flat";
  item.dayGainClass = item.hasDayGain ? valueClass(item.dayGainValue) : "flat";
  item.costGainClass = item.hasCostGain ? valueClass(item.costGainValue) : "flat";
  item.updateText = item.hasDayGain ? (hasReplace ? String(gztime).slice(5, 10) : String(gztime).slice(11, 16) || String(gztime).slice(10) || "--") : "--";
  item.dwjzValue = item.dwjz;
  item.dwjz = formatDecimal(item.dwjzValue);
  item.numText = formatDecimal(holdingShares(item));
  item.costText = item.cost ? formatDecimal(item.cost) : "--";
  return item;
}

function threeMonthsBefore(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() - 3);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function laterDate(a, b) {
  const first = validDateText(a);
  const second = validDateText(b);
  if (!first) return second;
  if (!second) return first;
  return first > second ? first : second;
}

function buildHoldingHistory(rows, holding, months = 3) {
  const byDate = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = String(row.FSRQ || row.date || "");
    const nav = toNumber(row.DWJZ || row.dwjz, NaN);
    if (date && Number.isFinite(nav) && nav > 0) byDate[date] = nav;
  });
  const allPoints = Object.keys(byDate)
    .sort()
    .map((date) => ({ date, nav: byDate[date] }));
  if (!allPoints.length) return [];

  const latestDate = allPoints[allPoints.length - 1].date;
  const startBasis = profitStartBasis(holding);
  const monthStart = months > 0 ? threeMonthsBefore(latestDate) : "";
  const startDate = laterDate(monthStart, startBasis.hasStart ? startBasis.date : "");
  const currentShares = Math.max(0, holdingShares(holding));
  const currentCostNav = toNumber(holding && holding.cost, NaN);
  const oldCostBasis = Number.isFinite(currentCostNav) && currentCostNav > 0
    ? currentShares * currentCostNav
    : NaN;
  const transactions = normalizedTransactions(holding, latestDate, startBasis.hasStart ? startBasis.date : "");
  if (startBasis.hasStart && currentShares <= 0 && (!Number.isFinite(startBasis.shares) || startBasis.shares <= 0)) return [];

  const filtered = allPoints.filter((point) => !startDate || point.date >= startDate);
  return filtered.map((point, index) => {
    let shares;
    let costBasis;
    if (startBasis.hasStart) {
      const past = transactions.filter((item) => item.date <= point.date);
      const pastShares = past.reduce((sum, item) => sum + item.shares, 0);
      const pastAmount = past.reduce((sum, item) => sum + item.amount, 0);
      if (Number.isFinite(startBasis.shares) && startBasis.shares > 0) {
        shares = startBasis.shares + pastShares;
      } else {
        const futureShares = transactions
          .filter((item) => item.date > point.date)
          .reduce((sum, item) => sum + item.shares, 0);
        shares = Math.max(0, currentShares - futureShares);
      }
      costBasis = startBasis.amount + pastAmount;
    } else {
      const future = transactions.filter((item) => item.date > point.date);
      const futureShares = future.reduce((sum, item) => sum + item.shares, 0);
      const futureAmount = future.reduce((sum, item) => sum + item.amount, 0);
      shares = Math.max(0, currentShares - futureShares);
      costBasis = Number.isFinite(oldCostBasis)
        ? Math.max(0, oldCostBasis - futureAmount)
        : NaN;
    }
    const amount = point.nav * shares;
    const gain = Number.isFinite(costBasis) ? amount - costBasis : NaN;
    const rate = Number.isFinite(costBasis) && costBasis > 0 ? (gain / costBasis) * 100 : NaN;
    const previous = index > 0 ? filtered[index - 1] : null;
    const dayGain = previous ? (point.nav - previous.nav) * shares : 0;
    const navRate = previous && previous.nav > 0 ? ((point.nav - previous.nav) / previous.nav) * 100 : 0;
    return {
      date: point.date,
      nav: point.nav,
      shares,
      costBasis,
      amount,
      gain,
      rate,
      dayGain,
      navRate
    };
  });
}

function liveEstimateDate(item) {
  const match = String(item && item.gztime || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function rowDate(row) {
  return String(row && (row.FSRQ || row.date) || "");
}

function appendLiveEstimateToHistory(rows, fund) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!fund || !fund.isEstimated) return list;
  const date = liveEstimateDate(fund);
  const nav = toNumber(fund.currentNavValue || fund.gsz, NaN);
  if (!date || !Number.isFinite(nav) || nav <= 0) return list;

  const datedRows = list
    .filter((row) => rowDate(row))
    .sort((a, b) => rowDate(a).localeCompare(rowDate(b)));
  const existing = datedRows.find((row) => rowDate(row) === date && !row.estimated);
  const latestDate = datedRows.length ? rowDate(datedRows[datedRows.length - 1]) : "";
  if (existing || (latestDate && date <= latestDate)) return list;

  const previous = [...datedRows].reverse().find((row) => rowDate(row) < date && toNumber(row.DWJZ || row.dwjz, NaN) > 0);
  const previousNav = toNumber(previous && (previous.DWJZ || previous.dwjz), NaN);
  const rate = Number.isFinite(toNumber(fund.gszzl, NaN))
    ? toNumber(fund.gszzl, NaN)
    : Number.isFinite(previousNav) && previousNav > 0
    ? ((nav - previousNav) / previousNav) * 100
    : 0;

  return [...list, {
    FCODE: fund.code || fund.fundcode,
    FSRQ: date,
    DWJZ: nav.toFixed(4),
    LJJZ: "",
    JZZZL: String(rate),
    estimated: true
  }].sort((a, b) => rowDate(a).localeCompare(rowDate(b)));
}

function applyHistoryFallback(fund, rows) {
  if (!fund || fund.hasDayGain) return fund;
  const series = buildHoldingHistory(rows, fund, 3);
  if (series.length < 2) return fund;
  const latest = series[series.length - 1];
  const item = { ...fund };
  item.dwjz = latest.nav;
  item.jzrq = latest.date;
  item.gsz = null;
  item.gszText = "--";
  item.gszzl = latest.navRate;
  item.hasReplace = false;
  item.isEstimated = false;
  item.isHistoricalFallback = true;
  item.hasDayGain = true;
  item.currentNavValue = latest.nav;
  item.currentNav = formatDecimal(latest.nav);
  item.currentNavLabel = "历史净值";
  item.amountLabel = "持有金额";
  item.dayGainLabel = "最近一日收益";
  item.costGainLabel = item.hasProfitStart ? "导入后持有收益" : "持有收益";
  item.quoteStatusText = `按 ${latest.date} 与上一交易日净值回算`;
  item.amountValue = latest.amount;
  item.dayGainValue = latest.dayGain;
  item.costGainValue = Number.isFinite(latest.gain) ? latest.gain : NaN;
  item.costRateValue = Number.isFinite(latest.rate) ? latest.rate : NaN;
  item.hasCostGain = Number.isFinite(item.costGainValue) && Number.isFinite(item.costRateValue);
  item.profitStartReady = item.hasProfitStart ? latest.date >= item.profitStartDate : true;
  item.amount = formatMoney(item.amountValue);
  item.dayGain = formatMoney(item.dayGainValue);
  item.costGain = Number.isFinite(latest.gain) ? formatMoney(latest.gain) : "--";
  item.costRate = Number.isFinite(latest.rate) ? formatPercent(latest.rate) : "--";
  item.gszzlText = formatPercent(item.gszzl);
  item.valueClass = valueClass(item.gszzl);
  item.dayGainClass = valueClass(item.dayGainValue);
  item.costGainClass = item.hasCostGain ? valueClass(latest.gain) : "flat";
  item.updateText = latest.date;
  item.historySeries = series;
  item.dwjz = formatDecimal(item.dwjz);
  item.numText = formatDecimal(holdingShares(item));
  item.costText = item.cost ? formatDecimal(item.cost) : "--";
  return item;
}
function summarize(funds) {
  const hasEstimate = funds.some((item) => item.isEstimated);
  const hasProfitStart = funds.some((item) => item.hasProfitStart);
  const hasHistoricalFallback = funds.some((item) => item.isHistoricalFallback);
  const hasUnavailableDayGain = funds.some((item) => holdingShares(item) > 0 && !item.hasDayGain);
  const hasUnavailableCostGain = funds.some((item) => holdingShares(item) > 0 && item.hasCostGain === false);
  const totalAmount = funds.reduce((sum, item) => sum + toNumber(item.amountValue), 0);
  const totalDayGain = funds.reduce((sum, item) => sum + toNumber(item.dayGainValue), 0);
  const totalCostGain = funds.reduce((sum, item) => sum + toNumber(item.costGainValue), 0);
  const previousAmount = totalAmount - totalDayGain;
  const dayRate = previousAmount ? (totalDayGain / previousAmount) * 100 : 0;
  const previewHint = hasEstimate
    ? "按当天实时估值预估"
    : hasHistoricalFallback
    ? "按最近官方净值回算"
    : hasUnavailableDayGain
    ? "等待盘中估值"
    : "按最新行情计算";
  return {
    totalAmountValue: totalAmount,
    totalDayGainValue: totalDayGain,
    totalCostGainValue: totalCostGain,
    dayRateValue: dayRate,
    hasEstimate,
    hasProfitStart,
    hasHistoricalFallback,
    hasUnavailableDayGain,
    hasUnavailableCostGain,
    previewTitle: "实时收益预览",
    previewHint,
    previewValue: hasUnavailableDayGain ? "--" : formatMoney(totalDayGain),
    previewRate: hasUnavailableDayGain ? "--" : formatPercent(dayRate),
    previewClass: hasUnavailableDayGain ? "flat" : valueClass(totalDayGain),
    amountLabel: hasEstimate ? "估算持有金额" : "持有金额",
    dayGainLabel: hasHistoricalFallback ? (hasEstimate ? "参考日收益" : "最近一日收益") : (hasEstimate ? "估算日收益" : "日收益"),
    costGainLabel: hasProfitStart ? (hasEstimate ? "导入后估算收益" : "导入后持有收益") : (hasEstimate ? "估算持有收益" : "持有收益"),
    totalAmount: formatMoney(totalAmount),
    totalDayGain: hasUnavailableDayGain ? "--" : formatMoney(totalDayGain),
    totalCostGain: hasUnavailableCostGain ? "--" : formatMoney(totalCostGain),
    dayRate: hasUnavailableDayGain ? "--" : formatPercent(dayRate),
    totalDayGainClass: hasUnavailableDayGain ? "flat" : valueClass(totalDayGain),
    totalCostGainClass: hasUnavailableCostGain ? "flat" : valueClass(totalCostGain),
    dayRateClass: hasUnavailableDayGain ? "flat" : valueClass(dayRate)
  };
}
module.exports = {
  toNumber,
  round,
  formatMoney,
  formatDecimal,
  formatPercent,
  valueClass,
  normalizeFund,
  buildHoldingHistory,
  appendLiveEstimateToHistory,
  applyHistoryFallback,
  summarize,
  estimateDayGain,
  currentNav,
  holdingAmount,
  costGain,
  costRate
};