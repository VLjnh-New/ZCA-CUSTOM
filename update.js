import { compare } from "semver";
import fetch from "node-fetch";
import { logger } from "./utils.js";

const VERSION = "1.1.1";
const NPM_REGISTRY = "https://registry.npmjs.org/zca-custom";
const UPDATE_REPO = "https://github.com/VLjnh-New/ZCA-CUSTOM.git";

export async function checkUpdate(ctx) {
  if (!ctx.options.checkUpdate) return;
  const res = await fetch(NPM_REGISTRY).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json().catch(() => null);
  if (!data) return;

  const latest = data["dist-tags"].latest;
  if (compare(VERSION, latest) === -1) {
    logger(ctx).info(`Có phiên bản mới: ${latest} (đang dùng ${VERSION}). Cập nhật tại: ${UPDATE_REPO}`);
  } else {
    logger(ctx).info(`ZCA-CUSTOM đang ở bản mới nhất (${VERSION})`);
  }
}
