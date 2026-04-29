export class ZaloApiError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "ZaloApiError";
    this.code = code;
  }
}
