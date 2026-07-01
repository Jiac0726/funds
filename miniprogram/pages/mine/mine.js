const {
  getState,
  saveState,
  resetState,
  normalizeState,
  setDataSource
} = require("../../utils/storage");
const {
  fetchDataSources,
  fetchAuthStatus,
  fetchCurrentUser,
  wechatLogin,
  wechatLogout
} = require("../../utils/api");

const FALLBACK_SOURCES = [
  { id: "eastmoney", label: "东方财富", available: true, supportsEstimate: true },
  { id: "fundgz", label: "天天基金估值", available: true, supportsEstimate: true },
  { id: "tushare", label: "Tushare净值", available: false, supportsEstimate: false }
];

function displaySources(sources) {
  return sources.map((item) => ({
    ...item,
    displayLabel: item.available ? item.label : `${item.label}（未配置）`
  }));
}

Page({
  data: {
    holdingCount: 0,
    version: "0.3.0",
    dataSources: displaySources(FALLBACK_SOURCES),
    sourceIndex: 0,
    currentSourceLabel: "东方财富",
    authAvailable: false,
    authLoading: false,
    loggedIn: false,
    userId: "",
    authStatusText: "未登录"
  },

  onShow() {
    this.refreshStats();
    this.loadDataSources();
    this.loadAuth();
  },

  refreshStats() {
    const state = getState();
    const sourceId = state.settings && state.settings.dataSource || "eastmoney";
    const sourceIndex = Math.max(0, this.data.dataSources.findIndex((item) => item.id === sourceId));
    this.setData({
      holdingCount: (state.holdings || []).length,
      sourceIndex,
      currentSourceLabel: this.data.dataSources[sourceIndex].label
    });
  },

  loadDataSources() {
    fetchDataSources()
      .then((sources) => {
        const dataSources = displaySources(sources.length ? sources : FALLBACK_SOURCES);
        const sourceId = getState().settings.dataSource || "eastmoney";
        const sourceIndex = Math.max(0, dataSources.findIndex((item) => item.id === sourceId));
        this.setData({
          dataSources,
          sourceIndex,
          currentSourceLabel: dataSources[sourceIndex].label
        });
      })
      .catch(() => {
        this.setData({ dataSources: displaySources(FALLBACK_SOURCES) });
        this.refreshStats();
      });
  },

  onDataSourceChange(event) {
    const index = Number(event.detail.value);
    const source = this.data.dataSources[index];
    if (!source) return;
    if (!source.available) {
      wx.showModal({
        title: "数据源未配置",
        content: source.id === "tushare"
          ? "请先在服务器配置 TUSHARE_TOKEN。"
          : "请先配置小程序后端域名。",
        showCancel: false
      });
      return;
    }
    setDataSource(source.id);
    this.setData({ sourceIndex: index, currentSourceLabel: source.label });
    wx.showToast({ title: `已切换到${source.label}`, icon: "none" });
  },

  loadAuth() {
    this.setData({ authLoading: true });
    fetchAuthStatus()
      .then((status) => {
        const available = !!(status && status.available);
        if (!available) {
          this.setData({
            authAvailable: false,
            authLoading: false,
            loggedIn: false,
            userId: "",
            authStatusText: "服务器未配置微信登录"
          });
          return null;
        }
        this.setData({ authAvailable: true });
        return fetchCurrentUser();
      })
      .then((user) => {
        if (!this.data.authAvailable) return;
        this.setData({
          authLoading: false,
          loggedIn: !!user,
          userId: user && user.id || "",
          authStatusText: user ? "微信用户 " + user.id : "未登录"
        });
      })
      .catch(() => {
        this.setData({
          authLoading: false,
          loggedIn: false,
          userId: "",
          authStatusText: "登录状态已失效"
        });
      });
  },

  loginWechat() {
    if (!this.data.authAvailable || this.data.authLoading) return;
    this.setData({ authLoading: true, authStatusText: "正在微信授权" });
    wechatLogin()
      .then((user) => {
        this.setData({
          authLoading: false,
          loggedIn: true,
          userId: user.id,
          authStatusText: "微信用户 " + user.id
        });
        wx.showToast({ title: "登录成功", icon: "success" });
      })
      .catch((error) => {
        this.setData({ authLoading: false, authStatusText: "登录失败" });
        wx.showToast({ title: error.message || "登录失败", icon: "none" });
      });
  },

  logoutWechat() {
    if (this.data.authLoading) return;
    this.setData({ authLoading: true });
    wechatLogout().then(() => {
      this.setData({
        authLoading: false,
        loggedIn: false,
        userId: "",
        authStatusText: "未登录"
      });
      wx.showToast({ title: "已退出", icon: "none" });
    });
  },

  goEdit() {
    wx.navigateTo({ url: "/pages/edit/edit" });
  },

  goImport() {
    wx.navigateTo({ url: "/pages/import/import" });
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  exportConfig() {
    const payload = {
      app: "funds-mini",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: getState()
    };
    wx.setClipboardData({
      data: JSON.stringify(payload, null, 2),
      success: () => wx.showToast({ title: "已复制配置", icon: "success" })
    });
  },

  importConfig() {
    wx.getClipboardData({
      success: (res) => {
        let parsed;
        try {
          parsed = JSON.parse(res.data || "");
        } catch (error) {
          wx.showToast({ title: "剪贴板不是配置 JSON", icon: "none" });
          return;
        }
        const nextState = normalizeState(parsed);
        wx.showModal({
          title: "导入配置",
          content: `将导入 ${nextState.holdings.length} 只自选基金，当前配置会被覆盖。`,
          confirmText: "导入",
          success: (modal) => {
            if (!modal.confirm) return;
            saveState(nextState);
            this.refreshStats();
            wx.showToast({ title: "导入成功", icon: "success" });
          }
        });
      },
      fail: () => wx.showToast({ title: "读取剪贴板失败", icon: "none" })
    });
  },

  resetConfig() {
    wx.showModal({
      title: "恢复默认配置",
      content: "会清空当前自选、份额和成本设置。",
      confirmText: "恢复",
      confirmColor: "#c73636",
      success: (res) => {
        if (!res.confirm) return;
        resetState();
        this.refreshStats();
        wx.showToast({ title: "已恢复默认", icon: "success" });
      }
    });
  }
});