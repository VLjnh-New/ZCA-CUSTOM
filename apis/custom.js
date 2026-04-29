import { apiFactory, encodeAES, makeURL, request, handleZaloResponse } from "../utils.js";

export const customFactory = apiFactory()((api, ctx) => {
  return function custom(name, handler) {
    if (typeof name !== "string" || !name) throw new Error("custom: tên không hợp lệ");
    if (typeof handler !== "function") throw new Error("custom: handler phải là function");

    api[name] = (props) =>
      handler({
        ctx,
        api,
        props,
        utils: {
          makeURL: (base, p) => makeURL(ctx, base, p),
          encodeAES: (data) => encodeAES(ctx.secretKey, data),
          request: (url, options) => request(ctx, url, options),
          resolve: (res) => handleZaloResponse(res, ctx),
        },
      });
    return api[name];
  };
});
