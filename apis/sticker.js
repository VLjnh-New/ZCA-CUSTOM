export function setupSticker(api, ctx, utils) {
  const sticker = api.zpwServiceMap.sticker?.[0] || api.zpwServiceMap.sticker;

  api.getStickers = (keyword) => {
    if (!keyword) throw new Error("Thiếu keyword");
    return utils.getEncrypted(
      `${sticker}/api/message/sticker/suggest/stickers`,
      { keyword, gif: 1, guggy: 0, imei: ctx.imei },
      {
        mapResult: (data) =>
          (data?.sugg_sticker || []).map((s) => s.sticker_id),
      }
    );
  };

  // Endpoint sticker_detail dùng field viết tắt `sid`, không phải sticker_id;
  // và không nhận imei/language – dư field sẽ bị server từ chối.
  api.getStickersDetail = (stickerId) =>
    utils.getEncrypted(`${sticker}/api/message/sticker/sticker_detail`, {
      sid: Number(stickerId),
    });

  api.searchSticker = (keyword, limit = 50) =>
    utils.getEncrypted(`${sticker}/api/message/sticker/search`, {
      keyword, limit, srcType: 0, imei: ctx.imei,
    });

  api.getStickerCategoryDetail = (cateId) =>
    utils.getEncrypted(`${sticker}/api/message/sticker/category/sticker_detail`, {
      cid: cateId,
    });

  api.updatePersonalSticker = (cateIds, version = 0) =>
    utils.getEncrypted(`${sticker}/api/message/sticker/personalized/update`, {
      sticker_cates: (Array.isArray(cateIds) ? cateIds : [cateIds]).map(Number),
      version, imei: ctx.imei,
    });
}
