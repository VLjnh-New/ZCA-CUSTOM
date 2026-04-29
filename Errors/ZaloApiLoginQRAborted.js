export class ZaloApiLoginQRAborted extends Error {
  constructor(message = "QR login aborted") {
    super(message);
    this.name = "ZaloApiLoginQRAborted";
  }
}
