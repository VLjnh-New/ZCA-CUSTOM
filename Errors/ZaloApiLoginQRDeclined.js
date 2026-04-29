export class ZaloApiLoginQRDeclined extends Error {
  constructor(message = "QR login declined on phone") {
    super(message);
    this.name = "ZaloApiLoginQRDeclined";
  }
}
