export function setupAutoReply(api, ctx, utils) {
  const ar = api.zpwServiceMap.auto_reply?.[0];

  api.createAutoReply = (payload) =>
    utils.postEncrypted(`${ar}/api/autoreply/create`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.updateAutoReply = (payload) =>
    utils.postEncrypted(`${ar}/api/autoreply/update`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.deleteAutoReply = (id) =>
    utils.postEncrypted(`${ar}/api/autoreply/delete`, {
      id, imei: ctx.imei, language: ctx.language,
    });

  api.getAutoReplyList = () =>
    utils.getEncrypted(`${ar}/api/autoreply/list`, {
      // field đúng là cliLang, không phải language
      version: 0, cliLang: ctx.language,
    });
}
