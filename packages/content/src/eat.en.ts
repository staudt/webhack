// English text for eating, hunger, sickness and corpses. ref: src/eat.c, src/timeout.c, src/potion.c
import { MONSTERS } from './monsters';
import { OBJECTS } from './objects';

/** "sewer rat" from 'nh:sewer_rat': the catalog names are the ids spelled out. */
const plain = (id: string): string => id.replace(/^[^:]*:/, '').replace(/_/g, ' ');

/** Killer texts that read well after "killed by a/an" are given per monster and food. */
const killers: Record<string, string> = {};
for (const m of MONSTERS) killers[`killer.rotted.${m.id}`] = `rotted ${plain(m.id)} corpse`;
for (const o of OBJECTS) {
  if (o.class === 'food') killers[`killer.choked.${o.id}`] = `choking on ${plain(o.id)}`;
}

export const eatMessagesEn: Record<string, string> = {
  ...killers,
  'action.nh:eat': 'Eat',
  'action.nh:eat_here': 'Eat the {item} here',

  // hunger states. ref: src/eat.c newuhs()
  'hunger.hungry_begin': 'You are beginning to feel hungry.',
  'hunger.hungry': 'You feel hungry.',
  'hunger.hungry_now': 'You only feel hungry now.',
  'hunger.weak_begin': 'You are beginning to feel weak.',
  'hunger.weak': 'You feel weak.',
  'hunger.weak_still': 'You are still weak.',
  'hunger.needs_food': '{role} needs food, badly!',
  'hunger.faint': 'You faint from lack of food.',
  'hunger.regain': 'You regain consciousness.',
  'hunger.starve': 'You die from starvation.',
  'killer.starvation': 'starvation',
  'killer.cadaver': 'cadaver',
  'killer.poisonous_corpse': 'poisonous corpse',
  'killer.acidic_corpse': 'acidic corpse',
  'killer.choked.snack': 'choking on a quick snack',

  // eating. ref: src/eat.c
  'eat.finish': 'You finish eating the {item}.',
  'eat.stop': 'You stop eating the {item}.',
  'eat.resume': 'You resume your meal.',
  'eat.resume_last': 'You consume the last bite of your meal.',
  'eat.begin': 'You begin eating {item|an}.',
  'eat.eat_now': 'You eat {item|an}.',
  'eat.hits_spot': 'This food really hits the spot!',
  'eat.satiates': 'This satiates your stomach!',
  'eat.delicious': 'This {item} is delicious!',
  'eat.terrible': 'This {item} is terrible!',
  'eat.bland': 'This {item} is bland.',
  'eat.tripe_yak': 'Yak - dog food!',
  'eat.core_dumped': 'Core dumped.',
  'eat.sinister_laughter': 'You hear sinister laughter as you fall asleep...',
  'eat.wake_up': 'You wake up.',
  'eat.hard_time': "You're having a hard time getting all of it down.",
  'eat.finally_finished': "You're finally finished.",
  'eat.stuff': 'You stuff yourself and then vomit voluminously.',
  'eat.choke_over': 'You choke over your {item}.',
  'eat.choke_over_it': 'You choke over it.',
  'eat.can_move_again': 'You can move again.',

  // rotten food. ref: src/eat.c rottenfood()
  'eat.rotten': 'Blecch!  Rotten food!',
  'eat.awful': 'Blecch!  Awful food!',
  'eat.light_headed': 'You feel rather light headed.',
  'eat.goes_dark': 'Everything suddenly goes dark.',
  'eat.world_spins': 'The world spins and goes dark.',
  'eat.conscious_again': 'You are conscious again.',

  // corpses. ref: src/eat.c eatcorpse()
  'eat.tainted': 'Ulch - that meat was tainted!',
  'eat.tainted_note': '(It must have died too long ago to be safe to eat.)',
  'eat.acid': 'You have a very bad case of stomach acid.',
  'eat.poisonous': 'Ecch - that must have been poisonous!',
  'eat.feel_sick': 'You feel sick.',
  'eat.feel_very_sick': 'You feel very sick.',
  'eat.rots_away_completely': 'The corpse rots away completely.',
  'eat.corpse.okay': 'This {item} tastes okay.',
  'eat.corpse.stringy': 'This {item} is stringy.',
  'eat.corpse.gamey': 'This {item} is gamey.',
  'eat.corpse.fatty': 'This {item} is fatty.',
  'eat.corpse.tough': 'This {item} is tough.',
  'eat.corpse.terrible': 'This {item} tastes terrible!',
  'corpse.rots_away': 'Your {item} rots away.',

  // sickness and vomiting. ref: src/potion.c make_sick(), src/timeout.c
  'sick.deathly': 'You feel deathly sick.',
  'sick.worse': 'You feel even worse.',
  'sick.much_worse': 'You feel much worse.',
  'sick.cured': 'You feel cured.  What a relief!',
  'sick.text.0': 'Your sickness feels worse.',
  'sick.text.1': 'Your sickness is severe.',
  'sick.text.2': "You are at Death's door.",
  'sick.recovered': 'You have recovered from your illness.',
  'sick.die': 'You die from your illness.',
  'vomit.text.14': 'You are feeling mildly nauseated.',
  'vomit.text.11': 'You feel slightly confused.',
  'vomit.text.8': "You can't seem to think straight.",
  'vomit.text.5': 'You feel incredibly sick.',
  'vomit.text.2': 'You are about to vomit.',
  'vomit.vomit': 'You vomit!',
  'vomit.less_nauseated': 'You feel much less nauseated now.',
};
