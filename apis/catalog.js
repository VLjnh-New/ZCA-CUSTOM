import fs from "fs";
import FormData from "form-data";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, getImageMetaData, request, resolveResponse, makeURL } from "../utils.js";

export function setupCatalog(api, ctx, utils) {
  const catalog = api.zpwServiceMap.catalog?.[0];
  const file = api.zpwServiceMap.file?.[0];

  api.createCatalog = (catalogName) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/catalog/create`, {
      catalog_name: catalogName, imei: ctx.imei, language: ctx.language,
    });

  api.updateCatalog = (payload) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/catalog/update`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.deleteCatalog = (catalogId) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/catalog/delete`, {
      catalog_id: catalogId, imei: ctx.imei, language: ctx.language,
    });

  api.getCatalogList = (payload = {}) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/catalog/list`, {
      version_list_catalog: 0,
      limit: payload.limit ?? 20,
      last_product_id: payload.lastProductId ?? -1,
      page: payload.page ?? 0,
    });

  api.createProductCatalog = (payload) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/product/create`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.updateProductCatalog = (payload) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/product/update`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.deleteProductCatalog = (payload) =>
    utils.postEncrypted(`${catalog}/api/prodcatalog/product/mdelete`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.getProductCatalogList = (payload) => {
    if (!payload?.catalogId) throw new ZaloApiError("Thiếu catalogId");
    return utils.postEncrypted(`${catalog}/api/prodcatalog/product/list`, {
      catalog_id: payload.catalogId,
      limit: payload.limit ?? 100,
      version_catalog: payload.versionCatalog ?? 0,
      last_product_id: payload.lastProductId ?? -1,
      page: payload.page ?? 0,
    });
  };

  api.uploadProductPhoto = async (filePath) => {
    if (!filePath) throw new ZaloApiError("Thiếu filePath");
    utils.requireSession();
    const meta = await getImageMetaData(filePath);
    const params = encodeAES(ctx.secretKey, JSON.stringify({
      totalSize: meta.totalSize, fileName: meta.fileName,
      width: meta.width || 480, height: meta.height || 480,
      imei: ctx.imei, language: ctx.language,
    }));
    const buf = await fs.promises.readFile(filePath);
    const fd = new FormData();
    fd.append("fileContent", buf, { filename: meta.fileName, contentType: "image/jpeg", knownLength: meta.totalSize });
    fd.append("params", params);
    const res = await request(ctx, makeURL(ctx, `${file}/api/product/upload/photo`), {
      method: "POST", headers: fd.getHeaders(), body: fd.getBuffer(),
    });
    return resolveResponse(ctx, res);
  };
}
