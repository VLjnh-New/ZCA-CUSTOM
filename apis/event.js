import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "./reaction.js";

export function setupEvent(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const chat = svc.chat?.[0];
  const group = svc.group?.[0];
  const profile = svc.profile?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };
  const tk = (type) => (type === ThreadType.User ? "toid" : "grid");

  api.sendTypingEvent = (threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${chat}/api/message/typing`
      : `${group}/api/group/typing`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId), imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendSeenEvent = (messages, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${chat}/api/message/seenv2`
      : `${group}/api/group/seenv2`;
    const msgs = Array.isArray(messages) ? messages : [messages];
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      messages: msgs.map((m) => ({
        msgId: String(m.msgId), cliMsgId: m.cliMsgId || "0", uidFrom: String(m.uidFrom || ""),
      })),
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendDeliveredEvent = (isSeen, messages, type = ThreadType.User) => {
    const msgs = Array.isArray(messages) ? messages : [messages];
    if (!msgs.length) throw new ZaloApiError("Thiếu messages");
    const idTo = msgs[0].idTo || msgs[0].threadId;
    const url = type === ThreadType.User
      ? `${chat}/api/message/deliveredv2`
      : `${group}/api/group/deliveredv2`;
    return utils.postEncrypted(url, {
      messages: msgs.map((m) => ({
        msgId: String(m.msgId), cliMsgId: m.cliMsgId || "0",
        uidFrom: String(m.uidFrom || ""), seen: isSeen ? 1 : 0,
      })),
      ...(type === ThreadType.User ? {} : { grid: String(idTo) }),
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.keepAlive = () =>
    utils.postEncrypted(`${svc.chat?.[0]}/keepalive`, {
      imei: ctx.imei, language: ctx.language,
    });

  api.sendReport = (options, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${profile}/api/report/abuse-v2`
      : `${profile}/api/social/profile/reportabuse`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      reason: options?.reason || 0,
      content: options?.content || "",
      imei: ctx.imei, language: ctx.language,
    });
  };
}
