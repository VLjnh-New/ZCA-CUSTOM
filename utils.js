import cryptojs from "crypto-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { imageSize } from "image-size";
import pako from "pako";
import SparkMD5 from "spark-md5";
import fetch from "node-fetch";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { spawn, execSync } from "node:child_process";
import { createRequire as _createRequire } from "node:module";

const _require = _createRequire(import.meta.url);

import { appContext, isContextReady } from "./context.js";
import { ZaloApiError } from "./Errors/ZaloApiError.js";

const _C = {
  r: "\x1b[0m", b: "\x1b[1m",
  white: "\x1b[97m",
  cyan: "\x1b[96m", yellow: "\x1b[93m", red: "\x1b[91m", magenta: "\x1b[95m",
  bgBlack: "\x1b[40m", bgCyan: "\x1b[46m", bgYellow: "\x1b[43m", bgRed: "\x1b[41m", bgMagenta: "\x1b[45m",
};
const _tag = (bg, label) => `${bg}${_C.bgBlack}${_C.b}${_C.white} ${label} ${_C.r}`;
const _STYLES = {
  info:    { tag: _tag(_C.bgCyan,    "◈ INF"),  color: _C.cyan },
  warn:    { tag: _tag(_C.bgYellow,  "⚠ ALT"),  color: _C.yellow },
  error:   { tag: _tag(_C.bgRed,     "✗ CRIT"), color: _C.red },
  verbose: { tag: _tag(_C.bgMagenta, "◈ DBG"),  color: _C.magenta },
};

function _formatArgs(args) {
  return args.map(a => {
    if (a instanceof Error) return a.message || a.toString();
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(" ");
}

export function logger(ctx = appContext) {
  const enabled = ctx?.options?.logging !== false;
  const make = (lvl) => (...a) => {
    if (!enabled && lvl === "verbose") return;
    const s = _STYLES[lvl] || _STYLES.info;
    console.log(`${s.tag} ${s.color}${_C.b}${_formatArgs(a)}${_C.r}`);
  };
  return { info: make("info"), warn: make("warn"), error: make("error"), verbose: make("verbose") };
}

export function makeURL(ctx, base, params = {}, includeVersion = true) {
  const url = new URL(base);
  if (includeVersion && ctx?.API_VERSION) {
    url.searchParams.append("zpw_ver", ctx.API_VERSION);
    url.searchParams.append("zpw_type", ctx.API_TYPE);
  }
  for (const k in params) if (params[k] !== undefined) url.searchParams.append(k, params[k]);
  return url.toString();
}

export function encodeAES(secretKey, data, retry = 0) {
  try {
    const key = cryptojs.enc.Base64.parse(secretKey);
    return cryptojs.AES.encrypt(data, key, {
      iv: cryptojs.enc.Hex.parse("00000000000000000000000000000000"),
      mode: cryptojs.mode.CBC,
      padding: cryptojs.pad.Pkcs7,
    }).ciphertext.toString(cryptojs.enc.Base64);
  } catch {
    return retry < 3 ? encodeAES(secretKey, data, retry + 1) : null;
  }
}

export function decodeAES(secretKey, data, retry = 0) {
  try {
    const key = cryptojs.enc.Base64.parse(secretKey);
    return cryptojs.AES.decrypt(
      { ciphertext: cryptojs.enc.Base64.parse(decodeURIComponent(data)) },
      key,
      {
        iv: cryptojs.enc.Hex.parse("00000000000000000000000000000000"),
        mode: cryptojs.mode.CBC,
        padding: cryptojs.pad.Pkcs7,
      }
    ).toString(cryptojs.enc.Utf8);
  } catch {
    return retry < 3 ? decodeAES(secretKey, data, retry + 1) : null;
  }
}

// cookie có thể tới ở 3 dạng: string, CookieJar hoặc mảng object → tự lo cả 3
function cookieHeaderFor(ctx, url) {
  const c = ctx.cookie;
  if (!c) throw new ZaloApiError("Cookie chưa được nạp");
  if (typeof c === "string") return c;
  if (c instanceof CookieJar) return c.getCookieStringSync(url);
  if (Array.isArray(c)) return c.map((x) => `${x.name || x.key}=${x.value}`).join("; ");
  return "";
}

export function getDefaultHeaders(ctx = appContext, url = "https://chat.zalo.me/") {
  if (!ctx.userAgent) throw new ZaloApiError("userAgent chưa được nạp");
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    "content-type": "application/x-www-form-urlencoded",
    Cookie: cookieHeaderFor(ctx, url),
    Origin: "https://chat.zalo.me",
    Referer: "https://chat.zalo.me/",
    "User-Agent": ctx.userAgent,
  };
}

function applySetCookie(ctx, response, url) {
  const sc = response.headers.raw?.()["set-cookie"] ?? response.headers.get("set-cookie");
  if (!sc) return;
  const arr = Array.isArray(sc) ? sc : [sc];
  if (ctx.cookie instanceof CookieJar) {
    for (const c of arr) ctx.cookie.setCookieSync(c, url, { ignoreError: true });
  } else if (typeof ctx.cookie === "string") {
    const merged = new Map(ctx.cookie.split(";").map((p) => p.trim().split("=")));
    for (const c of arr) {
      const [k, v] = c.split(";")[0].split("=");
      merged.set(k.trim(), (v || "").trim());
    }
    ctx.cookie = [...merged].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export async function request(ctx, url, options = {}, raw = false) {
  if (!ctx.cookie) ctx.cookie = new CookieJar();
  if (!raw) {
    options.headers = { ...getDefaultHeaders(ctx, url), ...(options.headers || {}) };
  }
  options.timeout ??= 8000;
  // tự xử redirect bằng tay – nếu để fetch tự follow là mất Set-Cookie ở chặng giữa
  if (options.redirect === undefined) options.redirect = "manual";

  const res = await fetch(url, options);
  applySetCookie(ctx, res, url);

  const location = res.headers.get("location");
  if (location) {
    const next = { ...options, method: "GET" };
    delete next.body;
    if (!raw) {
      next.headers = { ...(next.headers || {}), Referer: "https://id.zalo.me/" };
    }
    return request(ctx, new URL(location, url).toString(), next, raw);
  }
  return res;
}

// Zalo bọc response 2 lớp: bên ngoài là wrapper, bên trong là AES base64
// → phải check error_code ngoài, decode, rồi check tiếp error_code trong
export async function handleZaloResponse(response, ctx = appContext) {
  if (!response.ok) return { data: null, error: { message: `HTTP ${response.status}` } };
  try {
    const json = await response.json();
    if (json.error_code !== 0) {
      return { data: null, error: { message: json.error_message, code: json.error_code } };
    }
    const decoded = JSON.parse(decodeAES(ctx.secretKey, json.data));
    if (decoded.error_code !== 0) {
      return { data: null, error: { message: decoded.error_message, code: decoded.error_code } };
    }
    return { data: decoded.data, error: null };
  } catch (err) {
    return { data: null, error: { message: "Không parse được dữ liệu phản hồi: " + err.message } };
  }
}

export async function resolveResponse(ctx, response) {
  const r = await handleZaloResponse(response, ctx);
  if (r.error) throw new ZaloApiError(r.error.message, r.error.code);
  return r.data;
}

export function createUtils(ctx) {
  const u = {
    ctx,
    makeURL: (base, p, incVer) => makeURL(ctx, base, p, incVer),
    encodeAES: (data) => encodeAES(ctx.secretKey, data),
    request: (url, opts) => request(ctx, url, opts),
    resolve: (res) => resolveResponse(ctx, res),
    logger: logger(ctx),
    requireSession() {
      if (!isContextReady(ctx)) throw new ZaloApiError("Phiên đăng nhập chưa sẵn sàng");
    },
    async postEncrypted(url, params, { extraQuery, mapResult } = {}) {
      u.requireSession();
      const enc = encodeAES(ctx.secretKey, JSON.stringify(params));
      if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");
      // luôn nhét zpw_ver/zpw_type qua makeURL — nhiều endpoint info bắt buộc
      const finalUrl = makeURL(ctx, url, extraQuery || {});
      const res = await request(ctx, finalUrl, {
        method: "POST",
        body: new URLSearchParams({ params: enc }),
      });
      const data = await resolveResponse(ctx, res);
      return mapResult ? mapResult(data) : data;
    },
    async getEncrypted(url, params, { extraQuery, mapResult } = {}) {
      u.requireSession();
      const enc = encodeAES(ctx.secretKey, JSON.stringify(params));
      if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");
      const finalUrl = makeURL(ctx, url, { params: enc, ...(extraQuery || {}) });
      const res = await request(ctx, finalUrl);
      const data = await resolveResponse(ctx, res);
      return mapResult ? mapResult(data) : data;
    },
  };
  return u;
}

export function apiFactory() {
  return (cb) => (ctx, api) => {
    if (!ctx) throw new ZaloApiError("apiFactory: thiếu context");
    return cb(api, ctx, createUtils(ctx));
  };
}

export async function getImageMetaData(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const fileName = path.basename(filePath);
  try {
    const m = imageSize(buf);
    return { fileName, totalSize: buf.length, width: m.width, height: m.height };
  } catch {
    return { fileName, totalSize: buf.length, width: 0, height: 0 };
  }
}
export const getGifMetaData = getImageMetaData;

export async function getFileSize(filePath) {
  return (await fs.promises.stat(filePath)).size;
}

export async function getFileInfoFromUrl(url) {
  try {
    const res = await axios.head(url);
    let fileName = "";
    const cd = res.headers["content-disposition"];
    if (cd) {
      const m = cd.match(/filename=["']?([^"']+)["']?/);
      if (m) fileName = m[1];
    }
    if (!fileName) fileName = url.split("/").pop().split("?")[0] || "unknownFile";
    return { fileName, fileSize: parseInt(res.headers["content-length"]) || 0 };
  } catch {
    return { fileName: "unknownFile", fileSize: 0 };
  }
}

// Tải ảnh về buffer rồi probe width/height/totalSize. Dùng cho sendImage URL path
// để gửi qua endpoint photo_original/send (chuẩn Zalo) thay vì photo_url thô.
export async function getImageInfoFromUrl(url) {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buf = Buffer.from(res.data);
    let width = 500, height = 500;
    try {
      const m = imageSize(buf);
      if (m?.width)  width  = m.width;
      if (m?.height) height = m.height;
    } catch {}
    return { width, height, totalSize: buf.length };
  } catch {
    return { width: 500, height: 500, totalSize: 0 };
  }
}

// Lấy phần đuôi từ URL — ưu tiên path, fallback content-type
export async function checkExtFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.split("/").pop() || "";
    const ext = path.extname(p).slice(1).toLowerCase();
    if (ext) return ext;
  } catch {}
  try {
    const res = await axios.head(url);
    const ct = (res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const map = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
      "video/mp4": "mp4", "video/webm": "webm", "video/x-matroska": "mkv",
      "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg",
      "application/pdf": "pdf", "application/zip": "zip",
    };
    return map[ct] || "bin";
  } catch { return "bin"; }
}

export function getFileExtension(p) { return path.extname(p).slice(1); }

// ──────────────────────────────────────────────────────────────────────────
// Helpers vặt được dùng nhiều nơi — gom vào api-custom để các module khác
// có thể import từ một chỗ duy nhất.
// ──────────────────────────────────────────────────────────────────────────
export function decodeBase64ToBuffer(data) {
  return Buffer.from(data, "base64");
}

export function decodeUnit8Array(data) {
  try { return new TextDecoder().decode(data); }
  catch { return null; }
}

export function strPadLeft(e, t, n) {
  const s = String(e);
  const a = s.length;
  return a === n ? s : a > n ? s.slice(-n) : t.repeat(n - a) + s;
}

// ─── ffprobe wrapper (self-contained, không import src/) ─────────────────
function _resolveSystemBin(name) {
  try {
    const which = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const out = execSync(which, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim().split(/\r?\n/)[0].trim();
    if (out) return out;
  } catch {}
  return null;
}

function _resolveFFprobeBin() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const sys = _resolveSystemBin("ffprobe");
  if (sys) return sys;
  try {
    const m = _require("@ffprobe-installer/ffprobe");
    if (m?.path) return m.path;
  } catch {}
  return "ffprobe";
}

export const FFPROBE_BIN = _resolveFFprobeBin();

// Trả về metadata JSON đầy đủ của video (streams + format) — dùng cho mọi
// trường hợp cần thông tin chi tiết.
export function ffprobeAsync(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof filePath !== "string") {
      return reject(new Error(`filePath must be a string, received ${typeof filePath}`));
    }
    const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];
    const proc = spawn(FFPROBE_BIN, args);
    let out = "", err = "";
    proc.stdout.on("data", d => (out += d));
    proc.stderr.on("data", d => (err += d));
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${(err || "").slice(-200)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("ffprobe JSON parse error")); }
    });
    proc.on("error", reject);
  });
}

// Wrapper rút gọn cho sendVideo — chỉ trả các trường Zalo cần
export async function getVideoMetadata(filePath) {
  if (typeof filePath !== "string") {
    throw new Error(`filePath must be a string, received ${typeof filePath}`);
  }
  const meta = await ffprobeAsync(filePath);
  const videoStream = (meta.streams || []).find(s => s.codec_type === "video");
  if (!videoStream) throw new Error("No video stream found");
  return {
    fileName: path.basename(filePath),
    totalSize: Number(meta.format?.size || 0),
    width: videoStream.width,
    height: videoStream.height,
    duration: Number(videoStream.duration || meta.format?.duration || 0) * 1000,
  };
}

const _pad2 = (n) => String(n).padStart(2, "0");
export function getFullTimeFromMilisecond(ms) {
  const t = new Date(ms);
  return `${_pad2(t.getHours())}:${_pad2(t.getMinutes())} ${_pad2(t.getDate())}/${_pad2(t.getMonth() + 1)}/${t.getFullYear()}`;
}

export async function getMd5LargeFileObject(filePath, fileSize) {
  const chunkSize = 2 * 1024 * 1024;
  const chunks = Math.ceil(fileSize / chunkSize);
  const buf = await fs.promises.readFile(filePath);
  const spark = new SparkMD5.ArrayBuffer();
  for (let i = 0; i < chunks; i++) {
    spark.append(buf.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, fileSize)));
  }
  return { currentChunk: chunks, data: spark.end() };
}

export async function decodeEventData(parsed, cipherKey) {
  if (!cipherKey) return;
  const buf = Buffer.from(decodeURIComponent(parsed.data), "base64");
  if (buf.length < 48) return;
  const algo = {
    name: "AES-GCM",
    iv: buf.subarray(0, 16),
    tagLength: 128,
    additionalData: buf.subarray(16, 32),
  };
  const key = await crypto.subtle.importKey("raw", Buffer.from(cipherKey, "base64"), algo, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(algo, key, buf.subarray(32));
  const text = new TextDecoder().decode(pako.inflate(decrypted));
  return text ? JSON.parse(text) : null;
}

export function getSignKey(type, params) {
  let s = "zsecure" + type;
  for (const k of Object.keys(params).sort()) s += params[k];
  return cryptojs.MD5(s);
}

// reverse từ web Zalo – cứ giữ nguyên thuật toán, đừng đụng vào tham số magic
export class ParamsEncryptor {
  constructor({ type, imei, firstLaunchTime }) {
    this.enc_ver = "v2";
    this.zcid = null;
    this.encryptKey = null;
    this.zcid_ext = ParamsEncryptor.randomString();
    if (!type || !imei || !firstLaunchTime) throw new Error("ParamsEncryptor: thiếu tham số");
    this.zcid = ParamsEncryptor.encodeAES(
      "3FC4F0D2AB50057BCE0D90D9187A22B1",
      `${type},${imei},${firstLaunchTime}`,
      "hex", true
    );
    this.#createEncryptKey();
  }
  #createEncryptKey(retry = 0) {
    try {
      const md5 = cryptojs.MD5(this.zcid_ext).toString().toUpperCase();
      const { even: e1 } = ParamsEncryptor.processStr(md5);
      const { even: e2, odd: o2 } = ParamsEncryptor.processStr(this.zcid);
      if (!e1 || !e2 || !o2) {
        if (retry < 3) this.#createEncryptKey(retry + 1);
        return;
      }
      this.encryptKey = e1.slice(0, 8).join("") + e2.slice(0, 12).join("") + o2.reverse().slice(0, 12).join("");
    } catch {
      if (retry < 3) this.#createEncryptKey(retry + 1);
    }
  }
  getEncryptKey() {
    if (!this.encryptKey) throw new Error("Chưa khởi tạo encryptKey");
    return this.encryptKey;
  }
  getParams() {
    return this.zcid ? { zcid: this.zcid, zcid_ext: this.zcid_ext, enc_ver: this.enc_ver } : null;
  }
  static processStr(s) {
    if (!s || typeof s !== "string") return { even: null, odd: null };
    const [even, odd] = [...s].reduce((acc, ch, i) => (acc[i % 2].push(ch), acc), [[], []]);
    return { even, odd };
  }
  static randomString(min = 6, max = 12) {
    const lo = min, hi = max > min ? max : 12;
    let len = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    if (len <= 12) return Math.random().toString(16).slice(2, 2 + len);
    let out = "";
    while (len > 0) {
      out += Math.random().toString(16).slice(2, 2 + Math.min(len, 12));
      len -= 12;
    }
    return out;
  }
  static encodeAES(key, msg, encoding, uppercase, retry = 0) {
    if (!msg) return null;
    try {
      const enc = encoding === "hex" ? cryptojs.enc.Hex : cryptojs.enc.Base64;
      const out = cryptojs.AES.encrypt(msg, cryptojs.enc.Utf8.parse(key), {
        iv: { words: [0, 0, 0, 0], sigBytes: 16 },
        mode: cryptojs.mode.CBC,
        padding: cryptojs.pad.Pkcs7,
      }).ciphertext.toString(enc);
      return uppercase ? out.toUpperCase() : out;
    } catch {
      return retry < 3 ? ParamsEncryptor.encodeAES(key, msg, encoding, uppercase, retry + 1) : null;
    }
  }
}

export function generateZaloUUID(userAgent) {
  return crypto.randomUUID() + "-" + cryptojs.MD5(userAgent).toString();
}

export function removeUndefinedKeys(obj) {
  for (const k in obj) if (obj[k] === undefined) delete obj[k];
  return obj;
}

export function getFileName(p) { return path.basename(p); }

export async function getGifDimensions(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const m = imageSize(buf);
  return { fileName: path.basename(filePath), totalSize: buf.length, width: m.width, height: m.height };
}

export async function getMd5LargeFileFromUrl(url, fileSize) {
  const res = await axios({ url, method: "GET", responseType: "arraybuffer" });
  const buf = Buffer.from(res.data);
  const chunkSize = 2 * 1024 * 1024;
  const chunks = Math.ceil(fileSize / chunkSize);
  const spark = new SparkMD5.ArrayBuffer();
  for (let i = 0; i < chunks; i++) {
    spark.append(buf.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, fileSize)));
  }
  return { currentChunk: chunks, data: spark.end() };
}

const CLIENT_MSG_TYPE = {
  webchat: 1, "chat.voice": 31, "chat.photo": 32, "chat.sticker": 36,
  "chat.doodle": 37, "chat.recommended": 38, "chat.link": 1,
  "chat.video.msg": 44, "share.file": 46, "chat.gif": 49, "chat.location.new": 43,
};
export function getClientMessageType(msgType) {
  return CLIENT_MSG_TYPE[msgType] ?? 1;
}

// regex bắt cả link thiếu http:// kiểu user gõ "abc.com/xyz"
export function analyzeLinks(content) {
  const re = /(?:@)?(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s\n]*)?/gi;
  const links = (content.match(re) || [])
    .map((l) => {
      let n = l.replace(/^@/, "").replace(/\/+$/, "");
      return /^https?:\/\//i.test(n) ? n : "https://" + n;
    })
    .filter((l) => { try { new URL(l); return true; } catch { return false; } });
  return { count: links.length, links };
}

export function decryptResp(key, data) {
  try {
    const decoded = cryptojs.AES.decrypt(
      { ciphertext: cryptojs.enc.Base64.parse(decodeURIComponent(data)) },
      cryptojs.enc.Utf8.parse(key),
      {
        iv: { words: [0, 0, 0, 0], sigBytes: 16 },
        mode: cryptojs.mode.CBC,
        padding: cryptojs.pad.Pkcs7,
      }
    ).toString(cryptojs.enc.Utf8);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
