import fs from "fs";
import path from "path";
import FormData from "form-data";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, getImageMetaData, getFullTimeFromMilisecond, request, resolveResponse, makeURL } from "../utils.js";

const IMAGE_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png",  ".webp": "image/webp",
  ".gif": "image/gif",
};
function guessImageMime(filePath) {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()] || "image/jpeg";
}

export const UpdateLangAvailableLanguages = { VI: "vi", EN: "en" };

export function setupProfile(api, ctx, utils) {
  const { profile: profileSvc, file: fileSvc } = api.zpwServiceMap;
  const profile = profileSvc?.[0];
  const file = fileSvc?.[0];

  api.updateProfile = (payload) =>
    utils.postEncrypted(`${profile}/api/social/profile/update`, {
      ...payload, imei: ctx.imei, language: ctx.language,
    });

  api.updateProfileBio = (status) =>
    utils.postEncrypted(`${profile}/api/social/profile/status`, {
      status, imei: ctx.imei, language: ctx.language,
    });

  // Zalo trả error_code 114 (not supported) khá tuỳ tâm trạng — endpoint và
  // tên trường thay đổi theo phiên bản client. Quét qua các tổ hợp đã từng
  // hoạt động và bỏ qua riêng lỗi 114; lỗi khác ném ngay.
  api.updateBio = async (bio) => {
    const text = String(bio ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new ZaloApiError("Bio không được để trống");

    const endpoints = [
      `${profile}/api/social/profile/update`,
      `${profile}/api/user/status`,
      `${profile}/api/user/about`,
      `${profile}/api/user/update`,
      `${profile}/api/social/user/update`,
      `${profile}/api/profile/update`,
    ];
    const variants = [
      { bio: text },
      { description: text },
      { signature: text },
      { about: text },
      { status: text },
      { userAbout: text },
      { bio: text, userid: ctx.uid },
      { desc: text },
      { content: text },
      { text },
      { value: text },
      { bio: text, type: "bio" },
      { bio: text, action: "update_bio" },
      { bio: text, field: "bio" },
      { bio: text, what: "bio" },
      { bio: text, feature: "bio" },
    ];

    for (const url of endpoints) {
      for (const v of variants) {
        try {
          return await utils.postEncrypted(url, { ...v, imei: ctx.imei });
        } catch (e) {
          if (e?.code && e.code !== 114) throw e;
        }
      }
    }
    throw new ZaloApiError("Không thể cập nhật tiểu sử. Zalo có thể không hỗ trợ API này.");
  };

  api.changeAccountAvatar = async (avatarPath) => {
    if (!avatarPath) throw new ZaloApiError("Thiếu avatarPath");
    if (!fs.existsSync(avatarPath)) throw new ZaloApiError(`File không tồn tại: ${avatarPath}`);
    utils.requireSession();

    const meta = await getImageMetaData(avatarPath);
    if (!meta.totalSize) throw new ZaloApiError("File avatar rỗng");
    const w = meta.width  || 500;
    const h = meta.height || 500;
    if ((meta.width && meta.width < 240) || (meta.height && meta.height < 240)) {
      throw new ZaloApiError(`Avatar quá nhỏ (${meta.width}x${meta.height}). Tối thiểu 240x240.`);
    }

    const buf = await fs.promises.readFile(avatarPath);
    const size = buf.length;

    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const clientId = String(ctx.uid) +
      `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    const enc = encodeAES(ctx.secretKey, JSON.stringify({
      avatarSize: 120,
      clientId,
      language: ctx.language || "vi",
      metaData: JSON.stringify({
        origin:    { width: w, height: h },
        processed: { width: w, height: h, size },
      }),
    }));
    if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");

    const ext = path.extname(avatarPath).toLowerCase() || ".jpg";
    const url = makeURL(ctx, `${file}/api/profile/upavatar`) + `&params=${encodeURIComponent(enc)}`;

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append("fileContent", buf, {
          filename: `avatar${ext}`,
          contentType: "application/octet-stream",
        });
        const res = await request(ctx, url, {
          method: "POST",
          headers: fd.getHeaders(),
          body: fd.getBuffer(),
          timeout: 30000,
        });
        return await resolveResponse(ctx, res);
      } catch (e) {
        lastErr = e;
        const code = e?.code || e?.cause?.code || "";
        const msg  = String(e?.message || "");
        const retriable = ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EPIPE"]
          .some((c) => code === c || msg.includes(c));
        if (!retriable || attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw lastErr;
  };

  api.deleteAccountAvatar = (photoId) =>
    utils.getEncrypted(`${profile}/api/social/del-avatars`, {
      photoIds: Array.isArray(photoId) ? photoId : [photoId],
      imei: ctx.imei, language: ctx.language,
    });
  api.deleteAvatar = api.deleteAccountAvatar;

  api.reuseAvatar = (photoId) =>
    utils.getEncrypted(`${profile}/api/social/reuse-avatar`, {
      photoId, imei: ctx.imei, language: ctx.language,
    });

  api.getAvatarList = (count = 50, page = 1) =>
    utils.getEncrypted(`${profile}/api/social/avatar-list`, {
      count, page, imei: ctx.imei, language: ctx.language,
    });

  api.updateActiveStatus = (active) =>
    utils.postEncrypted(`${profile}/api/social/profile/ping`, {
      status: active ? 1 : 0, imei: ctx.imei, language: ctx.language,
    });

  api.deactivate = () =>
    utils.postEncrypted(`${profile}/api/social/profile/deactive`, {
      imei: ctx.imei, language: ctx.language,
    });

  api.updateLang = (language = "vi") =>
    utils.getEncrypted(`${profile}/api/social/profile/updatelang`, {
      lang: language, imei: ctx.imei, language: ctx.language,
    });

  api.getSettings = () =>
    utils.getEncrypted("https://wpa.chat.zalo.me/api/setting/me", {});

  api.updateSettings = (type, value) =>
    utils.getEncrypted("https://wpa.chat.zalo.me/api/setting/update", {
      type, value, imei: ctx.imei,
    });
}
