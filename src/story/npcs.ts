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
 * **On the casting.** He used to be assembled, and the note that stood here
 * explained why at some length: no model of him existed, so he was an ordinary
 * adult off the generic roster, repainted grey, with a bandana and a beard
 * generated in `accessories.ts` because paint cannot add a shape.
 *
 * He is modelled now. The whole costume came off with the change — the repaint
 * table, the two accessories, and the barrel-chested `build` that made a slim
 * young adult read as a stout old man — because every one of them was an
 * instruction for a texture and a skeleton he no longer has. What is left is
 * three lines, which is what a character who looks like themselves needs.
 *
 * Stature stays at 0, the short end of the range, for the same reason as
 * before: he should not tower over the person he is welcoming. On a model
 * whose height is his own rather than a generic adult's, that is a nudge
 * rather than the correction it used to be.
 */
const GRANDPA_LOOK: PremadeCharacter = {
  name: 'Grandpa Muto',
  model: 'solomon',
  tints: [],
  stature: 0,
};

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
 * The rip-based four, standing about the field.
 *
 * They say hello and nothing else on purpose. The open world is going to be
 * rebuilt around a story, and writing scripts against a world that does not
 * exist yet would be writing them twice; what is worth having *now* is the
 * cast, so that when there is something for them to say, saying it is a matter
 * of adding nodes to a record that already exists.
 *
 * Yugi, Yami, Kaiba and Joey are converted from the character rips of
 * *Yu-Gi-Oh! Duel Monsters: Saikyo Card Battle* (3DS) by `npm run import-rip` —
 * textured, rigged, and carrying the game's own Idle. Their records are three
 * lines each, because a model that already looks like somebody needs no
 * dressing and no accessories: the star hair, the coat and the studded belts
 * are in the file.
 *
 * **These four are the ones that still move.** Everything in `SCULPTED` below
 * is a static mesh, so the field is currently half breathing and half frozen.
 * That is a fact about where the models came from rather than a design, and it
 * is the strongest argument for rigging the sculpts: standing beside Yugi, who
 * shifts his weight, is what makes a motionless Pegasus read as unfinished
 * rather than as still.
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
     * Mai, modelled.
     *
     * What stood here was a page of repaint rules and a ribcage `build`,
     * because she was `woman2` in her colours: two windowed hue rules to get
     * blonde hair out of a blue-grey bob without bleaching the top or the
     * trousers painted within three degrees of it, one for the jacket, one for
     * the skirt, one for the corset — and a closing admission that no amount of
     * paint supplies the silhouette, because that body has a bob and she is
     * drawn with a mane.
     *
     * All of it is deleted rather than adapted. Every rule named a colour in a
     * 256×256 atlas that is not this model's, and the one problem it could
     * never solve is the one being modelled fixed.
     */
    character: { name: 'Mai Valentine', model: 'mai', tints: [], stature: 0.5 },
    /* Off the centre line — see the note on `WORLD_NPCS` about keeping the
       lane past Grandpa walkable. */
    x: 4.8,
    z: 16.5,
    facing: -2.858,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Well, hello. Mai Valentine.',
      'Do try to be interesting, sweetheart. Most of them are not.',
    ]),
  },
];

/* ------------------------------------------------------------------ */
/* The sculpted cast                                                   */
/* ------------------------------------------------------------------ */

/**
 * Twelve more, modelled rather than ripped or repainted.
 *
 * These are the sculpts brought in by `npm run sculpt` — see the block in
 * `premade.ts` and the header of `scripts/import-sculpt.mjs` for what they are
 * and what it took to make them servable. Every record here is the same three
 * lines the rips get, and for the same reason: a model that looks like somebody
 * needs no dressing.
 *
 * **They stand still.** No skeleton, so no idle and no walk. They can be
 * placed, scaled, turned to look at you and talked to; they cannot breathe.
 * Nothing below papers over that, and the arrangement leans into it — they are
 * placed as a gathering rather than scattered mid-stride, which is a pose a
 * motionless figure can hold honestly.
 *
 * `facing` is `atan2(-x, -z)` for each: turned to look at the arrival point, so
 * a duelist walking up the +Z axis meets faces rather than backs. The rig turns
 * them toward you when you come close and releases them back to this.
 */
const SCULPTED: WorldNpc[] = [
  {
    id: 'pegasus',
    character: { name: 'Maximillion Pegasus', model: 'pegasus', tints: [], stature: 0.5 },
    x: -21,
    z: 13,
    facing: 2.125,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Ahh — a new face. How perfectly delightful.',
      'Maximillion Pegasus, creator of this little game we all take so very seriously. Do enjoy yourself, {name}-boy. I shall be watching.',
    ]),
  },
  {
    id: 'keith',
    character: { name: 'Bandit Keith', model: 'keith', tints: [], stature: 0.5 },
    x: 21,
    z: 13,
    facing: -2.125,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Name’s Keith. Bandit Keith. You American? Doesn’t matter.',
      'I don’t lose, kid. When I do, it’s because somebody cheated. Remember that.',
    ]),
  },
  {
    id: 'bakura',
    character: { name: 'Bakura Ryou', model: 'bakura', tints: [], stature: 0.5 },
    x: -10.5,
    z: 21,
    facing: 2.678,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Oh — hello. Bakura Ryou. Sorry, I did not see you coming.',
      'It is nice here, is it not? Quiet. I do rather like the quiet.',
    ]),
  },
  {
    id: 'marik',
    character: { name: 'Yami Marik', model: 'marik', tints: [], stature: 0.5 },
    x: 10.5,
    z: 21,
    facing: -2.678,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'So. Another one crawls into the light.',
      'Enjoy the field while it is empty, {name}. It will not stay that way.',
    ]),
  },
  {
    id: 'mako',
    character: { name: 'Mako Tsunami', model: 'mako', tints: [], stature: 0.5 },
    x: -21.5,
    z: 25,
    facing: 2.431,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Ha! A visitor! Mako Tsunami — the sea is my deck and my dinner.',
      'There is no ocean out here yet, {name}. When there is, I will be in it.',
    ]),
  },
  {
    id: 'rex',
    character: { name: 'Rex Raptor', model: 'rex', tints: [], stature: 0.5 },
    x: 21.5,
    z: 25,
    facing: -2.431,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Rex Raptor. Dinosaurs. That’s the whole pitch, and it’s enough.',
      'You got somethin’ that beats a Two-Headed King Rex? Didn’t think so.',
    ]),
  },
  {
    id: 'weevil',
    character: { name: 'Weevil Underwood', model: 'weevil', tints: [], stature: 0.5 },
    x: -5.5,
    z: 26,
    facing: 2.933,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Heh heh heh. Weevil Underwood, Regional Champion.',
      'Everyone underestimates insects, {name}. Everyone. Right up until the web is finished.',
    ]),
  },
  {
    id: 'odion',
    character: { name: 'Odion Ishtar', model: 'odion', tints: [], stature: 0.5 },
    x: -11,
    z: 32,
    facing: 2.81,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'I am Odion. I serve the Ishtar family, and I do not duel for sport.',
      'You seem harmless enough. Walk on.',
    ]),
  },
  {
    id: 'ishizu',
    character: { name: 'Ishizu Ishtar', model: 'ishizu', tints: [], stature: 0.5 },
    x: 4.5,
    z: 36,
    facing: -3.017,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'I am Ishizu Ishtar, keeper of what the tombs remember.',
      'I have seen a great deal of what is coming, {name}. Not all of it is yours to know yet.',
    ]),
  },
  {
    id: 'priest-seto',
    character: { name: 'Priest Seto', model: 'priest-seto', tints: [], stature: 0.5 },
    x: 11,
    z: 32,
    facing: -2.81,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'You look upon a priest of the Pharaoh’s court. Three thousand years is a long walk.',
      'The face is familiar to you, I think. It usually is.',
    ]),
  },
  {
    /*
     * Not from this story, and standing here anyway.
     *
     * Kept slightly out on the right rather than tucked away: a joke that is
     * hidden is not a joke. He is the furthest of the humans from the arrival
     * point, so nobody meets him before they have met anybody real.
     */
    id: 'ash',
    character: { name: 'Ash Ketchum', model: 'ash', tints: [], stature: 0.5 },
    x: 22,
    z: 35,
    facing: -2.58,
    range: 3.2,
    start: 'greet',
    script: greeting([
      'Hey! I think I might be in the wrong game.',
      'Cards, right? I have got a deck somewhere. Probably. Good luck, {name}!',
    ]),
  },
  {
    /*
     * The dragon, and the one entry here that is not a person.
     *
     * Placed at the far end of the axis every other character is arranged
     * around, so it closes the view: walk straight on from Grandpa and you end
     * up in front of it. Eleven metres past Ishizu, which is well clear of
     * anybody's prompt.
     *
     * `range` is nearly double everyone else's because the model is about six
     * and a half metres long — at 3.2 you would have to be standing inside its
     * chest before it noticed you. The turn-to-look applies to it as it does to
     * the rest, which on something this size is worth more than it is on a
     * person.
     */
    id: 'blue-eyes',
    character: { name: 'Blue-Eyes White Dragon', model: 'blue-eyes', tints: [], stature: 0.5 },
    x: 0,
    z: 46,
    facing: -Math.PI,
    range: 6,
    start: 'greet',
    script: {
      greet: {
        lines: [
          'The dragon regards you without moving. Somewhere behind the eyes there is nothing that wants to talk.',
          'You are, it decides, not worth standing up for.',
        ],
        choices: [],
      },
    },
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
 * The rest stand further out and turned inward, in widening arcs past him, so
 * that walking on from the first conversation finds a second. Eighteen of them
 * now, from six and a half metres out to forty-six, and the ordering is by how
 * much a new player needs them: the teacher first, then the four who move, then
 * the rest of the cast, then the dragon closing the far end.
 *
 * They are spread far enough apart that no two prompts can be live at once —
 * the nearest pair are 6.6 metres apart against a talking range of 3.2, so two
 * ranges cannot even touch — and all of them sit well inside the world's
 * 120-metre edge.
 *
 * **Nobody but Grandpa stands on the centre line**, and that is a rule rather
 * than an accident of arrangement. The first draft of the sculpted cast put
 * Mai, Weevil and Ishizu at x=0 with the dragon behind them, which reads well
 * in a plan view and is miserable to walk through: an NPC is a 1.1-metre
 * cylinder you slide around, so four of them stacked up the +Z axis turned the
 * one direction a new player walks into a corridor of people to squeeze past,
 * starting with Grandpa, who you cannot get around without noticing you are
 * stuck on him. They are offset a few metres now. The dragon keeps the axis
 * because it is forty-six metres out and closes the view.
 */
export const WORLD_NPCS: WorldNpc[] = [
  {
    id: 'grandpa',
    character: GRANDPA_LOOK,
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
  ...SCULPTED,
];

/** Fills the one token a line may carry. */
export function sayLine(line: string, playerName: string): string {
  return line.replace(/\{name\}/g, playerName);
}
