// ref: include/objects.h (NetHack 5.0). Armor AC here is the bonus (10 - the ARMOR() ac argument).
import type { AppearanceDef, ObjectDef } from '@nh/core';

// Colors as in include/color.h (HI_ aliases resolved).
const BLACK = '#555555';
const BRIGHT_BLUE = '#5555ff';
const BRIGHT_GREEN = '#55ff55';
const BRIGHT_MAGENTA = '#ff55ff';
const BROWN = '#aa5500';
const CYAN = '#33bbbb';
const GRAY = '#aaaaaa';
const GREEN = '#33aa33';
const MAGENTA = '#bb44bb';
const ORANGE = '#ff8800';
const RED = '#cc3333';
const WHITE = '#ffffff';
const YELLOW = '#ffff55';

export const OBJECTS: readonly ObjectDef[] = [
  // ---- weapons ----
  // ref: objects.h WEAPON("dagger", NoDes, 1, 1, 0, 30, 10, 4, 4, 3, 2, P, P_DAGGER, IRON, HI_METAL, DAGGER)
  {
    id: 'nh:dagger',
    nameKey: 'nh:dagger',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 30,
    weight: 10,
    cost: 4,
    material: 'iron',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 4],
      large: [1, 3],
      hitBonus: 2,
      skill: 'dagger',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("elven dagger", "runed dagger", 0, 1, 0, 10, 10, 4, 5, 3, 2, P, P_DAGGER, WOOD, HI_WOOD, ELVEN_DAGGER)
  {
    id: 'nh:elven_dagger',
    nameKey: 'nh:elven_dagger',
    descKey: 'nh:elven_dagger.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: BROWN },
    prob: 10,
    weight: 10,
    cost: 4,
    material: 'wood',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 5],
      large: [1, 3],
      hitBonus: 2,
      skill: 'dagger',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("orcish dagger", "crude dagger", 0, 1, 0, 12, 10, 4, 3, 3, 2, P, P_DAGGER, IRON, CLR_BLACK, ORCISH_DAGGER)
  {
    id: 'nh:orcish_dagger',
    nameKey: 'nh:orcish_dagger',
    descKey: 'nh:orcish_dagger.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: BLACK },
    prob: 12,
    weight: 10,
    cost: 4,
    material: 'iron',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 3],
      large: [1, 3],
      hitBonus: 2,
      skill: 'dagger',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("knife", NoDes, 1, 1, 0, 20, 5, 4, 3, 2, 0, P|S, P_KNIFE, IRON, HI_METAL, KNIFE)
  {
    id: 'nh:knife',
    nameKey: 'nh:knife',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 20,
    weight: 5,
    cost: 4,
    material: 'iron',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 3],
      large: [1, 2],
      hitBonus: 0,
      skill: 'knife',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("spear", NoDes, 1, 1, 0, 50, 30, 3, 6, 8, 0, P, P_SPEAR, IRON, HI_METAL, SPEAR)
  {
    id: 'nh:spear',
    nameKey: 'nh:spear',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 50,
    weight: 30,
    cost: 3,
    material: 'iron',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 8],
      hitBonus: 0,
      skill: 'spear',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("dwarvish spear", "stout spear", 0, 1, 0, 12, 35, 3, 8, 8, 0, P, P_SPEAR, IRON, HI_METAL, DWARVISH_SPEAR)
  {
    id: 'nh:dwarvish_spear',
    nameKey: 'nh:dwarvish_spear',
    descKey: 'nh:dwarvish_spear.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 12,
    weight: 35,
    cost: 3,
    material: 'iron',
    merge: true,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 8],
      large: [1, 8],
      hitBonus: 0,
      skill: 'spear',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("short sword", NoDes, 1, 0, 0, 8, 30, 10, 6, 8, 0, P, P_SHORT_SWORD, IRON, HI_METAL, SHORT_SWORD)
  {
    id: 'nh:short_sword',
    nameKey: 'nh:short_sword',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 8,
    weight: 30,
    cost: 10,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 8],
      hitBonus: 0,
      skill: 'short_sword',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("dwarvish short sword", "broad short sword", 0, 0, 0, 2, 30, 10, 7, 8, 0, P, P_SHORT_SWORD, IRON, HI_METAL, DWARVISH_SHORT_SWORD)
  {
    id: 'nh:dwarvish_short_sword',
    nameKey: 'nh:dwarvish_short_sword',
    descKey: 'nh:dwarvish_short_sword.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 2,
    weight: 30,
    cost: 10,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 7],
      large: [1, 8],
      hitBonus: 0,
      skill: 'short_sword',
      bimanual: false,
      kind: 'pierce',
    },
  },
  // ref: objects.h WEAPON("scimitar", "curved sword", 0, 0, 0, 15, 40, 15, 8, 8, 0, S, P_SABER, IRON, HI_METAL, SCIMITAR)
  {
    id: 'nh:scimitar',
    nameKey: 'nh:scimitar',
    descKey: 'nh:scimitar.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 15,
    weight: 40,
    cost: 15,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 8],
      large: [1, 8],
      hitBonus: 0,
      skill: 'saber',
      bimanual: false,
      kind: 'slash',
    },
  },
  // ref: objects.h WEAPON("long sword", NoDes, 1, 0, 0, 50, 40, 15, 8, 12, 0, S, P_LONG_SWORD, IRON, HI_METAL, LONG_SWORD)
  {
    id: 'nh:long_sword',
    nameKey: 'nh:long_sword',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 50,
    weight: 40,
    cost: 15,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 8],
      large: [1, 12],
      hitBonus: 0,
      skill: 'long_sword',
      bimanual: false,
      kind: 'slash',
    },
  },
  // ref: objects.h WEAPON("axe", NoDes, 1, 0, 0, 40, 60, 8, 6, 4, 0, S, P_AXE, IRON, HI_METAL, AXE)
  {
    id: 'nh:axe',
    nameKey: 'nh:axe',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 40,
    weight: 60,
    cost: 8,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 4],
      hitBonus: 0,
      skill: 'axe',
      bimanual: false,
      kind: 'slash',
    },
  },
  // ref: objects.h WEAPON("dwarvish mattock", "broad pick", 0, 0, 1, 13, 120, 50, 12, 8, -1, B, P_PICK_AXE, IRON, HI_METAL, DWARVISH_MATTOCK)
  {
    id: 'nh:dwarvish_mattock',
    nameKey: 'nh:dwarvish_mattock',
    descKey: 'nh:dwarvish_mattock.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 13,
    weight: 120,
    cost: 50,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 12],
      large: [1, 8],
      hitBonus: -1,
      skill: 'pick_axe',
      bimanual: true,
      kind: 'whack',
    },
  },
  // ref: objects.h WEAPON("aklys", "thonged club", 0, 0, 0, 8, 15, 4, 6, 3, 0, B, P_CLUB, IRON, HI_METAL, AKLYS)
  {
    id: 'nh:aklys',
    nameKey: 'nh:aklys',
    descKey: 'nh:aklys.desc',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 8,
    weight: 15,
    cost: 4,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 3],
      hitBonus: 0,
      skill: 'club',
      bimanual: false,
      kind: 'whack',
    },
  },
  // ref: objects.h WEAPON("mace", NoDes, 1, 0, 0, 40, 30, 5, 6, 6, 0, B, P_MACE, IRON, HI_METAL, MACE)
  {
    id: 'nh:mace',
    nameKey: 'nh:mace',
    class: 'weapon',
    glyph: { ch: ')', fg: CYAN },
    prob: 40,
    weight: 30,
    cost: 5,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 6],
      hitBonus: 0,
      skill: 'mace',
      bimanual: false,
      kind: 'whack',
    },
  },
  // ref: objects.h WEAPON("club", NoDes, 1, 0, 0, 12, 30, 3, 6, 3, 0, B, P_CLUB, WOOD, HI_WOOD, CLUB)
  {
    id: 'nh:club',
    nameKey: 'nh:club',
    class: 'weapon',
    glyph: { ch: ')', fg: BROWN },
    prob: 12,
    weight: 30,
    cost: 3,
    material: 'wood',
    merge: false,
    magic: false,
    delay: 0,
    weapon: {
      small: [1, 6],
      large: [1, 3],
      hitBonus: 0,
      skill: 'club',
      bimanual: false,
      kind: 'whack',
    },
  },

  // ---- armor (ac = 10 - macro ac argument; mc = macro can argument; armor never merges) ----
  // ref: objects.h SHIELD("small shield", "wooden shield", 0, 0, 0, 0, 6, 0, 30, 3, 9, 0, WOOD, HI_WOOD, SMALL_SHIELD)
  {
    id: 'nh:small_shield',
    nameKey: 'nh:small_shield',
    descKey: 'nh:small_shield.desc',
    class: 'armor',
    glyph: { ch: '[', fg: BROWN },
    prob: 6,
    weight: 30,
    cost: 3,
    material: 'wood',
    merge: false,
    magic: false,
    delay: 0,
    armor: { slot: 'shield', ac: 1, mc: 0 },
  },
  // ref: objects.h ARMOR("elven mithril-coat", NoDes, 1, 0, 0, 0, 15, 1, 150, 240, 5, 2, ARM_SUIT, MITHRIL, HI_SILVER, ELVEN_MITHRIL_COAT)
  {
    id: 'nh:elven_mithril_coat',
    nameKey: 'nh:elven_mithril_coat',
    class: 'armor',
    glyph: { ch: '[', fg: GRAY },
    prob: 15,
    weight: 150,
    cost: 240,
    material: 'mithril',
    merge: false,
    magic: false,
    delay: 1,
    armor: { slot: 'body', ac: 5, mc: 2 },
  },
  // ref: objects.h ARMOR("dwarvish mithril-coat", NoDes, 1, 0, 0, 0, 10, 1, 150, 240, 4, 2, ARM_SUIT, MITHRIL, HI_SILVER, DWARVISH_MITHRIL_COAT)
  {
    id: 'nh:dwarvish_mithril_coat',
    nameKey: 'nh:dwarvish_mithril_coat',
    class: 'armor',
    glyph: { ch: '[', fg: GRAY },
    prob: 10,
    weight: 150,
    cost: 240,
    material: 'mithril',
    merge: false,
    magic: false,
    delay: 1,
    armor: { slot: 'body', ac: 6, mc: 2 },
  },
  // ref: objects.h ARMOR("leather armor", NoDes, 1, 0, 0, 0, 75, 3, 150, 5, 8, 1, ARM_SUIT, LEATHER, HI_LEATHER, LEATHER_ARMOR)
  {
    id: 'nh:leather_armor',
    nameKey: 'nh:leather_armor',
    class: 'armor',
    glyph: { ch: '[', fg: BROWN },
    prob: 75,
    weight: 150,
    cost: 5,
    material: 'leather',
    merge: false,
    magic: false,
    delay: 3,
    armor: { slot: 'body', ac: 2, mc: 1 },
  },
  // ref: objects.h ARMOR("ring mail", NoDes, 1, 0, 0, 0, 66, 5, 250, 100, 7, 1, ARM_SUIT, IRON, HI_METAL, RING_MAIL)
  {
    id: 'nh:ring_mail',
    nameKey: 'nh:ring_mail',
    class: 'armor',
    glyph: { ch: '[', fg: CYAN },
    prob: 66,
    weight: 250,
    cost: 100,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 5,
    armor: { slot: 'body', ac: 3, mc: 1 },
  },
  // ref: objects.h CLOAK("dwarvish cloak", "hooded cloak", 0, 0, 0, 8, 0, 10, 50, 10, 1, CLOTH, HI_CLOTH, DWARVISH_CLOAK)
  {
    id: 'nh:dwarvish_cloak',
    nameKey: 'nh:dwarvish_cloak',
    descKey: 'nh:dwarvish_cloak.desc',
    class: 'armor',
    glyph: { ch: '[', fg: BROWN },
    prob: 8,
    weight: 10,
    cost: 50,
    material: 'cloth',
    merge: false,
    magic: false,
    delay: 0,
    armor: { slot: 'cloak', ac: 0, mc: 1 },
  },
  // ref: objects.h HELM("orcish helm", "iron skull cap", 0, 0, 0, 6, 1, 30, 10, 9, 0, IRON, CLR_BLACK, ORCISH_HELM)
  {
    id: 'nh:orcish_helm',
    nameKey: 'nh:orcish_helm',
    descKey: 'nh:orcish_helm.desc',
    class: 'armor',
    glyph: { ch: '[', fg: BLACK },
    prob: 6,
    weight: 30,
    cost: 10,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 1,
    armor: { slot: 'helm', ac: 1, mc: 0 },
  },
  // ref: objects.h HELM("dwarvish iron helm", "hard hat", 0, 0, 0, 6, 1, 40, 20, 8, 0, IRON, HI_METAL, DWARVISH_IRON_HELM)
  {
    id: 'nh:dwarvish_iron_helm',
    nameKey: 'nh:dwarvish_iron_helm',
    descKey: 'nh:dwarvish_iron_helm.desc',
    class: 'armor',
    glyph: { ch: '[', fg: CYAN },
    prob: 6,
    weight: 40,
    cost: 20,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 1,
    armor: { slot: 'helm', ac: 2, mc: 0 },
  },
  // ref: objects.h BOOTS("iron shoes", "hard shoes", 0, 0, 0, 7, 2, 50, 16, 8, 0, IRON, HI_METAL, IRON_SHOES)
  {
    id: 'nh:iron_shoes',
    nameKey: 'nh:iron_shoes',
    descKey: 'nh:iron_shoes.desc',
    class: 'armor',
    glyph: { ch: '[', fg: CYAN },
    prob: 7,
    weight: 50,
    cost: 16,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 2,
    armor: { slot: 'boots', ac: 2, mc: 0 },
  },
  // ref: objects.h SHIELD("dwarvish roundshield", "large round shield", 0, 0, 0, 0, 3, 0, 100, 10, 8, 0, IRON, HI_METAL, DWARVISH_ROUNDSHIELD)
  {
    id: 'nh:dwarvish_roundshield',
    nameKey: 'nh:dwarvish_roundshield',
    descKey: 'nh:dwarvish_roundshield.desc',
    class: 'armor',
    glyph: { ch: '[', fg: CYAN },
    prob: 3,
    weight: 100,
    cost: 10,
    material: 'iron',
    merge: false,
    magic: false,
    delay: 0,
    armor: { slot: 'shield', ac: 2, mc: 0 },
  },
  // ref: objects.h GLOVES("leather gloves", "old gloves", 0, 0, 0, 15, 1, 10, 8, 9, 0, LEATHER, HI_LEATHER, LEATHER_GLOVES)
  {
    id: 'nh:leather_gloves',
    nameKey: 'nh:leather_gloves',
    descKey: 'nh:leather_gloves.desc',
    class: 'armor',
    glyph: { ch: '[', fg: BROWN },
    prob: 15,
    weight: 10,
    cost: 8,
    material: 'leather',
    merge: false,
    magic: false,
    delay: 1,
    armor: { slot: 'gloves', ac: 1, mc: 0 },
  },

  // ---- food (all food merges; cost = nutrition / 20 + 5 as in the FOOD() macro) ----
  // ref: objects.h FOOD("food ration", 380, 5, 20, 0, VEGGY, 800, HI_ORGANIC, FOOD_RATION)
  {
    id: 'nh:food_ration',
    nameKey: 'nh:food_ration',
    class: 'food',
    glyph: { ch: '%', fg: BROWN },
    prob: 380,
    weight: 20,
    cost: 45,
    material: 'veggy',
    merge: true,
    magic: false,
    delay: 5,
    food: { nutrition: 800 },
  },
  // ref: objects.h FOOD("cram ration", 20, 3, 15, 0, VEGGY, 600, HI_ORGANIC, CRAM_RATION)
  {
    id: 'nh:cram_ration',
    nameKey: 'nh:cram_ration',
    class: 'food',
    glyph: { ch: '%', fg: BROWN },
    prob: 20,
    weight: 15,
    cost: 35,
    material: 'veggy',
    merge: true,
    magic: false,
    delay: 3,
    food: { nutrition: 600 },
  },
  // ref: objects.h FOOD("lembas wafer", 20, 2, 5, 0, VEGGY, 800, CLR_WHITE, LEMBAS_WAFER)
  {
    id: 'nh:lembas_wafer',
    nameKey: 'nh:lembas_wafer',
    class: 'food',
    glyph: { ch: '%', fg: WHITE },
    prob: 20,
    weight: 5,
    cost: 45,
    material: 'veggy',
    merge: true,
    magic: false,
    delay: 2,
    food: { nutrition: 800 },
  },
  // ref: objects.h FOOD("tripe ration", 140, 2, 10, 0, FLESH, 200, CLR_BROWN, TRIPE_RATION)
  {
    id: 'nh:tripe_ration',
    nameKey: 'nh:tripe_ration',
    class: 'food',
    glyph: { ch: '%', fg: BROWN },
    prob: 140,
    weight: 10,
    cost: 15,
    material: 'flesh',
    merge: true,
    magic: false,
    delay: 2,
    food: { nutrition: 200 },
  },
  // ref: objects.h FOOD("apple", 15, 1, 2, 0, VEGGY, 50, CLR_RED, APPLE)
  {
    id: 'nh:apple',
    nameKey: 'nh:apple',
    class: 'food',
    glyph: { ch: '%', fg: RED },
    prob: 15,
    weight: 2,
    cost: 7,
    material: 'veggy',
    merge: true,
    magic: false,
    delay: 1,
    food: { nutrition: 50 },
  },
  // ref: objects.h FOOD("carrot", 15, 1, 2, 0, VEGGY, 50, CLR_ORANGE, CARROT)
  {
    id: 'nh:carrot',
    nameKey: 'nh:carrot',
    class: 'food',
    glyph: { ch: '%', fg: ORANGE },
    prob: 15,
    weight: 2,
    cost: 7,
    material: 'veggy',
    merge: true,
    magic: false,
    delay: 1,
    food: { nutrition: 50 },
  },
  // ref: objects.h FOOD("corpse", 0, 1, 0, 0, FLESH, 0, CLR_BROWN, CORPSE); weight and nutrition are per monster at runtime
  {
    id: 'nh:corpse',
    nameKey: 'nh:corpse',
    class: 'food',
    glyph: { ch: '%', fg: BROWN },
    prob: 0,
    weight: 0,
    cost: 5,
    material: 'flesh',
    merge: true,
    magic: false,
    delay: 1,
    food: { nutrition: 0 },
  },

  // ---- coin ----
  // ref: objects.h COIN("gold piece", 1000, GOLD, 1, GOLD_PIECE)
  {
    id: 'nh:gold_piece',
    nameKey: 'nh:gold_piece',
    class: 'coin',
    glyph: { ch: '$', fg: YELLOW },
    prob: 1000,
    weight: 1,
    cost: 1,
    material: 'gold',
    merge: true,
    magic: false,
    delay: 0,
  },

  // ---- potions (glass, weight 20, merge; known-name potions have no descKey) ----
  // ref: objects.h POTION("healing", "purple-red", 1, 0, 115, 20, CLR_MAGENTA, POT_HEALING)
  {
    id: 'nh:potion_of_healing',
    nameKey: 'nh:potion_of_healing',
    class: 'potion',
    glyph: { ch: '!', fg: MAGENTA },
    prob: 115,
    weight: 20,
    cost: 20,
    material: 'glass',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h POTION("extra healing", "puce", 1, 0, 45, 100, CLR_RED, POT_EXTRA_HEALING)
  {
    id: 'nh:potion_of_extra_healing',
    nameKey: 'nh:potion_of_extra_healing',
    class: 'potion',
    glyph: { ch: '!', fg: RED },
    prob: 45,
    weight: 20,
    cost: 100,
    material: 'glass',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h POTION("full healing", "black", 1, 0, 10, 200, CLR_BLACK, POT_FULL_HEALING)
  {
    id: 'nh:potion_of_full_healing',
    nameKey: 'nh:potion_of_full_healing',
    class: 'potion',
    glyph: { ch: '!', fg: BLACK },
    prob: 10,
    weight: 20,
    cost: 200,
    material: 'glass',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h POTION("see invisible", "magenta", 1, SEE_INVIS, 40, 50, CLR_MAGENTA, POT_SEE_INVISIBLE)
  {
    id: 'nh:potion_of_see_invisible',
    nameKey: 'nh:potion_of_see_invisible',
    class: 'potion',
    glyph: { ch: '!', fg: MAGENTA },
    prob: 40,
    weight: 20,
    cost: 50,
    material: 'glass',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h POTION("water", "clear", 0, 0, 80, 100, CLR_CYAN, POT_WATER)
  {
    id: 'nh:potion_of_water',
    nameKey: 'nh:potion_of_water',
    descKey: 'nh:potion_of_water.desc',
    class: 'potion',
    glyph: { ch: '!', fg: CYAN },
    prob: 80,
    weight: 20,
    cost: 100,
    material: 'glass',
    merge: true,
    magic: false,
    delay: 0,
  },

  // ---- scrolls (paper, weight 5, merge; appearances are shuffled so no descKey) ----
  // ref: objects.h SCROLL("identify", "KERNOD WEL", 1, 180, 20, SCR_IDENTIFY)
  {
    id: 'nh:scroll_of_identify',
    nameKey: 'nh:scroll_of_identify',
    class: 'scroll',
    glyph: { ch: '?', fg: WHITE },
    prob: 180,
    weight: 5,
    cost: 20,
    material: 'paper',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h SCROLL("enchant weapon", "DAIYEN FOOELS", 1, 80, 60, SCR_ENCHANT_WEAPON)
  {
    id: 'nh:scroll_of_enchant_weapon',
    nameKey: 'nh:scroll_of_enchant_weapon',
    class: 'scroll',
    glyph: { ch: '?', fg: WHITE },
    prob: 80,
    weight: 5,
    cost: 60,
    material: 'paper',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h SCROLL("enchant armor", "ZELGO MER", 1, 63, 80, SCR_ENCHANT_ARMOR)
  {
    id: 'nh:scroll_of_enchant_armor',
    nameKey: 'nh:scroll_of_enchant_armor',
    class: 'scroll',
    glyph: { ch: '?', fg: WHITE },
    prob: 63,
    weight: 5,
    cost: 80,
    material: 'paper',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h SCROLL("remove curse", "PRATYAVAYAH", 1, 65, 80, SCR_REMOVE_CURSE)
  {
    id: 'nh:scroll_of_remove_curse',
    nameKey: 'nh:scroll_of_remove_curse',
    class: 'scroll',
    glyph: { ch: '?', fg: WHITE },
    prob: 65,
    weight: 5,
    cost: 80,
    material: 'paper',
    merge: true,
    magic: true,
    delay: 0,
  },
  // ref: objects.h SCROLL("light", "VERR YED HORRE", 1, 90, 50, SCR_LIGHT)
  {
    id: 'nh:scroll_of_light',
    nameKey: 'nh:scroll_of_light',
    class: 'scroll',
    glyph: { ch: '?', fg: WHITE },
    prob: 90,
    weight: 5,
    cost: 50,
    material: 'paper',
    merge: true,
    magic: true,
    delay: 0,
  },
];

/** Shuffled potion descriptions, one per potion except water (ref: objects.h POTION() descriptions). */
const potionLook = (slug: string, fg: string): AppearanceDef => ({
  id: `nh:${slug}_potion`,
  nameKey: `nh:${slug}_potion`,
  class: 'potion',
  glyph: { ch: '!', fg },
});

/** Shuffled scroll labels (ref: objects.h SCROLL() labels and XTRA_SCROLL_LABEL()). */
const scrollLabel = (slug: string): AppearanceDef => ({
  id: `nh:scroll_labeled_${slug}`,
  nameKey: `nh:scroll_labeled_${slug}`,
  class: 'scroll',
  glyph: { ch: '?', fg: WHITE },
});

export const APPEARANCES: readonly AppearanceDef[] = [
  // ---- potion descriptions ----
  potionLook('ruby', RED), // gain ability
  potionLook('pink', BRIGHT_MAGENTA), // restore ability
  potionLook('orange', ORANGE), // confusion
  potionLook('yellow', YELLOW), // blindness
  potionLook('emerald', BRIGHT_GREEN), // paralysis
  potionLook('dark_green', GREEN), // speed
  potionLook('cyan', CYAN), // levitation
  potionLook('sky_blue', CYAN), // hallucination
  potionLook('brilliant_blue', BRIGHT_BLUE), // invisibility
  potionLook('magenta', MAGENTA), // see invisible
  potionLook('purple_red', MAGENTA), // healing
  potionLook('puce', RED), // extra healing
  potionLook('milky', WHITE), // gain level
  potionLook('swirly', BROWN), // enlightenment
  potionLook('bubbly', WHITE), // monster detection
  potionLook('smoky', GRAY), // object detection
  potionLook('cloudy', WHITE), // gain energy
  potionLook('effervescent', GRAY), // sleeping
  potionLook('black', BLACK), // full healing
  potionLook('golden', YELLOW), // polymorph
  potionLook('brown', BROWN), // booze
  potionLook('fizzy', CYAN), // sickness
  potionLook('dark', BLACK), // fruit juice
  potionLook('white', WHITE), // acid
  potionLook('murky', BROWN), // oil

  // ---- scroll labels: labeled scrolls, then XTRA_SCROLL_LABEL extras (mail and blank paper are fixed) ----
  scrollLabel('zelgo_mer'), // enchant armor
  scrollLabel('juyed_awk_yacc'), // destroy armor
  scrollLabel('nr_9'), // confuse monster
  scrollLabel('xixaxa_xoxaxa_xuxaxa'), // scare monster
  scrollLabel('pratyavayah'), // remove curse
  scrollLabel('daiyen_fooels'), // enchant weapon
  scrollLabel('lep_gex_ven_zea'), // create monster
  scrollLabel('prirutsenie'), // taming
  scrollLabel('elbib_yloh'), // genocide
  scrollLabel('verr_yed_horre'), // light
  scrollLabel('venzar_borgavve'), // teleportation
  scrollLabel('tharr'), // gold detection
  scrollLabel('yum_yum'), // food detection
  scrollLabel('kernod_wel'), // identify
  scrollLabel('elam_ebow'), // magic mapping
  scrollLabel('duam_xnaht'), // amnesia
  scrollLabel('andova_begarin'), // fire
  scrollLabel('kirje'), // earth
  scrollLabel('ve_forbryderne'), // punishment
  scrollLabel('hackem_muche'), // charging
  scrollLabel('velox_neb'), // stinking cloud
  scrollLabel('foobie_bletch'),
  scrollLabel('temov'),
  scrollLabel('garven_deh'),
  scrollLabel('read_me'),
  scrollLabel('etaoin_shrdlu'),
  scrollLabel('lorem_ipsum'),
  scrollLabel('fnord'),
  scrollLabel('ko_bate'),
  scrollLabel('abra_ka_dabra'),
  scrollLabel('ashpd_sodalg'),
  scrollLabel('zlorfik'),
  scrollLabel('gnik_sisi_vle'),
  scrollLabel('hapax_legomenon'),
  scrollLabel('eiris_sazun_idisi'),
  scrollLabel('phol_ende_wodan'),
  scrollLabel('ghoti'),
  scrollLabel('mapiro_mahama_diromat'),
  scrollLabel('vas_corp_bet_mani'),
  scrollLabel('xor_ota'),
  scrollLabel('strc_prst_skrz_krk'),
];
