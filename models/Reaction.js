export const ReactionMap = {
  UNDO:               { text: "",         rType: -1  },
  HAHA:               { text: ":>",       rType: 0   },
  NGAI_NHIEN:         { text: "--b",      rType: 1   },
  KHOC:               { text: ":-((",     rType: 2   },
  LIKE:               { text: "/-strong", rType: 3   },
  DISLIKE:            { text: "/-weak",   rType: 4   },
  HEART:              { text: "/-heart",  rType: 5   },
  SMILE:              { text: ":d",       rType: 6   },
  CUOI_RA_NUOC_MAT:   { text: ":')",      rType: 7   },
  TEARS_OF_JOY:       { text: ":')",      rType: 7   },
  MISS:               { text: ":-*",      rType: 8   },
  KISS:               { text: ":-*",      rType: 8   },
  HANH_PHUC:          { text: ":3",       rType: 9   },
  SEE_LOVE:           { text: ":b",       rType: 10  },
  THINH:              { text: ";d",       rType: 11  },
  SO:                 { text: ":~",       rType: 12  },
  CUOI_BIT_MIENG:     { text: ";p",       rType: 13  },
  CHU_MO:             { text: ":*",       rType: 14  },
  LO_LANG:            { text: ";o",       rType: 15  },
  RUNG_NUOC_MAT:      { text: ":((",      rType: 16  },
  CRY:                { text: ":((",      rType: 16  },
  CUOI_NHE:           { text: ":)",       rType: 17  },
  LE_LUOI:            { text: ":p",       rType: 18  },
  NGAI_NGUNG:         { text: ":$",       rType: 19  },
  GIAN:               { text: ":-h",      rType: 20  },
  ANGRY:              { text: ":-h",      rType: 20  },
  CUOI_GIAN:          { text: "x-)",      rType: 21  },
  COOL_NGAU:          { text: "8-)",      rType: 22  },
  COOL:               { text: "8-)",      rType: 22  },
  SUNG_SUONG:         { text: ";-d",      rType: 23  },
  DOI:                { text: ":q",       rType: 24  },
  BUON:               { text: ":(",       rType: 25  },
  CUOI_HIEM:          { text: "b-)",      rType: 26  },
  THAC_MAC:           { text: ";?",       rType: 27  },
  WOW:                { text: ":o",       rType: 32  },
  NGU:                { text: ":z",       rType: 33  },
  CLOCK:              { text: "🕑",       rType: 55  },
  TIEU_TAN:           { text: ";!",       rType: 56  },
  TIA_SET:            { text: "/-li",     rType: 67  },
  OK:                 { text: "/-ok",     rType: 68  },
  NONE:               { text: "",         rType: 75  },
  HOA_HONG:           { text: "/-rose",   rType: 100 },
  ROSE:               { text: "/-rose",   rType: 100 },
  THANKS:             { text: "/-thanks", rType: 111 },
  DIAMOND:            { text: "💎",       rType: 100 },
  VIETNAM:            { text: "🇻🇳",      rType: 100 },
};

export const Reactions = Object.fromEntries(
  Object.entries(ReactionMap).map(([k, v]) => [k, v.text])
);

export class Reaction {
  constructor(data, isGroup, selfUid = null) {
    this.data = data;
    this.threadId = data.uidFrom === "0" ? data.idTo : data.uidFrom;
    this.isSelf = data.uidFrom === "0";
    this.isGroup = isGroup;
    if (selfUid) {
      if (data.idTo === "0") data.idTo = selfUid;
      if (data.uidFrom === "0") data.uidFrom = selfUid;
    }
  }
}
