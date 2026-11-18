import { useCallback, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Compass,
  Cookie,
  Moon,
  Pencil,
  RotateCcw,
  Sun,
  Sunset,
  Waves,
  X,
} from 'lucide-react';
import { AquariumCanvas, type AquariumCanvasHandle } from './components/AquariumCanvas';
import { BottomDock } from './components/BottomDock';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import type {
  AquariumCounts,
  AquariumLighting,
  LightingPreset,
  SelectedDecor,
} from './types/aquarium';

const LIGHTING_OPTIONS: {
  id: LightingPreset;
  label: string;
  defaultIntensity: number;
  icon: typeof Sun;
  accentClass: string;
}[] = [
  {
    id: 'day',
    label: 'Día',
    defaultIntensity: 1.0,
    icon: Sun,
    accentClass: 'text-amber-300',
  },
  {
    id: 'reef',
    label: 'Arrecife',
    defaultIntensity: 1.05,
    icon: Waves,
    accentClass: 'text-sky-300',
  },
  {
    id: 'sunset',
    label: 'Atardecer',
    defaultIntensity: 0.95,
    icon: Sunset,
    accentClass: 'text-orange-300',
  },
  {
    id: 'night',
    label: 'Nocturno',
    defaultIntensity: 0.45,
    icon: Moon,
    accentClass: 'text-indigo-300',
  },
];

export default function App() {
  const aquariumRef = useRef<AquariumCanvasHandle | null>(null);
  const [counts, setCounts] = useState<AquariumCounts>({
    fish: 1,
    plants: 3,
    stones: 2,
  });
  const [editMode, setEditMode] = useState(false);
  const [selectedDecor, setSelectedDecor] = useState<SelectedDecor | null>(null);
  const [lighting, setLighting] = useState<AquariumLighting>({
    preset: 'day',
    intensity: 1.0,
  });
  const [lightingOpen, setLightingOpen] = useState(false);

  const handleCountsChange = useCallback((nextCounts: AquariumCounts) => {
    setCounts(nextCounts);
  }, []);

  const handleSelectionChange = useCallback((nextSelected: SelectedDecor | null) => {
    setSelectedDecor(nextSelected);
    if (nextSelected) {
      setLightingOpen(false);
    }
  }, []);

  const handleToggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      aquariumRef.current?.setEditMode(next);
      if (!next) {
        setSelectedDecor(null);
      }
      return next;
    });
  }, []);

  const applyLighting = useCallback((next: AquariumLighting) => {
    setLighting(next);
    aquariumRef.current?.setLighting(next);
  }, []);

  const handleSelectPreset = useCallback(
    (preset: LightingPreset, defaultIntensity: number) => {
      applyLighting({ preset, intensity: defaultIntensity });
    },
    [applyLighting]
  );

  const handleToggleLighting = useCallback(() => {
    setLightingOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        aquariumRef.current?.clearSelection();
      }
      return nextOpen;
    });
  }, []);

  const handleReset = useCallback(() => {
    setLightingOpen(false);
    setLighting({ preset: 'day', intensity: 1.0 });
    aquariumRef.current?.reset();
  }, []);

  return (
    <div className="relative w-full h-dvh overflow-hidden bg-black">
      {/* Compact translucent top header adhering to mobile sticky height cap */}
      <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 sm:px-6 pt-safe pb-3 bg-gradient-to-b from-slate-950/60 via-slate-950/25 to-transparent pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 min-w-0">
          <h1 className="font-display text-sm sm:text-lg font-semibold tracking-tight text-white drop-shadow-sm whitespace-nowrap shrink-0">
            Acuario 3D
          </h1>
          <div
            aria-live="polite"
            className="hidden sm:flex items-center gap-1.5 text-xs text-sky-100/90 tabular-nums whitespace-nowrap truncate drop-shadow-sm"
          >
            <span>{counts.fish === 1 ? '1 pez' : `${counts.fish} peces`}</span>
            <span aria-hidden="true">·</span>
            <span>{counts.plants === 1 ? '1 planta' : `${counts.plants} plantas`}</span>
            <span aria-hidden="true">·</span>
            <span>{counts.stones === 1 ? '1 piedra' : `${counts.stones} piedras`}</span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => aquariumRef.current?.dropFood()}
            aria-label="Echar comida a los peces"
            className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-amber-100 bg-amber-600/85 hover:bg-amber-500 active:scale-[0.94] border border-amber-300/45 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Cookie className="w-3.5 h-3.5 text-amber-100 shrink-0" aria-hidden="true" />
            <span className={editMode ? 'hidden sm:inline' : ''}>Comida</span>
          </button>

          <button
            type="button"
            onClick={handleToggleEditMode}
            aria-pressed={editMode}
            aria-label={editMode ? 'Finalizar edición del acuario' : 'Activar modo edición'}
            className={`min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0 ${
              editMode
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300/70'
                : 'text-white bg-slate-950/85 hover:bg-slate-950/95 border-white/25'
            }`}
          >
            {editMode ? (
              <Check className="w-3.5 h-3.5 text-white shrink-0" aria-hidden="true" />
            ) : (
              <Pencil className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
            )}
            <span>{editMode ? 'Listo' : 'Editar'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleLighting}
            aria-label="Control de iluminación"
            aria-expanded={lightingOpen}
            className={`min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0 ${
              lightingOpen
                ? 'bg-sky-500 text-white border-sky-300/70'
                : 'text-amber-100 bg-slate-950/85 hover:bg-slate-950/95 border-white/20'
            }`}
          >
            <Sun
              className={`w-3.5 h-3.5 shrink-0 ${
                lightingOpen ? 'text-white' : 'text-amber-300'
              }`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Luz</span>
          </button>

          <button
            type="button"
            onClick={() => aquariumRef.current?.resetCamera()}
            aria-label="Centrar cámara"
            className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-sky-100 bg-slate-950/85 hover:bg-slate-950/95 active:scale-[0.96] border border-white/20 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Compass className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Centrar</span>
          </button>

          {!editMode && <PWAInstallButton />}

          {editMode && (
            <button
              type="button"
              onClick={handleReset}
              aria-label="Reiniciar acuario"
              className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-white bg-slate-950/85 hover:bg-slate-950/95 active:scale-[0.96] border border-white/25 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sky-200 shrink-0" aria-hidden="true" />
              <span>Reiniciar</span>
            </button>
          )}
        </div>
      </header>

      {/* Main interactive 3D aquarium stage */}
      <main className="w-full h-full">
        <AquariumCanvas
          ref={aquariumRef}
          onCountsChange={handleCountsChange}
          onSelectionChange={handleSelectionChange}
          onLightingLoaded={setLighting}
        />
      </main>

      {/* Contextual lighting controls */}
      {lightingOpen && (!editMode || !selectedDecor) && (
        <div
          role="region"
          aria-label="Controles de iluminación del acuario"
          className={`fixed left-0 right-0 z-30 flex justify-center px-3 pointer-events-none ${
            editMode ? 'bottom-[88px] sm:bottom-[84px]' : 'bottom-4 pb-safe'
          }`}
        >
          <div className="pointer-events-auto w-full max-w-md flex flex-col gap-2.5 p-2.5 rounded-xl bg-slate-950/92 border border-white/25 shadow-lg text-white">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {LIGHTING_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = lighting.preset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectPreset(opt.id, opt.defaultIntensity)}
                      aria-pressed={active}
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'bg-white/10 hover:bg-white/20 text-slate-100'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-white' : opt.accentClass
                        }`}
                        aria-hidden="true"
                      />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setLightingOpen(false)}
                aria-label="Cerrar controles de iluminación"
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-[0.96] text-slate-300 hover:text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <label className="flex items-center gap-3 px-1">
              <span className="text-xs font-medium text-sky-100 whitespace-nowrap shrink-0">
                Intensidad
              </span>
              <input
                type="range"
                min={15}
                max={160}
                step={1}
                value={Math.round(lighting.intensity * 100)}
                onChange={(e) =>
                  applyLighting({
                    ...lighting,
                    intensity: Number(e.target.value) / 100,
                  })
                }
                aria-label="Intensidad de la iluminación"
                className="w-full accent-sky-400 cursor-pointer h-2"
              />
              <span className="text-xs font-medium text-sky-200 tabular-nums w-10 text-right shrink-0">
                {Math.round(lighting.intensity * 100)}%
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Contextual layer controls when a stone or plant is selected/dragged in Edit Mode */}
      {editMode && selectedDecor && (
        <div
          role="region"
          aria-label="Orden de profundidad del elemento seleccionado"
          className="fixed bottom-[88px] sm:bottom-[84px] left-0 right-0 z-30 flex justify-center px-3 pointer-events-none"
        >
          <div className="pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/92 border border-white/25 shadow-lg text-white">
            <span className="px-2 text-xs font-medium text-sky-100 whitespace-nowrap shrink-0">
              {selectedDecor.kind === 'plant' ? 'Planta' : 'Piedra'}
            </span>

            <button
              type="button"
              onClick={() => aquariumRef.current?.sendSelectedBackward()}
              className="min-h-[44px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-[0.96] text-xs font-medium text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowDownToLine className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
              <span>Atrás</span>
            </button>

            <button
              type="button"
              onClick={() => aquariumRef.current?.bringSelectedForward()}
              className="min-h-[44px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 active:scale-[0.96] text-xs font-semibold text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUpToLine className="w-3.5 h-3.5 text-white shrink-0" aria-hidden="true" />
              <span>Adelante</span>
            </button>

            <button
              type="button"
              onClick={() => aquariumRef.current?.clearSelection()}
              aria-label="Cerrar selección"
              className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-[0.96] text-slate-300 hover:text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom edit dock shown only when Edit Mode is active */}
      {editMode && (
        <BottomDock
          onAddPlant={() => aquariumRef.current?.addPlant()}
          onAddStone={() => aquariumRef.current?.addStone()}
          onAddFish={() => aquariumRef.current?.addFish()}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
