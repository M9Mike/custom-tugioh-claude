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

import type { PremadeCharacter, RepaintRule } from './premade';
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
  /**
   * Colour in the texture → colour to repaint it, for the imported bodies.
   *
   * `overrides` names materials, which is how the untextured roster is dressed.
   * These models keep their look in an image instead, so an authored character
   * names the colours themselves.
   */
  repaint?: Record<string, RepaintRule>;
  /**
   * Bone name → local scale, for a character whose build is not the body's.
   *
   * The roster is a dozen generic adults and the cast is larger than that, so
   * a character often lands on a body shaped nothing like them. This reshapes
   * one segment at a time — `Spine1` is the ribcage, `Hips` the pelvis — and
   * the rig puts the children back where they were, so nothing downstream of
   * the change moves or resizes with it.
   */
  build?: Record<string, [number, number, number]>;
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
 * **On the casting.** There is no model of Solomon Muto anywhere — not in the
 * game the rest of the cast came from, not on Sketchfab, not in the MMD
 * catalogues. He has never been a playable duelist in a 3D game, so there is
 * nothing to extract. He is assembled: a body, repainted, plus the two shapes
 * that make him recognisable.
 *
 * The body is one of that same game's ordinary adults, and that is the whole
 * point of the change. He was built on the vendored `punk` when the vendored
 * roster was what the player wore too; now the player is from this game, and a
 * near-realistic body standing next to a 3DS one reads as a visitor from
 * somewhere else. Consistency beats the better silhouette: this body already
 * wears green, which is most of the way to his overalls.
 *
 * Stature 0 is the short end of the range, because he should not tower over
 * the person he is welcoming.
 */
const GRANDPA_LOOK: PremadeCharacter = {
  name: 'Grandpa Muto',
  model: 'man1',
  /* Everything he wears is said in `repaint` below, which can name colours the
     booth's three slots never reach. */
  tints: [],
  stature: 0,
};

/**
 * What the adult has to stop wearing to become a shopkeeper.
 *
 * Colours, not materials: this model keeps its look in a texture. The brown is
 * both his hair and his trousers — one hue family, and no amount of window
 * narrowing separates them, because they are painted the same brown at the same
 * lightness. Grey is the right answer for both at once, which is luck, and the
 * kind of luck worth taking.
 */
const GRANDPA_DRESS: Record<string, string> = {
  /* Hair and trousers together, gone grey. */
  '#5c321f': '#8f8a82',
  '#5c312a': '#a8a29a',
  /* The jacket, taken to the dark green of his overalls. */
  '#6b903d': '#2c5c48',
  '#5a7c3d': '#24503e',
  /* Whatever the pink accent is, off to a cream that reads as his shirt. */
  '#dd76b3': '#e6dcc4',
};

/**
 * The two things no repaint can supply.
 *
 * Everything else about his head is this model's own geometry in a different
 * colour. These two are shapes that are not in the file at all, and they are
 * the two he is recognised by: the bandana, and the moustache and beard under
 * it. They are built in `accessories.ts` against measurements of *this* body's
 * head — heads are not interchangeable across the pack, which is why moving him
 * from one body to another meant measuring again.
 */
const GRANDPA_HEAD: AccessorySpec[] = [
  /* Plain, and tied at the back. */
  { kind: 'bandana', bone: 'Head', color: '#d4842a' },
  /* Lighter than his hair, because it hangs under a chin and is lit from
     above: at the hair's own grey it came out near-black in that shadow.
     Still not white — white is a wizard, and he is a shopkeeper gone grey. */
  { kind: 'beard', bone: 'Head', color: '#ded9d1' },
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
     * Mai Valentine, and the same story as Grandpa: no model of her exists
     * anywhere, so she is an ordinary adult repainted. This body was already
     * wearing violet, which is the colour she is remembered in; what it needed
     * was her hair.
     *
     * The hair is the reason lightness windows exist. This body is painted with
     * three blue-ish things within three degrees of each other — hair, a pale
     * top and light trousers — so naming the hue alone bleaches the lot. What
     * separates them is that the hair is drawn as a gradient from lightness
     * 0.05 to 0.42 and the other two never come below 0.6, so the window covers
     * the whole head and touches neither.
     *
     * The window has to cover all of it. A first attempt stopped at 0.17 to
     * stay clear of the linework and left her with a blonde crown and black
     * ends, because the dark half is not linework — it is the hair, shaded.
     */
    character: { name: 'Mai Valentine', model: 'woman2', tints: [], stature: 0.7 },
    repaint: {
      /*
       * The blonde.
       *
       * Her hair is drawn in two blue-greys — the bulk at hue 0.611 and
       * highlight strands at 0.667 — which are 0.056 apart against a reach of
       * 0.055, so a rule sitting on either one leaves the other behind as
       * flecks. `#44495b` is pitched between them at 0.63, within reach of
       * both; its lightness is the bulk's, so the shading comes out unchanged.
       *
       * It cannot simply be moved further: her coat is hue 0.699, and a rule
       * that reached the strands from the coat's side would take the coat too.
       * 0.63 is 0.069 away from it, which is clear.
       */
      '#44495b': { to: '#e3c25c', lightness: [0.03, 0.44] },
      /* The jacket, near enough the purple it is already painted. */
      '#6555a5': '#6f4d99',
      /*
       * Below the waist, the skirt: this body's light blue capris in her
       * purple. Windowed above the hair, which is only 0.05 away in hue.
       *
       * **This rule must come before the top's.** The two regions are 0.07
       * apart at their centres, which is clear, but the legs carry sub-tones
       * out at hue 0.578 that fall inside the top rule's reach — so with the
       * top first she came out with one leg's worth of pink patches. First
       * match wins, so the legs claim their own tails before the top looks.
       */
      '#b5c3cb': { to: '#6d4a91', lightness: [0.5, 1] },
      /*
       * The corset, which is pink and is the one part of her nobody misremembers.
       *
       * What no repaint supplies is the silhouette. She is drawn with long,
       * thick, spiked hair and this body has a bob; that is geometry, not
       * paint, and it waits for a model of her that does not exist yet.
       */
      '#98aadf': { to: '#d15c96', lightness: [0.5, 0.95] },
    },
    /*
     * `woman2` is drawn as a slight young adult and Mai is not — she is the
     * grown woman of the cast, and her figure is part of how she is drawn.
     * `Spine1` is the ribcage, so widening and deepening it fills out the
     * chest; the shoulders and arms hanging off it keep their own size.
     */
    build: { Spine1: [1.16, 1, 1.3] },
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
    repaint: GRANDPA_DRESS,
    accessories: GRANDPA_HEAD,
    /*
     * Short and round, which is most of how he is recognised. `man1` is a slim
     * young adult, so the barrel goes on here: a wide, deep torso above a
     * pelvis widened to match, and a little taken off the height of both so it
     * reads as stout rather than merely inflated.
     */
    build: {
      Hips: [1.3, 0.94, 1.3],
      Spine: [1.24, 0.95, 1.3],
      Spine1: [1.2, 0.95, 1.26],
    },
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
