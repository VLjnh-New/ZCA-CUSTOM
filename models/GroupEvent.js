import { appContext } from "../context.js";

export const GroupEventType = {
  JOIN_REQUEST: 0,
  JOIN: 1,
  LEAVE: 2,
  REMOVE_MEMBER: 3,
  BLOCK_MEMBER: 4,
  UPDATE_SETTING: 5,
  UPDATE: 6,
  NEW_LINK: 7,
  ADD_ADMIN: 8,
  REMOVE_ADMIN: 9,
  NEW_PIN_TOPIC: 10,
  UPDATE_TOPIC: 11,
  UPDATE_BOARD: 12,
  REORDER_PIN_TOPIC: 13,
  UNPIN_TOPIC: 14,
  REMOVE_TOPIC: 15,
  UNKNOWN: 16,
};

const ACT_MAP = {
  join_request: GroupEventType.JOIN_REQUEST,
  join: GroupEventType.JOIN,
  leave: GroupEventType.LEAVE,
  remove_member: GroupEventType.REMOVE_MEMBER,
  block_member: GroupEventType.BLOCK_MEMBER,
  update_setting: GroupEventType.UPDATE_SETTING,
  update: GroupEventType.UPDATE,
  new_link: GroupEventType.NEW_LINK,
  add_admin: GroupEventType.ADD_ADMIN,
  remove_admin: GroupEventType.REMOVE_ADMIN,
  new_pin_topic: GroupEventType.NEW_PIN_TOPIC,
  update_topic: GroupEventType.UPDATE_TOPIC,
  update_board: GroupEventType.UPDATE_BOARD,
  reorder_pin_topic: GroupEventType.REORDER_PIN_TOPIC,
  unpin_topic: GroupEventType.UNPIN_TOPIC,
  remove_topic: GroupEventType.REMOVE_TOPIC,
};

export function getGroupEventType(act) {
  return ACT_MAP[act] ?? GroupEventType.UNKNOWN;
}

export function initializeGroupEvent(data, type) {
  const threadId = data.groupId;
  const me = appContext.uid;
  const isPinTopic =
    type === GroupEventType.NEW_PIN_TOPIC ||
    type === GroupEventType.UNPIN_TOPIC ||
    type === GroupEventType.REORDER_PIN_TOPIC;

  if (type === GroupEventType.JOIN_REQUEST) {
    return { type, data, threadId, isSelf: false };
  }
  if (isPinTopic) {
    return { type, data, threadId, isSelf: data.actorId === me };
  }
  const involvesMe =
    (data.updateMembers && data.updateMembers.some((m) => m.id === me)) ||
    data.sourceId === me;
  return { type, data, threadId, isSelf: !!involvesMe };
}
