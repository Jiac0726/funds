const test = require("node:test");
const assert = require("node:assert/strict");

const { parseFundGzPayload, mergeFundGzQuoteRows, mapFundPositionData, mapTushareNavRows } = require("../src/server");

test("parses the FundGZ JSONP quote payload", () => {
  const result = parseFundGzPayload('jsonpgz({"fundcode":"000001","name":"示例基金","jzrq":"2026-06-30","dwjz":"1.6370","gsz":"1.6331","gszzl":"-0.24","gztime":"2026-07-01 11:24"});');
  assert.equal(result.fundcode, "000001");
  assert.equal(result.gsz, "1.6331");
  assert.equal(result.gszzl, "-0.24");
});

test("maps and sorts Tushare fund NAV rows", () => {
  const result = mapTushareNavRows([
    { nav_date: "20260630", unit_nav: 1.2, accum_nav: 2.1 },
    { nav_date: "20260627", unit_nav: 1.0, accum_nav: 1.9 }
  ], "000001");

  assert.equal(result[0].FSRQ, "2026-06-27");
  assert.equal(result[1].FSRQ, "2026-06-30");
  assert.equal(result[1].JZZZL, "20.0000");
});
test("merges same-day FundGZ estimates into Eastmoney quote rows", () => {
  const result = mergeFundGzQuoteRows([
    { FCODE: "025833", SHORTNAME: "示例基金", PDATE: "2026-06-30", NAV: "1.4456", GSZ: null, GSZZL: null, GZTIME: "--" }
  ], [
    { FCODE: "025833", SHORTNAME: "示例基金", PDATE: "2026-06-30", NAV: "1.4456", GSZ: "1.4600", GSZZL: "1.00", GZTIME: "2026-07-01 10:30" }
  ], "2026-07-01");

  assert.equal(result[0].NAV, "1.4456");
  assert.equal(result[0].GSZ, "1.4600");
  assert.equal(result[0].GSZZL, "1.00");
  assert.equal(result[0].ESTIMATE_SOURCE, "fundgz");
});
test("maps fund internal stock positions and quote changes", () => {
  const result = mapFundPositionData({
    Expansion: "2026-06-30",
    Datas: {
      fundStocks: [
        { GPDM: "300750", GPJC: "宁德时代", NEWTEXCH: "0", JZBL: "9.876", PCTNVCHG: "1.234", PCTNVCHGTYPE: "增加" },
        { GPDM: "00700", GPJC: "腾讯控股", NEWTEXCH: "116", JZBL: "4.5", PCTNVCHGTYPE: "新增" }
      ]
    }
  }, [
    { f12: "300750", f2: 201.23, f3: -0.56 },
    { f12: "00700", f2: 388.4, f3: 1.2 }
  ]);

  assert.equal(result.expansion, "2026-06-30");
  assert.equal(result.stockPositions.length, 2);
  assert.equal(result.stockPositions[0].secid, "0.300750");
  assert.equal(result.stockPositions[0].ratio, 9.876);
  assert.equal(result.stockPositions[0].price, 201.23);
  assert.equal(result.stockPositions[0].quoteChangeRate, -0.56);
  assert.equal(result.stockPositions[1].periodChangeType, "新增");
  assert.ok(Math.abs(result.totalStockRatio - 14.376) < 1e-9);
});