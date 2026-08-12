/**
 * The people already standing in the world when you get there.
 *
 * An NPC is the same four things a duelist has always been, and this file is
 * the first two: **who** (a `PremadeCharacter`, exactly as the booth writes
 * one) and **where** (a position and a facing in the field). What they *do* is
 * the third — for now, one thing: they talk, from a script written here as
 * data. What they *play* is the fourth and is not built yet; when it is, a
 * deck of card slugs joins this record and nothing else about it changes.
 *
 * No three.js in here, deliberately, exactly like `premade.ts`: this is what
 * an NPC *is*, and `OpenWorld` is what one *looks like*. Adding somebody to
 * the field should be adding a row to `WORLD_NPCS`, not editing a renderer.
 *
 * ## The scripts
 *
 * A script is a map of nodes. A node is what the character says — one or more
 * paragraphs, shown a page at a time — and the replies you may give, each
 * naming the node it leads to. `null` ends the conversation. That is the whole
 * grammar: no state, no flags, no variables beyond the player's own name, so a
 * conversation is a thing you can read top to bottom and know what it does.
 *
 * `{name}` in a line is replaced with the player's duelist name. It is the one
 * token, and it exists because being greeted by name is most of the difference
 * between a character and a signpost.
 */

import { AS_AUTHORED, type PremadeCharacter } from './premade';
import type { AccessorySpec } from '@/components/story/accessories';

export interface DialogueChoice {
  /** What the player says. */
  label: string;
  /** The node it leads to, or `null` to end the conversation. */
  to: string | null;
}

export interface DialogueNode {
  /**
   * What the character says, one paragraph per page. Long speeches are split
   * here rather than scrolled: a wall of text on a phone is a wall nobody
   * reads, and a tap between paragraphs is the pacing a conversation has.
   */
  lines: string[];
  /**
   * The replies offered once the last page is shown. An empty list means the
   * conversation simply ends — the panel offers a single way out.
   */
  choices: DialogueChoice[];
}

export interface WorldNpc {
  id: string;
  /** Who they are, in the same record the player's own duelist is stored as. */
  character: PremadeCharacter;
  /**
   * Material name → hex, or `null` to hide it. The booth's three tint slots
   * are a constraint on the *player*; somebody written down is meant to look
   * like a particular person, so they may paint the whole model.
   */
  overrides?: Record<string, string | null>;
  /** Generated props hung off named bones — a bandana, in time a duel disk. */
  accessories?: AccessorySpec[];
  /** Where they stand, in world metres. */
  x: number;
  z: number;
  /** Which way they face when nobody is near, in radians (0 is +Z). */
  facing: number;
  /** How close you must be before they can be spoken to, in metres. */
  range: number;
  /** Which node their script opens on. */
  start: string;
  script: Record<string, DialogueNode>;
}

/* ------------------------------------------------------------------ */
/* Grandpa Muto                                                        */
/* ------------------------------------------------------------------ */

/**
 * Solomon Muto — Yugi's grandfather, keeper of the Kame Game Shop — standing
 * a few paces from where every new duelist arrives.
 *
 * He is the right person to be here for a reason beyond fondness: in the
 * story he is the one who taught Yugi, and the one who handed him the puzzle
 * that started all of it. A game that opens with somebody's grandfather
 * explaining the rules is opening the way this one actually did.
 *
 * **On the casting.** There is no model of Solomon Muto anywhere — not on
 * Sketchfab, not on The Models Resource, not in the Japanese MMD catalogues.
 * He has never been a playable duelist in a 3D game, so there is nothing to
 * rip, and the fan sculptors make Yugi and Kaiba. He is a famous character
 * with no model in existence. So he is assembled: a body off the roster, and a
 * head built in `accessories.ts`.
 *
 * The body is the **punk**, which sounds absurd and is the right answer. Strip
 * the mohawk and the earrings and what is left is the only silhouette on the
 * roster that matches his: an open garment over a lighter shirt, with
 * trousers. Repaint the vest the dark green of his overalls and the shirt
 * cream, and that is what he wears.
 *
 * It was the `king` first, on the reasoning that he was the only model with
 * white hair and a beard. That was backwards. Once the head is built rather
 * than borrowed, hair and beard stop being selection criteria — and the king's
 * body is pauldrons, greaves and plate, which no amount of repainting stops
 * reading as armour. Choose the body for the body.
 *
 * Stature 0 is the short end of the range, because he should not tower over
 * the person he is welcoming.
 */
const GRANDPA_LOOK: PremadeCharacter = {
  name: 'Grandpa Muto',
  model: 'punk',
  /* The catalog's own slots are left as authored — everything he wears is
     said properly in the overrides below, where it can name materials the
     booth's three slots never reach. */
  tints: [AS_AUTHORED, AS_AUTHORED, AS_AUTHORED],
  stature: 0,
};

/** What the punk has to stop wearing to become a shopkeeper. */
const GRANDPA_DRESS: Record<string, string | null> = {
  /* The mohawk spikes and the earrings. Gone. */
  Red: null,
  Earrings: null,
  /*
   * The rest of the hair, which on this model is a separate material from the
   * spikes — so it survives them, and goes grey. Hiding it as well was tried
   * and is wrong twice over: it leaves an actual hole through the back of the
   * skull, because there is no scalp modelled under the hair, and it throws
   * away hair that only needed recolouring.
   */
  Red_Dark: '#a8a29a',
  /* The vest, which on him is the bib of a pair of overalls. */
  Black: '#2c5c48',
  /* The shirt under it. */
  White: '#e6dcc4',
  /*
   * Trousers, and the colour is doing a job.
   *
   * This model's jeans are torn at the knee — two patches of bare leg, which is
   * the loudest remaining word of "punk" on him and cannot be painted out,
   * because the skin showing through is the same material as his face. Against
   * navy those patches shout. Against worn khaki they read as knees gone thin,
   * which is what an old man's work trousers look like anyway.
   */
  LightBlue: '#7a6a55',
  /* This model carries its brows as a material of their own, so his go grey
     here rather than being rebuilt — one fewer piece of geometry for the same
     result, which is the trade this whole file is trying to make. */
  Eyebrows: '#8e8981',
};

/**
 * The two things the model could not supply.
 *
 * Everything else about his head is the punk's own geometry with a different
 * colour on it. These two are shapes that are not in the file at all, and they
 * are the two the character is recognised by: the bandana, and the moustache
 * and beard beneath it.
 *
 * Two pieces, and it took getting down to two. Grey hair, sideburns and brows
 * were all built here at one point and all three are gone — the first two
 * because this body already has hair worth keeping, the third because it has a
 * brow material of its own. At conversation distance a face is an outline, and
 * every piece of detail added below this level has made him worse.
 */
const GRANDPA_HEAD: AccessorySpec[] = [
  /* Plain, and tied at the back. The chevrons the accessory can draw were
     tried and cut: at this size a pattern is two pale scratches. */
  { kind: 'bandana', bone: 'Head', color: '#d4842a' },
  /* The same grey as his hair. Not white — white is a wizard, and he is a
     shopkeeper who has gone grey. */
  { kind: 'beard', bone: 'Head', color: '#a8a29a' },
];

/**
 * What he actually teaches, and why it is him teaching it.
 *
 * Everything about the rules is true of *this* game rather than of the card
 * game it comes from — 4000 life points, twenty-five cards, one Main Phase,
 * three monster zones — because a tutorial that describes a different game is
 * worse than no tutorial. The Exodia line is in because it is this build's
 * best rule and a player who never hears it never looks for it.
 *
 * Everything about *him* is from the story: the Kame Game Shop, the dig in
 * Egypt, the puzzle he brought back and gave to his grandson, and the
 * Blue-Eyes that Kaiba tore in half in front of him. He talks about them the
 * way an old man talks about things that happened — sideways, and only when
 * asked.
 */
const GRANDPA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well now — a face I have not seen before.',
      'Welcome, {name}. Every duelist who has ever mattered started exactly where you are standing: in a field, with a deck they have not played yet.',
    ],
    choices: [
      { label: 'Who are you?', to: 'who' },
      { label: 'Where am I?', to: 'where' },
      { label: 'Teach me to duel.', to: 'duel' },
    ],
  },

  who: {
    lines: [
      'Solomon Muto. Most people just say Grandpa, and I have stopped correcting them.',
      'I keep the Kame Game Shop — the little one with the turtle over the door. I taught my grandson Yugi to play at that counter, and he has since done things with the game I could not have imagined.',
      'So I stand out here now and tell new duelists the parts nobody tells them. It saves a great deal of grief.',
    ],
    choices: [
      { label: 'Teach me to duel, then.', to: 'duel' },
      { label: 'Were you a duelist?', to: 'past' },
      { label: 'What about my deck?', to: 'deck' },
    ],
  },

  past: {
    lines: [
      'A long time ago, and not only at a card table. I spent my younger years digging in Egypt, in tombs that did not want to be dug in.',
      'I brought a puzzle home from one of them. Gold, in a box, in pieces — eight years my grandson spent putting it together. You could say the whole thing started on my shelf.',
      'And yes, I have owned a card or two worth owning. There was a Blue-Eyes White Dragon. A young man in a very expensive coat tore it in half in front of me, to be certain nobody else could ever play it.',
      'I have never decided whether that was the cruellest thing I have seen done to a card, or simply the most honest thing I have seen anyone do about wanting to win.',
    ],
    choices: [
      { label: 'Teach me to duel.', to: 'duel' },
      { label: 'What about my deck?', to: 'deck' },
      { label: 'I am sorry about the dragon.', to: 'menu' },
    ],
  },

  where: {
    lines: [
      'A field. Not much of one yet — grass, sky, and room to walk.',
      'It will be more than that. There will be duelists standing where you are standing now, each with a deck of their own and a reason to use it. Yugi will be among them, and Kaiba, and the rest of that noisy generation.',
      'For the moment there is me, and there is you, and that is enough to start with.',
    ],
    choices: [
      { label: 'Teach me to duel.', to: 'duel' },
      { label: 'Who are you?', to: 'who' },
      { label: 'I will look around.', to: null },
    ],
  },

  duel: {
    lines: [
      'Good. Sit up, this part is short.',
      'You begin with four thousand life points and five cards. A turn goes: draw, one Main Phase, battle, end. One Main Phase — not two — so everything you mean to play, you play before you swing.',
      'You have three monster zones and a single spell or trap zone. Three. That is the whole of your board, and it is why the question is never what is strongest, it is what fits.',
      'Nobody attacks on the first turn of the duel. Whoever goes first gets the tempo; you get to still be standing.',
    ],
    choices: [
      { label: 'How do I win?', to: 'win' },
      { label: 'Tell me about summoning.', to: 'tribute' },
      { label: 'And my deck?', to: 'deck' },
    ],
  },

  tribute: {
    lines: [
      'Levels five and six cost you one monster off your own field. Seven and up cost two. That is the price of anything worth summoning, and paying it is most of what playing well looks like.',
      'The exception is the toons, which need no tribute at all while Toon World is face-up. If you ever duel Pegasus you will find out what that is worth. Rather quickly.',
    ],
    choices: [
      { label: 'How do I win?', to: 'win' },
      { label: 'And my deck?', to: 'deck' },
      { label: 'That is enough for now.', to: 'bye' },
    ],
  },

  win: {
    lines: [
      'Three ways, and only the first is obvious.',
      'Take your opponent to zero life points. Or leave them with no cards to draw — a duel that goes long is won by whoever built the better twenty-five.',
      'Or assemble all five pieces of Exodia. In your hand, on your field, or split between the two — a piece standing in a monster zone still counts. Only the graveyard is final. Lose a piece there and it is lost.',
    ],
    choices: [
      { label: 'Tell me about my deck.', to: 'deck' },
      { label: 'Anything else I should know?', to: 'menu' },
      { label: 'Thank you.', to: 'bye' },
    ],
  },

  deck: {
    lines: [
      'Twenty-five cards. Exactly twenty-five — the ones you chose when you cut it, and those are the cards you own. Not a sample of them. All of them.',
      'You can rearrange what you have from the menu whenever you like. Making it *bigger* is a different matter: a collection grows by winning, and there is nobody out here yet to win against.',
      'Which is a polite way of saying come back and see me.',
    ],
    choices: [
      { label: 'How do I win a duel?', to: 'win' },
      { label: 'Anything else?', to: 'menu' },
      { label: 'I will. Thank you.', to: 'bye' },
    ],
  },

  menu: {
    lines: ['Ask away. I have nowhere to be.'],
    choices: [
      { label: 'How does a duel work?', to: 'duel' },
      { label: 'How do I win?', to: 'win' },
      { label: 'What about my deck?', to: 'deck' },
      { label: 'Tell me about the puzzle.', to: 'past' },
      { label: 'Nothing — thank you.', to: 'bye' },
    ],
  },

  bye: {
    lines: [
      'Go on, then. Walk the field, get the feel of it.',
      'And {name} — the deck you are holding is the one you built. My grandson would tell you the cards have hearts and they listen. I will only tell you that the ones you chose on purpose tend to turn up when you need them.',
      'Come back when there is somebody out here to beat.',
    ],
    choices: [],
  },
};

/* ------------------------------------------------------------------ */
/* The rest of them                                                    */
/* ------------------------------------------------------------------ */

/**
 * Five more, standing about the field.
 *
 * They say hello and nothing else on purpose. The open world is going to be
 * rebuilt around a story, and writing five scripts against a world that does
 * not exist yet would be writing them twice; what is worth having *now* is the
 * cast, so that when there is something for them to say, saying it is a matter
 * of adding nodes to a record that already exists.
 *
 * **Four of them are themselves.** Yugi, Yami, Kaiba and Joey are the real
 * models, converted from the character rips of *Yu-Gi-Oh! Duel Monsters:
 * Saikyo Card Battle* (3DS) by `npm run import-rip` — textured, rigged, and
 * carrying the game's own Idle. Their records are three lines each, because a
 * model that already looks like somebody needs no dressing and no accessories:
 * the star hair, the coat and the studded belts are in the file.
 *
 * **Two of them are assembled**, and it is not for want of looking. Mai
 * Valentine and Solomon Muto have no 3D model in existence — not in that game,
 * not in any other that has been ripped, not on Sketchfab, not in the MMD
 * catalogues. Neither has ever been a playable duelist in a 3D game, so there
 * is nothing to extract, and the fan sculptors make Yugi and Kaiba. Those two
 * stay as they were: a body off the generic roster, repainted, plus geometry
 * for whatever the roster cannot supply.
 *
 * That split is worth keeping in view. Anybody the games shipped as a playable
 * body can be imported in about a minute; anybody they did not has to be built,
 * and building is where the hours go.
 */

/** A whole character in the one thing each of them says for now. */
const greeting = (lines: string[]): Record<string, DialogueNode> => ({
  greet: { lines, choices: [] },
});

const CAST: WorldNpc[] = [
  {
    id: 'yugi',
    /* His own model, so nothing to dress and nothing to build. */
    character: { name: 'Yugi Muto', model: 'yugi', tints: [], stature: 0.5 },
    x: -7.5,
    z: 10.5,
    facing: Math.PI * 0.85,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Oh — hello! I am Yugi.',
      'Grandpa said someone new had turned up. Come and find me when there is duelling to be done.',
    ]),
  },
  {
    id: 'yami',
    character: { name: 'Yami Yugi', model: 'yami', tints: [], stature: 0.5 },
    x: 7.5,
    z: 10.5,
    facing: -Math.PI * 0.85,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'So. Another duelist.',
      'We will play, in time. I look forward to seeing what you are made of.',
    ]),
  },
  {
    id: 'kaiba',
    character: { name: 'Seto Kaiba', model: 'kaiba', tints: [], stature: 0.5 },
    x: 13,
    z: 4.5,
    facing: -Math.PI * 0.62,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Kaiba. Seto Kaiba — and no, I have not heard of you.',
      'Come back when you have a deck worth my time.',
    ]),
  },
  {
    id: 'joey',
    character: { name: 'Joey Wheeler', model: 'joey', tints: [], stature: 0.5 },
    x: -13,
    z: 4.5,
    facing: Math.PI * 0.62,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Hey! Joey Wheeler — good to meet ya.',
      'Stick around. This place is gonna get a lot more interesting.',
    ]),
  },
  {
    id: 'mai',
    /*
     * Mai Valentine. The `executive`, which is the only jacket-and-blouse on
     * the roster, in her violet. This model carries no separate eye or brow
     * material — its face is painted into two, `Brown` for the features and
     * `Red` for a long fall of hair — so the hair goes blonde by repainting
     * `Red`, which is worth knowing before anybody tints it as a garment.
     */
    character: { name: 'Mai Valentine', model: 'executive', tints: [AS_AUTHORED, AS_AUTHORED, AS_AUTHORED], stature: 0.7 },
    overrides: {
      /* The jacket. */
      LimeGreen: '#7d4fa8',
      /* Trim, and her gloves. */
      Gold: '#e8dcc0',
      /* The hair. */
      Red: '#e6c65e',
    },
    x: 0,
    z: 15.5,
    facing: Math.PI,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Well, hello. Mai Valentine.',
      'Do try to be interesting, sweetheart. Most of them are not.',
    ]),
  },
];

/**
 * Everybody standing in the field.
 *
 * Grandpa is six and a half metres up the +Z axis, facing back down it — which
 * is directly in front of a duelist arriving at the spawn, at a distance where
 * he is unmistakably *there* without being in the way. New players walk into
 * him on purpose; anyone who would rather not can simply go around.
 *
 * The rest stand further out and turned inward, in a rough arc past him, so
 * that walking on from the first conversation finds a second. They are spread
 * far enough apart that no two prompts can be live at once — the nearest pair
 * are seven metres apart against a talking range of three — and all of them sit
 * well inside the world's 120-metre edge.
 */
export const WORLD_NPCS: WorldNpc[] = [
  {
    id: 'grandpa',
    character: GRANDPA_LOOK,
    overrides: GRANDPA_DRESS,
    accessories: GRANDPA_HEAD,
    x: 0,
    z: 6.5,
    facing: Math.PI,
    /* Comfortably wider than a pace, so the prompt does not flicker on and
       off while you are standing still fidgeting with the stick. */
    range: 3.2,
    start: 'greet',
    script: GRANDPA_SCRIPT,
  },
  ...CAST,
];

/** Fills the one token a line may carry. */
export function sayLine(line: string, playerName: string): string {
  return line.replace(/\{name\}/g, playerName);
}
