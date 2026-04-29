import fs from "fs";
import path from "path";
import FormData from "form-data";
import {
  encodeAES, request, resolveResponse, makeURL,
  getImageMetaData, getGifMetaData, getFileSize, getMd5LargeFileObject,
  getFileExtension, getFileInfoFromUrl,
  getImageInfoFromUrl, checkExtFromUrl, getMd5LargeFileFromUrl,
  getVideoMetadata,
} from "../utils.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { ThreadType } from "./reaction.js";

const IMG_EXT   = ["jpg", "jpeg", "png", "webp", "bmp"];
const VIDEO_EXT = ["mp4", "mov", "avi", "mkv", "webm", "3gp"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "amr"];

function classify(ext) {
  ext = ext.toLowerCase();
  if (IMG_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "gif") return "gif";
  return "file";
}

const URL_TYPE = {
  image:  "photo_original/upload",
  aac:    "voice/upload",
  video:  "asyncfile/upload",
  gif:    "gif",
  others: "asyncfile/upload",
};

const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_CONCURRENT = 99;
const PROGRESS_LOG_EVERY = 5; // log mỗi N chunks (đỡ noise)
// Voice >9MB không gửi được qua endpoint voice -> fallback asyncfile
const MAX_AAC_INLINE = 9 * 1000 * 1000;

export function setupMedia(api, ctx, utils) {
  const file = api.zpwServiceMap.file?.[0];

  // Upload 1 hoặc nhiều file. Trả object đơn nếu input là string, mảng nếu là mảng.
  // Chia chunk 3MB, song song có giới hạn, retry per-chunk + retry toàn bộ 1 lần.
  // Với video/audio/file thường: server trả fileId rồi đẩy URL thật qua WebSocket
  // — listener đăng ký vào ctx.uploadCallbacks để gom lại.
  api.uploadAttachment = async (input, threadId, type = ThreadType.User, isUseProphylactic = false) => {
    if (!input) throw new ZaloApiError("Thiếu filePath");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    utils.requireSession();

    const inputs = Array.isArray(input) ? input : [input];
    const isGroup = type === ThreadType.Group;
    const baseUrl = `${file}/api/${isGroup ? "group" : "message"}/`;
    const idKey = isGroup ? "grid" : "toid";
    const queryType = isGroup ? "11" : "2";

    const results = [];

    for (const filePath of inputs) {
      if (!fs.existsSync(filePath)) {
        throw new ZaloApiError(`Không tìm thấy file: ${filePath}`);
      }

      const ext = getFileExtension(filePath).toLowerCase();
      const fileSize = await getFileSize(filePath);
      const fileName = path.basename(filePath);

      let fileType = "others";
      let fallbackTail = "ljzi.aac";
      const kind = classify(ext);
      if (kind === "image") fileType = "image";
      else if (ext === "gif") fileType = "gif";
      else if (kind === "video") fileType = "video";
      else if (["mp3", "aac", "m4a"].includes(ext)) {
        if (fileSize > MAX_AAC_INLINE) {
          fileType = "others";
          fallbackTail = "ljzi.aac";
        } else {
          fileType = "aac";
        }
      }

      let fileData = { fileName, totalSize: fileSize };
      if (fileType === "image") {
        const m = await getImageMetaData(filePath).catch(() => ({}));
        fileData = { fileName, totalSize: fileSize, width: m.width || 480, height: m.height || 480 };
      } else if (fileType === "gif") {
        const m = await getGifMetaData(filePath).catch(() => ({}));
        fileData = { fileName, totalSize: fileSize, width: m.width || 200, height: m.height || 200 };
      }

      const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
      const clientId = Date.now();
      const fileBuffer = await fs.promises.readFile(filePath);

      const baseParams = {
        imei: ctx.imei,
        isE2EE: 0,
        jxl: 0,
        clientId,
        fileName,
        totalChunk: totalChunks,
        totalSize: fileSize,
        fileType,
        ...(fileType === "image" ? { originalWidth: fileData.width, originHeight: fileData.height } : {}),
        ...(fileType === "gif"   ? { width: fileData.width, height: fileData.height } : {}),
        [idKey]: String(threadId),
      };

      const runUpload = async () => {
        let finalRes = null;
        let uploadedChunks = 0;
        const startTime = Date.now();

        const uploadChunk = async (buf, chunkId) => {
          const enc = encodeAES(ctx.secretKey, JSON.stringify({ ...baseParams, chunkId }));
          if (!enc) throw new ZaloApiError("Mã hoá tham số thất bại");

          const fd = new FormData();
          fd.append("chunkContent", buf, { filename: fileName, contentType: "application/octet-stream" });
          const url = makeURL(ctx, `${baseUrl}${URL_TYPE[fileType]}`, { type: queryType, params: enc });

          let lastErr;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const res = await request(ctx, url, {
                method: "POST", headers: fd.getHeaders(), body: fd.getBuffer(),
              });
              const data = await resolveResponse(ctx, res);
              if (!data) return null;

              // Ảnh: trả thẳng khi chunk cuối finished
              if (data.photoId && data.finished) {
                finalRes = { fileType, ...fileData, ...data };
                return finalRes;
              }

              // Video/audio/file: chờ WS callback theo fileId mới có URL thật
              if (data.fileId && String(data.fileId) !== "-1") {
                return await new Promise((resolve) => {
                  ctx.uploadCallbacks.set(String(data.fileId), async (wsData) => {
                    const md5 = await getMd5LargeFileObject(filePath, fileSize).catch(() => ({ data: "" }));
                    const merged = { fileType, ...fileData, ...data, ...wsData, checksum: md5.data };
                    if (fallbackTail && merged.fileUrl && !merged.fileUrl.endsWith(fallbackTail)) {
                      merged.fileUrl = `${merged.fileUrl}/${fallbackTail}`;
                    }
                    finalRes = merged;
                    resolve(merged);
                  });
                });
              }
              return data;
            } catch (e) {
              lastErr = e;
              if (attempt < 4) await new Promise((r) => setTimeout(r, 1000 + attempt * 500));
            }
          }
          throw lastErr || new ZaloApiError(`Chunk ${chunkId} upload thất bại`);
        };

        const active = [];
        const chunkResults = [];
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const buf = fileBuffer.subarray(start, Math.min(start + CHUNK_SIZE, fileSize));
          const p = uploadChunk(buf, i + 1).then((r) => {
            chunkResults.push(r);
            uploadedChunks++;
            if (totalChunks > 1 && (uploadedChunks % PROGRESS_LOG_EVERY === 0 || uploadedChunks === totalChunks)) {
              const pct = ((uploadedChunks / totalChunks) * 100).toFixed(1);
              console.log(`[upload] ${fileName}: ${uploadedChunks}/${totalChunks} chunks (${pct}%)`);
            }
            return r;
          });
          active.push(p);
          p.finally(() => {
            const idx = active.indexOf(p);
            if (idx >= 0) active.splice(idx, 1);
          });
          if (active.length >= MAX_CONCURRENT) await Promise.race(active);
        }
        await Promise.all(active);

        const dur = (Date.now() - startTime) / 1000;
        if (totalChunks > 1 && dur > 0) {
          console.log(`[upload] ${fileName} done: ${totalChunks} chunks in ${dur.toFixed(2)}s (${(totalChunks / dur).toFixed(2)} chunk/s)`);
        }

        if (finalRes) return finalRes;
        const last = chunkResults.filter(Boolean).pop();
        if (last) return { fileType, ...fileData, ...last };
        throw new ZaloApiError("Upload thất bại: không có chunk nào thành công");
      };

      try {
        results.push(await runUpload());
      } catch (err) {
        try {
          await new Promise((r) => setTimeout(r, 1000));
          results.push(await runUpload());
        } catch (err2) {
          results.push({ error: true, message: err2.message, filePath });
        }
      }
    }

    if (results.length && results.every((r) => r.error)) {
      const reason = results.map((r) => r.message).filter(Boolean).join(" | ");
      throw new ZaloApiError(`Tất cả file đều upload thất bại${reason ? `: ${reason}` : ""}`);
    }
    // Luôn trả về MẢNG để callers dùng nhất quán results[0].fileUrl / .photoId / ...
    return results;
  };

  api.sendImage = async (input, threadId, type = ThreadType.User) => {
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    if (typeof input === "string") input = { src: input };
    const src = input.src || input.url || input.path;
    if (!src) throw new ZaloApiError("Thiếu src/url/path ảnh");

    const isGroup = type === ThreadType.Group;
    const idKey = isGroup ? "grid" : "toid";

    // URL path: gửi qua photo_original/send (chuẩn Zalo) — fetch metadata + hỗ trợ mentions
    if (/^https?:\/\//i.test(src)) {
      const meta = await getImageInfoFromUrl(src);
      const url = isGroup
        ? `${file}/api/group/photo_original/send`
        : `${file}/api/message/photo_original/send`;
      const params = {
        photoId: Math.floor(Date.now() / 1000),
        clientId: Date.now().toString(),
        desc: input.msg || "",
        width: meta.width || 500,
        height: meta.height || 500,
        rawUrl: src, thumbUrl: src, hdUrl: src,
        hdSize: String(meta.totalSize || 0),
        zsource: -1,
        jcp: JSON.stringify({ sendSource: 1, convertible: "jxl" }),
        ttl: input.ttl || 0,
        imei: ctx.imei,
        ...(isGroup ? { oriUrl: src } : { normalUrl: src }),
        [idKey]: String(threadId),
      };
      if (input.mentions) params.mentionInfo = JSON.stringify(input.mentions);
      return utils.postEncrypted(url, params);
    }

    const uploadRes = await api.uploadAttachment(src, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload ảnh thất bại");
    const url = isGroup
      ? `${file}/api/group/photo_original/send`
      : `${file}/api/message/photo_original/send`;
    const params = {
      [idKey]: String(threadId),
      photoId: upload.photoId,
      clientId: upload.clientId,
      msg: input.msg || "",
      thumbUrl: upload.thumbUrl, normalUrl: upload.normalUrl, hdUrl: upload.hdUrl,
      fileName: upload.fileName,
      imei: ctx.imei, language: ctx.language,
    };
    if (input.mentions) params.mentionInfo = JSON.stringify(input.mentions);
    return utils.postEncrypted(url, params);
  };

  api.sendMultiImage = async (imageUrls, threadId, type = ThreadType.User, options = {}) => {
    if (!Array.isArray(imageUrls)) imageUrls = [imageUrls];
    return Promise.all(imageUrls.map((src) =>
      api.sendImage({ src, msg: options.msg || "" }, threadId, type)
    ));
  };

  // Cho phép truyền URL HTTP(S) hoặc local filePath. URL: bypass upload, gửi thẳng
  // (tự fetch fileName/fileSize/extension/md5 từ remote)
  api.sendFile = async (input, threadId, type = ThreadType.User, msg = "") => {
    if (typeof input === "string") input = { src: input };
    const src = input.src || input.url || input.path || input.filePath;
    if (!src) throw new ZaloApiError("Thiếu src/url/filePath");
    const message = input.msg ?? msg ?? "";
    const isGroup = type === ThreadType.Group;
    const idKey = isGroup ? "grid" : "toid";
    const url = isGroup
      ? `${file}/api/group/asyncfile/msg`
      : `${file}/api/message/asyncfile/msg`;

    if (/^https?:\/\//i.test(src)) {
      const ext = input.extension || await checkExtFromUrl(src);
      const { fileName: rName, fileSize: rSize } = await getFileInfoFromUrl(src);
      const fileName = input.fileName || rName || `file.${ext}`;
      const fileSize = Number(input.fileSize || rSize || 0);
      const md5 = input.md5 || (fileSize > 0 ? (await getMd5LargeFileFromUrl(src, fileSize).catch(() => ({ data: "" }))).data : "");
      const params = {
        [idKey]: String(threadId),
        fileId: Date.now() * 600,
        checksum: md5,
        checksumSha: "",
        extension: ext,
        totalSize: fileSize,
        fileName,
        clientId: Date.now().toString(),
        fType: 1, fileCount: 0, fdata: "{}",
        fileUrl: src,
        zsource: 402,
        ttl: input.ttl || 0,
        msg: message,
        imei: ctx.imei, language: ctx.language,
      };
      if (input.mentions) params.mentionInfo = JSON.stringify(input.mentions);
      return utils.postEncrypted(url, params);
    }

    const uploadRes = await api.uploadAttachment(src, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload file thất bại");
    return utils.postEncrypted(url, {
      [idKey]: String(threadId),
      fileId: upload.fileId,
      clientId: upload.clientId,
      fileName: upload.fileName,
      checksum: upload.checksum,
      totalSize: upload.totalSize,
      fileUrl: upload.fileUrl,
      msg: message,
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendVideo = async (input, threadId, type = ThreadType.User) => {
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    if (typeof input === "string") input = { src: input };
    const src = input.src || input.url || input.path;
    if (!src) throw new ZaloApiError("Thiếu src video");

    const idKey = type === ThreadType.User ? "toid" : "grid";

    if (/^https?:\/\//i.test(src)) {
      const info = await getFileInfoFromUrl(src).catch(() => ({ fileName: "video.mp4", fileSize: 0 }));
      const isGroup = type === ThreadType.Group;
      const url = isGroup
        ? `${file}/api/group/forward`
        : `${file}/api/message/forward`;
      const thumb = input.thumb || src.replace(/\.[^/.]+$/, ".jpg");
      const params = {
        clientId: Date.now().toString(),
        ttl: input.ttl || 0,
        zsource: 704,
        msgType: 5,
        msgInfo: JSON.stringify({
          videoUrl: String(src),
          thumbUrl: String(thumb),
          duration: Number(input.duration || 0),
          width: Number(input.width || 1280),
          height: Number(input.height || 720),
          fileSize: Number(info.fileSize || 0),
          properties: {
            color: -1, size: -1, type: 1003, subType: 0,
            ext: { sSrcType: -1, sSrcStr: "", msg_warning_type: 0 },
          },
          title: input.msg || "",
        }),
        imei: ctx.imei,
      };
      if (isGroup) { params.grid = String(threadId); params.visibility = 0; }
      else params.toId = String(threadId);
      if (input.mentions) params.mentionInfo = JSON.stringify(input.mentions);
      return utils.postEncrypted(url, params);
    }

    const uploadRes = await api.uploadAttachment(src, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload video thất bại");
    // Probe metadata thật (width/height/duration) bằng ffprobe — không bắt buộc, fail thì bỏ qua.
    let vmeta = null;
    try { vmeta = await getVideoMetadata(src); } catch {}
    const url = type === ThreadType.User
      ? `${file}/api/message/asyncfile/msg`
      : `${file}/api/group/asyncfile/msg`;
    const sendParams = {
      [idKey]: String(threadId),
      fileId: upload.fileId, clientId: upload.clientId,
      fileName: upload.fileName, totalSize: upload.totalSize,
      checksum: upload.checksum, fileUrl: upload.fileUrl,
      msg: input.msg || "",
      imei: ctx.imei, language: ctx.language,
    };
    if (vmeta) {
      sendParams.width    = Number(input.width    || vmeta.width    || 0);
      sendParams.height   = Number(input.height   || vmeta.height   || 0);
      sendParams.duration = Number(input.duration || vmeta.duration || 0);
    }
    if (input.mentions) sendParams.mentionInfo = JSON.stringify(input.mentions);
    return utils.postEncrypted(url, sendParams);
  };

  // Cho phép truyền URL HTTP(S) hoặc local filePath
  // Local: upload qua zcloud → forward msgType=31. URL: HEAD lấy fileSize → forward thẳng
  api.sendVoice = async (input, threadId, type = ThreadType.User) => {
    if (typeof input === "string") input = { src: input };
    const src = input.src || input.url || input.path || input.filePath;
    if (!src) throw new ZaloApiError("Thiếu src/url/filePath voice");
    const isGroup = type === ThreadType.Group;
    const idKey = isGroup ? "grid" : "toid";

    if (/^https?:\/\//i.test(src)) {
      const info = await getFileInfoFromUrl(src).catch(() => ({ fileSize: 0 }));
      const url = isGroup
        ? `${file}/api/group/forward`
        : `${file}/api/message/forward`;
      const params = {
        [idKey]: String(threadId),
        ttl: input.ttl || 0,
        zsource: -1,
        msgType: 3,
        clientId: Date.now().toString(),
        msgInfo: JSON.stringify({
          voiceUrl: String(src),
          m4aUrl: String(src),
          fileSize: Number(info.fileSize || 0),
        }),
        imei: ctx.imei,
        ...(isGroup ? { visibility: 0 } : {}),
      };
      return utils.postEncrypted(url, params);
    }

    const uploadRes = await api.uploadAttachment(src, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload voice thất bại");
    const url = isGroup
      ? `${file}/api/group/forward`
      : `${file}/api/message/forward`;
    return utils.postEncrypted(url, {
      [idKey]: String(threadId),
      msgInfo: JSON.stringify({
        voiceUrl: upload.fileUrl, m4aUrl: upload.fileUrl, fileSize: upload.totalSize,
      }),
      msgType: 31, clientId: upload.clientId,
      imei: ctx.imei, language: ctx.language,
    });
  };

  // Wrapper "Unified" — chữ ký { filePath, threadId, threadType } cho các module gọi thống nhất
  api.sendVoiceUnified = ({ filePath, threadId, threadType = ThreadType.User } = {}) => {
    if (!filePath) throw new ZaloApiError("Thiếu filePath");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    return api.sendVoice(filePath, String(threadId), threadType);
  };

  api.sendVideoUnified = ({ videoPath, src, msg, threadId, threadType = ThreadType.User, mentions, ttl, duration, width, height, thumb } = {}) => {
    const path = videoPath || src;
    if (!path) throw new ZaloApiError("Thiếu videoPath");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    return api.sendVideo({ src: path, msg, mentions, ttl, duration, width, height, thumb }, String(threadId), threadType);
  };

  api.sendGif = async (filePath, threadId, type = ThreadType.User) => {
    const uploadRes = await api.uploadAttachment(filePath, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload gif thất bại");
    const idKey = type === ThreadType.User ? "toid" : "grid";
    const url = type === ThreadType.User
      ? `${file}/api/message/gif`
      : `${file}/api/group/gif`;
    return utils.postEncrypted(url, {
      [idKey]: String(threadId),
      gifUrl: upload.fileUrl || upload.gifUrl,
      width: upload.width, height: upload.height,
      clientId: upload.clientId, fileName: upload.fileName,
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sendCustomerSticker = (staticImgUrl, animationImgUrl, threadId, type = ThreadType.User, opts = {}) => {
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    if (!staticImgUrl) throw new ZaloApiError("Thiếu staticImgUrl");
    const animUrl = animationImgUrl || staticImgUrl;
    const { width = 512, height = 512, ttl = 0, noAI = false, quote } = opts;
    const isGroup = type === ThreadType.Group;
    const url = isGroup
      ? `${file}/api/group/photo_url`
      : `${file}/api/message/photo_url`;

    const params = {
      clientId: Date.now(),
      title: "",
      oriUrl: staticImgUrl,
      thumbUrl: staticImgUrl,
      hdUrl: staticImgUrl,
      width: parseInt(width),
      height: parseInt(height),
      properties: JSON.stringify({
        subType: 0, color: -1, size: -1, type: 3,
        ext: JSON.stringify({ sSrcStr: "@STICKER", sSrcType: 0 }),
      }),
      contentId: Date.now(),
      thumb_height: parseInt(height),
      thumb_width: parseInt(width),
      webp: JSON.stringify({ width: parseInt(width), height: parseInt(height), url: animUrl }),
      zsource: -1,
      ttl,
    };

    // jcp.pStickerType báo server đây là sticker do AI sinh; bỏ đi nếu ảnh tự upload
    if (!noAI) params.jcp = JSON.stringify({ pStickerType: 1 });
    if (quote?.cliMsgId) params.refMessage = String(quote.cliMsgId);

    if (isGroup) { params.grid = String(threadId); params.visibility = 0; }
    else params.toId = String(threadId);

    return utils.postEncrypted(url, params);
  };

  api.checkImage = async (imageInput) => {
    try {
      if (typeof imageInput === "string" && fs.existsSync(imageInput)) {
        const meta = await getImageMetaData(imageInput);
        return { valid: true, ...meta };
      }
      return { valid: false, error: "Không phải file ảnh hợp lệ" };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  };

  api.uploadThumbnail = async (filePath, threadId, type = ThreadType.User) => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new ZaloApiError("Không tìm thấy file thumbnail");
    }
    const url = type === ThreadType.User
      ? `${file}/api/message/upthumb`
      : `${file}/api/group/upthumb`;
    const fd = new FormData();
    fd.append("fileContent", fs.readFileSync(filePath), { filename: "blob", contentType: "image/png" });
    return utils.postEncrypted(url, {
      [type === ThreadType.User ? "toid" : "grid"]: String(threadId),
      imei: ctx.imei, language: ctx.language,
    }, { formData: fd });
  };

  api.sendLocalImage = async (imagePath, threadId, type = ThreadType.User, options = {}) => {
    if (!imagePath) throw new ZaloApiError("Thiếu imagePath");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");

    const uploadRes = await api.uploadAttachment(imagePath, threadId, type);
    const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
    if (!upload) throw new ZaloApiError("Upload ảnh thất bại");

    const isGroup = type === ThreadType.Group;
    const url = `${file}/api/${isGroup ? "group" : "message"}/photo_original/send`;

    const params = {
      photoId: upload.photoId || Math.floor(Date.now() / 1000),
      clientId: upload.clientId || String(Date.now()),
      desc: options.msg || "",
      width: options.width || upload.originalWidth || 2560,
      height: options.height || upload.originHeight || 2560,
      rawUrl: upload.normalUrl,
      thumbUrl: upload.thumbUrl,
      hdUrl: upload.hdUrl,
      thumbSize: String(upload.totalSize || 53932),
      hdSize: String(upload.hdSize || upload.totalSize || 344622),
      zsource: -1,
      jcp: JSON.stringify({ sendSource: 1, convertible: "jxl" }),
      ttl: options.ttl || 0,
      imei: ctx.imei,
    };

    if (isGroup) {
      params.grid = String(threadId);
      params.oriUrl = upload.normalUrl;
    } else {
      params.toid = String(threadId);
      params.normalUrl = upload.normalUrl;
    }
    if (options.mentions) params.mentionInfo = JSON.stringify(options.mentions);

    return utils.postEncrypted(url, params, { extraQuery: { nretry: 0 } });
  };

  api.sendMultiLocalImage = async (imagePaths, threadId, type = ThreadType.User, options = {}) => {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new ZaloApiError("imagePaths không được rỗng");
    }
    if (!threadId) throw new ZaloApiError("Thiếu threadId");

    const isGroup = type === ThreadType.Group;
    const groupLayoutId = String(Date.now());
    const results = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const uploadRes = await api.uploadAttachment(imagePaths[i], threadId, type);
      const upload = Array.isArray(uploadRes) ? uploadRes[0] : uploadRes;
      if (!upload) throw new ZaloApiError(`Upload ảnh thất bại: ${imagePaths[i]}`);

      const url = `${file}/api/${isGroup ? "group" : "message"}/photo_original/send`;
      const params = {
        photoId: upload.photoId || Math.floor(Date.now() / 1000),
        clientId: upload.clientId || String(Date.now() + i),
        desc: options.msg || "",
        width: upload.originalWidth || 2560,
        height: upload.originHeight || 2560,
        groupLayoutId,
        totalItemInGroup: imagePaths.length,
        isGroupLayout: 1,
        idInGroup: i,
        rawUrl: upload.normalUrl,
        thumbUrl: upload.thumbUrl,
        hdUrl: upload.hdUrl,
        thumbSize: String(upload.totalSize || 53932),
        hdSize: String(upload.hdSize || upload.totalSize || 344622),
        zsource: -1,
        jcp: JSON.stringify({ sendSource: 1, convertible: "jxl" }),
        ttl: options.ttl || 0,
        imei: ctx.imei,
      };

      if (isGroup) {
        params.grid = String(threadId);
        params.oriUrl = upload.normalUrl;
      } else {
        params.toid = String(threadId);
        params.normalUrl = upload.normalUrl;
      }
      if (options.mentions) params.mentionInfo = JSON.stringify(options.mentions);

      results.push(await utils.postEncrypted(url, params, { extraQuery: { nretry: 0 } }));
    }
    return results;
  };

  api.sendCustomSticker = api.sendCustomerSticker;

  // ─── Trợ giúp upload voice (chỉ trả URL/ID, không gửi tin) ────────────────
  api.uploadVoice = async ({ filePath, threadId, threadType }) => {
    const results = await api.uploadAttachment(filePath, threadId, threadType);
    if (!results?.length) throw new ZaloApiError("Upload voice thất bại");
    const r = results[0];
    return { voiceId: r.fileId, voiceUrl: r.fileUrl || r.url };
  };

  // ─── Gửi voice "native" qua /forward msgType=3 (cho phép truyền sẵn URL) ──
  api.sendVoiceNative = async ({ voiceUrl, threadId, threadType, duration = 0, fileSize = 0, ttl = 1800000 }) => {
    if (!voiceUrl) throw new ZaloApiError("Thiếu voiceUrl");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    const isGroup = threadType === ThreadType.Group;
    const msgInfo = {
      voiceUrl: String(voiceUrl),
      m4aUrl:   String(voiceUrl),
      fileSize: Number(fileSize) || 0,
      duration: Number(duration) || 0,
    };
    const base = {
      ttl: Number(ttl), zsource: -1, msgType: 3,
      clientId: Date.now().toString(),
      msgInfo: JSON.stringify(msgInfo),
      imei: ctx.imei,
    };
    const params = isGroup
      ? { grid: String(threadId), visibility: 0, ...base }
      : { toId: String(threadId), ...base };
    const url = `${file}/api/${isGroup ? "group" : "message"}/forward`;
    return utils.postEncrypted(url, params, { extraQuery: { nretry: 0 } });
  };

  // ─── Gửi ảnh từ URL (dùng photo_url) — không cần upload local ─────────────
  api.sendImageEnhanced = async ({ imageUrl, threadId, threadType, width = 720, height = 1280, msg = "" }) => {
    if (!imageUrl) throw new ZaloApiError("Thiếu imageUrl");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    const isGroup = threadType === ThreadType.Group;
    const u = String(imageUrl);
    const payload = {
      clientId: Date.now().toString(),
      desc: msg,
      oriUrl: u, thumbUrl: u, hdUrl: u, normalUrl: u, url: u,
      width: Number(width), height: Number(height),
      zsource: -1, ttl: 0,
    };
    if (isGroup) { payload.grid = String(threadId); payload.visibility = 0; }
    else         { payload.toId = String(threadId); }
    const url = `${file}/api/${isGroup ? "group" : "message"}/photo_url`;
    return utils.postEncrypted(url, payload, { extraQuery: { nretry: 0 } });
  };

  // ─── Gửi video player từ URL có sẵn (msgType=5, /forward) ─────────────────
  api.sendVideoEnhanced = async ({ videoUrl, thumbnailUrl, duration = 0, width = 720, height = 1280, fileSize = 0, msg = "", threadId, threadType }) => {
    if (!videoUrl) throw new ZaloApiError("Thiếu videoUrl");
    if (!threadId) throw new ZaloApiError("Thiếu threadId");
    const isGroup = threadType === ThreadType.Group;
    const msgInfo = JSON.stringify({
      videoUrl,
      thumbUrl: thumbnailUrl,
      duration: Math.floor(Number(duration) || 0),
      width:    Math.floor(Number(width)    || 720),
      height:   Math.floor(Number(height)   || 1280),
      fileSize: Math.floor(Number(fileSize) || 0),
      properties: { color: -1, size: -1, type: 1003, subType: 0, ext: { sSrcType: -1, sSrcStr: "", msg_warning_type: 0 } },
      title: msg || "",
    });
    const base = {
      clientId: String(Date.now()),
      ttl: 0, zsource: 704, msgType: 5,
      msgInfo, imei: ctx.imei,
    };
    const params = isGroup
      ? { grid: String(threadId), visibility: 0, ...base }
      : { toId: String(threadId), title: msg || "", ...base };
    const url = `${file}/api/${isGroup ? "group" : "message"}/forward`;
    return utils.postEncrypted(url, params, { extraQuery: { nretry: 0 } });
  };
}
