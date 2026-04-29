import { appContext } from "../context.js";

export const MessageType = {
  DirectMessage: 0,
  GroupMessage: 1,
};

class BaseMessage {
  constructor(data, type) {
    this.type = type;
    this.data = data;
    this.isSelf = data.uidFrom === "0";
    if (data.uidFrom === "0") data.uidFrom = appContext.uid;
  }
}

export class Message extends BaseMessage {
  constructor(data) {
    super(data, MessageType.DirectMessage);
    this.threadId = data.uidFrom === appContext.uid ? data.idTo : data.uidFrom;
    if (data.idTo === "0") data.idTo = appContext.uid;
  }
}

export class GroupMessage extends BaseMessage {
  constructor(data) {
    super(data, MessageType.GroupMessage);
    this.threadId = data.idTo;
  }
}

export function MessageMention(uid, length = 1, offset = 0, autoFormat = false) {
  if (typeof offset !== "number" || typeof length !== "number") {
    throw new Error("offset và length phải là số");
  }
  const m = { pos: offset, len: length, uid, type: uid === "-1" ? 1 : 0 };
  return autoFormat ? JSON.stringify([m]) : m;
}

export function MessageStyle({
  offset = 0, length = 1,
  color = "ffffff", size = "18",
  bold = false, italic = false, underline = false, strike = false,
  autoFormat = false,
} = {}) {
  const st = [];
  if (bold) st.push("b");
  if (italic) st.push("i");
  if (underline) st.push("u");
  if (strike) st.push("s");
  st.push("c_" + color.replace("#", ""));
  st.push("f_" + size);

  const style = { start: offset, len: length, st: st.join(",") };
  return autoFormat ? JSON.stringify({ styles: [style], ver: 0 }) : style;
}

// Gộp nhiều style (object hoặc chuỗi JSON đã encode) thành 1 chuỗi gửi cho server
export function MultiMsgStyle(list = []) {
  const styles = list
    .map((s) => {
      if (typeof s !== "string") return s;
      try { return JSON.parse(s).styles[0]; } catch { return null; }
    })
    .filter(Boolean);
  return JSON.stringify({ styles, ver: 0 });
}
