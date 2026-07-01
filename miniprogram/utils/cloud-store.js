const { CLOUD_ENV_ID, CLOUD_STATE_COLLECTION } = require("./config");

function isCloudAvailable() {
  return !!(CLOUD_ENV_ID && typeof wx !== "undefined" && wx.cloud && wx.cloud.database);
}

function getStateCollection() {
  if (!isCloudAvailable()) {
    throw new Error("CloudBase 未配置");
  }
  return wx.cloud.database({ env: CLOUD_ENV_ID }).collection(CLOUD_STATE_COLLECTION);
}

async function fetchCloudStateDirect() {
  const collection = getStateCollection();
  const result = await collection.where({ key: "default" }).limit(1).get();
  const doc = result && result.data && result.data[0];
  return {
    state: doc && doc.state ? doc.state : null,
    updatedAt: doc && doc.updatedAt || ""
  };
}

async function saveCloudStateDirect(state) {
  const collection = getStateCollection();
  const now = new Date().toISOString();
  const result = await collection.where({ key: "default" }).limit(1).get();
  const doc = result && result.data && result.data[0];

  if (doc && doc._id) {
    const updated = await collection.doc(doc._id).update({
      data: {
        state,
        updatedAt: now
      }
    });
    if (!updated || updated.updated === 0) {
      throw new Error("云端数据未更新，请稍后重试");
    }
    return { updatedAt: now };
  }

  await collection.add({
    data: {
      key: "default",
      state,
      createdAt: now,
      updatedAt: now
    }
  });
  return { updatedAt: now };
}

module.exports = {
  isCloudAvailable,
  fetchCloudStateDirect,
  saveCloudStateDirect
};
