import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ReactionMap } from "../models/Reaction.js";

export const ThreadType = { User: 0, Group: 1 };

export const Reactions = {
  HEART: "/-heart", LIKE: "/-strong", HAHA: "/-haha", WOW: "/-wow",
  CRY: "/-cry", ANGRY: "/-bad", KISS: "/-kiss", TEARS_OF_JOY: "/-tearsofjoy",
  SHIT: "/-shit", ROSE: "/-rose", BROKEN_HEART: "/-bh", DISLIKE: "/-weak",
  LOVE: "/-loveyou", CONFUSED: "/-confuse", WINK: "/-wink", FADE: "/-fade",
  SUN: "/-sun", BIRTHDAY: "/-birthday", BOMB: "/-bomb", OK: "/-ok",
  PEACE: "/-peace", THANKS: "/-thanks", PUNCH: "/-punch", SHARE: "/-share",
  PRAY: "/-pray", NO: "/-no", BAD: "/-bad", LOVE_YOU: "/-loveyou",
  SAD: "/-cry", VERY_SAD: "/-vrycry", COOL: "/-cool", NERD: "/-nerd",
  BIG_SMILE: "/-bigsmile", SUNGLASSES: "/-sg", NEUTRAL: "/-neutral",
  SAD_FACE: "/-sad", BIG_LAUGH: "/-laugh", TONGUE: "/-tongue", QUIET: "/-quiet",
  EMBARRASSED: "/-embarrassed", SURPRISED: "/-surprised",
};

const lookupReaction = (icon, fallbackRType = 3) =>
  ReactionMap[icon] ||
  ReactionMap[String(icon).toUpperCase()] ||
  { text: icon || "", rType: fallbackRType };

export function setupReaction(api, ctx, utils) {
  const { reaction, chat, group } = api.zpwServiceMap;
  const reactionURL = reaction?.[0];
  const chatURL = chat?.[0];
  const groupURL = group?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  api.addReaction = (icon, message, threadId, type = ThreadType.User) => {
    need(message, "message");

    if (Array.isArray(message)) {
      if (!message.length) throw new ZaloApiError("message[] rỗng");
      const first = message[0];
      const isGroup = first.type === 1 || type === ThreadType.Group;
      const tid = threadId || first.threadId;
      need(tid, "threadId");

      const r = lookupReaction(icon, 75);
      const rMsg = message.map((m) => ({
        gMsgID: parseInt(m.data?.msgId ?? m.msgId),
        cMsgID: parseInt(m.data?.cliMsgId ?? m.cliMsgId ?? Date.now()),
        msgType: parseInt(m.type ?? 0),
      }));

      const url = `${reactionURL}/api/${isGroup ? "group" : "message"}/reaction`;
      return utils.postEncrypted(url, {
        react_list: [{
          message: JSON.stringify({ rMsg, rIcon: r.text, rType: r.rType, source: 6 }),
          clientId: Date.now() * 600,
        }],
        [isGroup ? "grid" : "toid"]: String(tid),
        imei: ctx.imei,
      }).then(() => ({ icon, rType: r.rType }));
    }

    need(icon, "icon");
    need(message?.msgId, "message.msgId");
    need(threadId, "threadId");

    const r = lookupReaction(icon);
    const isUser = type === ThreadType.User;
    return utils.postEncrypted(`${reactionURL}/api/${isUser ? "message" : "group"}/reaction`, {
      data: JSON.stringify({
        data: { rIcon: r.text || icon, rType: r.rType, source: 6 },
        cliMsgId: message.cliMsgId || Date.now().toString(),
        globalMsgId: message.msgId,
        msgType: 1,
      }),
      [isUser ? "toid" : "grid"]: String(threadId),
      imei: ctx.imei,
    });
  };

  api.undoMessage = (message, threadId, type = ThreadType.User) => {
    need(message?.msgId, "message.msgId");
    need(threadId, "threadId");
    const isUser = type === ThreadType.User;
    return utils.postEncrypted(
      isUser ? `${chatURL}/api/message/undo` : `${groupURL}/api/group/undomsg`,
      {
        [isUser ? "toid" : "grid"]: String(threadId),
        cliMsgId: message.cliMsgId || Date.now().toString(),
        msgId: String(message.msgId),
        cliMsgIdUndo: Date.now().toString(),
        imei: ctx.imei,
      }
    );
  };
  api.undo = api.unsend = api.undoMessage;

  api.deleteMessage = (message, threadId, type = ThreadType.User) => {
    need(message?.msgId, "message.msgId");
    need(threadId, "threadId");
    const isUser = type === ThreadType.User;
    return utils.postEncrypted(
      isUser ? `${chatURL}/api/message/delete` : `${groupURL}/api/group/deletemsg`,
      {
        [isUser ? "toid" : "grid"]: String(threadId),
        cliMsgId: message.cliMsgId || Date.now().toString(),
        msgId: String(message.msgId),
        ownerId: String(message.ownerId || ctx.uid),
        onlyMe: 1,
        imei: ctx.imei,
      }
    );
  };

  // options: { cliMsgId, msgId, uidFrom, onlyMe }
  api.zDeleteMessage = async (options, threadId, type = ThreadType.User) => {
    if (!options) throw new ZaloApiError("Thiếu options");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");

    const isGroup = type === ThreadType.Group;
    const isSelf = String(ctx.uid) === String(options.uidFrom);
    if (isSelf && options.onlyMe === false) {
      throw new ZaloApiError("Để xoá tin của bạn cho mọi người, dùng undoMessage");
    }

    const url = isGroup
      ? `${groupURL}/api/group/deletemsg`
      : `${chatURL}/api/message/delete`;
    const params = {
      [isGroup ? "grid" : "toid"]: String(threadId),
      cliMsgId: Date.now() * 600,
      msgs: [{
        cliMsgId: String(options.cliMsgId),
        globalMsgId: String(options.msgId),
        ownerId: String(options.uidFrom),
        destId: String(threadId),
      }],
      onlyMe: options.onlyMe ? 1 : 0,
    };
    if (!isGroup) params.imei = ctx.imei;

    let lastErr;
    for (let i = 0; i < 6; i++) {
      try {
        return await utils.postEncrypted(url, params);
      } catch (e) {
        lastErr = e;
        if (i < 5) await sleep(500);
      }
    }
    throw lastErr;
  };

  api.pinMessage = (action, message, threadId, type = ThreadType.User) => {
    need(message?.msgId, "message.msgId");
    need(threadId, "threadId");
    const isUser = type === ThreadType.User;
    return utils.postEncrypted(
      `${isUser ? chatURL + "/api/message" : groupURL + "/api/group"}/pin`,
      {
        [isUser ? "toid" : "grid"]: String(threadId),
        action: action === "pin" || action === true ? 1 : 0,
        msgId: String(message.msgId),
        cliMsgId: message.cliMsgId || Date.now().toString(),
        imei: ctx.imei,
      }
    );
  };
}
