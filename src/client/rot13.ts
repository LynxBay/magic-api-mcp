/**
 * ROT13 替换（与 Java ROT13Utils.rot13 一致）：
 * 仅替换字母（a-z A-Z），非字母字符原样保留。
 */
function rot13(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x61 && c <= 0x7a) {
      // a-z
      result += String.fromCharCode(((c - 0x61 + 13) % 26) + 0x61);
    } else if (c >= 0x41 && c <= 0x5a) {
      // A-Z
      result += String.fromCharCode(((c - 0x41 + 13) % 26) + 0x41);
    } else {
      result += str[i];
    }
  }
  return result;
}

/**
 * 加密：输入 → Base64 → ROT13
 * 对应 Java ROT13Utils.encrypt
 */
export function encrypt(plain: string): string {
  return rot13(Buffer.from(plain, "utf-8").toString("base64"));
}

/**
 * 解密：ROT13 → Base64 → 原文
 * 对应 Java ROT13Utils.decrypt（含首尾引号处理）
 */
export function decrypt(cipher: string): string {
  let s = cipher;
  if (s.startsWith('"')) s = s.slice(1);
  if (s.endsWith('"')) s = s.slice(0, -1);
  return Buffer.from(rot13(s), "base64").toString("utf-8");
}
