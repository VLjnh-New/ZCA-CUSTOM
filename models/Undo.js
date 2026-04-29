export class Undo {
  constructor(data, isSelf = false) {
    this.data = data;
    this.threadId = data.toUid || data.idTo;
    this.isSelf = isSelf;
  }
}
