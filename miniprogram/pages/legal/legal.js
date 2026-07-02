const TITLES = {
  agreement: "用户协议",
  privacy: "隐私政策",
  risk: "风险提示与数据说明"
};

Page({
  data: {
    type: "agreement",
    title: TITLES.agreement
  },

  onLoad(query) {
    const type = query && TITLES[query.type] ? query.type : "agreement";
    this.setData({
      type,
      title: TITLES[type]
    });
    wx.setNavigationBarTitle({ title: TITLES[type] });
  }
});
