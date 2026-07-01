# 小程序正式上线清单

## 1. 准备域名和备案

- 准备 API 域名，例如 `api.example.com`
- DNS A 记录指向服务器公网 IP
- 如果服务器在中国大陆，完成 ICP 备案
- 准备 HTTPS 证书

## 2. 部署后端代理

推荐 Docker：

```bash
cd server
cp .env.example .env
```

如果要使用支付宝截图识别，编辑 `.env` 并选择一种引擎。

通用视觉模型：

```bash
VISION_PROVIDER=chat-json
VISION_API_URL=https://你的模型服务/v1/chat/completions
VISION_API_KEY=你的密钥
VISION_MODEL=视觉模型名称
MAX_UPLOAD_BYTES=8388608
```

百度 Unlimited-OCR：

```bash
VISION_PROVIDER=unlimited-ocr
VISION_API_URL=http://127.0.0.1:8000/v1/chat/completions
VISION_MODEL=baidu/Unlimited-OCR
VISION_API_KEY=
UNLIMITED_OCR_SERVER=vllm
```

启动服务：

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

然后用 Nginx 反代到 `127.0.0.1:8080`，参考：

`server/deploy/nginx-funds-api.conf`

外网检查：

```bash
curl https://api.example.com/health
```

## 3. 小程序切换接口域名

修改：

`miniprogram/utils/config.js`

```js
const API_BASE_URL = "https://api.example.com";
```

## 4. 微信后台配置合法域名

微信公众平台 -> 开发管理 -> 开发设置 -> 服务器域名：

request 合法域名添加：

- `https://api.example.com`

uploadFile 合法域名添加：

- `https://api.example.com`

使用后端代理后，不需要把东方财富域名加入小程序合法域名。AI/OCR 密钥只放在服务器 `.env`，不要写进小程序代码。

## 5. 上传审核

- 微信开发者工具导入 `miniprogram/` 或仓库根目录
- 检查 AppID
- 真机测试行情、搜索、手动添加、支付宝截图导入
- 上传代码
- 小程序后台提交审核
- 审核通过后发布

## 6. 上线后建议

- 给 `/health` 加监控
- Nginx 日志轮转
- 定期更新 TLS 证书
- 关注视觉/OCR 模型接口调用量和费用
- 如访问量增加，可把后端缓存改成 Redis
- 如需要账号同步，再新增登录和云端用户配置表