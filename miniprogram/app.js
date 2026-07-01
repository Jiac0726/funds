const { CLOUD_ENV_ID } = require("./utils/config");

App({
  globalData: {
    version: "0.1.0",
    cloudReady: false
  },

  onLaunch() {
    if (CLOUD_ENV_ID && wx.cloud) {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }
  }
});
