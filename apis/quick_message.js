export function setupQuickMessage(api, ctx, utils) {
  const qm = api.zpwServiceMap.quick_message?.[0];

  api.addQuickMessage = (addPayload) =>
    utils.getEncrypted(`${qm}/api/quickmessage/create`, {
      ...addPayload, imei: ctx.imei, language: ctx.language,
    });

  api.updateQuickMessage = (updatePayload, itemId) =>
    utils.getEncrypted(`${qm}/api/quickmessage/update`, {
      item_id: itemId, ...updatePayload,
      imei: ctx.imei, language: ctx.language,
    });

  api.removeQuickMessage = (itemIds) =>
    utils.getEncrypted(`${qm}/api/quickmessage/delete`, {
      item_ids: Array.isArray(itemIds) ? itemIds : [itemIds],
      imei: ctx.imei, language: ctx.language,
    });

  api.getQuickMessageList = () =>
    utils.getEncrypted(`${qm}/api/quickmessage/list`, {
      imei: ctx.imei, language: ctx.language,
    });
}
