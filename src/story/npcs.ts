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

import type { AreaId } from './areas';
import type { PremadeCharacter, RepaintRule } from './premade';
import type { AccessorySpec } from '@/components/story/accessories';
import { ASH_HAUNTS, ashWhereabouts, type Haunt } from './ash';

export interface DialogueChoice {
  /** What the player says. */
  label: string;
  /**
   * Leaves the conversation and duels this character instead.
   *
   * The node named by `to` is not shown now — it is where the conversation
   * resumes *after* the duel, and which one is used depends on how it went.
   * That is the whole of the mechanism: a duel is a branch that takes a while
   * and comes back with one bit of information.
   */
  duel?: boolean;
  /**
   * Opens this character's shop instead of advancing the conversation.
   *
   * The same shape as `duel` and for the same reason: the counter is a screen
   * rather than a node, so the script hands off and the node named by `to` is
   * where the conversation picks up when the player is done buying.
   */
  shop?: boolean;
  /**
   * What the player is putting on the table, for a duel that is played for
   * money — see `WAGER` in `story/shop.ts`.
   *
   * Only ever read alongside `duel`, and it is here rather than in a picker
   * because the amounts are a *conversation*: she asks what you are putting up
   * and you answer, which is one screen fewer and reads like the thing it is.
   * The server clamps whatever arrives into her range, so this is what the
   * player meant and not what they are charged.
   */
  stake?: number;
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

/** How a duel this character offered turned out, and where it picks up. */
export interface DuelOffer {
  /** Which premade duelist plays their side — an id from `decklists.json`. */
  opponentId: string;
  /** The node to resume on when the player won. */
  won: string;
  /** The node to resume on when they did not. */
  lost: string;
  /**
   * What they say when the player names a stake they have not got the money
   * for, and what they say when it is *their* purse that cannot cover it.
   *
   * Only meaningful for somebody who plays for money. The amounts are on offer
   * whether or not either side can afford them, deliberately: a greyed-out
   * reply is a reply that has stopped being part of the conversation, and the
   * player is left to work out why on their own. Answered in her own words it
   * is still a conversation, and it says which of the two of you is short.
   *
   * `{stake}` is the figure asked for, `{money}` what the player is holding and
   * `{purse}` what she has left.
   */
  short?: string;
  spent?: string;
  /**
   * What this character asks for on the table instead of money.
   *
   * `'card'` is Ash's: the conversation opens a picker over the player's
   * collection when a `duel` reply is pressed, and the chosen card is the stake
   * — see `CARD_WAGER` in `story/shop.ts` for what happens to it. Absent for
   * everybody else, who play for a pack, a bounty or a purse.
   */
  wager?: 'card';
  /**
   * What they say when the player has no card to spare — a collection that is
   * exactly a deck, which the owner's rule says may not be bet from. In their
   * own words, like `short`, because a picker that will not open is a button
   * that reads as broken.
   */
  few?: string;
}

/**
 * A route somebody walks when they are not standing still.
 *
 * There and back along a list of points rather than a closed loop: a loop's
 * last leg is the jump from the end of the path to its start, and unless the
 * author closes it by hand that jump is the character walking through
 * everything in between. Reversing at the ends is right by construction, and
 * on a straight run — which is what a path down an avenue is — it is also what
 * pacing looks like.
 *
 * The points are where she *arrives*; `groundAt` supplies the height at every
 * step, so a route may climb stairs without saying so.
 */
export interface RoamRoute {
  /**
   * The points, in the area's metres, in the order they are visited.
   *
   * Two of them at least, and the type says so rather than the renderer
   * checking: a one-point route has no second leg to walk to, and the frame
   * loop reading `path[1]` of it is an exception sixty times a second.
   */
  path: [{ x: number; z: number }, { x: number; z: number }, ...{ x: number; z: number }[]];
  /** Metres a second. */
  speed: number;
  /** Seconds spent standing at each point before moving on. */
  dwell: number;
  /**
   * Roughly how many seconds of walking there are between unplanned stops.
   *
   * A route on its own is a patrol: the same legs, the same pauses, at the same
   * two places, and the eye has it in about ten seconds. This is the number
   * that stops it being one — she halts somewhere along a leg, does something,
   * and goes on. Jittered either side by half again, so two laps never line up.
   *
   * Absent means she only ever stops where the path says, which is right for
   * somebody pacing a beat and wrong for somebody killing an afternoon.
   */
  restEvery?: number;
  /**
   * Clips she may play while stopped, by name, chosen at random.
   *
   * Authored by `scripts/blender/make-gesture.py` and additive over whatever
   * the body is already doing, so a character who has none simply stands —
   * naming one a model has not got costs nothing and does nothing.
   *
   * The stop lasts as long as the clip does. A gesture cut off half way by the
   * route moving on is worse than no gesture, and the rig returns the length
   * for exactly this.
   */
  gestures?: string[];
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
  /**
   * Somebody who is not quite here: translucent, shadowless, and walked
   * through rather than round.
   *
   * The third is the one that matters to the world rather than to the eye.
   * Every other NPC is a metre-wide cylinder the player is pushed out of, and
   * a cylinder that *moves* is a cylinder that can shove you off a terrace or
   * corner you against a wall. A spirit has no such body, so a route may run
   * straight down the middle of the avenue everybody walks up.
   */
  spirit?: boolean;
  /**
   * Where they go when nobody is near, if they go anywhere.
   *
   * Absent on everybody standing still, which is everybody else: a shopkeeper
   * behind his counter and two duelists waiting in a street are *placed*, and
   * a placed character who wanders is a character you cannot find twice.
   *
   * They stop the moment the player is close enough to be noticed — the same
   * distance that turns them to face you — because an NPC you have to chase to
   * talk to is a worse idea than one who never moves.
   */
  roam?: RoamRoute;
  /** Which area they stand in. */
  area: AreaId;
  /** Where they stand, in that area's metres — the first point of a `roam`. */
  x: number;
  z: number;
  /** Which way they face when nobody is near, in radians (0 is +Z). */
  facing: number;
  /** How close you must be before they can be spoken to, in metres. */
  range: number;
  /** Which node their script opens on. */
  start: string;
  /**
   * What happens if a choice in their script sets `duel`.
   *
   * Absent on anybody who does not duel yet, which is everybody else for now:
   * the cast is being bound to decks one character at a time, and a duel that
   * cannot be answered is worse than an NPC who only talks.
   */
  duel?: DuelOffer;
  /**
   * Somebody who is not always where their record says, or here at all.
   *
   * `area`, `x`, `z`, `facing` and `roam` above are where a placed character
   * *is*; for one of these they are where the tools that iterate the cast
   * (the face lab, the audits) may put them, and where they are in the world
   * is `whereabouts` — which reads the clock, and may answer that they are
   * nowhere right now. Ash is the only one, and the reason it is a function
   * rather than a table is that his is seeded by the day.
   */
  haunts?: Haunt[];
  /** Which of `haunts` they are at, at this hour of this day; `null` is away. */
  schedule?: (hour: number, day: number) => Haunt | null;
  script: Record<string, DialogueNode>;
}

/**
 * Where somebody is at this hour of this day, or `null` if they are not
 * anywhere the player can meet them.
 *
 * For everybody with no schedule it is the record itself — the one place the
 * old fields are read into the new shape — so a renderer or a check asks one
 * question of every NPC and never special-cases the one who moves about.
 */
export function whereabouts(npc: WorldNpc, hour: number, day: number): Haunt | null {
  if (npc.schedule) return npc.schedule(hour, day);
  return { area: npc.area, x: npc.x, z: npc.z, facing: npc.facing, roam: npc.roam };
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
/**
 * Everything he says, which is one thing.
 *
 * Deliberately one node with no choices. The world he is standing in has two
 * areas and nothing to do in either of them yet, so a tutorial would be
 * explaining a game the player cannot go and play — and the long version he used
 * to give (four thousand life points, three monster zones, the five pieces of
 * Exodia) described rules against a world that did not exist to use them in.
 *
 * So he says the true thing instead: go away and play, it is not complicated.
 * It is also in character. He is not a quest marker, he is somebody's
 * grandfather who has explained this several thousand times and has stopped
 * dressing it up.
 *
 * `choices: []` is what makes it repeat: the panel offers a single way out, and
 * walking back into range starts it again from the top, unchanged.
 */
const GRANDPA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, well. A new face.',
      'I can see you are new here, {name} — you have the look. Do not think about it too hard.',
      'It is a card game. Go and play some duels, you will pick it up faster than I could ever explain it. I have been trying to explain it since 1987.',
    ],
    choices: [
      { label: 'What have you got for sale?', to: 'greet', shop: true },
      { label: 'Will you play me?', to: 'offer' },
      { label: 'I will go and duel, then.', to: null },
    ],
  },

  /*
   * The one fixture in the game that is not about winning something.
   *
   * He says the terms out loud — no cards — because every other duelist in the
   * city hands over a pack when they lose, and a player who beat the hardest
   * deck in the game and got nothing would reasonably think it was broken.
   * What he does not do is quote the hundred: the money is a thing that happens
   * when it happens, in his hand, in his own words.
   */
  offer: {
    lines: [
      'Me? I am eighty and I run a shop.',
      'But yes. Sit down.',
      'I will tell you what you are getting into, because it is not what the others offer you. You beat Tony out there and he gives you his cards. You beat me and you get nothing out of my deck — not one of them, not ever. I have had some of these a very long time.',
      'What you get is the practice. I play the hardest deck you are going to meet for a long while, and I will not go easy, and you can come back tomorrow and lose to it again. That is worth more than a card.',
    ],
    choices: [
      { label: 'What do you play?', to: 'style' },
      { label: 'Then let us duel.', to: 'beaten', duel: true },
      { label: 'Maybe when I am better.', to: 'later' },
    ],
  },

  /* He tells you exactly what is coming, which is both in character and the
     fairest thing in the game: the deck takes your monsters and tributes them,
     so a player who leaves a big one on the board has been warned. */
  style: {
    lines: [
      'Three gods, and no honest way of paying for them.',
      'A god wants two monsters on the table to be summoned, and I am an old man with a shop — I do not have two monsters. So I take yours. I borrow, I swap, I buy the thing you were so pleased with, and then I feed it to something older than both of us.',
      'It is not clever. It has been working since 1987.',
    ],
    choices: [
      { label: 'Then let us duel.', to: 'beaten', duel: true },
      { label: 'I will think about it.', to: null },
    ],
  },

  later: {
    lines: [
      'Sensible. I will be here — I am always here.',
    ],
    choices: [],
  },

  /* The player won. He pays, and the payment is the line rather than a number
     on a card: what the save actually does is `BOUNTY.solomon`. */
  beaten: {
    lines: [
      'Well.',
      'Well, well, well.',
      'Here. Take it — out of the till, and do not tell my grandson what I keep in there. You earned it off the three of them and there is not a person in this city who would believe me.',
      'Come back and do it again, {name}. I would like to see whether that was you or whether that was the draw.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'I will spend this first.', to: 'greet', shop: true },
      { label: 'Another time.', to: null },
    ],
  },

  /* The player lost. One thing to fix, said plainly, because the whole point of
     this fixture is the next attempt. */
  won: {
    lines: [
      'There it is.',
      'You left something big out where I could reach it, and I thanked you for it. That is the whole trick, and knowing it is most of beating it.',
      'Do not put your best monster down because you are proud of it. Put it down because I cannot answer it. Go on — again when you are ready.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'Let me think about that.', to: null },
    ],
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

/**
 * Mai, who is the first person out here you can actually play.
 *
 * She talks the way she is written: bored until you are worth her time, and
 * unbothered either way. The invitation is hers rather than the player's — she
 * is the one who decides you are interesting enough — which is both truer to her
 * and the reason it can be refused without the refusal feeling like a menu.
 *
 * `beaten` and `won` are named from *her* side, matching `DuelOffer`, which is
 * worth saying out loud because it reads backwards at a glance: `beaten` is the
 * node for when she has been, so it is the player's victory.
 */
const MAI_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, hello. Mai Valentine.',
      'Do try to be interesting, sweetheart. Most of them are not.',
    ],
    choices: [
      { label: 'Who are you?', to: 'who' },
      { label: 'I could be interesting.', to: 'offer' },
      { label: 'Just passing through.', to: null },
    ],
  },

  who: {
    lines: [
      'Mai Valentine. Professional, since you were going to ask badly.',
      'I read people, sweetheart. What they want, what they are afraid of, and which of the two they are holding. The cards are the easy part.',
    ],
    choices: [
      { label: 'Read me, then.', to: 'offer' },
      { label: 'That sounds like a bluff.', to: 'offer' },
      { label: 'Maybe later.', to: null },
    ],
  },

  offer: {
    lines: [
      'Mm. You have the look of someone who built a deck this morning and has not found out yet.',
      'So let us find out. You and me — bring whatever you have sleeved, and I will show you what it is missing.',
    ],
    choices: [
      { label: "You're on. Let's duel.", to: 'beaten', duel: true },
      { label: 'Not yet — I want to fix my deck first.', to: 'later' },
      { label: 'Some other time.', to: null },
    ],
  },

  later: {
    lines: [
      'Sensible. Rare, but sensible.',
      'Go and shuffle it until it stops embarrassing you. I will be here — I am not in a hurry, and neither is the field.',
    ],
    choices: [],
  },

  /* The player won. She is gracious in the way she is: by moving the
     compliment somewhere it costs her less. */
  beaten: {
    lines: [
      'Well. That is not how I saw that going.',
      'You play like you mean it, {name}. Not clean, not clever — but you never stopped coming, and most of them stop.',
      'Do not let it go to your head. I will want that one back.',
    ],
    choices: [
      { label: 'Again, then?', to: 'beaten', duel: true },
      { label: 'I will take the win.', to: null },
    ],
  },

  /* The player lost. No gloating: she is not cruel, she is just right, and
     the line that matters is the one that tells them what to fix. */
  won: {
    lines: [
      'And that is the part nobody tells you.',
      'You had the cards, sweetheart. You played them in the order you drew them, which is not the same as playing them.',
      'Three monster zones and one back row. Decide what the board is going to look like *before* you swing, and come find me again.',
    ],
    choices: [
      { label: 'Run it back.', to: 'won', duel: true },
      { label: 'I need to think about that.', to: null },
    ],
  },
};

/**
 * The cast, built and waiting to be placed.
 *
 * Every one of these is finished — rigged, animated, and carrying the dialogue
 * they will use. They are *not* in `WORLD_NPCS` because the world they belong in
 * does not exist yet: they are duelists you meet on a tournament circuit, and
 * there is one street and one shop so far. Standing five named characters in a
 * road because they happen to be ready is how a world stops feeling like a place
 * and starts feeling like a character select screen.
 *
 * Introducing one is moving it into `WORLD_NPCS` and giving it an `area`. That is
 * the whole operation, which is why they are kept here rather than deleted.
 *
 * **Mai's duel goes with her.** Everything that makes her offer a duel and react
 * to the result still exists — `duel`, the routes, the room seating — and it is
 * unreachable while she is not placed, because nobody can walk up to her.
 */
const WAITING: WorldNpc[] = [
  {
    id: 'yugi',
    /* Not placed yet — see WAITING_CAST. */
    area: 'starting-area',
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
    /* Not placed yet — see WAITING_CAST. */
    area: 'starting-area',
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
    /* Not placed yet — see WAITING_CAST. */
    area: 'starting-area',
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
    /* Not placed yet — see WAITING_CAST. */
    area: 'starting-area',
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
    /* Not placed yet — see WAITING_CAST. */
    area: 'starting-area',
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
    /*
     * The first character bound to a deck.
     *
     * `mai` is a duelist in `decklists.json` already — the same premade the
     * menu's solo duel has always been able to seat — so binding her is naming
     * it and the two nodes the result comes back to. Everything that makes the
     * duel a *story* duel is elsewhere: the player brings the twenty-five cards
     * their save says they own rather than a premade, and the way out of the
     * win screen is back to this conversation rather than to a lobby.
     */
    duel: { opponentId: 'mai', won: 'beaten', lost: 'won' },
    script: MAI_SCRIPT,
  },
];


/* ------------------------------------------------------------------ */
/* The two in the street                                               */
/* ------------------------------------------------------------------ */

/**
 * Sarah and Tony, who are the first people you meet who are not shopkeepers.
 *
 * Both duel. Each has a deck of their own in `decklists.json` under their own
 * id, and a `duel` record naming it, so walking up to either of them and saying
 * yes seats a room with your twenty-five against theirs and starts it.
 *
 * They are in the Starting Area rather than the shop because the street is
 * where the game is going to happen, and a street with nobody in it reads as
 * scenery. Two is the right number for now: enough that walking out of the door
 * finds somebody, few enough that the road is still a road.
 *
 * ## Where they stand
 *
 * The walkable street runs x −18..18 and z −9..10, once the terraces, the
 * hoarding and the alley rails are taken out. They are placed on opposite
 * sides of it, both a real walk from the shop door at (2.6, −7.2):
 *
 *   Sarah  (−11.5, 1.5)  16.6 m from the door
 *   Tony   ( 12.5, −1.5) 11.4 m from the door
 *
 * Twenty-four metres apart, against a talk range of 3.2, so their prompts
 * cannot both be live and you never get a choice of two conversations at once.
 * Both sit at least five metres clear of every lamp post, planter, bench, the
 * vending machine and the post box, so neither is standing inside the street
 * furniture and neither can be trapped against it.
 *
 * They face the middle of the road rather than the shop door. Facing the door
 * would mean two strangers staring at it, which reads as an ambush; facing the
 * centre reads as two people who happen to be standing about. The rig turns
 * them to look at you when you get close either way.
 */
const STREET: WorldNpc[] = [
  {
    id: 'sarah',
    area: 'starting-area',
    character: { name: 'Sarah', model: 'sarah', tints: [], stature: 0.5 },
    x: -11.5,
    z: 1.5,
    /* Looking at the middle of the road: atan2(0 − x, 0 − z). */
    facing: 1.7,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'sarah', won: 'beaten', lost: 'won' },
    script: {
      greet: {
        lines: [
          'You came out of the old man\u2019s shop, so you are new. That is not an insult, it is a schedule.',
          'Sarah. I duel, and I am good at it. If you have twenty-five sleeved, we can find out where you are on it.',
        ],
        choices: [
          { label: 'Let\u2019s duel.', to: 'beaten', duel: true },
          { label: 'What do you play?', to: 'style' },
          { label: 'Maybe later.', to: null },
        ],
      },

      /* She tells you exactly what she does. It is not a bluff — the deck is
         walls and a Royal Tribute — and a duelist who warns you and is still
         right is a better character than one who surprises you. */
      style: {
        lines: [
          'Nothing you have not seen. Elves, a witch, a knight or three, and enough two-thousand defence that swinging into me is a decision rather than a habit.',
          'And when your hand is full of monsters you are waiting to summon, I take all of them at once. That is the part people remember.',
        ],
        choices: [
          { label: 'Let\u2019s duel.', to: 'beaten', duel: true },
          { label: 'Noted. Later.', to: null },
        ],
      },

      /* The player won. She is not gracious about it, she is precise about it. */
      beaten: {
        lines: [
          'Hm. You went through the wall instead of round it.',
          'That is the right answer, and I would rather you got there by knowing than by luck. I am not going to ask which it was.',
        ],
        choices: [
          { label: 'Again?', to: 'beaten', duel: true },
          { label: 'I will leave it there.', to: null },
        ],
      },

      /* The player lost. The line that matters is the one that says what to fix. */
      won: {
        lines: [
          'You attacked into two thousand defence twice. The second one was not bad luck.',
          'Look at what is face-up on my side before you declare. If you cannot get through it, set something and make me come to you \u2014 I am in no hurry.',
        ],
        choices: [
          { label: 'Run it back.', to: 'won', duel: true },
          { label: 'Let me think.', to: null },
        ],
      },
    },
  },
  {
    id: 'tony',
    area: 'starting-area',
    character: { name: 'Tony', model: 'tony', tints: [], stature: 0.5 },
    x: 12.5,
    z: -1.5,
    facing: -1.45,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'tony', won: 'beaten', lost: 'won' },
    script: {
      greet: {
        lines: [
          'Tony. Do not let the vest fool you \u2014 I am out here for the cards, same as everybody.',
          'You want a duel or you want directions? Either is fine. One of them is quicker.',
        ],
        choices: [
          { label: 'A duel.', to: 'beaten', duel: true },
          { label: 'What am I walking into?', to: 'style' },
          { label: 'Directions, then.', to: 'where' },
        ],
      },

      style: {
        lines: [
          'Nothing clever. A lot of small things, all at once, and a dragon behind them for when you have run out of answers.',
          'People lose to me because they spend their good card on my worst monster. Then there are four more.',
        ],
        choices: [
          { label: 'Let\u2019s go.', to: 'beaten', duel: true },
          { label: 'I will come back.', to: null },
        ],
      },

      where: {
        lines: [
          'Street runs east to west. Shop behind you, the alley is railed off, and the building site at the far end is not going anywhere.',
          'That is the whole tour. Told you it was quicker.',
        ],
        choices: [
          { label: 'Duel, then.', to: 'beaten', duel: true },
          { label: 'Thanks.', to: null },
        ],
      },

      beaten: {
        lines: [
          'Well. That is what happens when you actually read the board.',
          'Good. Most people out here swing first and count afterwards.',
        ],
        choices: [
          { label: 'Again.', to: 'beaten', duel: true },
          { label: 'That will do.', to: null },
        ],
      },

      won: {
        lines: [
          'You ran out of monsters before I ran out of monsters. That is the whole story.',
          'Three zones is three zones \u2014 do not fill them with things that trade down. Come back when you have something that stays on the field.',
        ],
        choices: [
          { label: 'Again.', to: 'won', duel: true },
          { label: 'Fair enough.', to: null },
        ],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* Isha, in the old ground                                             */
/* ------------------------------------------------------------------ */

/**
 * Isha, who walks the avenue of the Old Cemetery and is not alive.
 *
 * ## Why here and not anywhere else
 *
 * She is a spirit, and the city has exactly one place that is *about* the
 * dead: a hundred and twelve metres of cut stone, moss and fresh flowers on
 * one grave. Standing her in a street would make her a woman with an unusual
 * shader; standing her here makes the whole area mean something it did not
 * mean yesterday — the biggest area in the game had nobody in it at all.
 *
 * ## The route
 *
 * Up the main walk and back down it, x 12.4, which is the one the gate opens
 * on to and the one lined with lanterns. From z −38, a few paces inside the
 * gate, to z 38 on the oldest ground, which is 76 metres and two flights of
 * steps: she climbs to the middle terrace at z −16..−12 and to the high one at
 * z 12..16 without the route saying so, because `groundAt` answers the height
 * at every step.
 *
 * 0.62 m/s is well under a walking pace and it is meant to be — she is not
 * going anywhere. Eight seconds at each end. The whole circuit takes four
 * minutes, so somebody crossing the burial ground meets her about once, which
 * is the right number of times to meet a ghost.
 *
 * Straight down the middle of the walk, which nothing else in this file may
 * do: `spirit` means she has no collision cylinder, so she passes through the
 * player rather than shouldering them into the graves.
 *
 * ## What she is
 *
 * Deliberately never answered. She does not say she is dead, she does not say
 * whose the ground is, and she does not know what year it is — she tells you
 * she has been waiting and lets you work out the rest. A ghost who explains
 * herself is a tour guide.
 */
const ISHA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Oh. You can see me.',
      'That is the part that always takes a moment. Most of them walk straight through and shiver and put it down to the weather.',
      'I am Isha. I have been here a while, {name}.',
    ],
    /* One hop to the duel, like Mai's. Everything else she has to say is on
       the other branch and is optional — a duelist you have to interview
       before you can play them is a duelist most players never play. */
    choices: [
      { label: 'How long is a while?', to: 'long' },
      { label: 'Do you play?', to: 'offer' },
      { label: 'Nothing. I saw nothing.', to: null },
    ],
  },

  long: {
    lines: [
      'The elms were smaller. The gate was wood.',
      'I stopped counting when the counting stopped helping. You will find that is how it goes.',
    ],
    choices: [
      { label: 'What are you waiting for?', to: 'waiting' },
      { label: 'Do you play?', to: 'offer' },
      { label: 'I should go.', to: null },
    ],
  },

  /* The one line that says what she is, and it is about the ground rather
     than about her. */
  waiting: {
    lines: [
      'Someone to stay long enough to be worth talking to.',
      'They come up the walk with flowers and they are gone in four minutes. You have been here longer than that already, and you have not looked at your feet once.',
      'Everyone looks at their feet here. They know what is under them.',
    ],
    choices: [
      { label: 'Do you play?', to: 'offer' },
      { label: 'I am looking now.', to: 'feet' },
      { label: 'I should go.', to: null },
    ],
  },

  feet: {
    lines: [
      'Good. That is the only manners this place asks for.',
      'Go on, then. Say the name on the nearest one out loud. It costs you nothing and it is the whole of what anybody here wants.',
    ],
    choices: [
      { label: 'Do you play?', to: 'offer' },
      { label: 'I will. Goodbye, Isha.', to: null },
    ],
  },

  offer: {
    lines: [
      'I do. It is what there is to do.',
      'I should tell you before you agree: nothing I put down stays down. You will kill the same thing three times and it will come back up smiling, and by then you will have spent everything you had on it.',
      'That is not a threat. It is just what I am.',
    ],
    choices: [
      { label: 'Then I will kill it a fourth time.', to: 'beaten', duel: true },
      { label: 'Let me fix my deck first.', to: 'later' },
      { label: 'Another time.', to: null },
    ],
  },

  later: {
    lines: [
      'Take as long as you like. I have some.',
    ],
    choices: [],
  },

  /* The player won. She is not sore about it; she has lost before and she is
     still here, which is the joke. */
  beaten: {
    lines: [
      'Well.',
      'You did not swing at the wall. You waited for the trap and then you went through. Nobody waits, {name} — everybody who comes up that walk is in a hurry.',
      'Come back. I am not going to be anywhere else.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'I will leave it there.', to: null },
    ],
  },

  /* The player lost, and the line that matters is the one that says what to
     fix: she recurs, so trading one-for-one is losing slowly. */
  won: {
    lines: [
      'You traded with me. One of yours for one of mine, over and over, and you thought that was even.',
      'It is never even. Mine come back up. Yours are gone.',
      'Stop trading and start taking the board — or make me draw the thing I need instead of the thing I want. Come and find me when you have thought about it.',
    ],
    choices: [
      { label: 'Run it back.', to: 'won', duel: true },
      { label: 'Let me think.', to: null },
    ],
  },
};

/**
 * Everybody standing in the field.
 *
 * Grandpa is six and a half metres up the +Z axis, facing back down it — which
 * is directly in front of a duelist arriving at the spawn, at a distance where
 * he is unmistakably *there* without being in the way. New players walk into
 * him on purpose; anyone who would rather not can simply go around.
 *
 * The other five stand further out and turned inward, in a rough arc past him,
 * so that walking on from the first conversation finds a second.
 *
 * Six of them, where there were eighteen. The twelve that went were static
 * sculpts with no skeleton — they could be placed, turned and talked to, but
 * they could not breathe, and a motionless figure standing next to Yugi shifting
 * his weight reads as unfinished rather than as still. They come back one at a
 * time, rigged at source, through `npm run rigged`.
 *
 * They are spread far enough apart that no two prompts can be live at once —
 * the nearest pair are seven metres apart against a talking range of 3.2 — and
 * all of them sit well inside the world's 120-metre edge.
 *
 * **Nobody but Grandpa stands on the centre line.** An NPC is a 1.1-metre
 * cylinder you slide around, so anybody else up the +Z axis turns the one
 * direction a new player walks into a queue to squeeze past.
 */
/* ------------------------------------------------------------------ */
/* Tina                                                                */
/* ------------------------------------------------------------------ */

/**
 * What Tina is for, which is not the duel.
 *
 * Everybody else in the world so far talks about themselves — Sarah about her
 * walls, Tony about his numbers, Solomon about the rules. Tina talks about
 * something that has not happened yet, and she is the first person here who
 * does. A world where every conversation is about the person in front of you is
 * a world with no weather in it.
 *
 * So she carries a rumour: a tournament above the scale of anything the game
 * has, run by nobody anyone can name, paid for by somebody with a great deal of
 * money. It is told the way a rumour is actually told — she half believes it,
 * she says which part she cannot explain away, and the evidence she offers is
 * not a secret but an *expense*. Somebody spending is the only fact in it, and
 * it is the one that makes the rest worth repeating.
 *
 * She is a courier, which is why it is her: she moves between the market and
 * the station all day and hears the same thing from people who have not spoken
 * to each other. That is also the only reason a rumour is ever worth believing,
 * and she says so.
 *
 * Nothing here sets a flag or opens anything. When the tournament is built, this
 * script is where it is announced from, and the day that happens these nodes
 * change and nothing else does.
 */
const TINA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'You came up from the old man’s shop. {name}, is it — word gets about a metre a minute under this roof.',
      'Tina. I run things between here and the station, which means I hear everything twice before lunch and half of it is worth hearing once.',
    ],
    choices: [
      { label: 'What have you heard?', to: 'rumour' },
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Another time.', to: null },
    ],
  },

  /* The rumour, and immediately the reason she gives it any weight: four
     sources that are not each other's. A character who repeats a thing without
     saying why they believe it is a noticeboard. */
  rumour: {
    lines: [
      'There is a tournament coming. Not a shop ladder and not a city bracket — every duelist there is, wherever they are, and one table left at the end of it.',
      'I have had that from four people this week and not one of them got it from the other three. That is the part I cannot explain away, and I have tried.',
    ],
    choices: [
      { label: 'Who is running it?', to: 'who' },
      { label: 'Sounds like talk.', to: 'doubt' },
      { label: 'Let’s duel.', to: 'wager' },
    ],
  },

  /* The organiser is a hole in the story, and she treats it as the point rather
     than as a gap. The evidence is money moving, because that is the only kind
     a courier would actually have. */
  who: {
    lines: [
      'Nobody has a name. Nobody has half a name. That is exactly why it is still going round — a rumour with a man in it gets argued about and dies.',
      'Somebody is spending, though. Halls booked, screens, tables by the hundred, all of it paid before anybody thought to ask who by. Whoever that is has more money than every address on my round put together, and they are in no hurry to be thanked for it.',
    ],
    choices: [
      { label: 'Why tell me?', to: 'why' },
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'I will keep an ear out.', to: null },
    ],
  },

  why: {
    lines: [
      'Because you will be in it. Everyone will be — that is the whole shape of the thing, and it is the part that ought to worry you rather than the part that flatters you.',
      'So find out what your deck actually does now, while being wrong about it costs you an afternoon.',
    ],
    choices: [
      { label: 'Go on, then.', to: 'wager' },
      { label: 'I will think about it.', to: null },
    ],
  },

  doubt: {
    lines: [
      'Probably. Most of what I carry is, and I would not argue with you for free.',
      'But talk does not put a deposit on a hall, and it has not put one on three. Somebody is spending. Work backwards from that and tell me what else it could be.',
    ],
    choices: [
      { label: 'Who is running it?', to: 'who' },
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Fair enough.', to: null },
    ],
  },

  /*
   * The table. Every road to a duel with her comes through here.
   *
   * Four replies rather than a slider, and they are four replies rather than one
   * because the amount is the only decision in the exchange and a conversation
   * is where decisions in this game are made. The panel greys out anything the
   * player cannot cover, so the choice on screen is always a choice they can
   * make — and `stakeFor` clamps whatever arrives anyway, because the client
   * picking its own number is the client picking its own number.
   *
   * She names the range out loud. A player who cannot afford the two has been
   * told why the reply is dim rather than left to work it out.
   */
  wager: {
    lines: [
      'Not for nothing, though. I do not play for nothing — you put money on the table and I put the same money next to it, and whoever is still standing picks the lot up.',
      'Anything from two to five. Your call, and it wants to be money you actually have on you.',
    ],
    choices: [
      { label: 'Two dollars.', to: 'beaten', duel: true, stake: 2 },
      { label: 'Three.', to: 'beaten', duel: true, stake: 3 },
      { label: 'Four.', to: 'beaten', duel: true, stake: 4 },
      { label: 'Five — all of it.', to: 'beaten', duel: true, stake: 5 },
      { label: 'Not today.', to: null },
    ],
  },

  /* Same contract as Sarah's: she tells you exactly what the deck does, and it
     is true. Twenty-five singles is a fact about the list you can check. */
  style: {
    lines: [
      'Twenty-five cards and no two of them the same. Nothing in there is beating you on its own and I have never pretended otherwise.',
      'What it does is charge you for every one you kill — they go off, or they take something with them, or they come back. And when it is close I have two dice, which do not care what either of us planned.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Noted.', to: null },
    ],
  },

  /* The player won. She pays in cards and hands the rumour back on the way
     out, because that is the thing she actually wanted to give you. */
  beaten: {
    lines: [
      'Hah. You took the trades and did not flinch at any of them. Most people flinch at the second one.',
      'Pick it up, then — yours and mine both, and a pack of the deck on top of it. And when you hear about the tournament off somebody who is not me — and you will — remember where you had it first.',
    ],
    choices: [
      { label: 'Again?', to: 'wager' },
      { label: 'I will leave it there.', to: null },
    ],
  },

  /* The player lost. One thing to fix, stated as a habit rather than a mistake. */
  won: {
    lines: [
      'You stopped swinging once you had worked out what everything did. Right instinct, about three turns late.',
      'I will take that, then. Read what is already face-up before you declare, not after it has gone off in your hand — and come back when that is a habit. I am not going anywhere and neither is the money.',
    ],
    choices: [
      { label: 'Run it back.', to: 'wager' },
      { label: 'Let me think.', to: null },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Ash                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ash Ketchum, who is ten, is not from this cartoon, and is not on any map.
 *
 * He is the one person in Domino City who does not belong to it, and the
 * script has to make that make sense *inside the game* — and keep him
 * mysterious, which is the owner's word. So he explains nothing he does not
 * have to: he knows what a duel is, because everyone here duels; his Pokémon
 * are cards now, special ones — not drawn by him, not printed by anybody,
 * in his bag the morning he arrived — which is why they play on this
 * world's tables and why they will never be traded; and how he got here is
 * a question he has stopped asking out loud. Short lines, no chatter, and a
 * boy who knows a little more than he says. An easter egg that explains
 * itself is a feature.
 *
 * The terms are his, in his own words, and they are the owner's rules with
 * a reason each: his team is not for trade, so a win pays money, and he has
 * more of it than this city gives him a use for; a duel costs one of *your*
 * cards, because where he is from you take a badge off the trainer you beat
 * and here a card is the nearest thing. `wager: 'card'` on the offer is what
 * opens the picker, and `few` is what he says to somebody whose collection
 * is exactly a deck.
 *
 * `{card}` in the two aftermath nodes is the card that was on the table,
 * filled by the panel from the duel's own note — the one token in this file
 * that is not the player's name, and it is here so the loss is named rather
 * than implied.
 */
const ASH_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'You are {name}. The old man said you would come through.',
      'I am Ash. I am not from here. I am not sure I am from anywhere you have heard of.',
    ],
    choices: [
      { label: 'Where are you from?', to: 'from' },
      { label: 'What is that deck?', to: 'cards' },
      { label: 'Do you duel?', to: 'offer' },
      { label: 'Right.', to: null },
    ],
  },

  /* Where he is from, and no answer to how he got here — he has none, and
     he has stopped asking. */
  from: {
    lines: [
      'A long way off. Further than the station goes.',
      'One morning I was there, and the next I was standing in your street with a deck I never packed. Nobody here knows why. I have stopped asking out loud.',
    ],
    choices: [
      { label: 'What is that deck?', to: 'cards' },
      { label: 'Do you duel?', to: 'offer' },
      { label: 'I will leave you to it.', to: null },
    ],
  },

  /* The cards, and the two facts the game needs said out loud: they are real
     cards that work here, and they are never his stake. */
  cards: {
    lines: [
      'Cards I did not draw and nobody printed. They were in my bag the morning I arrived — one for every friend I ever had, and I had a lot of them.',
      'You will not find them in the old man\'s stock, and no pack in this city pulls one. They play, though. Your tables do not seem to know the difference.',
      'They are not for trade. Do not ask twice — the first time was fine.',
    ],
    choices: [
      { label: 'Do you duel?', to: 'offer' },
      { label: 'How do they play?', to: 'style' },
      { label: 'I will not ask.', to: null },
    ],
  },

  /* The terms, all of them, before anybody can say yes, each with its reason
     and none of them softened. */
  offer: {
    lines: [
      'I do. Sit down and I will tell you the terms, because they are not the terms you get anywhere else in this city.',
      'Win, and you get nothing from my deck. Not one card, whatever you offer. You get money — I have more of it than I can use here. Three thousand.',
      'Lose, and I keep one of yours. One card, any card, chosen before we start. Where I am from you take a badge off the trainer you beat. Here, I take a card.',
    ],
    choices: [
      { label: 'Deal. Pick a card, then.', to: 'beaten', duel: true },
      { label: 'How do they play?', to: 'style' },
      { label: 'Not for my cards.', to: 'later' },
    ],
  },

  /* Sarah's contract: he tells you exactly what the deck does, and it is true
     — a Pokémon that has stood a turn evolves, and the evolved one does it
     again. */
  style: {
    lines: [
      'They start small and they do not stay small. Leave one on the field through your turn and it evolves. Leave that one, and it evolves again.',
      'Most people spend their answers on the first shape. That is why I have a bag full of cards.',
    ],
    choices: [
      { label: 'Deal. Pick a card, then.', to: 'beaten', duel: true },
      { label: 'Let me think.', to: null },
    ],
  },

  later: {
    lines: [
      'Sensible. I will be around — one of the shops, some part of the day. I do not keep hours anyone could write down.',
    ],
    choices: [],
  },

  /* The player won. He pays and hands the card back, and says less than he
     is thinking. */
  beaten: {
    lines: [
      'Huh.',
      'Here — your {card}, and the three thousand. You beat them evolved, {name}. I have not had to say that in this city before.',
      'Do not get used to it. Next time I do not wait.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'I will take the money.', to: null },
    ],
  },

  /* The player lost. He keeps the card, names it, and says how it comes back. */
  won: {
    lines: [
      'That was quick. It usually is.',
      'The {card} is mine now. It goes in the bag with the others. You know how to get it back — the same way I got it. Find me.',
    ],
    choices: [
      { label: 'I will be back for it.', to: null },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* The Amazons of Domino Shrine                                        */
/* ------------------------------------------------------------------ */

/**
 * Three sisters walking the shrine precinct, and the first characters here who
 * are a *set*.
 *
 * ## Why three at once, and why they are a ladder
 *
 * Everybody in the city so far is one person with one deck, and the player has
 * no way of knowing whether the next stranger is a step up or a step down until
 * they have lost to them. Three who arrive together can say it themselves:
 * Antiope is the shieldwall and the weakest of them, Panthesilea is the even
 * match, Hippolyta is the queen and the hardest. The decks are built to that
 * order (`data/decklists.json`), and Hippolyta *tells you* the order in as many
 * words — which is a difficulty curve delivered by a character rather than by a
 * number on a menu.
 *
 * ## The letter
 *
 * They are here because somebody sent for them, and none of the three can say
 * who. That is the same organiser Tina hears about in Market Row — she has the
 * halls and the money, they have the invitation — and neither of them knows
 * that the other one is a second source. The player is the only one who gets
 * both halves, and nothing in either conversation points at the other: a
 * character who summarises somebody else's scene is a character doing the
 * player's thinking for them.
 *
 * ## Where they walk
 *
 * The precinct is 64 × 52 m and stands 2.16 m above the street, with the hall
 * across the middle of it — so the open ground is a south band in front of the
 * flight and an aisle up each side. One route each, and the three never come
 * within 7.6 m of each other: both talk ranges are 3.2, so anything over 6.4
 * means two prompts can never live at once, which is a choice of two
 * conversations the world does not offer. Every point and every leg is a place
 * `settle` does not move a body out of, checked in `npm run shrine`.
 */
const ANTIOPE_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Close enough. I can see your hands from here, and that is all I want from a stranger on the steps.',
      'Antiope. My sisters and I have the run of this yard until the summer, by the kindness of a priest who did not ask us many questions.',
    ],
    choices: [
      { label: 'What brings you here?', to: 'letter' },
      { label: 'Sisters?', to: 'sisters' },
      { label: 'Fight me.', to: 'offer' },
      { label: 'I will leave you to it.', to: null },
    ],
  },

  /* The letter, and the one detail that makes it more than a letter: it knew
     where to find them, which nobody does. She reports it flatly and does not
     theorise — the theorising belongs to Hippolyta, who has the standing for
     it. */
  letter: {
    lines: [
      'A letter came. No name at the foot of it, no crest, and paid carriage all the way to a camp that is not on anybody’s road.',
      'It said there would be a tournament, that every duelist alive would be in it, and that we would want to be. My sister says a thing that knows where we sleep is worth walking to. So we walked.',
    ],
    choices: [
      { label: 'Who sent it?', to: 'nameless' },
      { label: 'Fight me.', to: 'offer' },
      { label: 'Good luck to you.', to: null },
    ],
  },

  nameless: {
    lines: [
      'I have carried that letter four hundred miles and read it at every fire. There is no name in it. There is not even a place to send an answer.',
      'Ask Hippolyta. She held it longest and she has said least about it, which in my sister means she has an opinion she does not want argued with.',
    ],
    choices: [
      { label: 'Where is she?', to: 'sisters' },
      { label: 'Fight me.', to: 'offer' },
      { label: 'Another time.', to: null },
    ],
  },

  sisters: {
    lines: [
      'Panthesilea is out in front of the steps, walking off a temper. Hippolyta keeps to the east side, under the trees, where she can see both of us and the gate.',
      'Take me first. I am the shield — I am what you practise on, and I will not pretend otherwise to make myself feel taller.',
    ],
    choices: [
      { label: 'Then let’s go.', to: 'offer' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Later.', to: null },
    ],
  },

  /* Same contract as the rest of the city's duelists: she describes her deck
     accurately, and it is a fact the player can check. A wall deck that claimed
     to be a killer would be the one lie in a conversation nobody can verify. */
  style: {
    lines: [
      'Nothing quick. A shield, a spear behind it, and enough spear-carriers that you will be bored before I am.',
      'I will not take you apart — I have nothing in there that could. I will make everything you try cost you something and see what you have left at the end of it.',
    ],
    choices: [
      { label: 'Let’s find out.', to: 'offer' },
      { label: 'Noted.', to: null },
    ],
  },

  offer: {
    lines: [
      'Good. A dollar on the step, then — that is what it costs to be wrong. Beat me and you take it back with five of mine on top, and the yard is the priest’s, so mind the lanterns.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Not yet.', to: null },
    ],
  },

  beaten: {
    lines: [
      'You came through the shield. It took you long enough that I watched you decide to do it, which is worth more to me than the losing is.',
      'Take a pack of it — the walls are no use to you but the spears might be. And go and find Panthesilea. She has been waiting for somebody to be worth the walk.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'I will do that.', to: null },
    ],
  },

  won: {
    lines: [
      'You went at the shield. Everybody does, once.',
      'The shield is not the deck, {name} — it is the clock. Take it down at your leisure and I will still have a spear behind it. Come back when you have worked out which of us is actually in a hurry.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'I need a think.', to: null },
    ],
  },
};

const PANTHESILEA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'You are the fourth person to walk up these steps today and the first one carrying a deck. I was beginning to think this city duels indoors only.',
      'Panthesilea. I hunt, mostly. Here there is nothing to hunt but duelists, so.',
    ],
    choices: [
      { label: 'Why the shrine?', to: 'why' },
      { label: 'Hunt?', to: 'hunt' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Some other time.', to: null },
    ],
  },

  /* She does not believe the letter and says so in the same breath as admitting
     she came anyway. A sceptic who acts on the thing she is sceptical of is a
     person; one who only sneers is a signpost. */
  why: {
    lines: [
      'Because a letter with no name on it told us to be somewhere, and my sisters wanted to come. I think it is a rich man buying an audience and I think we are the audience.',
      'And I am here, so you may weigh my opinion accordingly. Whoever it is will have to put duelists in a hall to make a tournament of it, and I would rather meet a few of them early.',
    ],
    choices: [
      { label: 'Early for what?', to: 'hunt' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Fair enough.', to: null },
    ],
  },

  hunt: {
    lines: [
      'A hunt is not the kill. It is the three days before it, when you learn what a thing does when it is frightened and what it does when it thinks it is winning.',
      'So I will trade with you. Every one of mine that goes down takes one of yours with it, and I will know your deck by the end of the afternoon whether I win or not.',
    ],
    choices: [
      { label: 'Try it.', to: 'offer' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Not today.', to: null },
    ],
  },

  style: {
    lines: [
      'Nothing that survives. Everything I put down is worth more dead than alive, and the traps are for the moment you decide you have seen enough of it.',
      'It is an even match, if you want the truth of it — my sister on the west side is easier and the one under the trees is not. Start where you like.',
    ],
    choices: [
      { label: 'Here, then.', to: 'offer' },
      { label: 'I will start easier.', to: null },
    ],
  },

  offer: {
    lines: [
      'Set your board, and a dollar down with it. Lose and I keep it; put me down and you take it back and ten of mine with it. I would rather not carry that home anyway.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Give me a moment.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Hah. You let me spend three of them and then took the fourth trade off me — that is the whole hunt, and you did it to me.',
      'A pack of mine, then. And go and stand in front of Hippolyta while you are still pleased with yourself; she is at her best against people who are.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'I will go and see her.', to: null },
    ],
  },

  won: {
    lines: [
      'You killed everything I put in front of you, {name}, and every one of them was meant to be killed.',
      'Count what it cost you next time. That is the only lesson in it and it is not a hard one.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'Later.', to: null },
    ],
  },
};

const HIPPOLYTA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'You have walked past both my sisters to get to me. Either somebody sent you or you cannot count.',
      'Hippolyta. I hold what is left of a people you have not heard of, which is eleven women and a good deal of opinion. Say what you came to say.',
    ],
    choices: [
      { label: 'I want the duel.', to: 'order' },
      { label: 'About the letter.', to: 'letter' },
      { label: 'Nothing. Carry on.', to: null },
    ],
  },

  /* The queen names the ladder, which is the point of her existing: the player
     learns the order to fight the three of them in from somebody standing in
     the world, and not from a difficulty label on a menu. */
  order: {
    lines: [
      'Not yet. Antiope is on the west side and Panthesilea in front of the steps, and you will beat both of them before you are worth my afternoon.',
      'That is not pride, it is arithmetic. My guard calls itself up out of the deck two at a time and there is a cat in there that strikes twice. You want to have learnt something first.',
    ],
    choices: [
      { label: 'I have beaten them.', to: 'offer' },
      { label: 'I will go and do that.', to: null },
      { label: 'Try me anyway.', to: 'offer' },
    ],
  },

  /* She is the one who thinks the letter is a *summons* rather than an
     invitation, and she does not explain why — the third source for Tina's
     rumour, and the only one in the city who sounds worried by it. */
  letter: {
    lines: [
      'It found a camp that has moved twice since spring, and it had my name on it spelled the way my mother spelled it. Nobody alive spells it that way.',
      'So it is not an invitation. Somebody has been keeping a list, and my sisters and I are on it. I intend to arrive at that hall in condition to be disappointing.',
    ],
    choices: [
      { label: 'Then duel me.', to: 'offer' },
      { label: 'Who keeps a list like that?', to: 'money' },
      { label: 'Good luck.', to: null },
    ],
  },

  money: {
    lines: [
      'Somebody who can pay carriage from here to the end of the world and never send a name with it. I have met three men who could afford the gesture and none of them could afford the silence.',
      'Ask in the market if you want gossip. I would rather be ready than informed.',
    ],
    choices: [
      { label: 'Let’s duel, then.', to: 'offer' },
      { label: 'I will ask about.', to: null },
    ],
  },

  offer: {
    lines: [
      'Then stand there and do not apologise for anything. A dollar to sit down, fifteen of mine and your own back if you put me down. I am not cheap and I do not pretend to be.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Give me a minute.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Well. That is the first time since the crossing that I have had to watch the end of one coming.',
      'A pack of the guard, and you have earned the rest of it: when that hall opens, find me in it. I would sooner be beaten twice by somebody I have met than once by a stranger.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'I will see you there.', to: null },
    ],
  },

  won: {
    lines: [
      'You came at the guard and the guard held. It is what a guard is for.',
      'You are not far off, {name}, and I do not say that to be kind — I say it because the next time you stand there I want it to be difficult. Go away and make it difficult.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'I will be back.', to: null },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Step Lane: the last two before the tournament                       */
/* ------------------------------------------------------------------ */

/**
 * Kaela Veyron and Seraphina Drayke, at either end of the steps.
 *
 * ## Why they stand rather than walk
 *
 * Step Lane is not a yard. It is a lane 3.8 m wide between two walls, climbing
 * 5.8 m from the street door at the east end to the terrace at the west, and
 * most of what lies between is flights and half-metre landings — the widest
 * flat piece anywhere in it is about two metres long. A route wants ground to
 * cover; this has none, so they are placed, like Grandpa and the street pair,
 * and the walking is left to the people who have somewhere to walk.
 *
 * ## Off the crown of the lane, both of them
 *
 * An NPC is a 1.1 m cylinder the player is pushed out of, and a lane this
 * narrow is one an NPC can cork. Both stand at |z| 1.1 — a metre off the
 * middle — which leaves better than two metres of clear floor on the other
 * side, against the 0.76 m a duelist needs. Checked rather than eyeballed:
 * `npm run roam` settles a body at each of their spots and at the passing
 * line beside them.
 *
 * They are 27 m apart with the whole climb between them, so there is never a
 * question of which of them the prompt means.
 */
const KAELA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Mind the third step, it is proud of the others by about four millimetres. I have counted it twice and I am going to say something to somebody about it.',
      'Kaela Veyron. I build things that work, and lately I have been building a deck, which turns out to be the same job with worse tolerances.',
    ],
    choices: [
      { label: 'Building for what?', to: 'tournament' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Mind how you go.', to: null },
    ],
  },

  /* The tournament as a *date* rather than a rumour: Tina heard it was coming,
     the Amazons were summoned to it, and these two are the ones who know it
     starts. Nobody repeats anybody else's scene. */
  tournament: {
    lines: [
      'It opens this month. Not "there is talk of" — it opens, they have the hall, and the second round is seeded off what people do between now and then.',
      'Which is why I am stood on a staircase in a strange city tuning a machine deck instead of sleeping. Everybody worth beating is doing the same thing within a mile of here.',
    ],
    choices: [
      { label: 'Who told you that?', to: 'source' },
      { label: 'Let’s duel, then.', to: 'offer' },
      { label: 'Good luck with it.', to: null },
    ],
  },

  source: {
    lines: [
      'A schedule came with my name spelled right and my last four results printed under it. Whoever is running this has been watching longer than I have been entering.',
      'I did not find that comforting and I am not going to pretend the walk here settled it. Ask the one at the top of the steps — she got the same envelope and she thinks it is a compliment.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'I will go and ask her.', to: null },
    ],
  },

  style: {
    lines: [
      'Machines, and they are built to make each other bigger — every one I put down adds to the rest, so the board is worth more at the end of a turn than it was at the start.',
      'And a dragon made of gun barrels, when the arithmetic runs out. Three coins, and whatever they say happens to whatever you have got.',
    ],
    choices: [
      { label: 'Show me.', to: 'offer' },
      { label: 'Noted.', to: null },
    ],
  },

  offer: {
    lines: [
      'Here, then — there is a landing four steps down that is nearly level and I have been using it as a bench all morning.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Not yet.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Hm. You went at the King rather than the board, which is the right answer and not the obvious one.',
      'Take a pack of it. And if you are in that hall next month, come and find me early — I would rather lose to you twice than find out in the bracket.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'I will look for you.', to: null },
    ],
  },

  won: {
    lines: [
      'You let the board build. Four machines is four hundred each, and by the time it mattered the arithmetic was already against you.',
      'Kill the King, {name}. Everything else on my side is ordinary, and it goes back to being ordinary the moment he is gone.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'Later.', to: null },
    ],
  },
};

const SERAPHINA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Up here, if you are coming up. The view is the only thing this street has to recommend it and I have paid for it in calves.',
      'Seraphina Drayke. I keep dragons — properly kept, which means they come back, which is more than most people manage with anything.',
    ],
    choices: [
      { label: 'Why Domino?', to: 'tournament' },
      { label: 'Kept how?', to: 'style' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Enjoy the view.', to: null },
    ],
  },

  tournament: {
    lines: [
      'The same reason as everybody on this hill. It opens this month, and an invitation came to a house that has not been listed anywhere for two generations.',
      'The engineer at the bottom of the steps finds that sinister. I find it flattering, and I am aware those are the same fact.',
    ],
    choices: [
      { label: 'It does not worry you?', to: 'worry' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Good luck.', to: null },
    ],
  },

  worry: {
    lines: [
      'A thing that wants me in a hall has to put me in a hall. Until then it is somebody spending a great deal of money to watch, and I have been watched before.',
      'What would worry me is arriving out of practice. Hence a fortnight on a staircase, duelling anybody who comes up it.',
    ],
    choices: [
      { label: 'I came up it.', to: 'offer' },
      { label: 'Fair enough.', to: null },
    ],
  },

  style: {
    lines: [
      'Fetched, mostly. Every dragon I own knows where another one is — one dies and hands me the next, and a flute puts two down at once when I am in a hurry.',
      'And while the Lord is on the field you may not touch any of them with a card effect. You will have to do it the honest way.',
    ],
    choices: [
      { label: 'The honest way, then.', to: 'offer' },
      { label: 'Another time.', to: null },
    ],
  },

  offer: {
    lines: [
      'Then stand where you are and do not back down the steps — I have watched three people do it and it is undignified for everybody.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'A moment.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Well. You took the Lord first and then everything else at your leisure, which is exactly how it is done and almost nobody does it.',
      'A pack of them, then — they are better company than most people I have met on this street. I shall see you in the hall.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'In the hall, then.', to: null },
    ],
  },

  won: {
    lines: [
      'They came back, {name}. They always come back — that is the entire trick and I told you it up front.',
      'Next time, take the one holding them together before you start counting the big ones. Off you go; the steps are easier down.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'I will be back.', to: null },
    ],
  },
};

export const WORLD_NPCS: WorldNpc[] = [
  {
    id: 'grandpa',
    character: GRANDPA_LOOK,
    area: 'grandpa-shop',
    /*
     * Behind his own counter, which is the whole staging of the scene.
     *
     * The counter runs from x −4.7 to 2.5 and he stands a metre behind the
     * middle of it, so a player walking in through the door at x 2.6 sees him
     * across it rather than beside it. You cannot get round to his side — the
     * counter is solid — so the conversation happens over it, at about a metre
     * and a half, which is exactly the distance you talk to a shopkeeper at.
     */
    /*
     * Nearly in line with the door, not off to one side.
     *
     * He stood at x −1.0 while the door is at x 2.6, so walking straight in —
     * which is what anybody does first — took you past him with three and a half
     * metres of counter between you, and his talk range is 3.4. Verified on
     * production: approaching head-on produced no prompt at all, and only a
     * deliberate diagonal found him. A shopkeeper you have to go looking for is
     * a shopkeeper most players will not meet.
     */
    x: 0.9,
    /*
     * Behind the counter, not in it. The counter runs from z −3.15 to −2.05.
     *
     * He was at −2.95, inside its volume, reading as a head on the worktop. Then
     * −3.3, which is his *centre* 15 cm clear of the back edge — and a person is
     * not a point. A torso is a good 25 cm deep, so his front was still in the
     * woodwork and he stood in the table rather than behind it.
     *
     * 45 cm of clearance puts the whole of him on his own side, and still shows
     * him from the waist up, which is how you see somebody serving.
     */
    z: -3.6,
    /* Facing +Z: towards the door, so he is looking at you as you come in. */
    facing: 0,
    /* Wider than the counter is deep, so the prompt is live from anywhere a
       customer would reasonably stand. */
    range: 3.4,
    start: 'greet',
    /*
     * The hardest fixture in the game, behind the shop counter from the first
     * minute — and the only one that pays no cards. See `KEEPS_THEIR_CARDS` and
     * `BOUNTY` in `story/shop.ts`: his deck is not a prize, his till is.
     */
    duel: { opponentId: 'solomon', won: 'beaten', lost: 'won' },
    script: GRANDPA_SCRIPT,
  },
  ...STREET,
  {
    /*
     * Tina, in the middle of Market Row.
     *
     * ## The floor she is standing on
     *
     * The arcade is 44 m of walkable length and 9.1 m across: the two rows of
     * units close it at z ±4.55, the arch piers take the west end at x −23..−21
     * and the station gateway the east at 21..23. Everything left out on the
     * floor — the crates, the bin, the sacks, the rack, the ice, the bicycles,
     * the bench — hugs one shopfront or the other, so the middle of it is clear
     * end to end. `MARKET_GOODS` in `areas.ts` is the list, read by the
     * collision and by `world/market.ts` both.
     *
     * ## Why here
     *
     * Three ways in, and none of them lands on top of her: the arch from Turtle
     * Lane at (−15, 0), the station gateway at (15.5, 0), and the passage down
     * to Black Crown at (16, 3.1). Her route runs between x ±11.5, so the
     * closest she ever comes to a way in is three and a half metres and she is
     * usually most of the arcade away from all three.
     *
     * She keeps off the centre line, between z 1.2 and 2.5. A market's middle
     * is its thoroughfare and somebody walking down the crown of it is an
     * obstacle; this is the side you use when you are waiting rather than
     * passing, and it stays clear of the awnings, whose camera limit starts at
     * 3.4 — a metre further back and the camera would clamp every time you
     * turned to face her.
     *
     * Range 3.2, the street pair's. She is the only person in Market Row, so
     * unlike Sarah and Tony there is no second prompt to keep hers away from.
     *
     * ## And she does not stay there
     *
     * She walks the arcade, and the rules that make that talkable live in
     * `OpenWorld`: she stops the moment the player is inside `range * 1.6` and
     * turns to face them, so by the time the prompt appears at `range` she has
     * been still for a step and a half — and she stays stopped for as long as
     * the conversation lasts, however far away the duel it sent you to left
     * you standing. Walk off and she picks the route up where she left it.
     */
    id: 'tina',
    area: 'market-row',
    character: { name: 'Tina', model: 'tina', tints: [], stature: 0.5 },
    /* Where the route starts, and so where she is standing the moment the area
       is built. The first point of `roam.path` and this are the same place,
       written once. */
    x: -11.5,
    z: 2.4,
    roam: {
      /*
       * Three points rather than two, and not in a straight line.
       *
       * Two points on one z is a sentry: the same length of pavement, out and
       * back, for ever. Drifting across the arcade between them — 2.4 out, 1.3
       * through the middle, 2.5 at the far end — is the difference between
       * somebody walking a beat and somebody with an afternoon to kill, and it
       * costs one number. The middle point is a *corner* and not a stop: the
       * dwell is charged where the route reverses, so this is 23.1 m of
       * continuous walking each way rather than two ten-metre hops.
       *
       * Every point and every leg sits between z 1.2 and 2.5, which is clear of
       * the lot: the goods hug the shopfronts at |z| 2.9 and beyond, the awnings'
       * camera limit starts at 3.4, and the two end doors and the Black Crown
       * passage are all outside x ±12. She cannot walk into the furniture, she
       * cannot stand on a door trigger, and the camera never clamps on her.
       * `standable` agrees at every point and at forty samples along every leg.
       */
      path: [
        { x: -11.5, z: 2.4 },
        { x: 0.0, z: 1.3 },
        { x: 11.5, z: 2.5 },
      ],
      /**
       * Her own walk, near enough exactly.
       *
       * Her Walk clip is rated at 1.96 m/s of ground coverage, and the rig
       * plays a clip at ground speed over its rating — so this is 0.94× and
       * her feet are honest. The 1.15 that stood here was three fifths of the
       * clip, which is a walk played in slow motion: every step longer than the
       * ground it covered, which is the exact look of somebody sliding.
       *
       * It is also below the run threshold with room to spare. `OpenWorld`
       * reads a roamer's gait as a fraction of `TOP_SPEED` (3.3), so this is
       * 0.56 against a Run blend that starts at 0.62.
       */
      speed: 1.85,
      /* Long enough to turn round in, and no longer: the pause is charged only
         where the route reverses — a point in the middle of a path is a corner,
         not somewhere to arrive at. Twenty-three metres of walking between the
         two of them. */
      dwell: 1.2,
      /* Getting on for half a minute of walking between unplanned stops, give
         or take half again — so about one on a lap of the arcade rather than
         one every ten metres. The stop itself lasts as long as the clip. */
      restEvery: 26,
      gestures: ['Stretch', 'LookAround', 'Settle'],
    },
    /* Looking at the middle of the arcade: atan2(0 − x, 0 − z). Not at either
       gateway — facing a door you did not come through is how a character ends
       up staring at the player's back. */
    facing: -2.55,
    range: 3.2,
    start: 'greet',
    duel: {
      opponentId: 'tina',
      won: 'beaten',
      lost: 'won',
      /* Her side of "you cannot cover that". Names both figures, because the
         player's own purse is not on screen while the panel is up. The tokens
         arrive already carrying their dollar sign — see `sayLine`. */
      short: 'You have {money} on you and you just said {stake}. Come back with it and I will still be here.',
      /* And the other way round, once she has been beaten enough times to feel
         it. Two dollars is the bottom of her range, so she is never out. */
      spent: 'I have {purse} left, love — you have had the rest of it off me. Say {purse} or less and we will play.',
    },
    script: TINA_SCRIPT,
  },
  {
    /*
     * Ash, who is here or not here.
     *
     * The record's own place is the first haunt — Grandpa's shop — which is
     * where the face lab and the audits will find him. Where the *world* puts
     * him is `whereabouts`, which reads the clock and answers with one of two
     * shops or with nothing at all; see `story/ash.ts` for the schedule and
     * for both routes. Range 3.2, the street pair's.
     */
    id: 'ash',
    area: ASH_HAUNTS[0].area,
    character: { name: 'Ash Ketchum', model: 'ash', tints: [], stature: 0.5 },
    x: ASH_HAUNTS[0].x,
    z: ASH_HAUNTS[0].z,
    facing: ASH_HAUNTS[0].facing,
    roam: ASH_HAUNTS[0].roam,
    haunts: ASH_HAUNTS,
    schedule: ashWhereabouts,
    range: 3.2,
    start: 'greet',
    duel: {
      opponentId: 'ash',
      won: 'beaten',
      lost: 'won',
      wager: 'card',
      /* A collection that is exactly a deck has nothing to put on the table —
         the owner's rule, in his voice. */
      few: 'You have got a deck and nothing else. I do not take cards out of the deck a person plays with — that is not a bet. Come back when you have a spare.',
    },
    script: ASH_SCRIPT,
  },
  {
    id: 'isha',
    area: 'old-cemetery',
    character: { name: 'Isha', model: 'isha', tints: [], stature: 0.5 },
    spirit: true,
    /* Where the route starts, and so where she is standing the moment the
       area is built — a few paces inside the gate, facing up the walk. */
    x: 12.4,
    z: -38,
    facing: 0,
    range: 3.2,
    roam: {
      path: [
        { x: 12.4, z: -38 },
        { x: 12.4, z: 38 },
      ],
      speed: 0.62,
      dwell: 8,
    },
    start: 'greet',
    duel: { opponentId: 'isha', won: 'beaten', lost: 'won' },
    script: ISHA_SCRIPT,
  },
  {
    /*
     * The three Amazons, walking the shrine precinct. The block above
     * `ANTIOPE_SCRIPT` says why they are a set, how the yard is divided between
     * them, and what holds the three routes apart.
     *
     * `x`/`z` is the first point of each route, written once: a record is where
     * somebody starts. The facing is only ever used while they stand still,
     * which for a roamer is the moment the area is built — across the yard at
     * the hall, `atan2(0 - x, 4.5 - z)`, so nobody is introduced staring at a
     * wall.
     *
     * Every route speed is a shade under the model's own Walk rating (1.94,
     * 2.07, 1.92 — `npm run gait`), so the clip plays between 0.92× and 0.97×
     * and the feet are honest; all three are well under the 2.05 m/s where the
     * rig starts blending towards a Run. The dwell is short because it is only
     * charged where a route turns round, and `restEvery` is long because the
     * precinct is somewhere people wait rather than pace.
     */
    id: 'antiope',
    area: 'domino-shrine',
    character: { name: 'Antiope', model: 'antiope', tints: [], stature: 0.5 },
    x: -23.0,
    z: -11.5,
    facing: 0.96,
    range: 3.2,
    roam: {
      /* The west aisle: along the front of the precinct and then north up the
         side, 25.4 m each way — the longest of the three, because the west side
         is the one nobody else walks. */
      path: [
        { x: -23.0, z: -11.5 },
        { x: -16.0, z: -10.0 },
        { x: -12.0, z: -9.0 },
        { x: -11.5, z: -1.0 },
        { x: -12.5, z: 5.0 },
      ],
      speed: 1.8,
      dwell: 1.2,
      restEvery: 24,
      gestures: ['Stretch', 'LookAround', 'Settle'],
    },
    start: 'greet',
    duel: { opponentId: 'antiope', won: 'beaten', lost: 'won' },
    script: ANTIOPE_SCRIPT,
  },
  {
    id: 'panthesilea',
    area: 'domino-shrine',
    character: { name: 'Panthesilea', model: 'panthesilea', tints: [], stature: 0.5 },
    x: -1.0,
    z: -10.2,
    facing: 0.07,
    range: 3.2,
    roam: {
      /* Across the front of the steps, 13 m each way. The shortest route of the
         three and the busiest bit of ground: she is the one you meet on the way
         in. It bends a little south in the middle to keep her off the crown of
         the yard and clear of the lantern at (5.6, -12). */
      path: [
        { x: -1.0, z: -10.2 },
        { x: 6.0, z: -10.6 },
        { x: 12.0, z: -10.2 },
      ],
      speed: 1.9,
      dwell: 1.4,
      restEvery: 22,
      gestures: ['Stretch', 'LookAround', 'Settle'],
    },
    start: 'greet',
    duel: { opponentId: 'panthesilea', won: 'beaten', lost: 'won' },
    script: PANTHESILEA_SCRIPT,
  },
  {
    id: 'hippolyta',
    area: 'domino-shrine',
    character: { name: 'Hippolyta', model: 'hippolyta', tints: [], stature: 0.5 },
    x: 16.5,
    z: -4.0,
    facing: -1.09,
    range: 3.2,
    roam: {
      /* The east aisle, 19.2 m each way, from the corner of the yard up past
         the hall — which is where she says she can see both her sisters and the
         gate, and from x 15..16.5 she can. */
      path: [
        { x: 16.5, z: -4.0 },
        { x: 15.5, z: 3.0 },
        { x: 16.0, z: 9.0 },
        { x: 15.0, z: 15.0 },
      ],
      speed: 1.85,
      dwell: 1.5,
      restEvery: 26,
      gestures: ['Stretch', 'LookAround', 'Settle'],
    },
    start: 'greet',
    duel: { opponentId: 'hippolyta', won: 'beaten', lost: 'won' },
    script: HIPPOLYTA_SCRIPT,
  },
  {
    /*
     * The bottom of the steps, a metre off the crown of the lane so the way up
     * stays open — see the block above `KAELA_SCRIPT`. Facing west, up the
     * climb, which is where anybody she is talking to has come from or is
     * going.
     */
    id: 'kaela',
    area: 'step-lane',
    character: { name: 'Kaela Veyron', model: 'kaela', tints: [], stature: 0.5 },
    x: 14.5,
    z: 1.1,
    facing: -Math.PI / 2,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'kaela', won: 'beaten', lost: 'won' },
    script: KAELA_SCRIPT,
  },
  {
    /* The terrace at the top, 5.76 m up and 27 m from Kaela, facing back down
       the steps. */
    id: 'seraphina',
    area: 'step-lane',
    character: { name: 'Seraphina Drayke', model: 'seraphina', tints: [], stature: 0.5 },
    x: -12.5,
    z: -1.1,
    facing: Math.PI / 2,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'seraphina', won: 'beaten', lost: 'won' },
    script: SERAPHINA_SCRIPT,
  },
];

/** Nobody is placed outside `WORLD_NPCS`; `WAITING` is the bench. */
export const WAITING_CAST: WorldNpc[] = WAITING;

/**
 * Fills the tokens a line may carry.
 *
 * `{name}` is the player's own duelist and is the only one a *script* uses —
 * the grammar of a conversation is deliberately that small. The rest are for
 * the lines that answer a number the player just named, where the sentence has
 * to say which figure it is talking about: see `DuelOffer.short`. Money arrives
 * already written as money (`$4`), so a line can read "you said {stake}" and
 * the file is not full of dollar signs standing next to braces — which in a
 * TypeScript file is a template literal waiting to happen.
 */
export function sayLine(line: string, playerName: string, fill?: Record<string, number | string>): string {
  let out = line.replace(/\{name\}/g, playerName);
  for (const [token, value] of Object.entries(fill ?? {})) {
    out = out.split(`{${token}}`).join(String(value));
  }
  return out;
}
