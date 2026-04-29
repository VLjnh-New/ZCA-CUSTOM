import fs from "fs";
import path from "path";
import FormData from "form-data";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, getImageMetaData, getFullTimeFromMilisecond, request, resolveResponse, makeURL } from "../utils.js";

const _IMG_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png",  ".webp": "image/webp", ".gif": "image/gif",
};
const _guessImageMime = (p) => _IMG_MIME[path.extname(p).toLowerCase()] || "image/jpeg";

export const GroupSetting = {
  blockName: "blockName", signAdminMsg: "signAdminMsg", addMemberOnly: "addMemberOnly",
  setTopicOnly: "setTopicOnly", enableMsgHistory: "enableMsgHistory", lockCreatePost: "lockCreatePost",
  lockCreatePoll: "lockCreatePoll", joinAppr: "joinAppr", bannFeature: "bannFeature",
  dirMsgMode: "dirMsgMode", lockSendMsg: "lockSendMsg", lockViewMember: "lockViewMember",
};

export function setupGroup(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const group = svc.group?.[0];
  const file = svc.file?.[0];
  const cloud = svc.group_cloud_message?.[0];

  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };

  api.getAllGroups = () =>
    utils.getEncrypted(`${group}/api/group/getlg/v4`, {});

  api.getGroupInfo = (groupId) => {
    need(groupId, "groupId");
    const ids = Array.isArray(groupId) ? groupId : [groupId];
    // Endpoint chỉ nhận đúng 1 field gridVerMap – thêm imei/language là bị reject
    return utils.postEncrypted(`${group}/api/group/getmg-v2`, {
      gridVerMap: JSON.stringify(Object.fromEntries(ids.map((g) => [g, 0]))),
    });
  };

  api.getGroupMembers = (groupId) => {
    need(groupId, "groupId");
    return utils.postEncrypted(`${group}/api/group/getmg-v2`, {
      gridVerMap: JSON.stringify({ [groupId]: 0 }),
    });
  };

  api.getGroupChatHistory = (groupId, lastMsgId = 0, count = 50) =>
    utils.getEncrypted(`${cloud}/api/cm/getrecentv2`, {
      // Zalo cần đầy đủ globalMsgId (id mốc trên), msgIds (đã xem), src=1
      groupId: String(groupId),
      globalMsgId: lastMsgId ? Number(lastMsgId) : 10000000000000000,
      count, msgIds: [], imei: ctx.imei, src: 1,
    });

  api.createGroup = (members, groupName, description = "") => {
    need(members, "members");
    const mems = Array.isArray(members) ? members.map(String) : [String(members)];
    const name = groupName || "Default Group Name";
    return utils.postEncrypted(`${group}/api/group/create/v2`, {
      clientId: Date.now(),
      gname: name,
      gdesc: description,
      members: mems,
      memberTypes: mems.map(() => -1),
      nameChanged: groupName ? 1 : 0,
      createLink: 0,
      clientLang: ctx.language || "vi",
      imei: ctx.imei,
      zsource: 601,
    });
  };

  // Lưu ý thứ tự: (memberId, groupId) – đúng theo signature của ZCA-CUSTOM gốc
  api.addUserToGroup = (memberId, groupId) => {
    // Hỗ trợ luôn cách gọi đảo ngược cũ: nếu arg đầu trông giống groupId (string dài)
    // và arg sau là mảng/uid thì hoán đổi cho an toàn.
    if (groupId && Array.isArray(memberId) === false &&
        typeof memberId === "string" && memberId.length > 14 &&
        (Array.isArray(groupId) || (typeof groupId === "string" && groupId.length <= 19))) {
      const t = memberId; memberId = groupId; groupId = t;
    }
    need(groupId, "groupId");
    need(memberId, "memberId");
    const members = Array.isArray(memberId) ? memberId : [memberId];
    return utils.postEncrypted(`${group}/api/group/invite/v2`, {
      grid: String(groupId),
      members,
      memberTypes: members.map(() => -1), // field đúng là memberTypes (không có 's' ở giữa)
      imei: ctx.imei,
      clientLang: ctx.language,           // field đúng là clientLang, không phải language
    });
  };

  api.removeUserFromGroup = (groupId, members) => {
    need(groupId, "groupId");
    need(members, "members");
    return utils.postEncrypted(`${group}/api/group/kickout`, {
      grid: groupId, members: Array.isArray(members) ? members : [members],
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.changeGroupName = (groupId, name) => {
    need(groupId, "groupId");
    // Field đúng là `gname` (group name), không phải `name`
    return utils.postEncrypted(`${group}/api/group/updateinfo`, {
      gname: String(name || ""),
      grid: String(groupId),
    });
  };

  // Đổi avatar nhóm — schema khớp ZCA-CUSTOM gốc: payload phẳng đầy đủ
  // (photoId, width, height, rawSize, md5, imei, type, isAvatar360, desc) +
  // metaData JSON string. Thiếu bất kỳ field nào server sẽ trả "Tham số bị thiếu".
  api.changeGroupAvatar = async (avatarPath, groupId) => {
    need(avatarPath, "avatarPath");
    need(groupId, "groupId");
    if (!fs.existsSync(avatarPath)) throw new ZaloApiError(`File không tồn tại: ${avatarPath}`);
    utils.requireSession();

    const meta = await getImageMetaData(avatarPath);
    if (!meta.totalSize) throw new ZaloApiError("File avatar rỗng");

    const enc = encodeAES(ctx.secretKey, JSON.stringify({
      grid: String(groupId),
      avatarSize: 120,
      clientId: `g${groupId}${getFullTimeFromMilisecond(Date.now())}`,
      imei: ctx.imei,
      originWidth:  meta.width  || 1080,
      originHeight: meta.height || 1080,
    }));
    if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");

    const buf = await fs.promises.readFile(avatarPath);
    const fd = new FormData();
    fd.append("fileContent", buf, { filename: "blob", contentType: "image/jpeg" });

    const url = makeURL(ctx, `${file}/api/group/upavatar`) + `&params=${encodeURIComponent(enc)}`;
    const res = await request(ctx, url, {
      method: "POST", headers: fd.getHeaders(), body: fd.getBuffer(),
    });
    return resolveResponse(ctx, res);
  };

  api.changeGroupOwner = (groupId, newOwnerId) => {
    need(groupId, "groupId");
    need(newOwnerId, "newOwnerId");
    return utils.getEncrypted(`${group}/api/group/change-owner`, {
      grid: groupId, newAdminId: newOwnerId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.changeGroupSetting = (groupId, options) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/setting/update`, {
      grid: groupId, ...options, imei: ctx.imei, language: ctx.language,
    });
  };
  api.updateGroupSettings = api.changeGroupSetting;

  api.leaveGroup = (groupId, silent = false) => {
    need(groupId, "groupId");
    // Endpoint nhận mảng `grids` chứ không phải 1 `grid`; có thêm `silent`
    return utils.postEncrypted(`${group}/api/group/leave`, {
      grids: Array.isArray(groupId) ? groupId.map(String) : [String(groupId)],
      imei: ctx.imei,
      silent: silent ? 1 : 0,
    });
  };

  api.disperseGroup = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/disperse`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.upgradeGroupToCommunity = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/upgrade/community`, {
      grId: String(groupId), language: ctx.language || "vi",
    });
  };

  // Lưu ý: signature đặt userId trước cho khớp toàn bộ call site (.js gọi
  // theo dạng `(uid, threadId)`). Vẫn giữ heuristic phòng khi truyền đảo:
  // nếu arg đầu là mảng → coi như (groupIds, userId) cũ.
  api.inviteUserToGroups = (userId, groupIds) => {
    if (Array.isArray(userId) && !Array.isArray(groupIds)) {
      const t = userId; userId = groupIds; groupIds = t;
    }
    need(userId, "userId");
    need(groupIds, "groupIds");
    return utils.postEncrypted(`${group}/api/group/invite/multi`, {
      grids: Array.isArray(groupIds) ? groupIds : [groupIds],
      member: String(userId), imei: ctx.imei, language: ctx.language,
    });
  };

  api.addGroupAdmins = (groupId, memberIds) => {
    need(groupId, "groupId"); need(memberIds, "memberIds");
    return utils.getEncrypted(`${group}/api/group/admins/add`, {
      grid: groupId, members: Array.isArray(memberIds) ? memberIds : [memberIds],
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.removeGroupAdmins = (groupId, memberIds) => {
    need(groupId, "groupId"); need(memberIds, "memberIds");
    return utils.getEncrypted(`${group}/api/group/admins/remove`, {
      grid: groupId, members: Array.isArray(memberIds) ? memberIds : [memberIds],
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.addGroupDeputy = api.addGroupAdmins;
  api.removeGroupDeputy = api.removeGroupAdmins;

  api.blockUsersInGroup = (groupId, memberIds) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/blockedmems/add`, {
      grid: groupId, members: Array.isArray(memberIds) ? memberIds : [memberIds],
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.unblockUsersInGroup = (groupId, memberIds) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/blockedmems/remove`, {
      grid: groupId, members: Array.isArray(memberIds) ? memberIds : [memberIds],
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.getBlockedUsersInGroup = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/blockedmems/list`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.getGroupMembersJoinRequest = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/pending-mems/list`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };
  api.getPendingGroupMembers = api.getGroupMembersJoinRequest;

  api.handleGroupPendingMembers = (groupId, members, isAccept = true) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/pending-mems/review`, {
      grid: groupId,
      members: Array.isArray(members) ? members : [members],
      isApprove: isAccept ? 1 : 0,
      imei: ctx.imei, language: ctx.language,
    });
  };
  api.reviewPendingMemberRequest = api.handleGroupPendingMembers;

  api.changeGroupLink = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/link/new`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };
  api.enableGroupLink = api.changeGroupLink;

  api.disableGroupLink = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/link/disable`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.getGroupLinkDetail = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/link/detail`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.joinGroupByLink = (link, answer) => {
    need(link, "link");
    const params = { link, imei: ctx.imei, language: ctx.language };
    if (answer != null && String(answer).trim() !== "") params.answer = String(answer);
    return utils.getEncrypted(`${group}/api/group/link/join`, params);
  };
  api.joinGroup = api.joinGroupByLink;

  api.getGroupInfoByLink = (link) => {
    need(link, "link");
    return utils.getEncrypted(`${group}/api/group/link/ginfo`, {
      link, avatar_size: 120, member_avatar_size: 120, mpage: 1,
    });
  };
  api.getGroupLinkInfo = api.getGroupInfoByLink;
  api.getInfoGroupByLink = api.getGroupInfoByLink;

  api.joinGroupLink = api.joinGroupByLink;
  api.addGroupBlockedMember = api.blockUsersInGroup;
  api.removeGroupBlockedMember = api.unblockUsersInGroup;
  api.getGroupBlockedMember = (payload, groupId) =>
    api.getBlockedUsersInGroup(groupId ?? payload?.groupId ?? payload);
  api.getBlockedUsers = api.getBlockedUsersInGroup;
  api.fetchAllGroups = api.getAllGroups;

  api.getGroupInviteBoxList = (mpage = 1, page = 0, invPerPage = 12, mcount = 50, lastGroupId = "") =>
    utils.getEncrypted(`${group}/api/group/inv-box/list`, {
      mpage, page, invPerPage, mcount, lastGroupId,
      avatar_size: 120, member_avatar_size: 120,
    });
  api.getGroupInvites = api.getGroupInviteBoxList;

  api.getGroupInviteBoxInfo = (groupId) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/inv-box/inv-info`, {
      grid: groupId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.joinGroupInviteBox = (groupId) => {
    need(groupId, "groupId");
    return utils.postEncrypted(`${group}/api/group/inv-box/join`, {
      grid: String(groupId), lang: ctx.language || "vi",
    });
  };

  api.handleGroupInvite = (groupId, isAccept = true) => {
    need(groupId, "groupId");
    const endpoint = isAccept ? "join" : "mdel-inv";
    return utils.getEncrypted(`${group}/api/group/inv-box/${endpoint}`, {
      grid: String(groupId), imei: ctx.imei, language: ctx.language,
    });
  };

  api.deleteGroupInviteBox = (groupId, blockFutureInvite = false) => {
    need(groupId, "groupId");
    return utils.getEncrypted(`${group}/api/group/inv-box/mdel-inv`, {
      grids: [groupId], block: blockFutureInvite ? 1 : 0,
      imei: ctx.imei, language: ctx.language,
    });
  };
}
