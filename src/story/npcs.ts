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
];

/** Nobody is placed outside `WORLD_NPCS`; `WAITING` is the bench. */
export const WAITING_CAST: WorldNpc[] = WAITING;

/** Fills the one token a line may carry. */
export function sayLine(line: string, playerName: string): string {
  return line.replace(/\{name\}/g, playerName);
}
