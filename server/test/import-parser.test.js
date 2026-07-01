const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAlipayTextHeuristic } = require("../src/server");

test("parses an Alipay asset detail page without using fund NAV as cost", () => {
  const result = parseAlipayTextHeuristic(`
资产详情
示例稳健6个月持有期债券A
012345 中低风险
金额(元)
4,009.99
锁定份额 3,622.72份
昨日收益(元) +0.72
持有收益(元) +9.99
持有收益率 +0.25%
持有金额 4,009.99 待确认金额 0.00
持仓成本价 1.1041 持有份额 3,622.72
日涨幅 +0.02% 基金净值 1.1069(06-30)
`);

  assert.equal(result.items.length, 1);
  assert.deepEqual(
    {
      code: result.items[0].code,
      name: result.items[0].name,
      amount: result.items[0].amount,
      shares: result.items[0].shares,
      cost: result.items[0].cost
    },
    {
      code: "012345",
      name: "示例稳健6个月持有期债券A",
      amount: "4009.99",
      shares: "3622.72",
      cost: "1.1041"
    }
  );
});
test("parses the line-broken amount label from an asset detail page", () => {
  const result = parseAlipayTextHeuristic(`
示例指数联接C
065432
金额(元)
1,234.56
持有份额
987.65
持仓成本价
1.2500
基金净值
1.2600
`);

  assert.equal(result.items[0].amount, "1234.56");
  assert.equal(result.items[0].shares, "987.65");
  assert.equal(result.items[0].cost, "1.2500");
});
