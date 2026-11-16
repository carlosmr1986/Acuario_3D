import { Fish, Mountain, Sprout } from 'lucide-react';

interface BottomDockProps {
  onAddPlant: () => void;
  onAddStone: () => void;
  onAddFish: () => void;
}

export function BottomDock({
  onAddPlant,
  onAddStone,
  onAddFish,
}: BottomDockProps) {
  return (
    <nav
      aria-label="Controles del acuario"
      className="fixed bottom-0 left-0 right-0 z-30 flex justify-center px-3 pb-safe pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-md sm:max-w-lg grid grid-cols-3 gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-white/95 border border-white/80 shadow-xl shadow-sky-950/25">
        <button
          type="button"
          onClick={onAddPlant}
          className="group min-h-[52px] sm:min-h-[48px] px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 bg-emerald-50/90 hover:bg-emerald-100 active:scale-[0.96] text-emerald-950 font-medium text-[11px] sm:text-sm leading-none transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer whitespace-nowrap"
        >
          <Sprout
            className="w-5 h-5 sm:w-[18px] sm:h-[18px] text-emerald-600 shrink-0 transition-transform duration-150 group-active:scale-110"
            aria-hidden="true"
          />
          <span>Añadir Planta</span>
        </button>

        <button
          type="button"
          onClick={onAddStone}
          className="group min-h-[52px] sm:min-h-[48px] px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 bg-slate-100/95 hover:bg-slate-200/90 active:scale-[0.96] text-slate-900 font-medium text-[11px] sm:text-sm leading-none transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 cursor-pointer whitespace-nowrap"
        >
          <Mountain
            className="w-5 h-5 sm:w-[18px] sm:h-[18px] text-slate-600 shrink-0 transition-transform duration-150 group-active:scale-110"
            aria-hidden="true"
          />
          <span>Añadir Piedra</span>
        </button>

        <button
          type="button"
          onClick={onAddFish}
          className="group min-h-[52px] sm:min-h-[48px] px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 bg-sky-600 hover:bg-sky-700 active:scale-[0.96] text-white font-semibold text-[11px] sm:text-sm leading-none shadow-sm shadow-sky-900/20 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 cursor-pointer whitespace-nowrap"
        >
          <Fish
            className="w-5 h-5 sm:w-[18px] sm:h-[18px] text-sky-100 shrink-0 transition-transform duration-150 group-active:scale-110"
            aria-hidden="true"
          />
          <span>Añadir Pez</span>
        </button>
      </div>
    </nav>
  );
}
