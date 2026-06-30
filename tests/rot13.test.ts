import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "../src/client/rot13.js";

describe("ROT13 encrypt/decrypt round-trip", () => {
  it("encrypt then decrypt returns original JSON", () => {
    const original = '{"name":"test","path":"/api"}';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("encrypt handles Chinese characters", () => {
    const original = '{"name":"测试接口","path":"/user/list"}';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });
});

describe("ROT13 interop with Java ROT13Utils", () => {
  it("encrypt produces known value", () => {
    // encrypt("hello") = ROT13(Base64("hello")) = ROT13("aGVsbG8=") = "nTIfoT8="
    expect(encrypt("hello")).toBe("nTIfoT8=");
  });

  it("decrypt matches Java decrypt behavior", () => {
    const encrypted = encrypt("test");
    expect(decrypt(encrypted)).toBe("test");
  });
});
