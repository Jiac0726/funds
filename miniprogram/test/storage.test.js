const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeState } = require("../utils/storage");

test("preserves valid construction and addition records in holding storage", () => {
  const state = normalizeState({
    holdings: [
      {
        code: "012345",
        name: "持仓记录示例",
        num: "200",
        cost: "1.5000",
        transactions: [
          {
            id: "open-1",
            kind: "open",
            date: "2026-04-01",
            shares: "100",
            amount: "140"
          },
          {
            id: "add-1",
            kind: "add",
            date: "2026-05-15",
            shares: "100",
            price: "1.60"
          },
          {
            id: "invalid",
            kind: "add",
            date: "invalid",
            shares: "10",
            amount: "10"
          }
        ]
      }
    ]
  });

  const transactions = state.holdings[0].transactions;
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].kind, "open");
  assert.equal(transactions[1].amount, "160.00");
  assert.equal(transactions[1].price, "1.6000");
});
test("keeps supported data sources and rejects unknown values", () => {
  assert.equal(normalizeState({ settings: { dataSource: "tushare" } }).settings.dataSource, "tushare");
  assert.equal(normalizeState({ settings: { dataSource: "unknown" } }).settings.dataSource, "eastmoney");
});
