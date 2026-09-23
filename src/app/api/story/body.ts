/**
 * Reading a request body without believing a word of it.
 *
 * `req.json()` is only guarded against *malformed* JSON. `POST null` is
 * perfectly well-formed and parses to `null`, and reading `.username` off that
 * throws a TypeError — which a route turns into a 500, for a request that
 * deserved a 401. `{"username": {}}` is worse: it gets as far as `fold()`,
 * which calls `.trim()` on an object and throws from inside the store layer.
 *
 * So every Story Mode route reads its body through here: anything that is not
 * an object becomes an empty one, and `username` is a string or it is absent.
 * The rest of each body is still each route's own business — the character goes
 * through `normaliseCharacter` and the deck through `validateDeck`, both of
 * which already assume they are being handed nonsense.
 */
export interface StoryBody {
  username: string;
  /** Tournament: `start` once the broadcast has played, `seen` once the finals have been announced. */
  step?: unknown;
  character?: unknown;
  deck?: unknown;
  world?: unknown;
  /** Packs: which half of the flow this is. */
  action?: unknown;
  /** Packs: the room a win is being claimed against. */
  code?: unknown;
  token?: unknown;
  /** The shop: which card is being bought. */
  slug?: unknown;
  /** `save`: the duel on the save has been come back from; forget it. */
  duelDone?: boolean;
  /** `save`: Trunk cards the player has now looked at; take them off `fresh`. */
  seen?: unknown;
  /** `save`: NPCs the player has now been introduced to; add them to `met`. */
  met?: unknown;
}

export async function readBody(req: Request): Promise<StoryBody> {
  const raw: unknown = await req.json().catch(() => null);
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    username: typeof obj.username === 'string' ? obj.username : '',
    step: obj.step,
    character: obj.character,
    action: obj.action,
    code: obj.code,
    token: obj.token,
    slug: obj.slug,
    deck: obj.deck,
    world: obj.world,
    seen: obj.seen,
    met: obj.met,
    duelDone: obj.duelDone === true,
  };
}
