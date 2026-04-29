import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "./reaction.js";

export function setupConversation(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const conv = svc.conversation?.[0];
  const profile = svc.profile?.[0];
  const chat = svc.chat?.[0];
  const group = svc.group?.[0];
  const label = svc.label?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };
  const tk = (type) => (type === ThreadType.User ? "toid" : "grid");

  api.setMute = (params, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    return utils.postEncrypted(`${profile}/api/social/profile/setmute`, {
      [tk(type)]: String(threadId), ...params,
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.getMute = () =>
    utils.getEncrypted(`${profile}/api/social/profile/getmute`, {
      imei: ctx.imei, language: ctx.language,
    });

  api.setPinnedConversations = (pin, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    return utils.postEncrypted(`${conv}/api/pinconvers/updatev2`, {
      [tk(type)]: String(threadId), pin: pin ? 1 : 0,
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.getPinConversations = () =>
    utils.getEncrypted(`${conv}/api/pinconvers/list`, {});

  api.deleteChat = (lastMessage, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${chat}/api/message/deleteconver`
      : `${group}/api/group/deleteconver`;
    return utils.postEncrypted(url, {
      [tk(type)]: String(threadId),
      lastMsgId: lastMessage?.msgId ? String(lastMessage.msgId) : "0",
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.addUnreadMark = (threadId, type = ThreadType.User) =>
    utils.postEncrypted(`${conv}/api/conv/addUnreadMark`, {
      [tk(type)]: String(threadId), imei: ctx.imei, language: ctx.language,
    });
  api.removeUnreadMark = (threadId, type = ThreadType.User) =>
    utils.postEncrypted(`${conv}/api/conv/removeUnreadMark`, {
      [tk(type)]: String(threadId), imei: ctx.imei, language: ctx.language,
    });
  api.getUnreadMark = () =>
    utils.getEncrypted(`${conv}/api/conv/getUnreadMark`, {});

  api.setHiddenConversations = (hidden, threadId, type = ThreadType.User) =>
    utils.postEncrypted(`${conv}/api/hiddenconvers/add-remove`, {
      [tk(type)]: String(threadId), hide: hidden ? 1 : 0,
      imei: ctx.imei, language: ctx.language,
    });
  api.getHiddenConversations = () =>
    utils.getEncrypted(`${conv}/api/hiddenconvers/get-all`, {
      imei: ctx.imei, language: ctx.language,
    });
  api.updateHiddenConversPin = (pin) =>
    utils.getEncrypted(`${conv}/api/hiddenconvers/update-pin`, {
      pin: String(pin), imei: ctx.imei, language: ctx.language,
    });
  api.resetHiddenConversPin = () =>
    utils.getEncrypted(`${conv}/api/hiddenconvers/reset`, {});

  api.getAutoDeleteChat = () =>
    utils.getEncrypted(`${conv}/api/conv/autodelete/getConvers`, {});
  api.updateAutoDeleteChat = (ttl, threadId, type = ThreadType.User) =>
    utils.postEncrypted(`${conv}/api/conv/autodelete/updateConvers`, {
      threadId: String(threadId),
      isGroup: type === ThreadType.User ? 0 : 1,
      ttl,
      clientLang: ctx.language || "vi",
    });

  api.getArchivedChatList = () =>
    utils.getEncrypted(`${label}/api/archivedchat/list`, {
      imei: ctx.imei, language: ctx.language,
    });
  api.updateArchivedChatList = (isArchived, conversations) =>
    utils.postEncrypted(`${label}/api/archivedchat/update`, {
      archived: isArchived ? 1 : 0,
      convers: Array.isArray(conversations) ? conversations : [conversations],
      imei: ctx.imei, language: ctx.language,
    });
}
