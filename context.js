const FIVE_MINUTES = 5 * 60 * 1000;

// callback upload nhỡ rớt sự kiện thì tự dọn sau 5 phút, tránh leak
class CallbacksMap extends Map {
  set(key, value, ttl = FIVE_MINUTES) {
    setTimeout(() => this.delete(key), ttl);
    return super.set(key, value);
  }
}

export function createContext(apiType = 30, apiVersion = 671) {
  return {
    API_TYPE: apiType,
    API_VERSION: apiVersion,
    imei: null,
    cookie: null,
    userAgent: null,
    language: "vi",
    secretKey: null,
    uid: null,
    uin: null,
    send2meId: null,
    settings: null,
    timeMessage: 0,
    uploadCallbacks: new CallbacksMap(),
    options: {
      selfListen: false,
      checkUpdate: true,
      logging: true,
    },
  };
}

export const appContext = createContext();

export function isContextReady(ctx) {
  return Boolean(ctx && ctx.secretKey && ctx.imei && ctx.cookie && ctx.userAgent);
}

export const MAX_MESSAGES_PER_SEND = 50;
