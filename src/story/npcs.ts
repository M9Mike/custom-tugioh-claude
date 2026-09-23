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
import { holdsChip, isEntrant, isFinalist, phaseOf, tournamentOpen, type TournamentState } from './tournament';
import { HOST_SPOT, TRAVELLER_BY_ID } from './travel';

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
  /**
   * Somebody who is only in the city once the tournament is.
   *
   * The four who came for it — and Kaiba, who is running it — are not placed
   * before his broadcast has played for this player, and are from then on.
   * Absent on everybody who was here first.
   */
  arrives?: 'tournament';
  /** Which area they stand in. */
  area: AreaId;
  /** Where they stand, in that area's metres — the first point of a `roam`. */
  x: number;
  z: number;
  /** Which way they face when nobody is near, in radians (0 is +Z). */
  facing: number;
  /** How close you must be before they can be spoken to, in metres. */
  range: number;
  /**
   * Which node their script opens on the first time you meet them.
   *
   * The rest are read by name rather than by field, because they are the same
   * decision over and over and twenty records do not need a line each to say
   * it — `openingNode` is the whole rule:
   *
   * - **`again`** is the short version, once you have been introduced. A scene
   *   replayed every time you walk past is a scene the player taps through.
   * - **`meet`** is the first meeting once the tournament is running, for
   *   anybody whose own `start` is tied to the place they used to stand —
   *   they walk the city now, and "mind the third step" is a line for the
   *   steps.
   * - **`ready`** is what they say once the tournament is running and their
   *   star chip is still on the table.
   * - **`chipped`**, once it is not — the player holds it.
   * - **`chip`** is where the conversation resumes after the win that took it,
   *   instead of their ordinary `beaten`.
   * - **`finalist`**, **`out`** and **`finals`** once the finals are set: the
   *   three who went through, everybody who did not, and Kaiba.
   *
   * Any of them may be missing and the conversation simply falls back — Ash
   * has none of the tournament's, deliberately: he is not from here and the
   * tournament is not his.
   */
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
 * Everything he says, which is nearly one thing.
 *
 * The long version he used to give — four thousand life points, three monster
 * zones, the five pieces of Exodia — described rules against a world that did
 * not exist to use them in, so he says the true thing instead: go away and
 * play, it is not complicated. He is not a quest marker, he is somebody's
 * grandfather who has explained this several thousand times and has stopped
 * dressing it up.
 *
 * What he has now that nobody else has is the *terms*. He keeps a till and a
 * card counter, so everybody who buys a pack in this city tells him why they
 * are buying it, and he is the one who will say the number out loud and then
 * tell you not to buy your way to it. Tina has the rumour, the sisters have
 * the letter, he has the arithmetic.
 */
const GRANDPA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, well. A new face.',
      'I can see you are new here, {name} — you have the look. Do not think about it too hard.',
      'It is a card game. Go and play some duels, you will pick it up faster than I could ever explain it. I have been trying to explain it since 1987.',
      'And do it soon, while you can be bad at it in private. There is a tournament coming, and they are not counting wins to let you in — they are counting cards. Ninety-nine on your name. You are carrying {cards}.',
    ],
    choices: [
      { label: 'Ninety-nine?', to: 'hall' },
      { label: 'What have you got for sale?', to: 'greet', shop: true },
      { label: 'Will you play me?', to: 'offer' },
      { label: 'I will go and duel, then.', to: null },
    ],
  },

  /*
   * The terms, said once, by the one character who would actually know them.
   *
   * Two halves and he gives both: what the hall costs to get into, and what
   * happens inside it. The second half is the city's own economy at scale —
   * every duelist out there already pays a bounty when they lose and charges
   * you for losing to them, so the tournament is not a new rule to learn, it
   * is the rule the player has been living under with the volume up.
   *
   * And the honest sentence about his own shop. He sells cards; a shopkeeper
   * who let you think the counter was the short way to ninety-nine would be
   * the one dishonest line in the game.
   */
  hall: {
    lines: [
      'Ninety-nine. Then they will seat you, and not before — and it is a bounty tournament, so bring the rest of your nerve as well.',
      'Everybody in that hall has a price on them. Put one down and you take it: cards off their deck and money out of their pocket. Lose and it goes the other way, and it goes just as fast.',
      'You can buy some of them off me and I will be glad of the custom. But ninety-nine is a long way at my prices, and the cheap way is out there — beat somebody and they hand you a pack of the deck that just lost. That is the whole design of it, and whoever thought of it was not thinking about my till.',
    ],
    choices: [
      { label: 'Show me the shelf, then.', to: 'hall', shop: true },
      { label: 'Will you play me?', to: 'offer' },
      { label: 'Then I had better go and duel.', to: null },
    ],
  },

  /*
   * The second time in, and every time after.
   *
   * Short because he is: an old man in his own shop who has already told you
   * the thing. It still carries both doors — the counter and the duel — so the
   * brevity costs the player nothing, and it carries the count, because the
   * count is the one fact about them that changes between visits.
   */
  again: {
    lines: [
      'Back again, {name}. {left} cards to go, unless you have been hiding some from me.',
      'They are not in here, mind. They are out there, in other people’s decks, and the only way to ask for one is to win it.',
    ],
    choices: [
      { label: 'What is on the shelf?', to: 'again', shop: true },
      { label: 'Play me.', to: 'offer' },
      { label: 'I am going.', to: null },
    ],
  },

  /* Ninety-nine. He has been counting since the first conversation, so he is
     the one who gets to say it first if the player has been listening. */
  ready: {
    lines: [
      'So it is young Kaiba’s tournament. I might have known — that boy has never done anything quietly in his life.',
      'Go on, then. Ten chips, and he will have to shake your hand at the bottom of those steps. I would pay good money to see his face.',
    ],
    choices: [
      { label: 'One more against you first.', to: 'offer' },
      { label: 'Anything I should buy?', to: 'ready', shop: true },
      { label: 'Then I am going.', to: null },
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


/**
 * Yugi, who arrives with the tournament and is the kindest person in it.
 *
 * He talks the way he is drawn: earnest, quick to be pleased for somebody else,
 * and no good at all at pretending a duel does not matter to him. He is the one
 * who tells you the map shows where everybody is, because he is the one who
 * would think you might not know.
 */
const YUGI_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Oh — hi! I’m Yugi. You’re the one Grandpa keeps talking about, aren’t you?',
      'So you made it into the tournament too. I thought you would. Kaiba’s put every one of us out in the city — you’ve probably seen people walking past with that look, like they’re counting chips in their heads.',
      'I’ve got a star chip with my name on it, same as everybody. If you want it, I’d really like to see how you play for it.',
    ],
    choices: [
      { label: 'Let’s duel, Yugi.', to: 'beaten', duel: true },
      { label: 'How are you finding it?', to: 'city' },
      { label: 'Later.', to: null },
    ],
  },

  city: {
    lines: [
      'Honestly? I keep getting lost. The station and the plaza I know, and the school, obviously. The towers are a maze.',
      'Everyone’s out there somewhere. Check your map — the duel disk shows where they all are. Joey’s usually wherever the food is.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'Thanks, Yugi.', to: null },
    ],
  },

  ready: {
    lines: [
      'Hi, {name}! {chips} chips now? That’s great.',
      'Mine’s still here if you want to try for it. No pressure — but I’d like that.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'Where is everyone?', to: 'city' },
      { label: 'Not yet.', to: null },
    ],
  },

  chip: {
    lines: [
      'You did it! That was a really good duel.',
      'Here — my star chip. It’s yours now. Don’t lose it before the finals, okay?',
    ],
    choices: [
      { label: 'Again, just for fun?', to: 'beaten', duel: true },
      { label: 'Thanks, Yugi.', to: null },
    ],
  },

  chipped: {
    lines: [
      'Hey, {name}. You’ve got my chip already — {chips} of ten, right? Keep going.',
      'We can still duel if you want. Just for the fun of it.',
    ],
    choices: [
      { label: 'Just for fun, then.', to: 'beaten', duel: true },
      { label: 'Next time.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Wow. You’re getting really good at this.',
      'I learned something from that one. Thanks, {name}.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Good game.', to: null },
    ],
  },

  won: {
    lines: [
      'That was close! You had me worried for a while there.',
      'You’re really strong, you know — you just gave me a turn I didn’t deserve. Try holding a trap back for the turn I think I’m safe.',
    ],
    choices: [
      { label: 'One more.', to: 'won', duel: true },
      { label: 'I’ll think about it.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! I still can’t believe it.',
      'Whatever happens down there, {name} — let’s give Kaiba a duel he won’t forget.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I didn’t make the cut this time. It’s okay — honestly.',
      'Go and win it, {name}. I’ll be cheering. Loudly. Joey’s teaching me how.',
    ],
    choices: [],
  },
};

/**
 * Yami, who has been waiting a very long time for a game worth playing.
 *
 * Few words, all of them meant. He is the one who says out loud what Kaiba has
 * built — a city made into an arena — and the only one who sounds as though he
 * has seen something like it before.
 */
const YAMI_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'So. The one they call {name}.',
      'Kaiba has made the whole city his arena — every district a table, every duelist a star chip walking the streets. I have seen worse ideas. Not many.',
      'My chip is on the line like any other. If you want it, you will have to take it.',
    ],
    choices: [
      { label: 'Then I will take it.', to: 'beaten', duel: true },
      { label: 'Why are you here?', to: 'why' },
      { label: 'Not today.', to: null },
    ],
  },

  why: {
    lines: [
      'Because a game is being played in this city, and I have never been able to leave a game alone.',
      'And because whoever arranged this wants to see who is left standing at the end. I intend to be there when he finds out.',
    ],
    choices: [
      { label: 'Then duel me.', to: 'beaten', duel: true },
      { label: 'Fair enough.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}. {chips} chips, and the city is watching you collect them.',
      'Mine is still yours to take. Are you ready?',
    ],
    choices: [
      { label: 'It’s time to duel.', to: 'beaten', duel: true },
      { label: 'Not yet.', to: null },
    ],
  },

  chip: {
    lines: [
      'Well played. You earned that.',
      'Take my star chip — and remember what it cost. The finals will ask for more.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'I will remember.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You carry my chip. Carry it well.',
      'If you want to test yourself again, I will not refuse.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'Another time.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Twice, now. You are no accident, {name}.',
      'Whatever Kaiba built this city to find, I suspect it has found you.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'Good game.', to: null },
    ],
  },

  won: {
    lines: [
      'The cards answered me, this time.',
      'You hesitated on the turn you should have committed. When the board opens, walk through it.',
    ],
    choices: [
      { label: 'One more.', to: 'won', duel: true },
      { label: 'I will remember that.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. As it should be.',
      'Kaiba will be watching every move down there. So will I — from across the table.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'My part in this tournament is over. Yours is not.',
      'Go down into that forecourt and finish it, {name}.',
    ],
    choices: [],
  },
};

/**
 * Joey, who has never once been told a tournament exists without entering it.
 *
 * Loud, loyal and delighted, and the one who calls Kaiba "rich boy" to his
 * back and to his face. He is also the one who knows Sarah and Tony are keeping
 * the street, because he has already tried to duel both of them.
 */
const JOEY_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Hey! Joey Wheeler — you’re the new face everybody’s talkin’ about!',
      'Can ya believe this? Rich boy Kaiba’s got the whole city runnin’ around after star chips. Ten of ’em an’ you’re in the finals — an’ he gets to sit in his tower an’ watch.',
      'Well, I ain’t sittin’. My chip’s right here, pal. Wanna try an’ take it?',
    ],
    choices: [
      { label: 'You’re on, Joey.', to: 'beaten', duel: true },
      { label: 'Where is everybody?', to: 'where' },
      { label: 'Later, Joey.', to: null },
    ],
  },

  where: {
    lines: [
      'All over! The market, the station, the shrine, that creepy cemetery — everywhere ’cept the street by the old man’s shop. Sarah an’ Tony are holdin’ that down.',
      'Your duel disk’s got a map on it, ya know. Shows ya where everybody is. Took me a week to figure that out — don’t tell Yugi.',
    ],
    choices: [
      { label: 'Duel me, then.', to: 'beaten', duel: true },
      { label: 'Thanks, Joey.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}! How many ya got? {chips}? Not bad, not bad.',
      'Still room in your pocket for mine? C’mon, let’s go!',
    ],
    choices: [
      { label: 'Let’s go.', to: 'beaten', duel: true },
      { label: 'Where is everybody?', to: 'where' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'Aw, man! Ya got me fair an’ square.',
      'Here. Take the chip — an’ you better make the finals with it, ’cause I’m tellin’ everybody I lost to a finalist.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Deal.', to: null },
    ],
  },

  chipped: {
    lines: [
      'Hey, it’s the chip thief! Just kiddin’.',
      'Wanna go again? No chips on it — just pride. Mine, mostly.',
    ],
    choices: [
      { label: 'Let’s go.', to: 'beaten', duel: true },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again?! Okay, okay — you’re good. I’m big enough to say it.',
      '…Don’t tell Mai.',
    ],
    choices: [
      { label: 'One more?', to: 'beaten', duel: true },
      { label: 'Your secret’s safe.', to: null },
    ],
  },

  won: {
    lines: [
      'Ha! Yeah! Did ya see that?',
      'Look — ya gotta keep somethin’ in your hand for when things go sideways. Things always go sideways. That’s the whole game, pal.',
    ],
    choices: [
      { label: 'Run it back.', to: 'won', duel: true },
      { label: 'Noted.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals, baby! Me! Can ya believe it?',
      'Me an’ you, {name}, down at the towers. Rich boy’s gonna have to watch us both.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Didn’t make it. Man.',
      'Hey — no hard feelin’s. You go down there an’ knock Kaiba’s socks off for me, yeah?',
    ],
    choices: [],
  },
};

/**
 * Mai, who arrives with the tournament and has been the card everybody in the
 * room wanted to take since she was nineteen.
 *
 * She talks the way she is written: bored until you are worth her time, and
 * unbothered either way. The invitation is hers rather than the player's — she
 * is the one who decides you are interesting enough — which is both truer to
 * her and the reason it can be refused without the refusal feeling like a menu.
 *
 * `beaten` and `won` are named from *her* side, matching `DuelOffer`, which is
 * worth saying out loud because it reads backwards at a glance: `beaten` is the
 * node for when she has been, so it is the player's victory.
 */
const MAI_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, hello. Mai Valentine.',
      'So you are one of Kaiba’s little chip-collectors. Ten of them for a seat at his finals, and half this city running from district to district like it is a scavenger hunt.',
      'Mine is not going to be easy, sweetheart. Do try to be interesting.',
    ],
    choices: [
      { label: 'Who are you?', to: 'who' },
      { label: 'Why the hurry?', to: 'hall' },
      { label: 'I could be interesting.', to: 'offer' },
      { label: 'Just passing through.', to: null },
    ],
  },

  hall: {
    lines: [
      'Because nobody waits. Every time you sit down with somebody, the rest of us are sitting down with each other, and the chips go round whether you are watching or not.',
      'So he has built a game where the prize for being good is that everybody comes for you.',
      'I have been that prize since I was nineteen, sweetheart. Welcome to it.',
    ],
    choices: [
      { label: 'I could be interesting.', to: 'offer' },
      { label: 'Who are you?', to: 'who' },
      { label: 'Charming.', to: null },
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
      { label: 'You’re on. Let’s duel.', to: 'beaten', duel: true },
      { label: 'Not yet — I want to fix my deck first.', to: 'later' },
      { label: 'Some other time.', to: null },
    ],
  },

  later: {
    lines: [
      'Sensible. Rare, but sensible.',
      'Go and shuffle it until it stops embarrassing you. I am not in a hurry, and neither is my chip.',
    ],
    choices: [],
  },

  ready: {
    lines: [
      'Back again. {chips} chips — I have been counting, and so has everyone else.',
      'Mine is still here. Come and take it, if you think you can.',
    ],
    choices: [
      { label: 'You’re on.', to: 'beaten', duel: true },
      { label: 'Not today.', to: null },
    ],
  },

  chip: {
    lines: [
      'Hmph. Fine. You played well enough to deserve it.',
      'Here — my star chip. Do not make me regret it by losing it to somebody boring.',
    ],
    choices: [
      { label: 'Again, then?', to: 'beaten', duel: true },
      { label: 'I will take the chip.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You already have my chip, sweetheart. What more could you possibly want from me?',
      '…A rematch. Of course. Fine — for pride.',
    ],
    choices: [
      { label: 'For pride.', to: 'beaten', duel: true },
      { label: 'Not today.', to: null },
    ],
  },

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

  won: {
    lines: [
      'And that is the part nobody tells you.',
      'You had the cards, sweetheart. You played them in the order you drew them, which is not the same as playing them.',
      'Three monster zones and one back row. Decide what the board is going to look like before you swing, and come find me again.',
    ],
    choices: [
      { label: 'Run it back.', to: 'won', duel: true },
      { label: 'I need to think about that.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. Of course I am in them.',
      'Save your best for down there, {name}. I intend to.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I missed the finals. Do not look at me like that.',
      'Go and win the thing. And if anybody asks, you learned everything from me.',
    ],
    choices: [],
  },
};

/**
 * Seto Kaiba, who runs the tournament and does not duel in it.
 *
 * He stands at the bottom of the forecourt at Central Towers — his towers, as
 * far as he is concerned — and he is where the rules live when the broadcast is
 * a memory: the chips, the city, the round nobody watches, the four who go
 * through. He will not duel you. Win his finals first; the story that comes
 * after that is his, and it is not written yet.
 */
const KAIBA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'So. You’re the one who made it this far.',
      'Seto Kaiba. This is my tournament — my city, my rules, my finals. You heard the broadcast.',
      'You have {chips} star chips. Ten gets you down these steps as a finalist. Until then, you’re a spectator with a duel disk.',
    ],
    choices: [
      { label: 'Remind me of the rules.', to: 'rules' },
      { label: 'Duel me.', to: 'no' },
      { label: 'I will be back.', to: null },
    ],
  },

  rules: {
    lines: [
      'Every entrant carries a star chip. Beat them and it’s yours — one chip per duelist, no second helpings.',
      'They’re out in the city and they move, gate to gate, the way you do. Your duel disk tracks every one of them. Use the map.',
      'Every time you duel, the rest of the field duels too. When you reach ten, the three with the most chips join you here. Four finalists. One champion.',
    ],
    choices: [
      { label: 'Understood.', to: null },
      { label: 'Duel me.', to: 'no' },
    ],
  },

  no: {
    lines: [
      'You? Duel me?',
      'Win the finals first. Then we’ll talk about whether you’re worth my time.',
    ],
    choices: [],
  },

  ready: {
    lines: [
      '{chips} chips. The clock is running, and so is the rest of the field.',
      'Come back when you have ten.',
    ],
    choices: [
      { label: 'The rules again.', to: 'rules' },
      { label: 'Duel me.', to: 'no' },
      { label: 'I will.', to: null },
    ],
  },

  finals: {
    lines: [
      'All four finalists. Good.',
      'The finals begin when I say they begin — and I haven’t said it yet. Stay sharp, {name}. You’ll want to be.',
    ],
    choices: [],
  },
};

/* ---- The rest of the main menu, who arrive with the tournament ---- */

/**
 * Maximillion Pegasus, who invented the game and would like everybody to know
 * it, charmingly. Calls Kaiba what he has always called him.
 */
const PEGASUS_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, well! A fresh face at Kaiba-boy’s little carnival — how perfectly delightful.',
      'Maximillion Pegasus. I invented the game every one of you is running about the city for, so you will forgive me if I find all this chip-counting rather sweet.',
      'I carry a chip too, of course. He insisted. Shall we see whether you can take it from the man who drew the cards?',
    ],
    choices: [
      { label: 'Let’s duel, Pegasus.', to: 'beaten', duel: true },
      { label: 'You invented the game?', to: 'author' },
      { label: 'Another time.', to: null },
    ],
  },

  author: {
    lines: [
      'Every card, every rule, every little monster — out of my head and on to paper before Kaiba-boy could spell “hologram”.',
      'He owns the towers, the screens and the broadcast. I own the reason anybody watches. We get along splendidly, as long as nobody mentions it.',
    ],
    choices: [
      { label: 'Then duel me.', to: 'beaten', duel: true },
      { label: 'Fair enough.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}! {chips} chips — you have been busy. I do love watching a story pick up pace.',
      'Mine is still here, and still quite shiny. Care to try your luck against the author?',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'Tell me about the game.', to: 'author' },
      { label: 'Not now.', to: null },
    ],
  },

  chip: {
    lines: [
      'Oh, bravo! Truly. It has been an age since anybody turned a page on me like that.',
      'Here — my chip, with my compliments. Do tell Kaiba-boy where you got it. His face will be a gift.',
    ],
    choices: [
      { label: 'Again, for fun?', to: 'beaten', duel: true },
      { label: 'I will.', to: null },
    ],
  },

  chipped: {
    lines: [
      'The one who took my chip! I tell everyone. It makes me sound generous.',
      'Another game? Nothing on it but my pride, and I have plenty of that to spare.',
    ],
    choices: [
      { label: 'Go on, then.', to: 'beaten', duel: true },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again! My, my. You read a board the way I read people.',
      'That is a compliment, {name}. I rarely hand those out twice in one afternoon.',
    ],
    choices: [
      { label: 'One more?', to: 'beaten', duel: true },
      { label: 'I’ll take it.', to: null },
    ],
  },

  won: {
    lines: [
      'Oh dear — did the toons get you? They do that. They never did learn when to stop.',
      'A word from the author: a card nobody can reach is only frightening until you stop reaching for it. Change the question instead.',
    ],
    choices: [
      { label: 'Run it back.', to: 'won', duel: true },
      { label: 'Noted.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! And they say an old designer cannot keep up.',
      'I shall see you at the towers, {name}. Do save Kaiba-boy a seat in the audience — somebody has to watch.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Not a finalist? How deliciously humbling. I shall write it into the next set.',
      'Go on, {name}. Win it — and play something I designed while you do.',
    ],
    choices: [],
  },
};

/**
 * Ishizu Ishtar, who has seen the tournament before it happened and is still
 * glad to be surprised by it. Marik's sister, which she does not hide.
 */
const ISHIZU_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'You have come to me. I saw that you would — though not which road you would take here.',
      'I am Ishizu Ishtar. The Necklace I wear shows me what is to come, and it has shown me this tournament many times: many duelists, one city, and one who does not stop walking.',
      'I carry a star chip, as Kaiba asked. If you wish to test the future, I will not refuse you.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'What does the Necklace show?', to: 'future' },
      { label: 'Another time.', to: null },
    ],
  },

  future: {
    lines: [
      'Fragments. A tower, a crowd, four people at the foot of a flight of steps.',
      'And my brother, walking the city with something in his shadow that is not him. If you meet Marik, be careful what you promise him. Odion watches over him, as he always has.',
    ],
    choices: [
      { label: 'Then duel me.', to: 'beaten', duel: true },
      { label: 'I will be careful.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}. {chips} chips — I saw it would be about so many by now.',
      'Mine remains. The future is a guide, not a cage. Shall we see?',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'The Necklace?', to: 'future' },
      { label: 'Not yet.', to: null },
    ],
  },

  chip: {
    lines: [
      'So. That was not the future I was shown.',
      'Take the chip. It is good, sometimes, to be surprised — it means the road is still being written.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Thank you, Ishizu.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You hold my chip, {name}. I have made my peace with it.',
      'If you wish to duel again, I will. There is nothing on it now but what we learn.',
    ],
    choices: [
      { label: 'Let’s.', to: 'beaten', duel: true },
      { label: 'Another time.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Twice. Perhaps the Necklace should be asking you what comes next.',
      'Go gently, {name}.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Goodbye, Ishizu.', to: null },
    ],
  },

  won: {
    lines: [
      'I knew where that turn was going before you played it. That is not a trick — you showed me.',
      'Hold something back. A duelist who spends everything at once has told the other where the end is.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'I will remember.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. The steps I saw, and I am standing on them.',
      'We will meet there, {name}. I do not know how it ends. For once, I am glad.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I will not be at the finals. I saw that too, though I hoped to be wrong.',
      'Go, {name}. Whatever the Necklace says, the ending is yours to find.',
    ],
    choices: [],
  },
};

/**
 * Priest Seto, out of his own time and not about to admit it bothers him. He
 * has noticed who else in the city wears his face.
 */
const PRIEST_SETO_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Stand where I can see you. You carry a disk upon your arm, as they all do in this city of glass.',
      'I am Seto, high priest of the Pharaoh’s court. I woke among these towers with a Rod in my hand and a stone chip in my belt, and a man with my face on every wall calling it a tournament.',
      'I do not understand this place. I understand a duel. Will you face me?',
    ],
    choices: [
      { label: 'I will face you.', to: 'beaten', duel: true },
      { label: 'A man with your face?', to: 'face' },
      { label: 'Another time.', to: null },
    ],
  },

  face: {
    lines: [
      'On every screen, speaking with my voice and none of my manners. Kaiba, they call him.',
      'He summons monsters as I did, and he commands as I did, and he has never once knelt to a pharaoh. I find I do not dislike him as much as I should.',
    ],
    choices: [
      { label: 'Duel me, priest.', to: 'beaten', duel: true },
      { label: 'Strange days.', to: null },
    ],
  },

  ready: {
    lines: [
      '{chips} chips. In my court that is a tally worth a name.',
      'Mine is yours for the taking — if you can take it. Come.',
    ],
    choices: [
      { label: 'I will.', to: 'beaten', duel: true },
      { label: 'About Kaiba…', to: 'face' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'Enough. You have won it, and a priest does not argue with an ending.',
      'Take the chip. When you stand before the one with my face, tell him Seto of the court sends his regards.',
    ],
    choices: [
      { label: 'Once more?', to: 'beaten', duel: true },
      { label: 'I will tell him.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip already. The Pharaoh himself took nothing twice from me.',
      'But I will duel you for the practice of it. A priest keeps his hand sharp.',
    ],
    choices: [
      { label: 'Then duel.', to: 'beaten', duel: true },
      { label: 'Another time.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again I fall. The gods favour you, or your deck is better built than it looks.',
      'Either way, I will remember your name, {name}.',
    ],
    choices: [
      { label: 'Once more.', to: 'beaten', duel: true },
      { label: 'Farewell.', to: null },
    ],
  },

  won: {
    lines: [
      'Kneel — no. They tell me that is not done here.',
      'Learn this: a monster summoned without purpose is a servant left standing in the rain. Every card you call must be called to do something.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'Understood.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. I will stand before the one with my face and see which of us the monsters answer to.',
      'Do not be late, {name}.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I will not stand in the finals. In my time, a priest who lost this often was sent to count grain.',
      'Go. Win it. And if the one with my face wins instead — do not tell me.',
    ],
    choices: [],
  },
};

/**
 * Yami Marik, having a wonderful time. Menace at arm's length — he enjoys
 * frightening people rather more than he enjoys hurting them, which is the
 * register a card game can carry.
 */
const YAMI_MARIK_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Ahh. A duelist, walking right up to me. How brave. How very, very foolish.',
      'You may call me Marik. The real one, not the pale little thing who usually wears this face. Kaiba has given me a chip and a city to hunt in, and I have been having a wonderful time.',
      'Duel me. I promise you will remember it.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'The real one?', to: 'shadow' },
      { label: 'I’d rather not.', to: null },
    ],
  },

  shadow: {
    lines: [
      'There are two of us in here. He is the one who worries. I am the one who enjoys himself.',
      'His sister walks the towers, and his faithful Odion follows me about as if he could put me back in a box. Let them try. Now — are we duelling, or are you going to keep asking questions?',
    ],
    choices: [
      { label: 'Duelling.', to: 'beaten', duel: true },
      { label: 'Neither.', to: null },
    ],
  },

  ready: {
    lines: [
      '{chips} chips. You have been collecting little trophies. So have I.',
      'Come and try for mine. The Rod and I are waiting.',
    ],
    choices: [
      { label: 'Let’s go.', to: 'beaten', duel: true },
      { label: 'Two of you?', to: 'shadow' },
      { label: 'Not now.', to: null },
    ],
  },

  chip: {
    lines: [
      'No. No, no — fine. Take it.',
      'Enjoy your little star, {name}. The finals are a long way down, and it is very dark at the bottom of the steps.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'I’ll manage.', to: null },
    ],
  },

  chipped: {
    lines: [
      'The thief returns. I remember you. I remember everyone.',
      'Another duel? Nothing to win. Something to lose, though. Your nerve, perhaps.',
    ],
    choices: [
      { label: 'Try me.', to: 'beaten', duel: true },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again. How irritating. How absolutely fascinating.',
      'Go, before I start to like you.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Gladly.', to: null },
    ],
  },

  won: {
    lines: [
      'Hahaha! Did you feel that? That is what it is like to lose to me.',
      'Something for free: you showed me your whole plan by your second turn. Fear is honest, {name}. Hide yours.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'I will.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. At the bottom of Kaiba’s precious steps, with everybody watching. Perfect.',
      'I will see you there, {name}. Bring your nerve.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Out? Me? This tournament is poorly designed.',
      'Go on, then. Win it — while I am feeling generous.',
    ],
    choices: [],
  },
};

/**
 * Odion, who came to the city because Marik did and walks a step behind him.
 * Says little, means all of it.
 */
const ODION_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Forgive me. I have been watching the crowd; I did not see you come.',
      'I am Odion. I serve the Ishtar family, and I have come to this city because Master Marik has, and because what walks with him is not my master.',
      'I carry a chip. I will not refuse an honest duel — it is a relief, these days, to have one.',
    ],
    choices: [
      { label: 'An honest duel, then.', to: 'beaten', duel: true },
      { label: 'What walks with Marik?', to: 'marik' },
      { label: 'Another time.', to: null },
    ],
  },

  marik: {
    lines: [
      'A shadow he made when he was young, and it has grown teeth. It speaks with his voice now.',
      'Lady Ishizu believes he can still be reached. So do I. Until then, I walk behind him and see that nobody is hurt. If you duel him, duel him as a duelist, not as an enemy.',
    ],
    choices: [
      { label: 'I will. Duel me first.', to: 'beaten', duel: true },
      { label: 'I understand.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}. {chips} chips. You carry them well.',
      'Mine is still here. Shall we?',
    ],
    choices: [
      { label: 'Let’s.', to: 'beaten', duel: true },
      { label: 'How is Marik?', to: 'marik' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'Well fought. There is no shame in losing to someone who plays with honour.',
      'The chip is yours. Keep it safe — and if you see Master Marik, keep yourself safe too.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Thank you, Odion.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip. I am glad it went to you.',
      'I will duel you again if you wish. It is a better use of an afternoon than watching.',
    ],
    choices: [
      { label: 'Then duel.', to: 'beaten', duel: true },
      { label: 'Rest, Odion.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again you win. I am learning, at least.',
      'Go well, {name}.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Go well.', to: null },
    ],
  },

  won: {
    lines: [
      'A good duel. You came close.',
      'Patience. A wall stands until the one hitting it grows tired — so do not be the one who tires. Build around it.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'Thank you.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. I did not come here for this, but I will stand there and be glad of it.',
      'And if Master Marik stands there too, I will be close by. Until then, {name}.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I will not be a finalist. It does not matter. My place was always behind someone.',
      'Win it, {name}. Honestly.',
    ],
    choices: [],
  },
};

/**
 * Ryou Bakura — the kind one — who came for the gaming tables at Black Crown
 * and paints his own figures. The Ring on his chest is mentioned exactly once.
 */
const BAKURA_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Oh — hello! Sorry, I was miles away. You’re a duelist too, aren’t you? Everybody seems to be this week.',
      'I’m Bakura. Ryou Bakura. I came down for the games — Black Crown has the best tables in the city — and then Kaiba went on every screen, and now I have a star chip in my pocket and no idea how that happened.',
      'Would you like to duel? I promise I’m nicer to play against than I look. Well — mostly.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'The games here?', to: 'games' },
      { label: 'Maybe later.', to: null },
    ],
  },

  games: {
    lines: [
      'Tabletop, mostly. I run a campaign with little painted figures — dungeons, dragons, that sort of thing. I paint them all myself.',
      'Sometimes I lose track of the time while I’m painting. Sometimes rather a lot of time. The Ring is a family thing. Don’t mind it.',
    ],
    choices: [
      { label: 'Duel me, then.', to: 'beaten', duel: true },
      { label: 'Sounds fun.', to: null },
    ],
  },

  ready: {
    lines: [
      'Oh, {name}! {chips} chips — that’s brilliant.',
      'I’ve still got mine. Shall we play for it?',
    ],
    choices: [
      { label: 'Let’s.', to: 'beaten', duel: true },
      { label: 'How’s the campaign?', to: 'games' },
      { label: 'Not now.', to: null },
    ],
  },

  chip: {
    lines: [
      'Well played! Honestly, that was lovely to watch, even from the losing side.',
      'Here — the chip’s yours. I’ll paint a little figure of you for the campaign. With a crown, I think.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'I’d like that.', to: null },
    ],
  },

  chipped: {
    lines: [
      'The champion of my campaign! Hello again.',
      'Another duel? Just for fun — nothing on it.',
    ],
    choices: [
      { label: 'Just for fun.', to: 'beaten', duel: true },
      { label: 'Later, Bakura.', to: null },
    ],
  },

  beaten: {
    lines: [
      'You’re very good, you know. I keep saying it because it keeps being true.',
      'See you around, {name}.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'See you.', to: null },
    ],
  },

  won: {
    lines: [
      'Oh! I won? Sorry — I mean, good game!',
      'If it helps: you kept attacking into cards you couldn’t see. Sometimes the kindest thing to do to a face-down card is leave it alone for a turn.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'Thanks, Bakura.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! Me? Goodness. I’ll need a bigger figure.',
      'See you at the towers, {name}. I’ll bring snacks.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Not a finalist. That’s all right — I have a campaign to finish anyway.',
      'Go and win it, {name}. I’ll paint you with the trophy.',
    ],
    choices: [],
  },
};

/**
 * Jaden Yuki, who was on his way back to Duel Academy and took a wrong turn
 * into somebody else's tournament. Having the time of his life.
 */
const JADEN_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Whoa, hey! Another duelist! This city is awesome — everybody’s got a deck.',
      'Jaden Yuki. I’m from Duel Academy — well, I was on the ferry back to Duel Academy, then I took a wrong turn somewhere, and now there’s a guy on every TV telling me I’m in a tournament. Best wrong turn ever.',
      'So how about it? You, me, a duel? I’ve got a chip if you want it!',
    ],
    choices: [
      { label: 'Let’s have some fun.', to: 'beaten', duel: true },
      { label: 'Duel Academy?', to: 'academy' },
      { label: 'Later, Jaden.', to: null },
    ],
  },

  academy: {
    lines: [
      'It’s a school for duelling! Dorms by colour — I’m in Slifer Red, which is the one with the worst food and the best people.',
      'I’m supposed to be studying. I mostly duel. My teachers have opinions about that.',
    ],
    choices: [
      { label: 'Then duel me.', to: 'beaten', duel: true },
      { label: 'Sounds great.', to: null },
    ],
  },

  ready: {
    lines: [
      '{name}! {chips} chips? You’re on fire!',
      'Mine’s still up for grabs. Come on — let’s make it a good one!',
    ],
    choices: [
      { label: 'Let’s go!', to: 'beaten', duel: true },
      { label: 'Tell me about the Academy.', to: 'academy' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'Aw, man — that was so good! You totally got me!',
      'Here, the chip’s yours. Now you have to win the whole thing, deal? Otherwise I lost to someone who didn’t, and that’s embarrassing.',
    ],
    choices: [
      { label: 'Again!', to: 'beaten', duel: true },
      { label: 'Deal.', to: null },
    ],
  },

  chipped: {
    lines: [
      'Hey, it’s my rival! I decided you’re my rival now.',
      'Duel again? No chip, just fun. Fun’s the whole point anyway!',
    ],
    choices: [
      { label: 'Let’s go!', to: 'beaten', duel: true },
      { label: 'Later, Jaden.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again?! Okay, that’s it, I’m studying your deck tonight. Well — tomorrow. Maybe.',
      'That was awesome, {name}!',
    ],
    choices: [
      { label: 'One more!', to: 'beaten', duel: true },
      { label: 'See ya.', to: null },
    ],
  },

  won: {
    lines: [
      'Yeah! That’s game! Good one though — seriously!',
      'My heroes only win because they fight together. Whatever your monsters are, play them so they help each other, not one at a time.',
    ],
    choices: [
      { label: 'Run it back!', to: 'won', duel: true },
      { label: 'Thanks, Jaden.', to: null },
    ],
  },

  finalist: {
    lines: [
      'I’m in the finals?! No way! Best field trip ever!',
      'See you at the towers, {name}. Let’s both bring our best!',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Didn’t make the finals. Oh well — I had a blast!',
      'You go win it, {name}. I’ll be cheering. Loudly.',
    ],
    choices: [],
  },
};

/**
 * Bandit Keith, who lives over the tables at Black Crown and plays for money
 * like the Step Lane pair — twenty down, thirty of his on a win (`FORFEIT` and
 * `BOUNTY` in `shop.ts`) — so every road to a duel goes through `terms`,
 * where the figure is said out loud.
 */
const KEITH_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Well, look what crawled in off the street. You lost, kid, or you lookin’ to lose?',
      'Name’s Keith. Bandit Keith, champion of the whole U-S-of-A, and Kaiba’s little tournament is the easiest money I ever saw. Star chips, cash — I take ’em both.',
      'You want mine, you pay to play. Scared yet?',
    ],
    choices: [
      { label: 'Deal me in.', to: 'terms' },
      { label: 'You cheat, don’t you?', to: 'cheat' },
      { label: 'Not today.', to: null },
    ],
  },

  terms: {
    lines: [
      'Twenty down, right here. You beat me — which you won’t — and you walk with your twenty and thirty of mine. You lose, the twenty’s mine. Fair’s fair.',
    ],
    choices: [
      { label: 'Deal.', to: 'beaten', duel: true },
      { label: 'Changed my mind.', to: null },
    ],
  },

  cheat: {
    lines: [
      'Cheat? Me? I just know where every card in this city is. Card sharps call it skill.',
      'Anyway, the machine shuffles now. Kaiba’s tech. Takes all the fun out of it. So — you playing or what?',
    ],
    choices: [
      { label: 'I’m playing.', to: 'terms' },
      { label: 'What.', to: null },
    ],
  },

  ready: {
    lines: [
      '{chips} chips, huh? Somebody’s been busy picking pockets.',
      'Mine’s still on me, and so’s my price.',
    ],
    choices: [
      { label: 'Deal me in.', to: 'terms' },
      { label: 'Not now.', to: null },
    ],
  },

  chip: {
    lines: [
      'Aw, come on! That was luck. Pure dumb luck.',
      'Fine. Here’s the chip. And the money. Don’t spend it all in one place, kid.',
    ],
    choices: [
      { label: 'Again?', to: 'terms' },
      { label: 'Thanks, Keith.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You again. You got my chip already — what else you want, my bandana?',
      'Same price as ever. I want my money back.',
    ],
    choices: [
      { label: 'Deal me in.', to: 'terms' },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'How do you keep doing that?',
      'Get outta here before I start keeping score.',
    ],
    choices: [
      { label: 'One more?', to: 'terms' },
      { label: 'See ya, Keith.', to: null },
    ],
  },

  won: {
    lines: [
      'Ha! Pay up! That twenty’s mine!',
      'Free lesson: you play scared, you play small. Put your big stuff down and make the other guy deal with it.',
    ],
    choices: [
      { label: 'Run it back.', to: 'terms' },
      { label: 'Noted.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! Knew it. America’s champ goes to the big show.',
      'See ya down there, kid. Bring your wallet.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'No finals. The whole thing’s rigged. Rigged, I tell ya.',
      'Go on, win it. Just remember who taught you to bet.',
    ],
    choices: [],
  },
};

/**
 * Mako Tsunami, son of the sea, a long way from any. Treats a tournament the
 * way he treats weather.
 */
const MAKO_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Ahoy! You have the look of a duelist who has been walking against the tide all day.',
      'Mako Tsunami, son of the sea. There is no ocean in this city — only towers and trains — but a tournament is a storm, and I have never turned my boat from a storm.',
      'I carry a star chip. Will you sail against me for it?',
    ],
    choices: [
      { label: 'Set sail.', to: 'beaten', duel: true },
      { label: 'Son of the sea?', to: 'sea' },
      { label: 'Another time.', to: null },
    ],
  },

  sea: {
    lines: [
      'My father was a fisherman. He went out one morning and the sea kept him, and I have been duelling to be worthy of the both of them ever since.',
      'The sea never lies, friend. Neither does a good duel. That is why I love them both.',
    ],
    choices: [
      { label: 'Then let’s duel.', to: 'beaten', duel: true },
      { label: 'I’m sorry.', to: null },
    ],
  },

  ready: {
    lines: [
      'Ahoy, {name}! {chips} chips — a fine catch.',
      'Mine still swims. Cast your line?',
    ],
    choices: [
      { label: 'Cast away.', to: 'beaten', duel: true },
      { label: 'Tell me about the sea.', to: 'sea' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'Well sailed! You rode that storm like a true captain.',
      'Take the chip, friend. The tide turns — today it turned for you.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Thank you, Mako.', to: null },
    ],
  },

  chipped: {
    lines: [
      'My old rival from the harbour — or the station, as it is here.',
      'Another duel, just for the joy of the waves?',
    ],
    choices: [
      { label: 'Just for joy.', to: 'beaten', duel: true },
      { label: 'Later, Mako.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again the sea is calm and I am the one overboard!',
      'Fair winds, {name}.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Fair winds.', to: null },
    ],
  },

  won: {
    lines: [
      'Ha! The deep has claimed another!',
      'Hear an old salt: what is under the surface is always bigger than what is on it. Respect a face-down card.',
    ],
    choices: [
      { label: 'Again!', to: 'won', duel: true },
      { label: 'Noted.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! Like a wave that rises and does not break!',
      'I will see you at the towers, {name}. Bring the storm.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'The tide went out on me. It happens to every sailor.',
      'Go, {name}. Win it. The sea would want you to.',
    ],
    choices: [],
  },
};

/**
 * Rex Raptor, loud, sure of himself, and looking for Weevil.
 */
const REX_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Hey, you! Yeah, you. You’re looking at the next champion of Domino City, so get a good look.',
      'Rex Raptor. Dinosaurs — the strongest monsters there ever were. Kaiba handed out chips and I’m keeping mine, unless you think you can take it off a tyrannosaur.',
      'Well? You duelling or gawking?',
    ],
    choices: [
      { label: 'Duelling.', to: 'beaten', duel: true },
      { label: 'Seen a guy with bugs?', to: 'weevil' },
      { label: 'Gawking.', to: null },
    ],
  },

  weevil: {
    lines: [
      'Weevil?! That little creep is here too? Figures. Where there’s a tournament, there’s a bug crawling around it.',
      'He cheated me once. Well — he says he didn’t. He did. When I find him, my dinosaurs are gonna step on every one of his beetles.',
    ],
    choices: [
      { label: 'Practise on me first.', to: 'beaten', duel: true },
      { label: 'Good luck with that.', to: null },
    ],
  },

  ready: {
    lines: [
      '{chips} chips? Pfft. I’ll have that many by dinner.',
      'Still want mine? Come and get stomped.',
    ],
    choices: [
      { label: 'Bring it.', to: 'beaten', duel: true },
      { label: 'Seen Weevil?', to: 'weevil' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'No way! That’s — you — ugh! Fine!',
      'Take the stupid chip. But I’m telling everybody it was a fluke. A lucky, lucky fluke.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'Sure it was.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You. The fluke.',
      'Rematch. No chips. Just me proving it was a fluke.',
    ],
    choices: [
      { label: 'Rematch.', to: 'beaten', duel: true },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Two flukes?! That’s not even possible!',
      'Get out of here before I think of something to say.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Bye, Rex.', to: null },
    ],
  },

  won: {
    lines: [
      'Ha! Extinct! Totally extinct!',
      'Here’s a tip, since I’m feeling generous: big monsters win games. Get ’em out early and hit hard. Works for me.',
    ],
    choices: [
      { label: 'Rematch!', to: 'won', duel: true },
      { label: 'Thanks, Rex.', to: null },
    ],
  },

  finalist: {
    lines: [
      'Finals! Told you! Told everybody!',
      'See you at the towers, {name}. And if Weevil’s there, I get first stomp.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I didn’t make it?! This tournament’s got it in for dinosaurs.',
      'Whatever. You win it. Just make sure Weevil doesn’t.',
    ],
    choices: [],
  },
};

/**
 * Weevil Underwood, patient, sneaky, very pleased with himself, and hiding
 * from Rex in the shrine's trees.
 */
const WEEVIL_SCRIPT: Record<string, DialogueNode> = {
  greet: {
    lines: [
      'Hee hee hee… oh, don’t mind me. I was just admiring the trees. Such lovely places for little things to hide.',
      'Weevil Underwood, regional champion and future owner of a great many star chips. Insects, you see — small, patient, everywhere. Exactly like me.',
      'A duel? Oh, I’d love to. Step a little closer.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'beaten', duel: true },
      { label: 'Rex is looking for you.', to: 'rex' },
      { label: 'No thanks.', to: null },
    ],
  },

  rex: {
    lines: [
      'Rex? Rex Raptor? Hee hee — let him look. Dinosaurs are big and loud and very, very extinct.',
      'He still thinks I cheated him. I merely… planned ahead. Now, are we playing, or would you rather go and fetch him for me?',
    ],
    choices: [
      { label: 'Playing.', to: 'beaten', duel: true },
      { label: 'I’ll leave you to it.', to: null },
    ],
  },

  ready: {
    lines: [
      'Hee hee, {name}. {chips} chips — you’ve been busy. So have my bugs.',
      'Mine is right here. Come and take it — if you can find it.',
    ],
    choices: [
      { label: 'Found it.', to: 'beaten', duel: true },
      { label: 'About Rex…', to: 'rex' },
      { label: 'Later.', to: null },
    ],
  },

  chip: {
    lines: [
      'What?! That wasn’t — you couldn’t have — hmph!',
      'Take it, then. Enjoy it while it lasts. Bugs have long memories. Well — some bugs.',
    ],
    choices: [
      { label: 'Again?', to: 'beaten', duel: true },
      { label: 'I will.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You. You took my chip. I’ve been thinking about that a great deal.',
      'Another duel? Nothing to win. Only… lessons. Hee hee.',
    ],
    choices: [
      { label: 'Teach me.', to: 'beaten', duel: true },
      { label: 'Later.', to: null },
    ],
  },

  beaten: {
    lines: [
      'Again? This is unacceptable. I shall have to plan further ahead.',
      'Much further.',
    ],
    choices: [
      { label: 'One more.', to: 'beaten', duel: true },
      { label: 'Good luck with that.', to: null },
    ],
  },

  won: {
    lines: [
      'Hee hee hee! Squashed! Like a— well, not like a bug. Bugs win.',
      'A little wisdom, free of charge: never trust the card your opponent leaves face-down on purpose. It’s always a trap. Always.',
    ],
    choices: [
      { label: 'Again.', to: 'won', duel: true },
      { label: 'Noted.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals! Hee hee — and not a dinosaur in sight, I hope.',
      'See you at the towers, {name}. Watch where you step.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I didn’t make the finals? Impossible. Someone must have cheated. Someone other than me.',
      'Go on, win it. I’ll be… watching. From the trees.',
    ],
    choices: [],
  },
};

/**
 * The cast, built and waiting to be placed — nobody, now.
 *
 * Yugi, Yami, Kaiba, Joey and Mai waited here, finished and rigged, for a
 * tournament circuit to be placed on. The tournament is it: they are in
 * `WORLD_NPCS` with `arrives: 'tournament'`, and the city has them the day
 * Kaiba's broadcast plays. The bench stays, empty, because it is the right
 * place to put the next one.
 */
const WAITING: WorldNpc[] = [];


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
      /* The first meeting once Kaiba has started it: the street is the same
         and she is on it, but the city she was warning you about has arrived. */
      meet: {
        lines: [
          'You are not from this street. I would know \u2014 I was standing on it before Kaiba put his face on every screen in the city.',
          'Sarah. I duel, I am good at it, and this week I am worth a star chip. Tony and I keep the street; everybody else is out walking the city after chips.',
        ],
        choices: [
          { label: 'Let\u2019s duel.', to: 'beaten', duel: true },
          { label: 'What do you play?', to: 'style' },
          { label: 'Maybe later.', to: null },
        ],
      },

      greet: {
        lines: [
          'You came out of the old man\u2019s shop, so you are new. That is not an insult, it is a schedule.',
          'Sarah. I duel, and I am good at it. If you have twenty-five sleeved, we can find out where you are on it.',
          'And you had better want to. They are seating a tournament on a card count \u2014 ninety-nine on your name and you are in it \u2014 so half this city has started collecting and the other half has started panicking.',
        ],
        choices: [
          { label: 'Let\u2019s duel.', to: 'beaten', duel: true },
          { label: 'A card count?', to: 'count' },
          { label: 'What do you play?', to: 'style' },
          { label: 'Maybe later.', to: null },
        ],
      },

      /* Her reading of the rule, which is a criticism, which is the point: she
         is the character who says what a thing is *for* in one flat sentence,
         and she is not wrong. The bounty half comes out of her own mouth as a
         complaint about who will be in the hall with her. */
      count: {
        lines: [
          'Cards. Not wins \u2014 cards. Which means the door is open to anybody with a patient afternoon, and the hall is going to be full of people who own ninety-nine cards and cannot play one of them.',
          'It sorts itself out inside, mind. Everyone in there carries a bounty: put somebody down and you take cards off them and money with it, and they take it off you when you are the one on the floor. Two rounds and the patient afternoon people will have nothing left to be patient with.',
          'Beat me and you are three cards closer, by the way. I do not enjoy saying that.',
        ],
        choices: [
          { label: 'Let\u2019s duel, then.', to: 'beaten', duel: true },
          { label: 'What do you play?', to: 'style' },
          { label: 'Noted.', to: null },
        ],
      },

      /* Short, and in her register: she does not do small talk twice. */
      again: {
        lines: [
          '{left} to go. I can count, {name}, it is not a party trick.',
          'Twenty-five sleeved? Then stop reading the street and put something on the table.',
        ],
        choices: [
          { label: 'Let\u2019s duel.', to: 'beaten', duel: true },
          { label: 'Not now.', to: null },
        ],
      },

      ready: {
        lines: [
          'So it has started. Kaiba on every screen in the city, and everybody suddenly very interested in me.',
          'I keep the street and I keep my chip. You can have one of those if you beat me for it.',
        ],
        choices: [
          { label: 'Let’s duel.', to: 'beaten', duel: true },
          { label: 'Later.', to: null },
        ],
      },

      chip: {
        lines: [
          'Fine. It is yours. You went through the wall properly, which is the only way I would have handed it over.',
          'One chip. Do not spend it on a victory lap in front of me.',
        ],
        choices: [
          { label: 'Again, for pride?', to: 'beaten', duel: true },
          { label: 'I will leave it there.', to: null },
        ],
      },

      chipped: {
        lines: [
          'You have my chip, {name}. I have not forgotten and I am not going to.',
          '{chips} of ten. The street is still here if you want to lose some of that confidence.',
        ],
        choices: [
          { label: 'One more.', to: 'beaten', duel: true },
          { label: 'Not now.', to: null },
        ],
      },

      finalist: {
        lines: [
          'The finals. Me. On the strength of a wall and a Royal Tribute — I shall be insufferable about it for years.',
          'I will see you at the towers. Do not go easy on me down there; I will know.',
        ],
        choices: [],
      },

      out: {
        lines: [
          'I did not make it. Somebody walked through my wall more often than I walked through theirs. It happens.',
          'Go on, then. Win it — and tell them where you started.',
        ],
        choices: [],
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
      meet: {
        lines: [
          'Tony. Do not let the vest fool you \u2014 I am out here for the chips now, same as everybody.',
          'Ten of them buys a seat in Kaiba\u2019s finals, so there is a queue of strangers on this street, and you are one of them, no offence. Sarah and me keep it; the rest go wherever the day takes them.',
          'So: a duel or directions? Either is fine. One of them is quicker.',
        ],
        choices: [
          { label: 'A duel.', to: 'beaten', duel: true },
          { label: 'What am I walking into?', to: 'style' },
          { label: 'Directions, then.', to: 'where' },
        ],
      },

      greet: {
        lines: [
          'Tony. Do not let the vest fool you \u2014 I am out here for the cards, same as everybody.',
          'Ninety-nine of them and the tournament lets you in. That is the whole reason there is a queue of strangers on this street, and you are one of them, no offence.',
          'So: a duel or directions? Either is fine. One of them is quicker.',
        ],
        choices: [
          { label: 'A duel.', to: 'beaten', duel: true },
          { label: 'Ninety-nine is a lot.', to: 'maths' },
          { label: 'What am I walking into?', to: 'style' },
          { label: 'Directions, then.', to: 'where' },
        ],
      },

      /* Tony does the arithmetic out loud, because he is the character who
         counts things — and the number he arrives at is the true one: a pack
         is three cards, so the door is about thirty wins away. Said as
         encouragement, which is how he means everything. */
      maths: {
        lines: [
          'It is thirty-odd duels, is what it is. You beat somebody, they hand you a pack of what they were just playing \u2014 three cards \u2014 and there are new ones turning up every week to beat.',
          'Start with whoever is standing about looking confident. That is free money in this city.',
        ],
        choices: [
          { label: 'You are standing about looking confident.', to: 'beaten', duel: true },
          { label: 'And inside the hall?', to: 'bounty' },
          { label: 'Right. Thanks.', to: null },
        ],
      },

      bounty: {
        lines: [
          'Bounties. Everybody in the bracket is worth cards and money to whoever puts them down, and the ones who last are worth more.',
          'Which sounds great until you work out the other half of it, which is that you are also worth cards and money, and you are worth them to a much better duelist than you.',
        ],
        choices: [
          { label: 'Let us start with you, then.', to: 'beaten', duel: true },
          { label: 'Cheerful.', to: null },
        ],
      },

      again: {
        lines: [
          'Still {left} off it. I am keeping count for you, it is free.',
          'Duel? Three cards nearer if it goes your way.',
        ],
        choices: [
          { label: 'Go on then.', to: 'beaten', duel: true },
          { label: 'Later.', to: null },
        ],
      },

      ready: {
        lines: [
          'The big man went up on every screen in the city and now everybody wants a chip. Mine included, which is flattering.',
          'Sarah and me are staying put — somebody has to keep the street. A duel for mine?',
        ],
        choices: [
          { label: 'Go on then.', to: 'beaten', duel: true },
          { label: 'Directions, then.', to: 'where' },
          { label: 'Later.', to: null },
        ],
      },

      chip: {
        lines: [
          'Well, that is that. One star chip, as advertised.',
          'Put it somewhere safe and go and collect nine more. I will tell people I knew you back when.',
        ],
        choices: [
          { label: 'Again.', to: 'beaten', duel: true },
          { label: 'That will do.', to: null },
        ],
      },

      chipped: {
        lines: [
          'You already took my chip, {name}. Do not rub it in — the vest is sensitive.',
          'A duel for nothing? The best kind, I always say. Never said it before, but I am saying it now.',
        ],
        choices: [
          { label: 'Go on then.', to: 'beaten', duel: true },
          { label: 'Later.', to: null },
        ],
      },

      finalist: {
        lines: [
          'Finals! Me! The fella in the vest!',
          'Right — see you at the towers. Somebody has to explain to Kaiba who I am.',
        ],
        choices: [],
      },

      out: {
        lines: [
          'No finals for me. Turns out a lot of small things all at once is not a tournament plan.',
          'Go and win it, {name}. Put a good word in for the street.',
        ],
        choices: [],
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
  meet: {
    lines: [
      'Oh. You can see me.',
      'That is the part that always takes a moment. I am Isha — and I have left my stones for the first time in longer than I can say, because the man on the screens says I carry a chip. It seems even the dead are entered.',
      'Will you play me? It is what there is to do.',
    ],
    choices: [
      { label: 'Play, then.', to: 'offer' },
      { label: 'How long have you been waiting?', to: 'long' },
      { label: 'Another time.', to: null },
    ],
  },

  greet: {
    lines: [
      'Oh. You can see me.',
      'That is the part that always takes a moment. Most of them walk straight through and shiver and put it down to the weather.',
      'I am Isha. I have been here a while, {name}.',
      'And they have started coming up the walk in twos to whisper about a tournament, which is new. The dead are very good at overhearing.',
    ],
    /* One hop to the duel, like Mai's. Everything else she has to say is on
       the other branch and is optional — a duelist you have to interview
       before you can play them is a duelist most players never play. */
    choices: [
      { label: 'How long is a while?', to: 'long' },
      { label: 'What do they say?', to: 'hall' },
      { label: 'Do you play?', to: 'offer' },
      { label: 'Nothing. I saw nothing.', to: null },
    ],
  },

  /*
   * The one person in the city who is told the terms and cannot use them.
   *
   * Everybody else meets the tournament as an opportunity or a threat. She
   * meets it as a thing that is happening to the living, and says the quiet
   * half nobody else can: it is for people who have an afterwards. That is her
   * whole character stated in one line about somebody else's news, which is
   * the only way she ever states it — she has never once said she is dead.
   */
  hall: {
    lines: [
      'Ninety-nine cards, and then a hall with your name in it. Always in the same hushed voice people keep for money, and always twice, because nobody believes it the first time.',
      'Go, when you have them. I mean that kindly. A tournament is a thing for people with an afterwards — I would only be the draught in the corner of it.',
      'Somebody will come up here and tell me how it went. Somebody always does, eventually.',
    ],
    choices: [
      { label: 'Do you play?', to: 'offer' },
      { label: 'What are you waiting for?', to: 'waiting' },
      { label: 'I will come and tell you myself.', to: null },
    ],
  },

  /* Short, and she is the one character for whom a short greeting is warmer
     than a long one: she has stopped introducing herself to you. */
  again: {
    lines: [
      'You came back. Nobody comes back.',
      '{left} to go, if the twos on the walk have their numbers right. Stay a while, or play me. Both of those count as staying.',
    ],
    choices: [
      { label: 'Play, then.', to: 'offer' },
      { label: 'Just staying.', to: 'feet' },
      { label: 'I should go.', to: null },
    ],
  },

  ready: {
    lines: [
      'The tournament came up the walk after all. A man shouting from every screen, and duelists everywhere — even among the stones.',
      'I walk now too, further than I have in years. My chip is yours if you can take it, {name}.',
    ],
    choices: [
      { label: 'Play me.', to: 'offer' },
      { label: 'Goodbye, Isha.', to: null },
    ],
  },

  chip: {
    lines: [
      'Well. There is my chip. I did not know I had one until the man on the screen said so.',
      'Carry it gently. It is the first thing I have given anybody in a long time.',
    ],
    choices: [
      { label: 'Again.', to: 'beaten', duel: true },
      { label: 'I will. Goodbye, Isha.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip. You came back anyway. Nobody comes back.',
      'Play, if you like. It is what there is to do.',
    ],
    choices: [
      { label: 'Play, then.', to: 'offer' },
      { label: 'Goodbye, Isha.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. They will have a ghost in the forecourt. I wonder if anybody will notice.',
      'I will be there, {name}. I am not going to be anywhere else.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'The finals will be played without me. That is all right; I am used to being the draught in the corner.',
      'Come and tell me how it ends. Somebody always does, eventually. I would like it to be you.',
    ],
    choices: [],
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
 * That day has come, and this is where it was announced from: the rumour has
 * terms now. Ninety-nine cards on your name and the hall will seat you — she
 * has the number before anybody else in the city has it, because she is the
 * one who carries the post. Everything else about her is unchanged, including
 * the part where she half believes it, and the evidence is still an expense
 * rather than a secret.
 */
const TINA_SCRIPT: Record<string, DialogueNode> = {
  meet: {
    lines: [
      '{name}, is it? Tina. I run things between the market and the station, and this week that means running between everybody — Kaiba has half the city walking in circles after chips.',
      'Mine is in my pocket and the money is on the table, same as ever. Want to play for both?',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Any news?', to: 'news' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Another time.', to: null },
    ],
  },

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
      'And it has stopped being a rumour this week, because a rumour does not come with terms. Ninety-nine cards on your name and you are in it. Not a fee, not a record of wins — a count. You are on {cards}.',
      'I have had that from four people and not one of them got it from the other three. That is the part I cannot explain away, and I have tried.',
    ],
    choices: [
      { label: 'Who is running it?', to: 'who' },
      { label: 'Why ninety-nine?', to: 'why' },
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
      'Because ninety-nine is what somebody looks like after a month of actually playing. You cannot borrow it and you will not be bothered to buy it, so whoever set that number was not filtering for money — they were filtering for people who turn up.',
      'And you will be in it. Everyone will be — that is the whole shape of the thing, and it is the part that ought to worry you rather than the part that flatters you.',
      'Know what it pays, though, before you are stood in it. Everyone in that hall has a bounty on them: cards off their deck, money out of their pocket, to whoever puts them down. And you are carrying one as well, in front of much better duelists than me. It is this table with the takings multiplied.',
    ],
    choices: [
      { label: 'Go on, then.', to: 'wager' },
      { label: 'Who is running it?', to: 'who' },
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

  /*
   * The short version, and it is the shortest in the game on purpose: she is a
   * courier, she is holding a bag, and she has already told you everything.
   * What she has that nobody else has is the count, so the count is the whole
   * greeting.
   */
  again: {
    lines: [
      '{cards} on your name, {left} to go. Do not ask me how I know, {name}, it is what I am for.',
      'Money on the table if you want it. Same as ever.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Any news?', to: 'who' },
      { label: 'Not today.', to: null },
    ],
  },

  ready: {
    lines: [
      'It has a name now, and the name is Kaiba. I had the broadcast off three screens before it finished — even I did not see that one coming.',
      'Chips are the new money under every roof in the city. Mine is on the table, same as the cash. Want to play for both?',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Any news?', to: 'news' },
      { label: 'Not today.', to: null },
    ],
  },

  news: {
    lines: [
      'Everybody is moving. The sisters have left their shrine, the girl with the dragons came down off her steps, and there is a ghost at the station, if you believe a porter.',
      'Check your map before you walk anywhere. Kaiba put a tracker in every duel disk in the city, which is the most expensive way to find a person I have ever heard of.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Thanks, Tina.', to: null },
    ],
  },

  chip: {
    lines: [
      'Hah. You win the money and the chip both. Do not get used to it.',
      'There you are — my star chip. You will hear about the finals from somebody who is not me, and remember who had it first.',
    ],
    choices: [
      { label: 'Again?', to: 'wager' },
      { label: 'I will leave it there.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip, {name}. The money is still in play, though. It always is.',
      '{chips} of ten — I am keeping count for you. It is what I am for.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'wager' },
      { label: 'Any news?', to: 'news' },
      { label: 'Not today.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. The courier made the finals. Write that down somewhere.',
      'See you at the towers, {name}. Bring money; old habits.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Missed the finals by a chip or two. I know exactly who took them, which is worse.',
      'Go on — win it. I want to be the one who carries the news.',
    ],
    choices: [],
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
  meet: {
    lines: [
      'Close enough. I can see your hands, and that is all I want from a stranger in a strange city.',
      'Antiope. My sisters and I walked a long way on a letter with no name at the foot of it. Now it has a name, and the name has sent us out walking his streets with a chip each.',
      'I am the shield — what you practise on — and I will not pretend otherwise.',
    ],
    choices: [
      { label: 'Then let’s go.', to: 'terms' },
      { label: 'What do you play?', to: 'style' },
      { label: 'Another time.', to: null },
    ],
  },

  terms: {
    lines: [
      'A dollar down, then. That is what it costs to be wrong. Beat me and you take it back with five of mine on top.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Not yet.', to: null },
    ],
  },

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
      'There is a price on the door and it is not money: ninety-nine cards, in your own hand, before they will seat you. We counted ours on the road and counted them again at the gate, which will tell you how three grown women are taking it.',
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
      { label: 'Let’s find out.', to: 'terms' },
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

  /* The shield's short version: she is the one of the three who is content to
     be practised on, so a second meeting is an offer and nothing else. */
  again: {
    lines: [
      'Close enough again. {left} cards off the door by my reckoning, and three of them are in my deck if you can take them.',
      'A dollar on the step. You know where it goes.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Where are your sisters?', to: 'sisters' },
      { label: 'Not yet.', to: null },
    ],
  },

  ready: {
    lines: [
      'The letter had a name after all. Kaiba. My sisters are out in the city and so am I — a shield is no use standing still in a yard.',
      'My chip is on the step with the dollar. Take them both, if you can.',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'Not yet.', to: null },
    ],
  },

  chip: {
    lines: [
      'Through the shield, and a star chip for your trouble. You earned it the slow way, which is the way that lasts.',
      'Go and find my sisters. They will not be so kind about it.',
    ],
    choices: [
      { label: 'Again?', to: 'terms' },
      { label: 'I will.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You carry my chip already. I am glad it was you.',
      'A dollar on the step, if you want the practice. I am still the shield.',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'Not now.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The shield, in the finals. My sisters will never let me hear the end of it.',
      'I will make everything cost you something down there, {name}. Same as ever.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Not the finals, for me. The shield held until it did not.',
      'Go and win it. Whoever you face, make them spend.',
    ],
    choices: [],
  },
};

const PANTHESILEA_SCRIPT: Record<string, DialogueNode> = {
  meet: {
    lines: [
      'A duelist who stops to look at me instead of walking past. Good — I was beginning to think this city duels indoors only.',
      'Panthesilea. I hunt, mostly. This week there is nothing to hunt but duelists, and Kaiba has sent every one of them out walking.',
    ],
    choices: [
      { label: 'Hunt?', to: 'hunt' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Some other time.', to: null },
    ],
  },

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
      { label: 'What does it pay?', to: 'purse' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Fair enough.', to: null },
    ],
  },

  /*
   * The bounty half of the tournament, from the only one of the three who
   * would think of it that way. She is a hunter and a sceptic, so she reads a
   * price on every head as a technique rather than as a prize: it is how you
   * get strangers to fight each other without having to ask them to. She is
   * not wrong, and she is going anyway, which is the whole of her.
   */
  purse: {
    lines: [
      'A bounty on every head in the hall. Beat somebody and you take cards out of their deck and money out of their purse, and the further they have got the more they are worth carrying.',
      'Which is a clever way of never having to ask anybody to fight. You do not order hounds to run, you drag something bleeding across the field and stand back.',
      'And I shall run, of course. I have looked at it from every side and I still want the thing at the end of it. Write that down somewhere and laugh at me later.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Why the shrine?', to: 'why' },
      { label: 'Noted.', to: null },
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
      'It is an even match, if you want the truth of it — Antiope is easier and Hippolyta is not. Start where you like.',
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

  again: {
    lines: [
      'You. Good — the fourth person up these steps today is a priest and he will not play me.',
      '{left} off the door, then. A dollar down and I will take ten of your afternoon off you.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'What does it pay, again?', to: 'purse' },
      { label: 'Not today.', to: null },
    ],
  },

  ready: {
    lines: [
      'So the rich man has a name, and the name is shouting from screens. I said we were the audience. I did not say we would be the hunt.',
      'Every duelist in this city is carrying a chip and walking. I have never had so much to hunt. A dollar down, and my chip besides.',
    ],
    choices: [
      { label: 'Ready.', to: 'offer' },
      { label: 'Save it.', to: null },
    ],
  },

  chip: {
    lines: [
      'Hah — you took the fourth trade off me again. The chip is yours. I shall have to go and hunt somebody easier.',
      'There are not many of those left.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'Good hunting.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip. I have not forgiven you, but I have noticed you, which is rarer.',
      'Another hunt, for the sport of it?',
    ],
    choices: [
      { label: 'Ready.', to: 'offer' },
      { label: 'Not today.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. I said I still wanted the thing at the end of it, and here it is.',
      'Save something for me down there, {name}.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'No finals. I ran the hunt and something faster ran it better.',
      'Go and finish it. I will want to hear how.',
    ],
    choices: [],
  },
};

const HIPPOLYTA_SCRIPT: Record<string, DialogueNode> = {
  meet: {
    lines: [
      'You have come to me before my sisters, or after them. Either way you came, and I respect that more than I will say.',
      'Hippolyta. I hold what is left of a people you have not heard of, which is eleven women and a good deal of opinion — and one star chip, which is apparently the only thing about us this city cares for.',
    ],
    choices: [
      { label: 'I want the duel.', to: 'offer' },
      { label: 'Carry on.', to: null },
    ],
  },

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
      'And consider what the door asks for. Not a fee — a count. Ninety-nine cards in your hand, which means they are not checking your purse at all, they are checking how many people you have beaten. Somebody is counting that for every duelist alive, and you are carrying {cards} of it.',
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

  /* A queen does not greet you twice. Two lines, both of them about the
     count, because the count is the only thing about you she is tracking. */
  again: {
    lines: [
      '{left} from the door, {name}. I keep a list of my own now, and you are the only name on it.',
      'A dollar to sit down. Say when.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'About the letter.', to: 'letter' },
      { label: 'Not yet.', to: null },
    ],
  },

  ready: {
    lines: [
      'The list-keeper has a name. Kaiba. I have met three men who could afford the gesture; he is the fourth, and the first who wanted to be seen making it.',
      'My chip is on the table. Sit down — and this time do not stop when the guard holds.',
    ],
    choices: [
      { label: 'Ready.', to: 'offer' },
      { label: 'Not yet.', to: null },
    ],
  },

  chip: {
    lines: [
      'The guard broke. Take the chip; you watched the end coming, and so did I.',
      'Find me at the finals. I intend to be there.',
    ],
    choices: [
      { label: 'Again?', to: 'offer' },
      { label: 'I will.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You carry my chip. I keep a list of my own and you are still the only name on it.',
      'Again, if you want it difficult.',
    ],
    choices: [
      { label: 'Ready.', to: 'offer' },
      { label: 'Not yet.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. Eleven women and a good deal of opinion, and one of us made it to the forecourt.',
      'Sit down across from me in there and do not apologise for anything.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'I will not be in the finals. Somebody counted better than I did.',
      'Go and be disappointing to Kaiba, {name}. It is the kindest thing anybody could do for him.',
    ],
    choices: [],
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
  meet: {
    lines: [
      'Kaela Veyron. If you have been up Step Lane you have walked past where I usually am; this week I am everywhere, like everybody, with a chip in my pocket and a deck I have tuned twice since breakfast.',
      'I build things that work. A deck is the same job with worse tolerances.',
    ],
    choices: [
      { label: 'What do you play?', to: 'style' },
      { label: 'Let’s duel.', to: 'terms' },
      { label: 'Mind how you go.', to: null },
    ],
  },

  terms: {
    lines: [
      'Twenty down before we start. Beat me and you take it back with fifteen of mine; do not, and I keep the twenty. I did not set that price to be liked.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Not yet.', to: null },
    ],
  },

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
      'The door is ninety-nine cards in your own hand, which is the most honest specification I have read in years. It does not ask what you own or what you can pay. It asks how many people have handed you a pack of their deck, which is a measurement of exactly one thing and cannot be faked. You are at {cards}.',
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
      { label: 'Show me.', to: 'terms' },
      { label: 'Noted.', to: null },
    ],
  },

  offer: {
    lines: [
      'Here, then — there is a landing four steps down that is nearly level and I have been using it as a bench all morning.',
      'Twenty on the step before we start. Beat me and you take it back with fifteen of mine; do not, and I keep the twenty. I did not set that price to be liked, I set it so that people who are not ready go and get ready.',
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

  /* She measured you once and has kept the figure. Two lines, one of them a
     number, which is the whole character. */
  again: {
    lines: [
      'Back. {left} short of the door, and the step is still four millimetres proud — I have written to somebody about one of those.',
      'The landing is free if you want it.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'Tell me about the hall again.', to: 'tournament' },
      { label: 'Another time.', to: null },
    ],
  },

  ready: {
    lines: [
      'It opened. Kaiba, on every screen, with a specification: ten chips, four finalists, one forecourt. I have read worse documents. Not many better.',
      'My chip is on the table with the twenty. Measure yourself against it?',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'Another time.', to: null },
    ],
  },

  chip: {
    lines: [
      'Hm. You went for the King again. Correct again. The chip is yours.',
      'Ten of those is a place in the finals, and I would like it on record that I supplied one of them.',
    ],
    choices: [
      { label: 'Again?', to: 'terms' },
      { label: 'On record.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip already. I checked the tolerances on it before I handed it over.',
      'The twenty is still there if you want the practice.',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'Another time.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. I built something that works.',
      'Find me early down there, {name}. I meant it before and I mean it more now.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'Missed the finals by a margin I have measured to the millimetre and will not be sharing.',
      'Go on. Win it properly.',
    ],
    choices: [],
  },
};

const SERAPHINA_SCRIPT: Record<string, DialogueNode> = {
  meet: {
    lines: [
      'Seraphina Drayke. I keep dragons — properly kept, which means they come back.',
      'A man who owns the television has summoned me down off my steps, and I find I do not mind: the view is worse and the duelling is better.',
    ],
    choices: [
      { label: 'Kept how?', to: 'style' },
      { label: 'Let’s duel.', to: 'terms' },
      { label: 'Enjoy the walk.', to: null },
    ],
  },

  terms: {
    lines: [
      'Twenty down, and ten of mine on top of it if you take me. Yes, the arithmetic is against you. That is what a tournament is for.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'A moment.', to: null },
    ],
  },

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
      'They will not seat you under ninety-nine cards, which meant counting mine — nobody in my family has counted anything since the war, and I found it obscurely thrilling. Yours stands at {cards}, if you have not been keeping up.',
    ],
    choices: [
      { label: 'It does not worry you?', to: 'worry' },
      { label: 'What is at stake in it?', to: 'stakes' },
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'Good luck.', to: null },
    ],
  },

  /* The bounty, taken as a compliment — she is the only character in the city
     delighted to have a price on her head, and the delight is the character. */
  stakes: {
    lines: [
      'Cards and money, and not politely. There is to be a bounty on every duelist in the hall: beat one and you take a pack of what they play and the coin in their pocket with it.',
      'Which means there is a price on my head, and there has never been a price on my head. Two generations of us kept out of every list there is, and a stranger with no name has put a number on me.',
      'I intend to be extremely expensive.',
    ],
    choices: [
      { label: 'Let’s duel.', to: 'offer' },
      { label: 'It does not worry you?', to: 'worry' },
      { label: 'Enjoy the view.', to: null },
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
      { label: 'The honest way, then.', to: 'terms' },
      { label: 'Another time.', to: null },
    ],
  },

  offer: {
    lines: [
      'Then stand where you are and do not back down the steps — I have watched three people do it and it is undignified for everybody.',
      'Twenty down, and ten of mine on top of it if you take me. Yes, the arithmetic is against you. That is what the last fortnight before a tournament is for.',
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
      'Next time, take the one holding them together before you start counting the big ones. Off you go.',
    ],
    choices: [
      { label: 'Again.', to: 'offer' },
      { label: 'I will be back.', to: null },
    ],
  },

  again: {
    lines: [
      'Up again. You are {left} from the door and I am still here, which says something about both of us.',
      'Dragons are rested. Say the word.',
    ],
    choices: [
      { label: 'Ready.', to: 'beaten', duel: true },
      { label: 'What is at stake, again?', to: 'stakes' },
      { label: 'A moment.', to: null },
    ],
  },

  ready: {
    lines: [
      'So the stranger with no name is Seto Kaiba, and he wants us walking his city like a tour group. I have been flattered and I have been summoned, and this is both.',
      'My chip is on the table with the twenty. Mind: the dragons come back.',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'A moment.', to: null },
    ],
  },

  chip: {
    lines: [
      'You took the Lord first. The chip is yours.',
      'I shall want to say I knew you, and now it will be true in writing.',
    ],
    choices: [
      { label: 'Again?', to: 'terms' },
      { label: 'In writing, then.', to: null },
    ],
  },

  chipped: {
    lines: [
      'You have my chip, {name}. Kept properly, I trust — it ought to come back to me eventually.',
      'Twenty down, for practice?',
    ],
    choices: [
      { label: 'Ready.', to: 'terms' },
      { label: 'A moment.', to: null },
    ],
  },

  finalist: {
    lines: [
      'The finals. A price on my head after all, and I seem to have paid it.',
      'I shall be extremely expensive down there. Do try to afford me.',
    ],
    choices: [],
  },

  out: {
    lines: [
      'No finals. The dragons came back; my luck did not.',
      'Win it, {name}. I shall tell everyone I taught you the honest way.',
    ],
    choices: [],
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
  {
    /*
     * The four who arrive with the tournament. Each record is where they
     * live — where the travel plan starts and ends their day, and where they
     * stand at night — and `travel.ts` is where they are the rest of the time.
     * `npm run travel` holds the two to agreeing.
     */
    id: 'yugi',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.yugi.home.area,
    character: { name: 'Yugi Muto', model: 'yugi', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.yugi.home.x,
    z: TRAVELLER_BY_ID.yugi.home.z,
    facing: TRAVELLER_BY_ID.yugi.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'yugi', won: 'beaten', lost: 'won' },
    script: YUGI_SCRIPT,
  },
  {
    id: 'yami',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.yami.home.area,
    character: { name: 'Yami Yugi', model: 'yami', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.yami.home.x,
    z: TRAVELLER_BY_ID.yami.home.z,
    facing: TRAVELLER_BY_ID.yami.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'yami', won: 'beaten', lost: 'won' },
    script: YAMI_SCRIPT,
  },
  {
    id: 'joey',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.joey.home.area,
    character: { name: 'Joey Wheeler', model: 'joey', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.joey.home.x,
    z: TRAVELLER_BY_ID.joey.home.z,
    facing: TRAVELLER_BY_ID.joey.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'joey', won: 'beaten', lost: 'won' },
    script: JOEY_SCRIPT,
  },
  {
    id: 'mai',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.mai.home.area,
    /* Modelled — see `premade.ts`. Her old costume of repaint rules went with
       the model swap, and nothing about her needs dressing now. */
    character: { name: 'Mai Valentine', model: 'mai', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.mai.home.x,
    z: TRAVELLER_BY_ID.mai.home.z,
    facing: TRAVELLER_BY_ID.mai.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'mai', won: 'beaten', lost: 'won' },
    script: MAI_SCRIPT,
  },
  {
    id: 'pegasus',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.pegasus.home.area,
    character: { name: 'Maximillion Pegasus', model: 'pegasus', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.pegasus.home.x,
    z: TRAVELLER_BY_ID.pegasus.home.z,
    facing: TRAVELLER_BY_ID.pegasus.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'pegasus', won: 'beaten', lost: 'won' },
    script: PEGASUS_SCRIPT,
  },
  {
    id: 'ishizu',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.ishizu.home.area,
    character: { name: 'Ishizu Ishtar', model: 'ishizu', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.ishizu.home.x,
    z: TRAVELLER_BY_ID.ishizu.home.z,
    facing: TRAVELLER_BY_ID.ishizu.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'ishizu', won: 'beaten', lost: 'won' },
    script: ISHIZU_SCRIPT,
  },
  {
    id: 'priestseto',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.priestseto.home.area,
    character: { name: 'Priest Seto', model: 'priestseto', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.priestseto.home.x,
    z: TRAVELLER_BY_ID.priestseto.home.z,
    facing: TRAVELLER_BY_ID.priestseto.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'priestseto', won: 'beaten', lost: 'won' },
    script: PRIEST_SETO_SCRIPT,
  },
  {
    id: 'yamimarik',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.yamimarik.home.area,
    character: { name: 'Yami Marik', model: 'yamimarik', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.yamimarik.home.x,
    z: TRAVELLER_BY_ID.yamimarik.home.z,
    facing: TRAVELLER_BY_ID.yamimarik.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'yamimarik', won: 'beaten', lost: 'won' },
    script: YAMI_MARIK_SCRIPT,
  },
  {
    id: 'odion',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.odion.home.area,
    character: { name: 'Odion', model: 'odion', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.odion.home.x,
    z: TRAVELLER_BY_ID.odion.home.z,
    facing: TRAVELLER_BY_ID.odion.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'odion', won: 'beaten', lost: 'won' },
    script: ODION_SCRIPT,
  },
  {
    id: 'bakura',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.bakura.home.area,
    character: { name: 'Bakura Ryou', model: 'bakura', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.bakura.home.x,
    z: TRAVELLER_BY_ID.bakura.home.z,
    facing: TRAVELLER_BY_ID.bakura.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'bakura', won: 'beaten', lost: 'won' },
    script: BAKURA_SCRIPT,
  },
  {
    id: 'jaden',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.jaden.home.area,
    character: { name: 'Jaden Yuki', model: 'jaden', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.jaden.home.x,
    z: TRAVELLER_BY_ID.jaden.home.z,
    facing: TRAVELLER_BY_ID.jaden.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'jaden', won: 'beaten', lost: 'won' },
    script: JADEN_SCRIPT,
  },
  {
    id: 'keith',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.keith.home.area,
    character: { name: 'Bandit Keith', model: 'keith', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.keith.home.x,
    z: TRAVELLER_BY_ID.keith.home.z,
    facing: TRAVELLER_BY_ID.keith.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'keith', won: 'beaten', lost: 'won' },
    script: KEITH_SCRIPT,
  },
  {
    id: 'mako',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.mako.home.area,
    character: { name: 'Mako Tsunami', model: 'mako', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.mako.home.x,
    z: TRAVELLER_BY_ID.mako.home.z,
    facing: TRAVELLER_BY_ID.mako.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'mako', won: 'beaten', lost: 'won' },
    script: MAKO_SCRIPT,
  },
  {
    id: 'rex',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.rex.home.area,
    character: { name: 'Rex Raptor', model: 'rex', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.rex.home.x,
    z: TRAVELLER_BY_ID.rex.home.z,
    facing: TRAVELLER_BY_ID.rex.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'rex', won: 'beaten', lost: 'won' },
    script: REX_SCRIPT,
  },
  {
    id: 'weevil',
    arrives: 'tournament',
    area: TRAVELLER_BY_ID.weevil.home.area,
    character: { name: 'Weevil Underwood', model: 'weevil', tints: [], stature: 0.5 },
    x: TRAVELLER_BY_ID.weevil.home.x,
    z: TRAVELLER_BY_ID.weevil.home.z,
    facing: TRAVELLER_BY_ID.weevil.home.facing,
    range: 3.2,
    start: 'greet',
    duel: { opponentId: 'weevil', won: 'beaten', lost: 'won' },
    script: WEEVIL_SCRIPT,
  },
  {
    /*
     * Kaiba, at the foot of the south flight into the forecourt at Central
     * Towers: the first thing anybody coming down from the plaza sees. He runs
     * the tournament and does not duel in it — see `KAIBA_SCRIPT`.
     */
    id: 'kaiba',
    arrives: 'tournament',
    area: HOST_SPOT.area,
    character: { name: 'Seto Kaiba', model: 'kaiba', tints: [], stature: 0.5 },
    x: HOST_SPOT.x,
    z: HOST_SPOT.z,
    facing: HOST_SPOT.facing,
    range: 3.4,
    start: 'greet',
    script: KAIBA_SCRIPT,
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
/**
 * Which node a conversation opens on, given who the player is by now.
 *
 * In priority order rather than in a table: somebody you have never met
 * introduces themselves, because an introduction you skipped is a character
 * you never met; after that the short version, `again`.
 *
 * The tournament moves everybody on. Once Kaiba's broadcast has played, a
 * first meeting is `meet` — the greeting a character had was for a city still
 * waiting on the tournament, and for the ones who travel, for the spot they
 * used to stand on — and after it `ready` is what an entrant says while their
 * chip is still on the table and `chipped` once it is yours. Once the finals
 * are set it is `finalist` for the three who went through with you, `out` for
 * everybody who did not, and `finals` for the man running it — met or not,
 * because by then nothing else is true: an introduction that offers a chip
 * nobody can win any more is worse than no introduction. The state is the
 * save's (`tournament`), not the card count's — a card lost to Ash does not
 * take anybody back out of it. A script missing any of these falls through to
 * the one before, so a character with nothing but a `greet` is still a
 * working character.
 *
 * `openAt` in the panel beats all of it — a conversation coming back from a
 * duel picks up where the result put it.
 */
export function openingNode(npc: WorldNpc, met: boolean, cards: number, tournament?: TournamentState | null): string {
  const phase = phaseOf(tournament);
  if (phase === 'finals') {
    if (isFinalist(tournament, npc.id) && npc.script.finalist) return 'finalist';
    if (npc.script.finals) return 'finals';
    if (isEntrant(npc.id) && npc.script.out) return 'out';
  }
  if (!met) return phase !== 'before' && npc.script.meet ? 'meet' : npc.start;
  if (phase !== 'before') {
    if (holdsChip(tournament, npc.id) && npc.script.chipped) return 'chipped';
    if (npc.script.ready) return 'ready';
  } else if (tournamentOpen(cards) && npc.script.ready) {
    return 'ready';
  }
  return npc.script.again ? 'again' : npc.start;
}

export function sayLine(line: string, playerName: string, fill?: Record<string, number | string>): string {
  let out = line.replace(/\{name\}/g, playerName);
  for (const [token, value] of Object.entries(fill ?? {})) {
    out = out.split(`{${token}}`).join(String(value));
  }
  return out;
}
