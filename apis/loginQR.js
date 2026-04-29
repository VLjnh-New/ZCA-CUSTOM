import { CookieJar } from "tough-cookie";
import { writeFile } from "node:fs/promises";

import { appContext } from "../context.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ZaloApiLoginQRAborted } from "../Errors/ZaloApiLoginQRAborted.js";
import { ZaloApiLoginQRDeclined } from "../Errors/ZaloApiLoginQRDeclined.js";
import { logger, request } from "../utils.js";

export const LoginQRCallbackEventType = {
  QRCodeGenerated: 0,
  QRCodeExpired: 1,
  QRCodeScanned: 2,
  QRCodeDeclined: 3,
  GotLoginInfo: 4,
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

const BROWSER_HEADERS = {
  "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const REF_PC = "https://id.zalo.me/account?continue=https%3A%2F%2Fzalo.me%2Fpc";
const REF_CHAT = "https://id.zalo.me/account?continue=https%3A%2F%2Fchat.zalo.me%2F";

async function postForm(ctx, url, fields, signal, referer) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return request(ctx, url, {
    method: "POST",
    body: form,
    signal,
    headers: {
      ...BROWSER_HEADERS,
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      Referer: referer,
    },
  });
}

async function loadLoginPage(ctx) {
  const res = await request(ctx, "https://id.zalo.me/account?continue=https%3A%2F%2Fchat.zalo.me%2F", {
    method: "GET",
    headers: {
      ...BROWSER_HEADERS,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "cache-control": "max-age=0",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-site",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      Referer: "https://chat.zalo.me/",
    },
  });
  const html = await res.text();
  return html.match(/https:\/\/stc-zlogin\.zdn\.vn\/main-([\d.]+)\.js/)?.[1];
}

const getLoginInfo = (ctx, v) =>
  postForm(ctx, "https://id.zalo.me/account/logininfo", { continue: "https://zalo.me/pc", v }, undefined, REF_PC)
    .then((r) => r.json()).catch(logger(ctx).error);

const verifyClient = (ctx, v) =>
  postForm(ctx, "https://id.zalo.me/account/verify-client", { type: "device", continue: "https://zalo.me/pc", v }, undefined, REF_PC)
    .then((r) => r.json()).catch(logger(ctx).error);

const generate = (ctx, v) =>
  postForm(ctx, "https://id.zalo.me/account/authen/qr/generate", { continue: "https://zalo.me/pc", v }, undefined, REF_PC)
    .then((r) => r.json()).catch(logger(ctx).error);

async function waitingScan(ctx, v, code, signal) {
  try {
    const data = await postForm(
      ctx,
      "https://id.zalo.me/account/authen/qr/waiting-scan",
      { code, continue: "https://chat.zalo.me/", v },
      signal,
      REF_CHAT
    ).then((r) => r.json());
    if (data?.error_code === 8) return waitingScan(ctx, v, code, signal);
    return data;
  } catch (e) {
    if (!signal.aborted) logger(ctx).error(e);
  }
}

async function waitingConfirm(ctx, v, code, signal) {
  logger(ctx).info("Vui lòng xác nhận đăng nhập trên điện thoại của bạn");
  try {
    const data = await postForm(
      ctx,
      "https://id.zalo.me/account/authen/qr/waiting-confirm",
      { code, gToken: "", gAction: "CONFIRM_QR", continue: "https://chat.zalo.me/", v },
      signal,
      REF_CHAT
    ).then((r) => r.json());
    if (data?.error_code === 8) return waitingConfirm(ctx, v, code, signal);
    return data;
  } catch (e) {
    if (!signal.aborted) logger(ctx).error(e);
  }
}

const checkSession = (ctx) =>
  request(ctx, "https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html", {
    method: "GET",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
      Referer: REF_CHAT,
    },
  }).catch(logger(ctx).error);

const getUserInfo = (ctx) =>
  request(ctx, "https://jr.chat.zalo.me/jr/userinfo", {
    method: "GET",
    headers: {
      ...BROWSER_HEADERS,
      accept: "*/*",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      Referer: "https://chat.zalo.me/",
    },
  }).then((r) => r.json()).catch(logger(ctx).error);

const saveQRToFile = (filepath, base64) => writeFile(filepath, base64, "base64");

export async function loginQR(arg1, arg2, arg3) {
  let ctx, options, callback;
  if (arg1 && (arg1.API_TYPE !== undefined || arg1.secretKey !== undefined)) {
    ctx = arg1;
    options = arg2 || {};
    callback = arg3;
  } else {
    ctx = appContext;
    options = arg1 || {};
    callback = arg2;
  }

  ctx.cookie = new CookieJar();
  ctx.userAgent = options.userAgent || DEFAULT_USER_AGENT;

  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    let qrTimeout = null;

    const cleanUp = () => {
      controller.abort();
      if (qrTimeout) {
        clearTimeout(qrTimeout);
        qrTimeout = null;
      }
    };
    const retry = () => {
      cleanUp();
      resolve(loginQR(ctx, options, callback));
    };
    const abort = () => {
      cleanUp();
      reject(new ZaloApiLoginQRAborted());
    };

    try {
      const version = await loadLoginPage(ctx);
      if (!version) throw new ZaloApiError("Không lấy được phiên bản trang login");
      logger(ctx).info("Phiên bản login:", version);

      await getLoginInfo(ctx, version);
      await verifyClient(ctx, version);

      const qrGen = await generate(ctx, version);
      if (!qrGen?.data) {
        throw new ZaloApiError(`Không tạo được QRCode\nResponse: ${JSON.stringify(qrGen, null, 2)}`);
      }

      const qrData = qrGen.data;
      const cleanImage = qrData.image.replace(/^data:image\/png;base64,/, "");

      if (callback) {
        callback({
          type: LoginQRCallbackEventType.QRCodeGenerated,
          data: { ...qrData, image: cleanImage },
          actions: {
            saveToFile: (p = options.qrPath ?? "qr.png") => saveQRToFile(p, cleanImage),
            retry,
            abort,
          },
        });
      } else if (options.qrPath) {
        await saveQRToFile(options.qrPath, cleanImage);
      }

      qrTimeout = setTimeout(() => {
        cleanUp();
        logger(ctx).info("QR đã hết hạn!");
        callback
          ? callback({ type: LoginQRCallbackEventType.QRCodeExpired, data: null, actions: { retry, abort } })
          : retry();
      }, 100000);

      const scanResult = await waitingScan(ctx, version, qrData.code, controller.signal);
      if (!scanResult?.data) throw new ZaloApiError("Không lấy được kết quả quét QR");
      callback?.({ type: LoginQRCallbackEventType.QRCodeScanned, data: scanResult.data, actions: { retry, abort } });

      const confirmResult = await waitingConfirm(ctx, version, qrData.code, controller.signal);
      if (!confirmResult) throw new ZaloApiError("Không nhận được kết quả xác nhận QR");

      clearTimeout(qrTimeout);
      qrTimeout = null;

      if (confirmResult.error_code === -13) {
        if (callback) {
          callback({
            type: LoginQRCallbackEventType.QRCodeDeclined,
            data: { code: qrData.code },
            actions: { retry, abort },
          });
          return;
        }
        throw new ZaloApiLoginQRDeclined();
      }
      if (confirmResult.error_code !== 0) {
        throw new ZaloApiError(`Đăng nhập QR thất bại\nResponse: ${JSON.stringify(confirmResult, null, 2)}`);
      }

      if (!(await checkSession(ctx))) throw new ZaloApiError("Không lấy được session sau khi xác nhận");

      const userInfo = await getUserInfo(ctx).catch(() => null);
      logger(ctx).info(
        "Đăng nhập thành công với tài khoản",
        scanResult.data.display_name || userInfo?.data?.info?.display_name || ""
      );

      resolve({
        jar: ctx.cookie,
        cookies: ctx.cookie.toJSON().cookies,
        userInfo: userInfo?.data?.info ?? null,
      });
    } catch (err) {
      cleanUp();
      reject(err);
    }
  });
}
