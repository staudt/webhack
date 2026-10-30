// English text for damage types, resistances, passive attacks, stun and intrinsics.
// ref: src/mhitu.c, src/uhitm.c, src/attrib.c, src/potion.c, src/timeout.c, src/eat.c
export const resistMessagesEn: Record<string, string> = {
  // hitmu(): the special damage types. ref: src/uhitm.c mhitm_ad_*()
  'mhitu.avoid_harm': 'You avoid harm.',
  'mhitu.zapped': 'You get zapped!',
  'mhitu.zap_no_shock': "The zap doesn't shock you!",
  'mhitu.on_fire': "You're {how}!",
  'mhitu.fire': 'on fire',
  'mhitu.roasted': 'being roasted',
  'mhitu.fire_not_hot': "The fire doesn't feel hot!",
  'mhitu.frost': "You're covered in frost!",
  'mhitu.frost_not_cold': "The frost doesn't seem cold!",
  'mhitu.acid_harmless': "You're covered in acid, but it seems harmless.",
  'mhitu.acid_burns': "You're covered in acid!  It burns!",
  'mhitu.put_to_sleep': 'You are put to sleep by the {mon}!',
  'mhitu.frozen_by': 'You are frozen by the {mon}!',
  'mhitu.was_poisoned': "The {mon}'s {subj} was poisoned!",
  'poison.subj.attack': 'attack',
  'poison.subj.contact': 'contact',
  'poison.subj.gaze': 'gaze',
  'poison.subj.bite': 'bite',
  'poison.subj.sting': 'sting',

  // poisoned(). ref: src/attrib.c poisoned(), poisontell()
  'poison.no_effect': "The poison doesn't seem to affect you.",
  'poison.deadly': 'The poison was deadly...',
  'poison.tell.str': 'You feel weaker!',
  'poison.tell.int': 'Your brain is on fire!',
  'poison.tell.wis': 'Your judgement is impaired!',
  'poison.tell.dex': "Your muscles won't obey you!",
  'poison.tell.con': 'You feel very sick!',
  'poison.tell.cha': 'You break out in hives!',

  // adjattrib(). ref: src/attrib.c plusattr[], minusattr[]
  'attr.plus.str': 'You feel {very}strong!',
  'attr.plus.int': 'You feel {very}smart!',
  'attr.plus.wis': 'You feel {very}wise!',
  'attr.plus.dex': 'You feel {very}agile!',
  'attr.plus.con': 'You feel {very}tough!',
  'attr.plus.cha': 'You feel {very}charismatic!',
  'attr.minus.str': 'You feel {very}weak!',
  'attr.minus.int': 'You feel {very}stupid!',
  'attr.minus.wis': 'You feel {very}foolish!',
  'attr.minus.dex': 'You feel {very}clumsy!',
  'attr.minus.con': 'You feel {very}fragile!',
  'attr.minus.cha': 'You feel {very}repulsive!',

  // passive(). ref: src/uhitm.c passive()
  'passive.splashed': "You are splashed by the {mon}'s acid!",
  'passive.frozen_gaze': "You are frozen by the {mon}'s gaze!",
  'passive.frozen': 'You are frozen by the {mon}!',
  'passive.mild_chill': 'You feel a mild chill.',
  'passive.very_cold': 'You are suddenly very cold!',
  'passive.mildly_warm': 'You feel mildly warm.',
  'passive.very_hot': 'You are suddenly very hot!',
  'passive.mild_tingle': 'You feel a mild tingle.',
  'passive.jolted': 'You are jolted with electricity!',

  // stun and timed properties. ref: src/potion.c make_stunned(), src/timeout.c nh_timeout()
  'stun.stagger': 'You stagger...',
  'stun.steady': 'You feel a bit steadier now.',
  'timeout.slow_down': 'You feel yourself slow down.',
  'timeout.slow_down_bit': 'You feel yourself slow down a bit.',
  'timeout.acid_unsafe': 'You no longer feel safe from acid.',
  'timeout.stone_unsafe': 'You no longer feel safe from becoming petrified.',

  // role abilities. ref: src/attrib.c val_abil[]
  'abil.stealthy': 'You feel stealthy!',
  'abil.quick': 'You feel quick!',

  // being stuck. ref: src/hack.c escape_from_sticky_mon()
  'stuck.cannot_escape': 'You cannot escape from the {mon}!',
  'stuck.pull_free': 'You pull free from the {mon}.',

  // corpse intrinsics. ref: src/eat.c givit()
  'givit.fire': 'You feel a momentary chill.',
  'givit.sleep': 'You feel wide awake.',
  'givit.cold': 'You feel full of hot air.',
  'givit.disint': 'You feel very firm.',
  'givit.shock': 'Your health currently feels amplified!',
  'givit.poison': 'You feel healthy.',
  'givit.poison_more': 'You feel especially healthy.',
  'givit.telepat': 'You feel a strange mental acuity.',
  'givit.acid': 'You feel less concerned about being harmed by acid.',
  'givit.stone': 'You feel less concerned about becoming petrified.',
  'eat.poison_unaffected': 'You seem unaffected by the poison.',

  // why the hero cannot act (multi_reason)
  'helpless.asleep': 'sleeping',
  'helpless.paralyzed': 'paralyzed',
  'helpless.frozen': 'frozen',
  'helpless.frozen_gaze': 'frozen by a gaze',
};
