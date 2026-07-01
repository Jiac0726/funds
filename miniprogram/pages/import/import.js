const { importAlipayScreenshot, parseAlipayText, hasBackend } = require("../../utils/api");
const { getState, saveState } = require("../../utils/storage");

function validCode(code) {
  return /^\d{6}$/.test(String(code || "").trim());
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function cleanNumber(value) {
  return cleanText(value).replace(/[,，￥¥元份\s]/g, "");
}

function rowIdFor(item, index) {
  const code = cleanText(item.code);
  if (validCode(code)) return `code-${code}`;
  return `row-${index}-${cleanText(item.name || item.amount || Date.now())}`;
}

function importableItems(items) {
  return (items || [])
    .filter((item) => item && (item.code || item.name || item.amount || item.shares || item.num))
    .map((item, index) => {
      const code = cleanText(item.code);
      const name = cleanText(item.name || code);
      return {
        rowId: item.rowId || rowIdFor(item, index),
        enabled: item.enabled !== false,
        code,
        name,
        num: cleanNumber(item.shares || item.num || ""),
        cost: cleanNumber(item.cost || ""),
        amount: cleanNumber(item.amount || ""),
        estimatedShares: !!item.estimatedShares,
        estimatedNav: cleanNumber(item.estimatedNav || ""),
        unresolved: !!item.unresolved || !validCode(code)
      };
    });
}

function mergeResultItems(baseItems, nextItems) {
  const rows = [];
  const codeIndex = {};
  (baseItems || []).concat(nextItems || []).forEach((item, index) => {
    if (!item) return;
    const normalized = importableItems([item])[0];
    if (!normalized) return;
    const code = cleanText(normalized.code);
    if (validCode(code) && codeIndex[code] !== undefined) {
      const current = rows[codeIndex[code]];
      rows[codeIndex[code]] = {
        ...current,
        ...normalized,
        rowId: current.rowId,
        enabled: current.enabled !== false,
        name: normalized.name || current.name || code,
        num: normalized.num || current.num || "",
        cost: normalized.cost || current.cost || "",
        amount: normalized.amount || current.amount || "",
        estimatedShares: !!(current.estimatedShares || normalized.estimatedShares),
        estimatedNav: normalized.estimatedNav || current.estimatedNav || "",
        unresolved: false
      };
      return;
    }
    normalized.rowId = validCode(code) ? `code-${code}` : `${normalized.rowId}-${index}`;
    if (validCode(code)) codeIndex[code] = rows.length;
    rows.push(normalized);
  });
  return rows;
}

function mergeWarnings(baseWarnings, nextWarnings) {
  const seen = {};
  return (baseWarnings || []).concat(nextWarnings || []).filter((item) => {
    if (!item || seen[item]) return false;
    seen[item] = true;
    return true;
  });
}

Page({
  data: {
    hasBackend: false,
    imagePaths: [],
    ocrText: "",
    loading: false,
    progressText: "",
    resultItems: [],
    warnings: []
  },

  onShow() {
    this.setData({ hasBackend: hasBackend() });
  },

  chooseImages() {
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const imagePaths = (res.tempFiles || []).map((file) => file.tempFilePath).filter(Boolean);
        if (!imagePaths.length) return;
        this.setData({ imagePaths, resultItems: [], warnings: [], progressText: "" });
      }
    });
  },

  clearImages() {
    this.setData({ imagePaths: [], resultItems: [], warnings: [], progressText: "" });
  },

  previewImage(event) {
    const imagePaths = this.data.imagePaths;
    if (!imagePaths.length) return;
    const index = Number(event.currentTarget.dataset.index || 0);
    wx.previewImage({ urls: imagePaths, current: imagePaths[index] || imagePaths[0] });
  },

  onTextInput(event) {
    this.setData({ ocrText: event.detail.value });
  },

  recognizeImages() {
    const imagePaths = this.data.imagePaths;
    if (!imagePaths.length) {
      wx.showToast({ title: "请先选择截图", icon: "none" });
      return;
    }

    this.setData({ loading: true, resultItems: [], warnings: [], progressText: `准备识别 ${imagePaths.length} 张截图` });
    this.recognizeImageQueue(imagePaths)
      .then(({ items, warnings }) => {
        this.setData({ resultItems: items, warnings });
        if (!items.length) {
          wx.showModal({
            title: "没有可导入基金",
            content: warnings[0] || "未识别到可填写的基金表单，请换一张截图或粘贴 OCR 文本。",
            showCancel: false
          });
        }
      })
      .finally(() => this.setData({ loading: false, progressText: "" }));
  },

  async recognizeImageQueue(imagePaths) {
    let items = [];
    let warnings = [];
    for (let index = 0; index < imagePaths.length; index += 1) {
      this.setData({ progressText: `正在识别第 ${index + 1}/${imagePaths.length} 张` });
      try {
        const res = await importAlipayScreenshot(imagePaths[index], this.data.ocrText);
        items = mergeResultItems(items, importableItems(res.items || []));
        warnings = mergeWarnings(warnings, res.warnings || []);
      } catch (error) {
        warnings = mergeWarnings(warnings, [`第 ${index + 1} 张识别失败：${error.message || "请检查后端 AI/OCR 配置"}`]);
      }
    }
    return { items, warnings };
  },

  recognizeText() {
    if (!this.data.ocrText.trim()) {
      wx.showToast({ title: "请先粘贴识别文本", icon: "none" });
      return;
    }
    this.setData({ loading: true, resultItems: [], warnings: [], progressText: "正在解析文本" });
    parseAlipayText(this.data.ocrText)
      .then((res) => this.handleRecognizeResult(res))
      .catch((error) => wx.showModal({ title: "解析失败", content: error.message || "请检查后端配置", showCancel: false }))
      .finally(() => this.setData({ loading: false, progressText: "" }));
  },

  handleRecognizeResult(res) {
    const resultItems = mergeResultItems([], importableItems(res.items || []));
    const warnings = res.warnings || [];
    this.setData({ resultItems, warnings });
    if (!resultItems.length) {
      wx.showModal({ title: "没有可导入基金", content: warnings[0] || "未识别到可填写的基金表单，请换一张截图或粘贴 OCR 文本。", showCancel: false });
    }
  },

  onItemInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (!field || Number.isNaN(index)) return;
    const value = event.detail.value;
    this.setData({ [`resultItems[${index}].${field}`]: value });
    if (field === "code") {
      this.setData({ [`resultItems[${index}].unresolved`]: !validCode(value) });
    }
    if (field === "amount") {
      const item = this.data.resultItems[index] || {};
      const nav = Number(item.estimatedNav);
      const amount = Number(cleanNumber(value));
      if (item.estimatedShares && Number.isFinite(nav) && nav > 0 && Number.isFinite(amount)) {
        this.setData({ [`resultItems[${index}].num`]: (amount / nav).toFixed(2) });
      }
    }
  },

  onItemSwitch(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    this.setData({ [`resultItems[${index}].enabled`]: event.detail.value });
  },

  removeItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const resultItems = this.data.resultItems.filter((_, itemIndex) => itemIndex !== index);
    this.setData({ resultItems });
  },

  addBlankItem() {
    const resultItems = this.data.resultItems.concat({
      rowId: `manual-${Date.now()}`,
      enabled: true,
      code: "",
      name: "",
      num: "",
      cost: "",
      amount: "",
      estimatedShares: false,
      estimatedNav: "",
      unresolved: true
    });
    this.setData({ resultItems });
  },

  validateImportItems() {
    const enabledItems = (this.data.resultItems || []).filter((item) => item.enabled !== false);
    if (!enabledItems.length) {
      wx.showToast({ title: "没有选择导入项", icon: "none" });
      return null;
    }
    const seen = {};
    const cleaned = [];
    for (let index = 0; index < enabledItems.length; index += 1) {
      const item = enabledItems[index];
      const code = cleanText(item.code);
      if (!validCode(code)) {
        wx.showToast({ title: `第 ${index + 1} 行基金代码不正确`, icon: "none" });
        return null;
      }
      if (seen[code]) {
        wx.showToast({ title: `基金代码 ${code} 重复`, icon: "none" });
        return null;
      }
      seen[code] = true;
      cleaned.push({
        code,
        name: cleanText(item.name) || code,
        num: cleanNumber(item.num) || "0",
        cost: cleanNumber(item.cost),
        amount: cleanNumber(item.amount)
      });
    }
    return cleaned;
  },

  applyImport() {
    const items = this.validateImportItems();
    if (!items) return;

    const state = getState();
    let added = 0;
    let updated = 0;
    items.forEach((item) => {
      const current = state.holdings.find((holding) => holding.code === item.code);
      if (current) {
        if (item.name) current.name = item.name;
        if (item.num && item.num !== "0") current.num = item.num;
        if (item.cost) current.cost = item.cost;
        updated += 1;
      } else {
        state.holdings.push({ code: item.code, name: item.name, num: item.num || "0", cost: item.cost || "" });
        added += 1;
      }
    });
    saveState(state);
    wx.showModal({
      title: "导入完成",
      content: `新增 ${added} 只，更新 ${updated} 只。`,
      showCancel: false,
      success: () => wx.navigateBack()
    });
  }
});