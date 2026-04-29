import { ZaloApiError } from "../Errors/ZaloApiError.js";

export function setupFriend(api, ctx, utils) {
  const svc = api.zpwServiceMap;
  const friend = svc.friend?.[0];
  const profile = svc.profile?.[0];
  const alias = svc.alias?.[0];
  const friendBoard = svc.friend_board?.[0];

  const requireId = (v, name) => { if (!v) throw new ZaloApiError(`Thiếu ${name}`); };

  api.getAllFriends = (count = 20000, page = 1) =>
    utils.getEncrypted(`${profile}/api/social/friend/getfriends`, {
      incInvalid: 0, page, count, avatar_size: 240, actiontime: 0,
      imei: ctx.imei, language: ctx.language,
    });

  api.sendFriendRequest = (msg, userId) => {
    requireId(userId, "userId");
    return utils.postEncrypted(`${friend}/api/friend/sendreq`, {
      toid: userId, msg: msg || "", reqsrc: 30,
      imei: ctx.imei, language: ctx.language, src: 1,
    });
  };

  api.acceptFriendRequest = (friendId) => {
    requireId(friendId, "friendId");
    return utils.postEncrypted(`${friend}/api/friend/accept`, {
      fid: friendId, language: ctx.language,
    });
  };

  api.rejectFriendRequest = (friendId) => {
    requireId(friendId, "friendId");
    return utils.postEncrypted(`${friend}/api/friend/reject`, {
      fid: friendId, language: ctx.language,
    });
  };

  api.undoFriendRequest = (friendId) => {
    requireId(friendId, "friendId");
    return utils.postEncrypted(`${friend}/api/friend/undo`, {
      fid: friendId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.removeFriend = (friendId) => {
    requireId(friendId, "friendId");
    return utils.postEncrypted(`${friend}/api/friend/remove`, {
      fid: friendId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.blockUser = (userId) => {
    requireId(userId, "userId");
    return utils.postEncrypted(`${friend}/api/friend/block`, {
      fid: userId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.unblockUser = (userId) => {
    requireId(userId, "userId");
    return utils.postEncrypted(`${friend}/api/friend/unblock`, {
      fid: userId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.blockViewFeed = (isBlockFeed, userId) => {
    requireId(userId, "userId");
    return utils.postEncrypted(`${friend}/api/friend/feed/block`, {
      fid: userId, is_block_feed: isBlockFeed ? 1 : 0,
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.changeFriendAlias = (friendId, aliasName) => {
    requireId(friendId, "friendId");
    requireId(aliasName, "aliasName");
    return utils.getEncrypted(`${alias}/api/alias/update`, {
      friendId, alias: aliasName, imei: ctx.imei,
    });
  };

  api.getAliasList = (count = 100, page = 1) =>
    utils.getEncrypted(`${alias}/api/alias/list`, {
      count, page, imei: ctx.imei, language: ctx.language,
    });

  api.removeFriendAlias = (friendId) => {
    requireId(friendId, "friendId");
    return utils.getEncrypted(`${alias}/api/alias/remove`, {
      friendId, imei: ctx.imei,
    });
  };

  api.getQR = (userId) => {
    requireId(userId, "userId");
    return utils.getEncrypted(`${friend}/api/friend/mget-qr`, {
      fid: userId, avatar_size: 240, language: ctx.language,
    });
  };

  api.getFriendRequestStatus = (friendId) => {
    requireId(friendId, "friendId");
    return utils.getEncrypted(`${friend}/api/friend/reqstatus`, {
      fid: friendId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.getSentFriendRequest = () =>
    utils.getEncrypted(`${friend}/api/friend/requested/list`, {
      imei: ctx.imei, language: ctx.language,
    });

  api.getRelatedFriendGroup = (friendId) =>
    utils.postEncrypted(`${friend}/api/friend/group/related`, {
      fid: friendId, imei: ctx.imei, language: ctx.language,
    });

  api.getFriendRecommendations = () =>
    utils.getEncrypted(`${friend}/api/friend/recommendsv2/list`, {
      count: 50, page: 1, imei: ctx.imei, language: ctx.language,
    });

  api.getFriendBoardList = (conversationId) =>
    utils.getEncrypted(`${friendBoard}/api/friendboard/list`, {
      conversation_id: conversationId, imei: ctx.imei, language: ctx.language,
    });

  api.getQR = (userId) => {
    const fids = Array.isArray(userId) ? userId : [String(userId)];
    return utils.postEncrypted(`${friend}/api/friend/mget-qr`, { fids });
  };
  api.getQRLink = api.getQR;
  api.getQRZalo = api.getQR;
  api.fetchAllFriend = api.getAllFriends;
}
