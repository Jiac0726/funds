const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeFund, buildHoldingHistory, appendLiveEstimateToHistory, applyHistoryFallback, summarize } = require("../utils/format");

test("uses intraday estimated NAV for live holding gains", () => {
  const fund = normalizeFund(
    {
      FCODE: "012345",
      SHORTNAME: "示例基金",
      PDATE: "2026-06-30",
      NAV: "1.1000",
      GSZ: "1.1200",
      GSZZL: "1.82",
      GZTIME: "2026-07-01 10:30"
    },
    { code: "012345", num: "1000", cost: "1.0000" }
  );

  assert.equal(fund.isEstimated, true);
  assert.equal(fund.currentNav, "1.12");
  assert.equal(fund.amountValue, 1120);
  assert.ok(Math.abs(fund.dayGainValue - 20) < 1e-9);
  assert.ok(Math.abs(fund.costGainValue - 120) < 1e-9);
  assert.ok(Math.abs(fund.costRateValue - 12) < 1e-9);
  assert.equal(fund.numText, "1000.00");
  assert.equal(fund.costText, "1.00");

  const summary = summarize([fund]);
  assert.equal(summary.hasEstimate, true);
  assert.equal(summary.amountLabel, "估算持有金额");
  assert.equal(summary.previewTitle, "实时收益预览");
  assert.equal(summary.previewHint, "按当天实时估值预估");
  assert.equal(summary.previewValue, "20.00");
  assert.equal(summary.previewRate, "1.82%");
  assert.equal(summary.totalAmount, "1,120.00");
  assert.equal(summary.totalDayGain, "20.00");
  assert.equal(summary.totalCostGain, "120.00");
});

test("uses the official NAV after the current-day NAV is published", () => {
  const fund = normalizeFund(
    {
      FCODE: "012345",
      SHORTNAME: "示例基金",
      PDATE: "2026-07-01",
      NAV: "1.1300",
      GSZ: "1.1200",
      GSZZL: "1.82",
      NAVCHGRT: "0.90",
      GZTIME: "2026-07-01 15:10"
    },
    { code: "012345", num: "1000", cost: "1.0000" }
  );

  assert.equal(fund.isEstimated, false);
  assert.equal(fund.currentNav, "1.13");
  assert.equal(fund.amountValue, 1130);
  assert.ok(Math.abs(fund.costGainValue - 130) < 1e-9);
});
test("shows unavailable intraday estimates as dashes instead of zero", () => {
  const fund = normalizeFund(
    {
      FCODE: "065432",
      SHORTNAME: "无盘中估值示例",
      PDATE: "2026-06-30",
      NAV: "1.4456",
      GSZ: null,
      GSZZL: null,
      GZTIME: null
    },
    { code: "065432", num: "4032.46", cost: "1.4701" }
  );

  assert.equal(fund.hasDayGain, false);
  assert.equal(fund.gszzlText, "--");
  assert.equal(fund.dayGain, "--");
  assert.equal(fund.currentNav, "1.45");
  assert.ok(Math.abs(fund.costGainValue - (-98.79527)) < 0.00001);

  const summary = summarize([fund]);
  assert.equal(summary.totalDayGain, "--");
  assert.equal(summary.dayRate, "--");
  assert.equal(summary.totalCostGain, "-98.80");
});
test("recalculates recent gains from imported holdings and official NAV history", () => {
  const fund = normalizeFund(
    {
      FCODE: "065432",
      SHORTNAME: "历史回算示例",
      PDATE: "2026-06-30",
      NAV: "1.4456",
      GSZ: null,
      GSZZL: null,
      GZTIME: null
    },
    { code: "065432", num: "4032.46", cost: "1.4701" }
  );
  const recalculated = applyHistoryFallback(fund, [
    { FSRQ: "2026-06-27", DWJZ: "1.4300" },
    { FSRQ: "2026-06-30", DWJZ: "1.4456" }
  ]);

  assert.equal(recalculated.isHistoricalFallback, true);
  assert.equal(recalculated.currentNavLabel, "历史净值");
  assert.equal(recalculated.dayGainLabel, "最近一日收益");
  assert.ok(Math.abs(recalculated.dayGainValue - 62.906376) < 0.00001);
  assert.equal(recalculated.costGain, "-98.80");
  const summary = summarize([recalculated]);
  assert.equal(summary.dayGainLabel, "最近一日收益");
  assert.equal(summary.totalDayGain, "62.91");
});
test("rebuilds a three-month daily holding series around historical additions", () => {
  const series = buildHoldingHistory(
    [
      { FSRQ: "2026-04-01", DWJZ: "1.4000" },
      { FSRQ: "2026-05-14", DWJZ: "1.5000" },
      { FSRQ: "2026-05-15", DWJZ: "1.5200" },
      { FSRQ: "2026-06-30", DWJZ: "1.6000" }
    ],
    {
      num: "200",
      cost: "1.5000",
      transactions: [
        { date: "2026-05-15", shares: "100", amount: "160.00" }
      ]
    },
    3
  );

  assert.equal(series[0].shares, 100);
  assert.equal(series[0].costBasis, 140);
  assert.equal(series[2].shares, 200);
  assert.equal(series[2].costBasis, 300);
  assert.equal(series[series.length - 1].amount, 320);
  assert.equal(series[series.length - 1].gain, 20);
});

test("appends same-day live estimate into holding history preview", () => {
  const fund = normalizeFund(
    {
      FCODE: "025833",
      SHORTNAME: "实时预览示例",
      PDATE: "2026-06-30",
      NAV: "1.4456",
      GSZ: "1.4600",
      GSZZL: "1.00",
      GZTIME: "2026-07-01 10:30",
      ESTIMATE_SOURCE: "fundgz"
    },
    { code: "025833", num: "1000", cost: "1.4701" }
  );
  const rows = appendLiveEstimateToHistory([
    { FSRQ: "2026-06-27", DWJZ: "1.4300" },
    { FSRQ: "2026-06-30", DWJZ: "1.4456" }
  ], fund);
  const series = buildHoldingHistory(rows, fund, 3);

  assert.equal(rows[rows.length - 1].FSRQ, "2026-07-01");
  assert.equal(rows[rows.length - 1].estimated, true);
  assert.ok(Math.abs(fund.dayGainValue - 14.4) < 0.00001);
  assert.ok(Math.abs(series[series.length - 1].dayGain - 14.4) < 0.00001);
});