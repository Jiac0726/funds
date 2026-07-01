# Unlimited-OCR 接入说明

仓库：`https://github.com/baidu/Unlimited-OCR.git`

推荐部署方式是把 Unlimited-OCR 单独作为 GPU OCR 服务运行，本项目的 `funds-api` 后端只通过 OpenAI-compatible `/v1/chat/completions` 调用它。

## funds-api 配置

```env
VISION_PROVIDER=unlimited-ocr
VISION_API_URL=http://127.0.0.1:8000/v1/chat/completions
VISION_MODEL=baidu/Unlimited-OCR
VISION_API_KEY=
UNLIMITED_OCR_SERVER=vllm
UNLIMITED_OCR_MAX_TOKENS=8192
UNLIMITED_OCR_NGRAM_SIZE=35
UNLIMITED_OCR_WINDOW_SIZE=128
```

如果 Unlimited-OCR 和 `funds-api` 不在同一台机器，把 `VISION_API_URL` 改成内网地址，例如：

```env
VISION_API_URL=http://10.0.0.12:8000/v1/chat/completions
```

## 运行关系

```text
微信小程序 -> https://你的API域名/api/import/alipay-screenshot
              -> funds-api
              -> Unlimited-OCR /v1/chat/completions
              -> funds-api 解析 OCR 文本，匹配基金代码，估算份额
              -> 小程序展示并导入
```

## 注意

- Unlimited-OCR 通常需要 NVIDIA GPU 环境，不建议直接塞进 `funds-api` 这个轻量 Node 容器。
- 小程序端不用改，仍然只配置 `utils/config.js` 的 `API_BASE_URL`。
- Unlimited-OCR 输出的是 OCR 文本，后端会再解析支付宝“名称/金额、日收益、持有收益、累计收益”的持仓表。
- OCR 无法从支付宝总览页看到成本净值；如果截图里只有金额，后端会按最新净值估算份额，导入前请人工确认。