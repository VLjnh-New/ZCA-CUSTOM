import { ZaloApiError } from "../Errors/ZaloApiError.js";

const AVATAR_LARGE = "https://s120-ava-talk.zadn.vn/default";

export function setupUser(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const profile = svc.profile?.[0];
  const friend = svc.friend?.[0];

  api.getOwnId = () => ctx.uid;

  api.getCookie = () => ctx.cookie;

  api.fetchAccountInfo = () =>
    utils.getEncrypted(`${profile}/api/social/profile/me-v2`, {});

  api.getUserInfo = (userId, avatarSize = 120) => {
    if (!userId) throw new ZaloApiError("Thiếu userId");
    const ids = (Array.isArray(userId) ? userId : [userId]).map((id) =>
      String(id).includes("_") ? String(id) : `${id}_0`
    );
    return utils.postEncrypted(`${profile}/api/social/friend/getprofiles/v2`, {
      phonebook_version: ctx.extraVer?.phonebook ?? 0,
      friend_pversion_map: ids,
      avatar_size: avatarSize,
      language: ctx.language,
      show_online_status: 1,
      imei: ctx.imei,
    });
  };

  api.findUser = (phoneNumber, avatarSize = 240) => {
    if (!phoneNumber) throw new ZaloApiError("Thiếu phoneNumber");
    let phone = String(phoneNumber);
    if (phone.startsWith("0") && ctx.language === "vi") phone = "84" + phone.slice(1);
    // Bản gốc gọi GET (qua querystring `params=...`) chứ không phải POST,
    // và có thêm reqSrc=40 để server không từ chối.
    return utils.getEncrypted(`${friend}/api/friend/profile/get`, {
      phone,
      avatar_size: avatarSize,
      language: ctx.language,
      imei: ctx.imei,
      reqSrc: 40,
    }, {
      // Server trả error.code=216 khi không tìm thấy số → trả null thay vì throw
      mapResult: (data) => {
        if (data && data.error && data.error.code && data.error.code !== 216) {
          throw new ZaloApiError(data.error.message, data.error.code);
        }
        return data?.data ?? data;
      },
    });
  };

  api.findUserByUsername = (username, avatarSize = 240) =>
    utils.getEncrypted(`${friend}/api/friend/search/by-user-name`, {
      keyword: username, avatar_size: avatarSize, imei: ctx.imei, language: ctx.language,
    });

  api.getMultiUsersByPhones = (phoneNumbers, avatarSize = 240) =>
    utils.getEncrypted(`${friend}/api/friend/profile/multiget`, {
      phones: Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers],
      avatar_size: avatarSize, language: ctx.language, imei: ctx.imei,
    });

  api.lastOnline = (uid) =>
    utils.getEncrypted(`${profile}/api/social/profile/lastOnline`, {
      fid: uid, imei: ctx.imei, language: ctx.language,
    });

  api.getFriendOnlines = () =>
    utils.getEncrypted(`${profile}/api/social/friend/onlines`, {
      efr: 1, imei: ctx.imei, language: ctx.language,
    });

  api.getCloseFriends = () =>
    utils.getEncrypted(`${profile}/api/social/friend/getclosedfriends`, {});

  api.getBizAccount = (friendId) => {
    if (!friendId) throw new ZaloApiError("Thiếu friendId");
    return utils.postEncrypted(`${profile}/api/social/friend/get-bizacc`, { fid: friendId });
  };

  api.getFullAvatar = (friendId) =>
    utils.getEncrypted(`${profile}/api/social/profile/avatar`, {
      fid: friendId, imei: ctx.imei, language: ctx.language,
    });

  api.getAvatarUrlProfile = (friendIds, avatarSize = 240) =>
    utils.getEncrypted(`${profile}/api/social/profile/avatar-url`, {
      // field đúng là friend_ids + srcReq, KHÔNG có imei/language
      friend_ids: Array.isArray(friendIds) ? friendIds : [friendIds],
      avatar_size: avatarSize,
      srcReq: -1,
    });

  api.getGroupMembersInfo = (memberId) =>
    utils.getEncrypted(`${profile}/api/social/group/members`, {
      uids: Array.isArray(memberId) ? memberId : [memberId],
      avatar_size: 240, language: ctx.language,
    });
}

export const AvatarSize = { Small: 120, Medium: 180, Large: 240, ExtraLarge: 720 };
