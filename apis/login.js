import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { appContext } from "../context.js";
import {
  decryptResp,
  getSignKey,
  logger,
  makeURL,
  ParamsEncryptor,
  request,
} from "../utils.js";

const LOGIN_URL = "https://wpa.chat.zalo.me/api/login/getLoginInfo";
const SERVER_INFO_URL = "https://wpa.chat.zalo.me/api/login/getServerInfo";

function resolveCtx(arg) {
  if (typeof arg === "boolean" || arg == null) {
    return { ctx: appContext, encrypt: arg };
  }
  return { ctx: arg, encrypt: undefined };
}

export async function login(arg, encryptArg) {
  const { ctx, encrypt: ep } = resolveCtx(arg);
  const encrypt = encryptArg !== undefined ? encryptArg : ep;
  const built = await buildParam(ctx, encrypt, "getlogininfo");

  try {
    const res = await request(
      ctx,
      makeURL(ctx, LOGIN_URL, { ...built.params, nretry: 0 })
    );
    if (!res.ok) throw new ZaloApiError(`getLoginInfo HTTP ${res.status}`);

    const json = await res.json();
    if (!built.enk) return null;

    const decoded = decryptResp(built.enk, json.data);
    return decoded && typeof decoded !== "string" ? decoded : null;
  } catch (err) {
    logger(ctx).error("Login failed:", err);
    throw err;
  }
}

export async function getServerInfo(arg, encryptArg) {
  const { ctx, encrypt: ep } = resolveCtx(arg);
  const encrypt = encryptArg !== undefined ? encryptArg : ep;
  const built = await buildParam(ctx, encrypt, "getserverinfo");

  if (!built.params.signkey) throw new ZaloApiError("Thiếu signkey");

  const res = await request(
    ctx,
    makeURL(
      ctx,
      SERVER_INFO_URL,
      {
        imei: ctx.imei,
        type: ctx.API_TYPE,
        client_version: ctx.API_VERSION,
        computer_name: "Web",
        signkey: built.params.signkey,
      },
      false
    )
  );
  if (!res.ok) throw new ZaloApiError(`getServerInfo HTTP ${res.status}`);

  const json = await res.json();
  if (json.data == null) {
    throw new ZaloApiError("getServerInfo dữ liệu rỗng: " + (json.error_message || "unknown"));
  }
  return json.data;
}

async function buildParam(ctx, encrypt, type) {
  const data = {
    computer_name: "Web",
    imei: ctx.imei,
    language: ctx.language || "vi",
    ts: Date.now(),
  };

  const params = {};
  let enk = null;

  if (encrypt) {
    const encryptor = new ParamsEncryptor({
      type: ctx.API_TYPE,
      imei: data.imei,
      firstLaunchTime: Date.now(),
    });
    enk = encryptor.getEncryptKey();
    const encoded = ParamsEncryptor.encodeAES(enk, JSON.stringify(data), "base64", false);
    Object.assign(params, encryptor.getParams(), { params: encoded });
  } else {
    Object.assign(params, data);
  }

  params.type = ctx.API_TYPE;
  params.client_version = ctx.API_VERSION;
  // signkey của getserverinfo tính trên params raw, KHÔNG phải params đã encrypt
  // (mất buổi mới mò ra cái này)
  params.signkey =
    type === "getserverinfo"
      ? getSignKey(type, {
          imei: ctx.imei,
          type: ctx.API_TYPE,
          client_version: ctx.API_VERSION,
          computer_name: "Web",
        })
      : getSignKey(type, params);

  return { params, enk };
}
