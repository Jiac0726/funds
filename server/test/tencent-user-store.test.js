const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TENCENT_COS_SECRET_ID = "test-secret-id";
process.env.TENCENT_COS_SECRET_KEY = "test-secret-key";
process.env.TENCENT_COS_BUCKET = "funds-test-1250000000";
process.env.TENCENT_COS_REGION = "ap-guangzhou";

const { configured, userKey, authorization } = require("../src/tencent-user-store");

test("hashes openid before building the private COS object key", () => {
  const key = userKey("openid-sensitive-value");
  assert.equal(configured(), true);
  assert.match(key, /^funds-mini\/users\/[a-f0-9]{64}\.json$/);
  assert.equal(key.includes("openid-sensitive-value"), false);
});

test("creates a scoped COS authorization header without exposing the secret key", () => {
  const header = authorization("PUT", "/funds-mini/users/test.json", "funds-test-1250000000.cos.ap-guangzhou.myqcloud.com");
  assert.match(header, /q-sign-algorithm=sha1/);
  assert.match(header, /q-ak=test-secret-id/);
  assert.match(header, /q-header-list=host/);
  assert.match(header, /q-signature=[a-f0-9]{40}/);
  assert.equal(header.includes("test-secret-key"), false);
});
