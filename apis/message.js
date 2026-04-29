import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "./reaction.js";
import {
  analyzeLinks,
  getClientMessageType,
  removeUndefinedKeys,
} from "../utils.js";

export const MessageType = { DirectMessage: 0, GroupMessage: 1 };

// mỗi loại file có endpoint riêng – ảnh đi photo_original, còn lại async
const ATT_SUBPATH = {
  image: "photo_original/send",
  gif: "gif",
  video: "asyncfile/msg",
  others: "asyncfile/msg",
};

const DESC_EXTS = ["jpg", "jpeg", "png", "webp"];

// uid = "-1" tức là @All, type phải set 1
function buildMentions(type, msg, mentions) {
  if (!Array.isArray(mentions) || type !== ThreadType.Group) return { final: [], msg };
  let total = 0;
  const final = mentions
    .filter((m) => m.pos >= 0 && m.uid && m.len > 0)
    .map((m) => {
      total += m.len;
      return { pos: m.pos, uid: String(m.uid), len: m.len, type: m.uid === "-1" ? 1 : 0 };
    });
  if (total > (msg || "").length) {
    throw new ZaloApiError("Mentions vượt quá độ dài tin");
  }
  return { final, msg };
}

function quoteAttach(quote) {
  const q = quote.data || quote;
  if (typeof q.content === "string") return q.propertyExt;
  if (q.msgType === "chat.todo") {
    return { properties: { color: 0, size: 0, type: 0, subType: 0, ext: '{"shouldParseLinkOrContact":0}' } };
  }
  return {
    ...(q.content || {}),
    thumbUrl: q.content?.thumb,
    oriUrl: q.content?.href,
    normalUrl: q.content?.href,
  };
}

function quoteText(quote) {
  const q = quote.data || quote;
  if (q.msgType === "chat.todo" && typeof q.content !== "string") {
    try { return JSON.parse(q.content.params).item.content; } catch { return ""; }
  }
  return "";
}

export function setupMessage(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const chat = svc.chat?.[0];
  const group = svc.group?.[0];
  const file = svc.file?.[0];
  const zimsg = svc.zimsg?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };
  const cliId = () => Date.now().toString();
  const tk = (type) => (type === ThreadType.User ? "toid" : "grid");

  async function sendText({ msg, mentions, quote, style, ttl, visibility }, threadId, type) {
    const isGroup = type === ThreadType.Group;
    const { final: ments } = buildMentions(type, msg, mentions);
    const hasMentions = ments.length > 0 && isGroup;

    const params = {
      [tk(type)]: String(threadId),
      message: msg,
      clientId: cliId(),
      mentionInfo: hasMentions ? JSON.stringify(ments) : undefined,
      ttl: ttl || 0,
      visibility: isGroup ? 0 : visibility,
      imei: isGroup ? undefined : ctx.imei,
      language: ctx.language,
      textProperties: style ? JSON.stringify(style) : undefined,
    };

    if (quote) {
      const q = quote.data || quote;
      Object.assign(params, {
        qmsgOwner: String(q.uidFrom || q.ownerId || "0"),
        qmsgId: String(q.msgId),
        qmsgCliId: String(q.cliMsgId || "0"),
        qmsg: typeof q.content === "string" ? q.content : quoteText(quote),
        qmsgType: getClientMessageType(q.msgType),
        qmsgTs: q.ts || Date.now(),
        qmsgTTL: q.ttl,
        qmsgAttach: isGroup ? JSON.stringify(quoteAttach(quote)) : undefined,
      });
    }
    removeUndefinedKeys(params);

    let path;
    if (quote) path = isGroup ? "group/quote" : "message/quote";
    else if (isGroup) path = hasMentions ? "group/mention" : "group/sendmsg";
    else path = "message/sms";

    return utils.postEncrypted(`${isGroup ? group : chat}/api/${path}`, params);
  }

  async function sendAttachments({ msg, mentions, attachments, quote, ttl, isUseProphylactic }, threadId, type) {
    const uploaded = await api.uploadAttachment(attachments, threadId, type, isUseProphylactic);
    const list = Array.isArray(uploaded) ? uploaded : [uploaded];
    const isGroup = type === ThreadType.Group;
    const isMulti = list.length > 1;
    const layoutId = String(Date.now());
    const { final: ments } = buildMentions(type, msg || "", mentions);
    const hasMentions = ments.length > 0 && isGroup && !isMulti && !quote;

    let cli = Date.now();
    let idx = list.length - 1;
    const out = [];

    for (const att of list) {
      let params;

      if (att.fileType === "image") {
        params = {
          photoId: att.photoId,
          clientId: String(cli++),
          desc: msg || "",
          width: att.width, height: att.height,
          [tk(type)]: String(threadId),
          rawUrl: att.normalUrl,
          hdUrl: att.hdUrl,
          thumbUrl: att.thumbUrl,
          oriUrl: isGroup ? att.normalUrl : undefined,
          normalUrl: isGroup ? undefined : att.normalUrl,
          hdSize: String(att.totalSize || 0),
          zsource: -1,
          ttl: ttl || 0,
          jcp: '{"convertible":"jxl"}',
          groupLayoutId: isMulti ? layoutId : undefined,
          isGroupLayout: isMulti ? 1 : undefined,
          idInGroup: isMulti ? idx-- : undefined,
          totalItemInGroup: isMulti ? list.length : undefined,
          mentionInfo: hasMentions ? JSON.stringify(ments) : undefined,
          imei: ctx.imei,
        };
      } else {
        const ext = (att.fileName || "").split(".").pop();
        params = {
          fileId: att.fileId,
          checksum: att.checksum,
          checksumSha: "",
          extention: ext,
          totalSize: att.totalSize,
          fileName: att.fileName,
          clientId: String(att.clientId || cli++),
          fType: 1,
          fileCount: 0,
          fdata: "{}",
          [tk(type)]: String(threadId),
          fileUrl: att.fileUrl,
          zsource: -1,
          ttl: ttl || 0,
          imei: ctx.imei,
        };
      }

      removeUndefinedKeys(params);
      const sub = ATT_SUBPATH[att.fileType] || ATT_SUBPATH.others;
      const url = `${file}/api/${isGroup ? "group" : "message"}/${sub}`;
      out.push(await utils.postEncrypted(url, params, { extraQuery: { nretry: 0 } }));
    }
    return out;
  }

  api.sendMessage = async (input, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    if (typeof input === "string") input = { msg: input };

    let { msg = "", attachments, mentions, quote, style, ttl, linkOn = true, visibility, isUseProphylactic } = input;
    ttl = ttl || ctx.timeMessage || 0;

    if (!msg && (!attachments || !attachments.length)) {
      throw new ZaloApiError("Thiếu nội dung tin");
    }

    const out = { message: null, attachment: [], link: null };

    if (attachments && attachments.length) {
      const ext = (attachments[0].split(".").pop() || "").toLowerCase();
      const single = attachments.length === 1;
      const canBeDesc = single && DESC_EXTS.includes(ext);

      // Tin có quote, hoặc nhiều file / không phải ảnh đơn → text phải gửi tách trước
      if ((!canBeDesc && msg) || (msg && quote)) {
        out.message = await sendText({ msg, mentions, quote, style, ttl, visibility }, threadId, type);
        msg = ""; mentions = undefined;
      }
      out.attachment = await sendAttachments(
        { msg, mentions, attachments, quote, ttl, isUseProphylactic },
        threadId, type
      );
      msg = "";
    }

    if (msg) {
      const { count, links } = analyzeLinks(msg);
      if (linkOn && count === 1) {
        try {
          out.link = await api.sendLink({ msg, link: links[0] }, threadId, type);
        } catch {
          out.message = await sendText({ msg, mentions, quote, style, ttl, visibility }, threadId, type);
        }
      } else {
        out.message = await sendText({ msg, mentions, quote, style, ttl, visibility }, threadId, type);
      }
    }

    return out;
  };

  api.sendMessagePrivate = (message, threadId, ttl = 0) => {
    need(threadId, "threadId");
    if (typeof message === "string") message = { msg: message };
    return utils.postEncrypted(`${chat}/api/message/sms`, {
      toid: String(threadId), message: message.msg,
      clientId: cliId(), ttl,
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendSticker = (sticker, threadId, type = ThreadType.User) => {
    need(threadId, "threadId"); need(sticker, "sticker");
    const url = type === ThreadType.User
      ? `${chat}/api/message/sticker`
      : `${group}/api/group/sticker`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      stickerId: sticker.id || sticker.stickerId,
      cateId: sticker.cateId || sticker.categoryId,
      type: sticker.type || 7,
      clientId: cliId(),
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendLink = (options, threadId, type = ThreadType.User) => {
    need(threadId, "threadId"); need(options?.link || options?.href, "link");
    const isGroup = type === ThreadType.Group;
    const url = isGroup
      ? `${group}/api/group/sendlink`
      : `${chat}/api/message/link`;
    const href = options.link || options.href;
    let host = "";
    try { host = new URL(href).hostname; } catch {}
    const payload = {
      msg: options.msg || "",
      href,
      src: options.src || host,
      title: options.title || "",
      desc: options.desc || options.description || "",
      thumb: options.thumb || "",
      type: 0,
      media: JSON.stringify({ type: 0, count: 0, mediaTitle: "", artist: "", streamUrl: "", stream_icon: "" }),
      ttl: options.ttl || 0,
      clientId: cliId(),
    };
    if (isGroup) {
      payload.grid = String(threadId);
      payload.visibility = 0;
      payload.imei = ctx.imei;
      payload.mentionInfo = options.mentionInfo || "[]";
    } else {
      payload.toId = String(threadId);
    }
    return utils.postEncrypted(url, payload);
  };

  api.parseLink = (link) => {
    need(link, "link");
    return utils.postEncrypted(`${file}/api/message/parselink`, {
      link, imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendBusinessCard = (userId, threadId, type = ThreadType.User) => {
    need(userId, "userId"); need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${file}/api/message/forward`
      : `${file}/api/group/forward`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      msgInfo: JSON.stringify({ uid: String(userId) }),
      msgType: 6, clientId: cliId(),
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendCard = async (options, threadId, type = ThreadType.User) => {
    need(options?.userId, "options.userId");
    need(threadId, "threadId");
    // Bản gốc: phải lấy QR của user → dựng msgInfo → forward qua /api/{message,group}/forward
    const qrMap = await api.getQR(options.userId);
    const qrCodeUrl = qrMap?.[options.userId] || qrMap?.qrCodeUrl || qrMap;
    const msgInfo = { contactUid: String(options.userId), qrCodeUrl };
    if (options.phoneNumber) msgInfo.phone = String(options.phoneNumber);
    const params = {
      ttl: options.ttl ?? 0,
      msgType: 6,
      clientId: cliId(),
      msgInfo: JSON.stringify(msgInfo),
    };
    if (type === ThreadType.Group) {
      params.visibility = 0;
      params.grid = String(threadId);
    } else {
      params.toId = String(threadId);
      params.imei = ctx.imei;
    }
    const url = type === ThreadType.Group
      ? `${file}/api/group/forward`
      : `${file}/api/message/forward`;
    return utils.postEncrypted(url, params);
  };

  api.sendBankCard = (payload, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    if (!zimsg) throw new ZaloApiError("Thiếu zimsg service");
    return utils.postEncrypted(`${zimsg}/api/transfer/card`, {
      [tk(type)]: String(threadId),
      ...payload, imei: ctx.imei, language: ctx.language,
    });
  };

  // Theo bản gốc ZCA-CUSTOM: dùng /api/{message,group}/mforward, gửi 1 lần cho nhiều thread.
  api.forwardMessage = (payload, threadIds, type = ThreadType.User) => {
    need(payload, "payload"); need(threadIds, "threadIds");
    const targets = Array.isArray(threadIds) ? threadIds.map(String) : [String(threadIds)];
    if (!targets.length) throw new ZaloApiError("Missing thread IDs");

    // Cho phép payload là string ("message") hoặc object { message, ttl, reference }
    const message = typeof payload === "string" ? payload : payload.message;
    if (!message) throw new ZaloApiError("Missing message content");
    const ttl = (typeof payload === "object" && payload?.ttl) ?? 0;
    const reference = typeof payload === "object" ? payload.reference : null;

    const url = type === ThreadType.Group
      ? `${file}/api/group/mforward`
      : `${file}/api/message/mforward`;

    const clientId = String(Date.now());
    const msgInfo = {
      message,
      reference: reference
        ? JSON.stringify({ type: 3, data: JSON.stringify(reference) })
        : undefined,
    };
    const decorLog = reference
      ? {
          fw: {
            pmsg: { st: 1, ts: reference.ts, id: reference.id },
            rmsg: { st: 1, ts: reference.ts, id: reference.id },
            fwLvl: reference.fwLvl,
          },
        }
      : null;

    const params = type === ThreadType.User
      ? {
          toIds: targets.map((tid) => ({ clientId, toUid: tid, ttl })),
          imei: ctx.imei,
          ttl,
          msgType: "1",
          totalIds: targets.length,
          msgInfo: JSON.stringify(msgInfo),
          decorLog: JSON.stringify(decorLog),
        }
      : {
          grids: targets.map((tid) => ({ clientId, grid: tid, ttl })),
          ttl,
          msgType: "1",
          totalIds: targets.length,
          msgInfo: JSON.stringify(msgInfo),
          decorLog: JSON.stringify(decorLog),
        };

    return utils.postEncrypted(url, params);
  };
  api.sendForward = api.forwardMessage;

  api.sendMessageForward = (message, threadId, type = ThreadType.User, ttl = 0) => {
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${file}/api/message/mforward`
      : `${file}/api/group/mforward`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      msgInfo: typeof message === "string" ? message : JSON.stringify(message),
      ttl, clientId: cliId(),
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.getRecentMessage = (toid, count = 30, lastMsgId = 0) => {
    need(toid, "toid");
    return utils.getEncrypted(`${svc.group_cloud_message?.[0]}/api/cm/getrecentv2`, {
      toid: String(toid), count, msgId: lastMsgId,
      imei: ctx.imei, language: ctx.language,
    });
  };
}
