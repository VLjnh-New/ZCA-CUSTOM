export function setupLabel(api, ctx, utils) {
  const label = api.zpwServiceMap.label?.[0];

  api.getLabels = () =>
    utils.getEncrypted(`${label}/api/convlabel/get`, {
      imei: ctx.imei, language: ctx.language,
    });

  api.updateLabels = (payload) =>
    utils.postEncrypted(`${label}/api/convlabel/update`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });
}
