import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "./reaction.js";
import { MessageType } from "../models/Message.js";

export function setupBoard(api, ctx, utils) {
  const board = api.zpwServiceMap.group_board?.[0];
  // Personal todo dùng service "boards" (đôi khi server trả về "personal_board")
  const boards = api.zpwServiceMap.boards?.[0]
    || api.zpwServiceMap.personal_board?.[0]
    || api.zpwServiceMap.board?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };
  const tidPair = (threadId, type) =>
    type === ThreadType.User ? { toid: String(threadId) } : { grid: String(threadId) };

  api.createReminder = (options, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    need(options?.title, "options.title");
    const url = type === ThreadType.User
      ? `${board}/api/board/oneone/create`
      : `${board}/api/board/topic/createv2`;
    const params = type === ThreadType.User
      ? {
          objectData: JSON.stringify({
            toUid: String(threadId),
            type: 0,
            color: -16245706,
            emoji: options.emoji ?? "⏰",
            startTime: options.startTime ?? Date.now(),
            duration: -1,
            params: { title: options.title },
            needPin: false,
            repeat: options.repeat ?? 0,
            creatorUid: ctx.uid,
            src: 1,
          }),
          imei: ctx.imei,
        }
      : {
          grid: String(threadId),
          type: 0,
          color: -16245706,
          emoji: options.emoji ?? "⏰",
          startTime: options.startTime ?? Date.now(),
          duration: -1,
          params: JSON.stringify({ title: options.title }),
          repeat: options.repeat ?? 0,
          src: 1,
          imei: ctx.imei,
          pinAct: 0,
        };
    return utils.postEncrypted(url, params);
  };

  api.editReminder = (options, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    need(options?.topicId, "options.topicId");
    const url = type === ThreadType.User
      ? `${board}/api/board/oneone/update`
      : `${board}/api/board/topic/updatev2`;
    const params = type === ThreadType.User
      ? {
          objectData: JSON.stringify({
            toUid: String(threadId),
            type: 0,
            color: -16777216,
            emoji: options.emoji ?? "",
            startTime: options.startTime ?? Date.now(),
            duration: -1,
            params: { title: options.title },
            needPin: false,
            reminderId: options.topicId,
            repeat: options.repeat ?? 0,
          }),
        }
      : {
          grid: String(threadId),
          type: 0,
          color: -16777216,
          emoji: options.emoji ?? "",
          startTime: options.startTime ?? Date.now(),
          duration: -1,
          params: JSON.stringify({ title: options.title }),
          topicId: options.topicId,
          repeat: options.repeat ?? 0,
          imei: ctx.imei,
          pinAct: 2,
        };
    return utils.postEncrypted(url, params);
  };

  api.removeReminder = (reminderId, threadId, type = ThreadType.User) => {
    need(reminderId, "reminderId");
    need(threadId, "threadId");
    const url = type === ThreadType.User
      ? `${board}/api/board/oneone/remove`
      : `${board}/api/board/topic/remove`;
    const params = type === ThreadType.User
      ? { uid: String(threadId), reminderId: String(reminderId) }
      : { grid: String(threadId), topicId: String(reminderId), imei: ctx.imei };
    return utils.postEncrypted(url, params);
  };

  api.getReminder = (reminderId) =>
    utils.getEncrypted(`${board}/api/board/topic/getReminder`, {
      eventId: String(reminderId), imei: ctx.imei,
    });

  // Zalo có 2 cách gọi: dạng cũ /api/board/oneone/list & /api/board/listReminder bọc trong objectData,
  // dạng mới /api/board/list với payload phẳng (board_type=1 = reminder/note).
  // Bản này thử dạng mới trước rồi fallback sang dạng cũ nếu lỗi.
  api.getListReminder = async (options, threadId, type = ThreadType.User) => {
    need(threadId, "threadId");
    const page = options?.page ?? 1;
    const count = options?.count ?? 20;
    const flatPayload = (type === ThreadType.User ? { uid: String(threadId) } : { group_id: String(threadId) });
    Object.assign(flatPayload, { board_type: 1, page, count, last_id: 0, last_type: 0, imei: ctx.imei });
    try {
      return await utils.getEncrypted(`${board}/api/board/list`, flatPayload);
    } catch (_e) {
      const legacyUrl = type === ThreadType.User
        ? `${board}/api/board/oneone/list`
        : `${board}/api/board/listReminder`;
      const objectData = type === ThreadType.User
        ? { uid: String(threadId), board_type: 1, page, count, last_id: 0, last_type: 0 }
        : { group_id: String(threadId), board_type: 1, page, count, last_id: 0, last_type: 0 };
      const params = { objectData: JSON.stringify(objectData) };
      if (type === ThreadType.Group) params.imei = ctx.imei;
      return utils.getEncrypted(legacyUrl, params, {
        mapResult: (data) => (typeof data === "string" ? JSON.parse(data) : data),
      });
    }
  };

  api.getReminderResponses = (reminderId) =>
    utils.getEncrypted(`${board}/api/board/topic/listResponseEvent`, {
      topicId: reminderId, imei: ctx.imei, language: ctx.language,
    });

  api.createNote = (options, groupId) => {
    need(groupId, "groupId");
    need(options?.title, "options.title");
    return utils.postEncrypted(`${board}/api/board/topic/createv2`, {
      grid: String(groupId),
      type: 0,
      title: options.title,
      params: { title: options.title, set_title: true },
      pinAct: options.pinAct ? 1 : 0,
      src: 1, imei: ctx.imei, language: ctx.language,
    });
  };

  api.editNote = (options, groupId) => {
    need(groupId, "groupId");
    need(options?.topicId, "options.topicId");
    return utils.postEncrypted(`${board}/api/board/topic/updatev2`, {
      grid: String(groupId),
      topicId: options.topicId,
      title: options.title,
      params: { title: options.title, set_title: true },
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.getListBoard = (options, groupId) =>
    utils.getEncrypted(`${board}/api/board/list`, {
      group_id: String(groupId),
      page: options?.page || 1,
      count: options?.count || 20,
      board_type: options?.boardType || 0,
      last_id: 0, last_type: 0,
      imei: ctx.imei,
    });

  // Bản gốc ZCA-CUSTOM KHÔNG có sendToDo — dùng createReminder oneone (cá nhân) hoặc topic (nhóm).
  // assignees[0] sẽ là target uid; nếu group thì threadId của group được dùng.
  api.sendToDo = (message, content, assignees /*, dueDate, description */) => {
    need(message, "message");
    need(content, "content");
    const isGroup = message.type === MessageType.GroupMessage || message.type === 1;
    const targetThreadId = isGroup
      ? message.threadId
      : (Array.isArray(assignees) && assignees.length ? String(assignees[0]) : message.threadId);
    const type = isGroup ? ThreadType.Group : ThreadType.User;
    return api.createReminder({ title: String(content) }, String(targetThreadId), type);
  };
  api.sendTodo = api.sendToDo;
}
