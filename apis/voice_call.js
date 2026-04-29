import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, makeURL, request, resolveResponse } from "../utils.js";

const VOICECALL_HOST = "https://voicecall-wpa.chat.zalo.me";
const DEFAULT_GROUP_NAME = "debug";
const DEFAULT_MAX_USERS = 8;

function trimStr(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function cleanUserIds(userIds) {
  if (!Array.isArray(userIds)) userIds = [userIds];
  const seen = new Set();
  const out = [];
  for (const u of userIds) {
    const id = trimStr(u);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function maybeOne(userId) {
  const id = trimStr(userId);
  return id ? [id] : [];
}

function resolveCallId(v) {
  const t = trimStr(v);
  if (!t) return Math.floor(Date.now() / 1000);
  const num = Number(t);
  return Number.isFinite(num) && String(num) === t ? num : t;
}

// gửi POST tới voicecall endpoint với body params=enc + zpw_ver=667 (theo Za-go)
async function vcPost(ctx, path, payload) {
  if (!ctx?.secretKey) throw new ZaloApiError("Phiên đăng nhập chưa sẵn sàng");
  const enc = encodeAES(ctx.secretKey, JSON.stringify(payload));
  if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");
  const url = makeURL(ctx, `${VOICECALL_HOST}${path}`, { zpw_ver: ctx.API_VERSION, zpw_type: ctx.API_TYPE }, false);
  const res = await request(ctx, url, {
    method: "POST",
    body: new URLSearchParams({ params: enc }),
  });
  return resolveResponse(ctx, res);
}

export function setupVoiceCall(api, ctx /*, utils */) {
  // Tạo cuộc gọi nhóm — bước 1/2 (request slot trên server)
  api.callGroupRequest = (groupId, userIds, callId, groupName) => {
    if (!groupId) throw new ZaloApiError("Thiếu groupId");
    const ids = cleanUserIds(userIds);
    if (!ids.length) throw new ZaloApiError("Thiếu userIds");
    const cid = resolveCallId(callId);
    const gname = trimStr(groupName) || DEFAULT_GROUP_NAME;
    return vcPost(ctx, "/api/voicecall/group/requestcall", {
      groupId: trimStr(groupId),
      callId: cid,
      typeRequest: 1,
      data: JSON.stringify({
        extraData: "",
        groupAvatar: "",
        groupId: trimStr(groupId),
        groupName: gname,
        maxUsers: DEFAULT_MAX_USERS,
        noiseId: ids,
      }),
      partners: ids,
    });
  };

  // Mời thêm user vào cuộc gọi nhóm đang diễn ra
  api.callGroupAddUser = (userIds, callId, hostCall, groupId) => {
    if (!groupId) throw new ZaloApiError("Thiếu groupId");
    const ids = cleanUserIds(userIds);
    if (!ids.length) throw new ZaloApiError("Thiếu userIds");
    const cid = resolveCallId(callId);
    const inner = JSON.stringify({
      groupAvatar: "",
      groupId: trimStr(groupId),
      groupName: DEFAULT_GROUP_NAME,
      hostCall: hostCall ?? "",
      maxUsers: DEFAULT_MAX_USERS,
    });
    const outer = JSON.stringify({
      codec: "",
      data: inner,
      extendData: "",
      rtcpAddress: "",
      rtcpAddressIPv6: "",
      rtpAddress: "",
      rtpAddressIPv6: "",
    });
    return vcPost(ctx, "/api/voicecall/group/adduser", {
      callId: cid,
      callType: 1,
      hostCall: hostCall ?? "",
      data: outer,
      session: "",
      partners: JSON.stringify([ids[0]]),
      groupId: trimStr(groupId),
    });
  };

  // Huỷ cuộc gọi nhóm
  api.callGroupCancel = (callId, hostCall, groupId) => {
    if (!groupId) throw new ZaloApiError("Thiếu groupId");
    const cid = resolveCallId(callId);
    return vcPost(ctx, "/api/voicecall/group/cancel", {
      callId: cid,
      hostCall: hostCall ?? "",
      data: JSON.stringify({
        callType: 1,
        duration: 0,
        extraData: "",
        groupId: trimStr(groupId),
      }),
    });
  };

  // Flow đầy đủ: request slot → đọc server RTP/RTCP → gửi /group/request để bot tham gia
  api.callGroup = async (groupId, userIds, opts = {}) => {
    if (!groupId) throw new ZaloApiError("Thiếu groupId");
    const ids = cleanUserIds(userIds);
    if (!ids.length) throw new ZaloApiError("Thiếu userIds");
    const callId = resolveCallId(opts.callId);
    const groupName = trimStr(opts.groupName) || DEFAULT_GROUP_NAME;

    const reqResp = await api.callGroupRequest(groupId, ids, callId, groupName);
    // Zalo có thể trả về {params:..., status, msg} đã decode hoặc dạng bọc
    const params = (reqResp && typeof reqResp === "object")
      ? (reqResp.params || reqResp.data?.params || reqResp.data || reqResp)
      : reqResp;

    if (String(reqResp?.status) === "2") {
      throw new ZaloApiError(`callGroup thất bại: ${reqResp?.msg || params?.msg || "status 2"}`);
    }
    const callSetting = params?.callSetting;
    if (!callSetting?.session || !Array.isArray(callSetting?.servers) || !callSetting.servers.length) {
      throw new ZaloApiError(`callGroup thiếu callSetting${params?.msg ? `: ${params.msg}` : ""}`);
    }

    const server = callSetting.servers[0] || {};
    const partnerIds = Array.isArray(reqResp?.partnerIds) ? reqResp.partnerIds : [];
    const idcal = trimStr(partnerIds[0] || ids[0]);
    const maxUsers = Number(params?.maxUsers) > 0 ? Number(params.maxUsers) : DEFAULT_MAX_USERS;

    const inner = JSON.stringify({
      groupAvatar: "",
      groupName,
      hostCall: params?.hostCall ?? "",
      maxUsers,
      noiseId: maybeOne(idcal),
    });
    const outer = JSON.stringify({
      codec: "",
      data: inner,
      extendData: "",
      rtcpAddress: trimStr(server.rtcpaddr),
      rtcpAddressIPv6: trimStr(server.rtcpaddrIPv6),
      rtpAddress: trimStr(server.rtpaddr),
      rtpAddressIPv6: trimStr(server.rtpaddrIPv6),
    });

    return vcPost(ctx, "/api/voicecall/group/request", {
      callId: params?.callId || callId,
      callType: 1,
      data: outer,
      session: callSetting.session,
      partners: JSON.stringify(maybeOne(idcal)),
      groupId: trimStr(groupId),
    });
  };
}
