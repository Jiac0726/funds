const {
  getState,
  saveState,
  resetState,
  normalizeState,
  setDataSource
} = require("../../utils/storage");
const {
  fetchDataSources
} = require("../../utils/api");
const {
  isCloudAvailable,
  fetchCloudStateDirect,
  saveCloudStateDirect
} = require("../../utils/cloud-store");

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
    cloudAvailable: false,
    cloudLoading: false,
    loggedIn: false,
    userId: "",
    authStatusText: "本机模式"
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
    const cloudAvailable = isCloudAvailable();
    this.setData({
      authAvailable: cloudAvailable,
      cloudAvailable,
      authLoading: false,
      loggedIn: cloudAvailable,
      userId: cloudAvailable ? "CloudBase" : "",
      authStatusText: cloudAvailable ? "微信云开发已连接" : "未配置云开发环境"
    });
  },

  loginWechat() {
    if (!this.data.cloudAvailable) {
      wx.showToast({ title: "未配置云开发环境", icon: "none" });
      return;
    }
    wx.showToast({ title: "云开发已自动连接", icon: "none" });
  },

  logoutWechat() {
    wx.showToast({ title: "云开发身份由微信自动管理", icon: "none" });
  },

  backupCloud() {
    if (!this.data.cloudAvailable || this.data.cloudLoading) return;
    this.setData({ cloudLoading: true });
    saveCloudStateDirect(getState())
      .then(() => wx.showToast({ title: "云端备份成功", icon: "success" }))
      .catch((error) => wx.showToast({ title: error.message || "备份失败", icon: "none" }))
      .finally(() => this.setData({ cloudLoading: false }));
  },

  restoreCloud() {
    if (!this.data.cloudAvailable || this.data.cloudLoading) return;
    this.setData({ cloudLoading: true });
    fetchCloudStateDirect()
      .then((result) => {
        if (!result.state) {
          wx.showToast({ title: "云端暂无备份", icon: "none" });
          return;
        }
        wx.showModal({
          title: "恢复云端数据",
          content: "将使用云端持仓覆盖当前本地数据，是否继续？",
          confirmText: "恢复",
          success: (modal) => {
            if (!modal.confirm) return;
            saveState(normalizeState(result.state));
            this.refreshStats();
            wx.showToast({ title: "恢复成功", icon: "success" });
          }
        });
      })
      .catch((error) => wx.showToast({ title: error.message || "恢复失败", icon: "none" }))
      .finally(() => this.setData({ cloudLoading: false }));
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

  openLegal(event) {
    const type = event.currentTarget.dataset.type || "agreement";
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
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
