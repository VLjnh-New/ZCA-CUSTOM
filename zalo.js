import { CookieJar, Cookie } from "tough-cookie";

import { appContext } from "./context.js";
import { checkUpdate } from "./update.js";
import { logger, makeURL, createUtils, generateZaloUUID } from "./utils.js";
import { ZaloApiError } from "./Errors/ZaloApiError.js";

import { Listener } from "./apis/listen.js";
import { login as fetchLoginInfo, getServerInfo } from "./apis/login.js";
import { customFactory } from "./apis/custom.js";
import { loginQR as runLoginQR, LoginQRCallbackEventType } from "./apis/loginQR.js";

import { setupUser } from "./apis/user.js";
import { setupFriend } from "./apis/friend.js";
import { setupGroup } from "./apis/group.js";
import { setupMessage } from "./apis/message.js";
import { setupMedia } from "./apis/media.js";
import { setupReaction } from "./apis/reaction.js";
import { setupProfile } from "./apis/profile.js";
import { setupSticker } from "./apis/sticker.js";
import { setupConversation } from "./apis/conversation.js";
import { setupPoll } from "./apis/poll.js";
import { setupBoard } from "./apis/board.js";
import { setupCatalog } from "./apis/catalog.js";
import { setupAutoReply } from "./apis/auto_reply.js";
import { setupQuickMessage } from "./apis/quick_message.js";
import { setupLabel } from "./apis/label.js";
import { setupEvent } from "./apis/event.js";
import { setupVoiceCall } from "./apis/voice_call.js";

// gom hết module API vào 1 mảng cho tiện đăng ký 1 lượt
const SETUPS = [
  setupUser, setupFriend, setupGroup, setupMessage, setupMedia,
  setupReaction, setupProfile, setupSticker, setupConversation,
  setupPoll, setupBoard, setupCatalog, setupAutoReply,
  setupQuickMessage, setupLabel, setupEvent, setupVoiceCall,
];

class Zalo {
  constructor(options = {}) {
    Object.assign(appContext.options, options);
    this.options = options;
    this.enableEncryptParam = true;
  }

  async login(creds) {
    if (!creds?.imei || !creds?.cookie || !creds?.userAgent) {
      throw new ZaloApiError("Thiếu tham số bắt buộc: imei / cookie / userAgent");
    }

    Object.assign(appContext, {
      imei: creds.imei,
      userAgent: creds.userAgent,
      language: creds.language || "vi",
      timeMessage: creds.timeMessage || 0,
      cookie: parseCookies(creds.cookie, appContext),
      secretKey: null,
    });

    await checkUpdate(appContext);

    // bắn 2 request cùng lúc cho nhanh – chúng độc lập với nhau
    const [loginData, serverInfo] = await Promise.all([
      fetchLoginInfo(appContext, this.enableEncryptParam),
      getServerInfo(appContext, this.enableEncryptParam),
    ]);
    const loginInfo = loginData?.data;
    if (!loginInfo || !serverInfo) {
      throw new ZaloApiError("Đăng nhập thất bại — phiên cookie có thể đã hết hạn");
    }

    Object.assign(appContext, {
      secretKey: loginInfo.zpw_enk,
      uid: loginInfo.uid,
      uin: loginInfo.zpw_uin || loginInfo.uin || null,
      send2meId: loginInfo.send2me_id,
      settings: serverInfo.setttings || serverInfo.settings,
      extraVer: serverInfo.extra_ver,
      loginInfo,
    });
    if (!appContext.secretKey) {
      throw new ZaloApiError("Đăng nhập thất bại — không nhận được zpw_enk");
    }

    logger(appContext).info(`Đăng nhập thành công · UID=${appContext.uid}`);

    const serviceMap = {};
    for (const [k, v] of Object.entries(loginInfo.zpw_service_map_v3 || {})) {
      serviceMap[k] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [v];
    }
    const wsUrls = (loginInfo.zpw_ws || []).map((u) =>
      makeURL(appContext, u, { t: Date.now() })
    );

    return new API(appContext, serviceMap, wsUrls);
  }

  async loginQR(options = {}, callback) {
    const result = await runLoginQR(appContext, options, callback);
    const userAgent = options.userAgent || appContext.userAgent;
    const imei = generateZaloUUID(userAgent);

    if (callback) {
      callback({
        type: LoginQRCallbackEventType.GotLoginInfo,
        data: { cookie: result.cookies, imei, userAgent },
        actions: null,
      });
    }

    return this.login({
      cookie: result.jar,
      imei,
      userAgent,
      language: options.language,
    });
  }
}

Zalo.API_TYPE = appContext.API_TYPE;
Zalo.API_VERSION = appContext.API_VERSION;

// tough-cookie kén format, phải normalize domain (bỏ chấm đầu) + map name<->key
function parseCookies(input, ctx) {
  if (typeof input === "string" || input instanceof CookieJar) return input;

  const list = (Array.isArray(input) ? input : input?.cookies || []).map((c) => ({
    ...c,
    domain: typeof c.domain === "string" && c.domain.startsWith(".") ? c.domain.slice(1) : c.domain,
    key: c.key || c.name,
  }));

  const jar = new CookieJar();
  for (const item of list) {
    try {
      const cookie = Cookie.fromJSON(item);
      if (!cookie) continue;
      const domain = cookie.domain || "chat.zalo.me";
      jar.setCookieSync(cookie, `https://${domain}`);
    } catch (err) {
      logger(ctx).warn("Bỏ qua cookie lỗi:", err?.message || err);
    }
  }
  return jar;
}

class API {
  constructor(ctx, zpwServiceMap, wsUrls) {
    this.ctx = ctx;
    this.zpwServiceMap = zpwServiceMap;
    this.listener = new Listener(ctx, wsUrls);
    const utils = createUtils(ctx);
    for (const setup of SETUPS) setup(this, ctx, utils);
    this.custom = customFactory(ctx, this);
  }
  getContext() {
    return this.ctx;
  }
}

export { Zalo, API, LoginQRCallbackEventType };
