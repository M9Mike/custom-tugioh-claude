'use client';

/**
 * Talking to somebody.
 *
 * A panel across the bottom of the field: who is speaking, what they said, and
 * either a tap to continue or the replies you may give. It walks a script from
 * `src/story/npcs.ts` and knows nothing else — no world, no three.js, no
 * character record. Hand it a script and a name and it is a conversation;
 * that is what makes the next NPC a data change.
 *
 * Two decisions worth keeping:
 *
 * - **A speech is paged, not scrolled.** Each paragraph is a page and a tap
 *   moves on. A phone-height panel holding four paragraphs is a wall of text,
 *   and a wall of text in a game is a thing players skip — which for a
 *   tutorial means they skip the tutorial.
 * - **Replies only appear on the last page.** Offering a choice while there is
 *   still text to come asks the player to answer something half-said.
 */

import { useEffect, useState } from 'react';
import { sayLine, type WorldNpc } from '@/story/npcs';
import { sfx } from '@/lib/sfx';

interface Props {
  npc: WorldNpc;
  /** The player's own duelist name, for `{name}` in the script. */
  playerName: string;
  onClose: () => void;
  /**
   * Which node to open on, instead of the script's own start.
   *
   * Set when the conversation is being *resumed* — the player has just come
   * back from a duel this character sent them to, and picks up on the node the
   * result chose. The panel does not know or care that a duel happened; it is
   * handed a node and carries on.
   */
  openAt?: string;
  /** Leave the conversation and duel this character. */
  onDuel?: () => void;
}

export default function Conversation({ npc, playerName, onClose, openAt, onDuel }: Props) {
  const [nodeId, setNodeId] = useState(openAt ?? npc.start);
  const [page, setPage] = useState(0);

  /* A script that names a node it does not have is an authoring mistake, and
     the panel is the wrong place to die of one: say so in the console, close
     cleanly, and leave the player standing in a field rather than looking at
     a blank box. */
  const node = npc.script[nodeId];
  useEffect(() => {
    if (!node) {
      console.error(`conversation: ${npc.id} has no node "${nodeId}"`);
      onClose();
    }
  }, [node, nodeId, npc.id, onClose]);
  if (!node) return null;

  const lastPage = page >= node.lines.length - 1;
  const line = sayLine(node.lines[page] ?? '', playerName);

  const advance = () => {
    sfx.click();
    if (!lastPage) {
      setPage((p) => p + 1);
      return;
    }
    /* No replies written means the speech was the whole of it. */
    if (node.choices.length === 0) onClose();
  };

  const choose = (to: string | null, duel?: boolean) => {
    sfx.click();
    /* A duel leaves the conversation rather than advancing it. The node named
       by the choice is where it will resume, and the caller records that — the
       panel is about to be unmounted and cannot remember anything. */
    if (duel && onDuel) {
      onDuel();
      return;
    }
    if (to === null) {
      onClose();
      return;
    }
    setNodeId(to);
    setPage(0);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end">
      {/* Tapping the speech advances it — the whole area above the replies is
          the button, because a small "next" chevron on a phone is a target you
          miss. */}
      <button
        aria-label="Continue"
        onClick={advance}
        className="pointer-events-auto flex-1 cursor-default"
      />
      <div
        className="panel grain pointer-events-auto m-3 rounded p-4"
        style={{ marginBottom: 'calc(var(--safe-bottom) + 12px)' }}
        data-conversation={npc.id}
      >
        <div className="flex items-baseline justify-between">
          <p className="font-display text-base leading-none text-brassbright">{npc.character.name}</p>
          <button
            className="btn rounded px-2 py-1 text-[9px]"
            aria-label="End the conversation"
            onClick={() => {
              sfx.click();
              onClose();
            }}
          >
            ✕
          </button>
        </div>
        <div className="brass-rule my-2.5" />

        <button onClick={advance} className="block w-full text-left" aria-label="Continue">
          {/* Named for the driving scripts: the panel holds several
              paragraphs and the speaker's own name is one of them, so "did
              answering move the conversation on" needs to address *this*
              one and not whichever happens to come first. */}
          <p data-line className="min-h-[3.5rem] text-xs leading-relaxed text-ptext/90">
            {line}
          </p>
        </button>

        {!lastPage && (
          <p className="mt-2 text-right text-[9px] uppercase tracking-widest text-ptextdim">Tap to go on</p>
        )}

        {lastPage && node.choices.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {node.choices.map((c) => (
              <button
                key={c.label}
                data-reply={c.label}
                className="btn rounded px-3 py-2 text-left text-[11px]"
                onClick={() => choose(c.to, c.duel)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {lastPage && node.choices.length === 0 && (
          <button className="btn btn-primary mt-3 w-full rounded px-3 py-2 text-[11px]" onClick={onClose}>
            Goodbye
          </button>
        )}
      </div>
    </div>
  );
}
