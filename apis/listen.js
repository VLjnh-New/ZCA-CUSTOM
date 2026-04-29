import EventEmitter from "events";
import WebSocket from "ws";

import { initializeGroupEvent, getGroupEventType } from "../models/GroupEvent.js";
import { GroupMessage, Message } from "../models/Message.js";
import { Reaction } from "../models/Reaction.js";
import { Undo } from "../models/Undo.js";
import { decodeEventData, logger } from "../utils.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";

// Zalo timeout chừng ~5 phút không ping → cứ 3p ping cho chắc
const PING_INTERVAL = 3 * 60 * 1000;

export class Listener extends EventEmitter {
  constructor(ctx, urls) {
    super();
    if (!ctx.cookie) throw new ZaloApiError("Cookie chưa được nạp");
    if (!ctx.userAgent) throw new ZaloApiError("userAgent chưa được nạp");

    this.ctx = ctx;
    this.urls = Array.isArray(urls) ? urls : [urls];
    this.urlIndex = 0;
    this.cipherKey = null;
    this.log = logger(ctx);
  }

  onConnected(cb) { this.on("connected", cb); }
  onClosed(cb) { this.on("closed", cb); }
  onError(cb) { this.on("error", cb); }
  onMessage(cb) { this.on("message", cb); }

  start() {
    const url = this.urls[this.urlIndex];
    // ws lib không nuốt CookieJar, phải tự lấy string nhét vào header
    const cookieHeader =
      typeof this.ctx.cookie === "string"
        ? this.ctx.cookie
        : this.ctx.cookie.getCookieStringSync?.(url) ?? "";

    this.ws = new WebSocket(url, {
      headers: {
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        host: new URL(url).host,
        origin: "https://chat.zalo.me",
        "sec-websocket-version": "13",
        "user-agent": this.ctx.userAgent,
        cookie: cookieHeader,
      },
    });

    this.ws.onopen = () => this.emit("connected");
    this.ws.onclose = () => {
      clearInterval(this.pingInterval);
      this.emit("closed");
    };
    this.ws.onerror = (err) => this.emit("error", err);
    this.ws.onmessage = (ev) => this.#onPacket(ev).catch((e) => this.emit("error", e));
  }

  stop() {
    clearInterval(this.pingInterval);
    this.ws?.close();
  }

  async #onPacket(event) {
    const data = event.data;
    if (!(data instanceof Buffer) || data.length < 4) return;

    const [version, cmd, subCmd] = parseHeader(data.subarray(0, 4));
    const body = new TextDecoder("utf-8").decode(data.subarray(4));
    if (!body) return;

    let parsed;
    try { parsed = JSON.parse(body); } catch { return; }
    if (version !== 1) return;

    if (cmd === 1 && subCmd === 1 && parsed.key) return this.#handleKeyExchange(parsed);
    if (cmd === 501) return this.#handlePersonal(parsed);
    if (cmd === 521) return this.#handleGroup(parsed);
    if (cmd === 601) return this.#handleControls(parsed);
    if (cmd === 612) return this.#handleReactions(parsed);
    if (cmd === 3000) {
      this.log.warn("Phiên khác đang mở, đóng kết nối hiện tại");
      this.ws.close();
    }
  }

  #handleKeyExchange(parsed) {
    this.cipherKey = parsed.key;
    clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => this.#sendPing(), PING_INTERVAL);
  }

  #sendPing() {
    const payload = JSON.stringify({ eventId: Date.now() });
    const encoded = new TextEncoder().encode(payload);
    const buf = Buffer.alloc(4 + encoded.length);
    buf.writeUInt8(1, 0);
    buf.writeInt16LE(2, 1);
    buf.writeInt8(1, 3);
    buf.set(encoded, 4);
    this.ws.send(buf);
  }

  async #handlePersonal(parsed) {
    const decoded = await decodeEventData(parsed, this.cipherKey);
    if (!decoded?.data?.msgs) return;
    for (const msg of decoded.data.msgs) {
      const isUndo = typeof msg.content === "object" && "deleteMsg" in msg.content;
      const obj = isUndo ? new Undo(msg, false) : new Message(msg);
      if (obj.isSelf && !this.ctx.options.selfListen) continue;
      this.emit(isUndo ? "undo" : "message", obj);
    }
  }

  async #handleGroup(parsed) {
    const decoded = await decodeEventData(parsed, this.cipherKey);
    if (!decoded?.data?.groupMsgs) return;
    for (const msg of decoded.data.groupMsgs) {
      const isUndo = typeof msg.content === "object" && "deleteMsg" in msg.content;
      const obj = isUndo ? new Undo(msg, true) : new GroupMessage(msg);
      if (obj.isSelf && !this.ctx.options.selfListen) continue;
      this.emit(isUndo ? "undo" : "message", obj);
    }
  }

  async #handleControls(parsed) {
    const decoded = await decodeEventData(parsed, this.cipherKey);
    if (!decoded?.data?.controls) return;

    for (const ctrl of decoded.data.controls) {
      const c = ctrl.content;

      if (c.act_type === "file_done" || c.act_type === "voice_aac_success") {
        // voice_aac_success trả URL trong slot "5" hoặc "6", không có .url
        const fileUrl = c.act_type === "file_done" ? c.data.url : c.data["5"] || c.data["6"];
        const payload = { fileUrl, fileId: c.fileId };
        const cb = this.ctx.uploadCallbacks.get(String(c.fileId));
        if (cb) cb(payload);
        this.ctx.uploadCallbacks.delete(String(c.fileId));
        this.emit("upload_attachment", payload);
        continue;
      }

      if (c.act_type === "group" && c.act !== "join_reject") {
        const data = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
        const event = initializeGroupEvent(data, getGroupEventType(c.act));
        if (event.isSelf && !this.ctx.options.selfListen) continue;
        this.emit("group_event", event);
      }
    }
  }

  async #handleReactions(parsed) {
    const decoded = await decodeEventData(parsed, this.cipherKey);
    if (!decoded?.data) return;
    const { reacts = [], reactGroups = [] } = decoded.data;

    for (const r of reacts) {
      try { r.content = JSON.parse(r.content); } catch {}
      const obj = new Reaction(r, false, this.ctx.uid);
      if (obj.isSelf && !this.ctx.options.selfListen) continue;
      this.emit("reaction", obj);
    }
    for (const r of reactGroups) {
      try { r.content = JSON.parse(r.content); } catch {}
      const obj = new Reaction(r, true, this.ctx.uid);
      if (obj.isSelf && !this.ctx.options.selfListen) continue;
      this.emit("reaction", obj);
    }
  }
}

function parseHeader(buf) {
  return [buf[0], buf.readUInt16LE(1), buf[3]];
}
