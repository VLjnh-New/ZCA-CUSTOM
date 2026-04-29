import { ZaloApiError } from "../Errors/ZaloApiError.js";

export function setupPoll(api, ctx, utils) {
  const group = api.zpwServiceMap.group?.[0];
  const need = (v, n) => { if (!v) throw new ZaloApiError(`Thiếu ${n}`); };

  api.createPoll = (options, groupId) => {
    need(groupId, "groupId");
    need(options?.question, "options.question");
    need(options?.options, "options.options");
    // Endpoint dùng POST (form), không phải GET; field đúng là `is_hide_vote_preview`
    return utils.postEncrypted(`${group}/api/poll/create`, {
      group_id: String(groupId),
      question: options.question,
      options: options.options,
      expired_time: options.expiredTime || 0,
      pinAct: !!options.pinAct,
      allow_multi_choices: !!options.allowMultiChoices,
      allow_add_new_option: !!options.allowAddNewOption,
      is_hide_vote_preview: !!options.hideVotePreview,
      is_anonymous: !!options.isAnonymous,
      poll_type: 0,
      src: 1,
      imei: ctx.imei,
    });
  };

  api.votePoll = (pollId, optionIds, groupId) => {
    need(pollId, "pollId");
    const payload = {
      poll_id: pollId,
      option_ids: (Array.isArray(optionIds) ? optionIds : [optionIds]).map(Number),
      imei: ctx.imei,
    };
    if (groupId) payload.group_id = String(groupId);
    return utils.postEncrypted(`${group}/api/poll/vote`, payload);
  };

  api.lockPoll = (pollId) => {
    need(pollId, "pollId");
    return utils.postEncrypted(`${group}/api/poll/end`, {
      poll_id: pollId, imei: ctx.imei,
    });
  };

  api.getPollDetail = (pollId) => {
    need(pollId, "pollId");
    return utils.getEncrypted(`${group}/api/poll/detail`, {
      poll_id: pollId, imei: ctx.imei, language: ctx.language,
    });
  };

  api.addPollOptions = (payload) => {
    need(payload?.pollId, "payload.pollId");
    return utils.getEncrypted(`${group}/api/poll/option/add`, {
      poll_id: payload.pollId,
      options: payload.options,
      imei: ctx.imei, language: ctx.language,
    });
  };

  api.sharePoll = (pollId) => {
    need(pollId, "pollId");
    return utils.postEncrypted(`${group}/api/poll/share`, {
      poll_id: pollId, imei: ctx.imei, language: ctx.language,
    });
  };
}
