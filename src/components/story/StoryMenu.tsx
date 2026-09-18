'use client';

/**
 * The pause menu: the sheet that comes down over the world.
 *
 * One card, the duelist's plaque on it, and every way out of the moment laid
 * out as a row you can read — what it does and what it is for — rather than a
 * stack of same-sized buttons in a corner. Options live one page in, behind a
 * back arrow, so the first page stays short. Deleting the duelist is at the
 * very bottom in the quiet voice a dangerous thing should have.
 *
 * The labels the checks press are unchanged: "Edit Deck", "Save", "Return to
 * the Main Menu", "Delete Character".
 */

import { useEffect, useState } from 'react';
import { getSfxEnabled, setSfxEnabled, sfx } from '@/lib/sfx';

export interface StoryMenuProps {
  name: string;
  level: number;
  money: number;
  /** Where she is standing, for the plaque. */
  place: string;
  /** The clock, as "HH:MM", if the world has one to show. */
  clock?: string;
  saving: boolean;
  savedNote?: string | null;
  hints: boolean;
  onHints: (on: boolean) => void;
  /** The position readout in the corner, for naming a place to me. */
  where: boolean;
  onWhere: (on: boolean) => void;
  onEditDeck: () => void;
  onMap: () => void;
  onSave: () => void;
  onExit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/* Line icons, drawn once: no icon font, no image assets. */
const Icon = ({ d, box = 24 }: { d: string; box?: number }) => (
  <svg viewBox={`0 0 ${box} ${box}`} className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICON = {
  deck: 'M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 8h6M9 11h6M9 14h3M4 7v11M20 7v11',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  save: 'M5 4h11l3 3v13H5V4zM8 4v5h7V4M8 20v-6h8v6',
  options: 'M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12M20 17h0M14 5v4M7 10v4M16 15v4',
  exit: 'M10 4H5v16h5M14 8l4 4-4 4M8 12h10',
  back: 'M15 5l-7 7 7 7',
  sound: 'M4 10v4h3l5 4V6L7 10H4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
  hints: 'M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3zM10 21h4',
  where: 'M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

export default function StoryMenu(p: StoryMenuProps) {
  const [page, setPage] = useState<'main' | 'options'>('main');
  const [sound, setSound] = useState(() => (typeof window === 'undefined' ? true : getSfxEnabled()));

  /* Esc closes, like every pause menu there is. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-ink/70 p-4 backdrop-blur-[2px]"
      style={{ paddingTop: 'calc(var(--safe-top) + 16px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
      onClick={p.onClose}
      role="dialog"
      aria-modal
      aria-label="Pause menu"
    >
      {/* Centred when it fits, scrolled from the top when it does not. */}
      <div className="flex min-h-full w-full items-center justify-center">
      <div
        className="panel grain relative flex w-full max-w-md flex-col overflow-hidden rounded sm:max-w-2xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* the plaque */}
        <div className="relative shrink-0 border-b border-stoneline bg-black/25 p-5 sm:w-64 sm:border-b-0 sm:border-r">
          <p className="text-[10px] uppercase tracking-[0.32em] text-brass">Duelist</p>
          <h2 className="mt-1 font-display text-2xl leading-tight text-brassbright">{p.name}</h2>
          <div className="brass-rule my-3" />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] sm:grid-cols-1">
            <div>
              <dt className="text-[9px] uppercase tracking-widest text-ptextdim">Level</dt>
              {/* The value reads "Level 1" to a screen reader and to the
                  story check, and shows the number under its label. */}
              <dd className="font-display text-base text-parchment"><span className="sr-only">Level </span>{p.level}</dd>
            </div>
            <div>
              <dt className="text-[9px] uppercase tracking-widest text-ptextdim">Purse</dt>
              <dd className="font-display text-base text-parchment">${p.money.toLocaleString()}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[9px] uppercase tracking-widest text-ptextdim">Standing in</dt>
              <dd className="font-display text-[13px] text-parchment">{p.place}</dd>
            </div>
            {p.clock && (
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-[9px] uppercase tracking-widest text-ptextdim">The hour</dt>
                <dd className="font-display text-[13px] text-parchment">{p.clock}</dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            className="btn absolute right-3 top-3 rounded px-2 py-1 text-[10px] sm:hidden"
            onClick={() => {
              sfx.click();
              p.onClose();
            }}
            aria-label="Close the menu"
          >
            ✕
          </button>
        </div>

        {/* the pages */}
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
          {page === 'main' ? (
            <>
              <div className="mb-3 hidden items-baseline justify-between sm:flex">
                <p className="text-[10px] uppercase tracking-[0.32em] text-brass">Paused</p>
                <button
                  type="button"
                  className="btn rounded px-2 py-1 text-[10px]"
                  onClick={() => {
                    sfx.click();
                    p.onClose();
                  }}
                >
                  ✕ Back to the world
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Row icon={ICON.deck} title="Edit Deck" sub="Twenty-five cards, one copy of each, from your Trunk" onClick={p.onEditDeck} />
                <Row icon={ICON.map} title="Map" sub="The plan of Domino City, and a way to any part of it" onClick={p.onMap} />
                <Row icon={ICON.save} title={p.saving ? 'Saving…' : 'Save'} sub={p.savedNote ?? 'Where you stand, your deck and your Trunk'} onClick={p.onSave} disabled={p.saving} />
                <Row icon={ICON.options} title="Options" sub="Sound and the on-screen hints" onClick={() => setPage('options')} />
                <Row icon={ICON.exit} title="Return to the Main Menu" sub="Your place here is kept" onClick={p.onExit} />
              </div>
              <div className="mt-auto pt-4 text-center sm:text-right">
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-widest text-[#b8646c] underline-offset-4 hover:underline"
                  onClick={() => {
                    sfx.click();
                    p.onDelete();
                  }}
                >
                  Delete Character
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn rounded px-2 py-1 text-[10px]"
                  onClick={() => {
                    sfx.click();
                    setPage('main');
                  }}
                  aria-label="Back"
                >
                  <Icon d={ICON.back} />
                </button>
                <p className="text-[10px] uppercase tracking-[0.32em] text-brass">Options</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Toggle
                  icon={ICON.sound}
                  title="Sound"
                  sub="Clicks, cards and the duel"
                  on={sound}
                  onChange={(on) => {
                    setSound(on);
                    setSfxEnabled(on);
                    if (on) sfx.click();
                  }}
                />
                <Toggle icon={ICON.hints} title="Control hints" sub="The line under the stick that says how to walk" on={p.hints} onChange={p.onHints} />
                <Toggle icon={ICON.where} title="Where I stand" sub="The area and the metres, in the corner, for naming a place" on={p.where} onChange={p.onWhere} />
              </div>
              <p className="mt-4 text-[10px] leading-relaxed text-ptextdim">
                The picture sets its own quality: it gives up pixels before it gives up frames, and there is nothing to
                choose. The clock is the city&apos;s and runs whether you are here or not.
              </p>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function Row({ icon, title, sub, onClick, disabled, primary }: { icon: string; title: string; sub: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click();
        onClick();
      }}
      disabled={disabled}
      className={`btn flex w-full items-center gap-3 rounded px-3 py-2.5 text-left normal-case tracking-normal ${primary ? 'btn-primary' : ''}`}
    >
      <span className="text-brass">
        <Icon d={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13px] uppercase tracking-[0.08em] text-parchment">{title}</span>
        <span className="block truncate font-sans text-[10px] normal-case tracking-normal text-ptextdim">{sub}</span>
      </span>
      <span className="text-ptextdim/60">›</span>
    </button>
  );
}

function Toggle({ icon, title, sub, on, onChange }: { icon: string; title: string; sub: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="btn flex w-full items-center gap-3 rounded px-3 py-2.5 text-left normal-case tracking-normal"
    >
      <span className="text-brass">
        <Icon d={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13px] uppercase tracking-[0.08em] text-parchment">{title}</span>
        <span className="block truncate font-sans text-[10px] normal-case tracking-normal text-ptextdim">{sub}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${on ? 'border-brass bg-[#6d5320]' : 'border-stoneline bg-black/40'}`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] ${on ? 'left-[18px] bg-brassbright' : 'left-0.5 bg-ptextdim'}`}
        />
      </span>
    </button>
  );
}
