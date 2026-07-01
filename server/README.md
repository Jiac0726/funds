# funds-api-proxy

小程序正式上线用的后端代理服务。小程序请求你自己的域名，后端再请求东方财富公开接口；支付宝截图识别也通过这个后端调用视觉/OCR 服务，密钥不下发到小程序端。

## 接口

- GET /health
- GET /api/auth/status
- POST /api/auth/wechat：JSON 中传入 wx.login 返回的临时 code
- GET /api/auth/me：请求头 Authorization: Bearer token
- POST /api/auth/logout
- `GET /api/funds/search?key=新能源`
- `GET /api/funds/quotes?codes=001618,000001`
- `GET /api/index/quotes?secids=1.000001,0.399001`
- `GET /api/funds/001618/net-history?range=y`
- `GET /api/funds/001618/base-info`
- `POST /api/import/alipay-text`：JSON `{ "text": "支付宝持仓 OCR 文本" }`
- `POST /api/import/alipay-screenshot`：multipart，图片字段名 `image`，可选文本字段 `text`

行情接口返回结构保持东方财富原始响应，方便小程序复用现有解析逻辑；净值历史接口不使用服务端缓存，供小程序按最新真实序列回算近三个月持仓。导入接口返回 `{ ok, items, warnings }`，小程序会把识别结果合并到本地自选。

## 本地运行

需要 Node.js 18+。

```bash
cd server
cp .env.example .env
node src/server.js
```

测试：

```bash
curl http://127.0.0.1:8080/health
curl "http://127.0.0.1:8080/api/funds/quotes?codes=001618"
curl -X POST http://127.0.0.1:8080/api/import/alipay-text \
  -H "content-type: application/json" \
  -d '{"text":"汇添富新能源 001618\n持有份额 100.5\n持仓成本 1.234"}'
```

## 微信登录

小程序在“我的”页由用户主动点击微信登录，前端调用 wx.login，后端调用微信 code2Session。微信返回的 session_key 不会返回小程序，也不会落盘。

服务器 .env 需要配置 WX_APPID、WX_APP_SECRET、AUTH_TOKEN_SECRET 和 AUTH_TOKEN_TTL_SECONDS。AUTH_TOKEN_SECRET 至少 32 字符，可使用 openssl rand -hex 32 生成。AppSecret 和令牌密钥不得写入小程序代码或提交到 Git。配置后访问 /api/auth/status 应返回 available: true。

## 基金数据源

小程序可在“我的 -> 基金数据源”切换：

- eastmoney：东方财富综合行情，支持单位净值和盘中估值。
- fundgz：天天基金估值备用端点，支持盘中估值；历史净值仍使用东方财富净值序列。
- tushare：独立日净值源，不提供盘中估值；需要在服务器配置 TUSHARE_TOKEN，历史收益会按正式净值回算。

后端通过 GET /api/data-sources 返回各来源是否可用。基金行情和历史接口接受 source=eastmoney|fundgz|tushare。Tushare Token 只保存在服务器环境变量中。

## 支付宝截图识别

后端支持支付宝“全部持有”和“资产详情”两类截图，可识别基金名称、代码、持有金额、持有份额和持仓成本价。资产详情中的基金净值不会作为成本价导入。后端提供两种截图识别引擎。

### 方式一：通用视觉模型返回 JSON

适合 OpenAI-compatible 的多模态模型服务。

```bash
VISION_PROVIDER=chat-json
VISION_API_URL=https://你的模型服务/v1/chat/completions
VISION_API_KEY=你的密钥
VISION_MODEL=视觉模型名称
MAX_UPLOAD_BYTES=8388608
```

后端会把图片转成 data URL 发送给视觉模型，并要求模型只返回 JSON。

### 方式二：百度 Unlimited-OCR

适合你给的 `baidu/Unlimited-OCR`。建议把 Unlimited-OCR 作为单独的 GPU 服务启动，暴露 OpenAI-compatible `/v1/chat/completions`，本后端只负责调用它并解析 OCR 文本。

```bash
VISION_PROVIDER=unlimited-ocr
VISION_API_URL=http://127.0.0.1:8000/v1/chat/completions
VISION_MODEL=baidu/Unlimited-OCR
VISION_API_KEY=
UNLIMITED_OCR_SERVER=vllm
UNLIMITED_OCR_MAX_TOKENS=8192
UNLIMITED_OCR_NGRAM_SIZE=35
UNLIMITED_OCR_WINDOW_SIZE=128
```

如果用 SGLang 服务，把 `UNLIMITED_OCR_SERVER=sglang`；如服务端要求自定义 logit processor，可把完整配置放到 `UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR`。

没有配置截图识别引擎时，截图接口会返回 501；文本接口仍会使用基础规则解析 6 位基金代码、基金名称、持有金额、持有份额和成本净值。

## Docker 部署

```bash
cd server
cp .env.example .env
# 编辑 .env，填入 VISION_PROVIDER / VISION_API_URL / VISION_MODEL 等配置
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

`docker-compose.yml` 默认只监听 `127.0.0.1:8080`，建议通过 Nginx 暴露 HTTPS。Unlimited-OCR 服务建议单独部署在 GPU 机器或同机另一个容器中，`funds-api` 通过内网地址访问它。

## Nginx HTTPS

1. 准备域名，例如 `api.example.com`。
2. DNS 添加 A 记录到服务器公网 IP。
3. 完成域名备案（中国大陆服务器和微信小程序正式域名一般都需要）。
4. 申请 HTTPS 证书，可以使用云厂商证书、certbot 或 acme.sh。
5. 参考 `deploy/nginx-funds-api.conf` 配置 Nginx。
6. 检查：`https://api.example.com/health` 返回 `ok: true`。

## 小程序切换到正式域名

修改：

`miniprogram/utils/config.js`

```js
const API_BASE_URL = "https://api.example.com";
```

然后在微信公众平台后台配置 request / uploadFile 合法域名：

- `https://api.example.com`

配置后上传小程序代码并提交审核。

## 环境变量

- `PORT`：服务端口，默认 `8080`
- `REQUEST_TIMEOUT_MS`：上游请求和 AI/OCR 请求超时基准，默认 `10000`
- `ALLOW_ORIGIN`：CORS 来源，默认 `*`
- `CACHE_DISABLED`：设为 `1` 可禁用内存缓存
- `MAX_UPLOAD_BYTES`：截图上传大小限制，默认 `8388608`
- `VISION_PROVIDER`：`chat-json` 或 `unlimited-ocr`
- `VISION_API_URL`：视觉/OCR 服务 chat completions 接口地址
- `VISION_API_KEY`：视觉/OCR 服务接口密钥；本地 Unlimited-OCR 可留空
- `VISION_MODEL`：模型名称
- `UNLIMITED_OCR_SERVER`：`vllm` 或 `sglang`
- `UNLIMITED_OCR_MAX_TOKENS`：OCR 最大输出 token
- `UNLIMITED_OCR_NGRAM_SIZE`：Unlimited-OCR 解码参数
- `UNLIMITED_OCR_WINDOW_SIZE`：Unlimited-OCR 解码参数
- `UNLIMITED_OCR_IMAGE_MODE`：SGLang 图片模式，默认 `gundam`
- `UNLIMITED_OCR_CUSTOM_LOGIT_PROCESSOR`：SGLang 自定义 logit processor，可选

## 说明

这个代理服务不存储用户自选基金数据，只做行情接口转发、短缓存和截图解析。自选基金、份额、成本仍保存在小程序本地缓存中。

## 腾讯云用户数据存储

登录后可在“我的”页将持仓备份到腾讯云 COS，或从云端恢复。创建私有 COS Bucket，并在服务器 `.env` 配置 `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_BUCKET`、`TENCENT_COS_REGION`，`TENCENT_COS_PREFIX` 可选。建议给专用 CAM 子账号只授予该 Bucket 指定前缀的 GetObject/PutObject 权限。密钥只保存在服务器，用户对象名由 openid 哈希生成。
