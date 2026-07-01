const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createAuthToken,
  verifyAuthToken,
  publicUser
} = require("../src/server");

const SECRET = "test-secret-0123456789-abcdefghij";

test("creates and verifies a signed WeChat login token", () => {
  const token = createAuthToken("openid-for-test", SECRET, 1000);
  const payload = verifyAuthToken(token, SECRET, 1001);
  assert.equal(payload.oid, "openid-for-test");
  assert.equal(payload.iat, 1000);
  assert.ok(payload.exp > 1001);
});

test("rejects tampered or expired login tokens", () => {
  const token = createAuthToken("openid-for-test", SECRET, 1000);
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.throws(() => verifyAuthToken(tampered, SECRET, 1001), /Invalid login token/);
  assert.throws(() => verifyAuthToken(token, SECRET, Number.MAX_SAFE_INTEGER), /expired/);
});

test("returns a stable public user id without exposing openid", () => {
  const user = publicUser("openid-for-test");
  assert.match(user.id, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(user).includes("openid-for-test"), false);
});