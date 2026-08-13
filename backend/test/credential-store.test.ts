import assert from "node:assert/strict";
import test from "node:test";
import { CredentialStore } from "../src/secrets/credential-store.js";

test("credential endpoint accepts HTTPS and loopback HTTP but rejects unsafe schemes and embedded credentials", () => {
  const store = new CredentialStore();
  store.set("valid-key-value", "https://api.deepseek.com/");
  assert.equal(store.require().baseUrl, "https://api.deepseek.com");
  store.set("valid-key-value", "http://127.0.0.1:9000/v1");
  assert.equal(store.require().baseUrl, "http://127.0.0.1:9000/v1");
  assert.throws(() => store.set("valid-key-value", "http://example.com/v1"), /必须使用 HTTPS/);
  assert.throws(() => store.set("valid-key-value", "file:///tmp/model"), /必须使用 HTTPS/);
  assert.throws(() => store.set("valid-key-value", "https://user:pass@example.com/v1"), /必须使用 HTTPS/);
});
