import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Box,
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
  AquariumBackgroundId,
  AquariumCounts,
  AquariumLighting,
  LightingPreset,
  SelectedDecor,
  TankDimensions,
} from './types/aquarium';

const DEFAULT_TANK_DIMENSIONS: TankDimensions = {
  preset: 'standard',
  width: 5.4,
  height: 3.2,
  depth: 3.0,
};

const TANK_SIZE_PRESETS: {
  id: Exclude<TankDimensions['preset'], 'custom'>;
  label: string;
  dims: Omit<TankDimensions, 'preset'>;
}[] = [
  { id: 'compact', label: 'Compacta', dims: { width: 4.0, height: 2.8, depth: 2.4 } },
  { id: 'standard', label: 'Estándar', dims: { width: 5.4, height: 3.2, depth: 3.0 } },
  { id: 'large', label: 'Grande', dims: { width: 6.6, height: 3.6, depth: 3.5 } },
  { id: 'panoramic', label: 'Panorámica', dims: { width: 7.4, height: 3.0, depth: 2.8 } },
];

const BACKGROUND_OPTIONS: {
  id: AquariumBackgroundId;
  label: string;
  swatchStyle: string;
}[] = [
  {
    id: 'natural',
    label: 'Natural',
    swatchStyle: 'linear-gradient(180deg, #1b7ea6 0%, #0b4a69 55%, #06273f 100%)',
  },
  {
    id: 'reef',
    label: 'Arrecife',
    swatchStyle: 'linear-gradient(180deg, #3ad1ec 0%, #1089b8 55%, #042a47 100%)',
  },
  {
    id: 'amazon',
    label: 'Amazónico',
    swatchStyle: 'linear-gradient(180deg, #4d926b 0%, #1f533e 58%, #071b16 100%)',
  },
  {
    id: 'slate',
    label: 'Pizarra',
    swatchStyle: 'linear-gradient(180deg, #324050 0%, #1b232e 58%, #0d1219 100%)',
  },
  {
    id: 'frosted',
    label: 'Esmerilado',
    swatchStyle: 'linear-gradient(180deg, #f2fbff 0%, #c6e8f7 55%, #69a5c7 100%)',
  },
  {
    id: 'abyss',
    label: 'Abismo',
    swatchStyle: 'linear-gradient(180deg, #1863a8 0%, #0b3a72 58%, #020b1d 100%)',
  },
];

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
  const [tankDimensions, setTankDimensions] = useState<TankDimensions>(
    DEFAULT_TANK_DIMENSIONS
  );
  const [backgroundId, setBackgroundId] = useState<AquariumBackgroundId>('natural');
  const [tankPanelOpen, setTankPanelOpen] = useState(false);

  const tankMetrics = useMemo(() => {
    const wCm = Math.round(tankDimensions.width * 15);
    const hCm = Math.round(tankDimensions.height * 15);
    const dCm = Math.round(tankDimensions.depth * 15);
    const liters = Math.round((wCm * hCm * dCm) / 1000);
    return { wCm, hCm, dCm, liters };
  }, [tankDimensions]);

  const handleCountsChange = useCallback((nextCounts: AquariumCounts) => {
    setCounts(nextCounts);
  }, []);

  const handleSelectionChange = useCallback((nextSelected: SelectedDecor | null) => {
    setSelectedDecor(nextSelected);
    if (nextSelected) {
      setLightingOpen(false);
      setTankPanelOpen(false);
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
        setTankPanelOpen(false);
        aquariumRef.current?.clearSelection();
      }
      return nextOpen;
    });
  }, []);

  const handleToggleTankPanel = useCallback(() => {
    setTankPanelOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setLightingOpen(false);
        aquariumRef.current?.clearSelection();
      }
      return nextOpen;
    });
  }, []);

  const applyTankDimensions = useCallback((next: TankDimensions) => {
    setTankDimensions(next);
    aquariumRef.current?.setTankDimensions(next);
  }, []);

  const handleSelectBackground = useCallback((id: AquariumBackgroundId) => {
    setBackgroundId(id);
    aquariumRef.current?.setBackground(id);
  }, []);

  const handleReset = useCallback(() => {
    setLightingOpen(false);
    setTankPanelOpen(false);
    setLighting({ preset: 'day', intensity: 1.0 });
    setTankDimensions(DEFAULT_TANK_DIMENSIONS);
    setBackgroundId('natural');
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
            <span>{counts.fish === 1 ? '1 goldfish' : `${counts.fish} goldfish`}</span>
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
            aria-label="Echar comida a los goldfish"
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
            onClick={handleToggleTankPanel}
            aria-label="Tamaño y fondo de la pecera"
            aria-expanded={tankPanelOpen}
            className={`min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0 ${
              tankPanelOpen
                ? 'bg-sky-500 text-white border-sky-300/70'
                : 'text-sky-100 bg-slate-950/85 hover:bg-slate-950/95 border-white/20'
            }`}
          >
            <Box
              className={`w-3.5 h-3.5 shrink-0 ${
                tankPanelOpen ? 'text-white' : 'text-cyan-300'
              }`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Pecera</span>
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
          onTankDimensionsLoaded={setTankDimensions}
          onBackgroundLoaded={setBackgroundId}
        />
      </main>

      {/* Contextual tank size & aquarium background controls */}
      {tankPanelOpen && (!editMode || !selectedDecor) && (
        <div
          role="region"
          aria-label="Tamaño y fondo de la pecera"
          className={`fixed left-0 right-0 z-30 flex justify-center px-3 pointer-events-none ${
            editMode ? 'bottom-[88px] sm:bottom-[84px]' : 'bottom-4 pb-safe'
          }`}
        >
          <div className="pointer-events-auto w-full max-w-lg flex flex-col gap-3 p-3 rounded-xl bg-slate-950/92 border border-white/25 shadow-lg text-white">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  Tamaño de pecera
                </span>
                <span className="text-[11px] font-medium text-sky-200/90 tabular-nums whitespace-nowrap">
                  {tankMetrics.wCm} × {tankMetrics.hCm} × {tankMetrics.dCm} cm · ~{tankMetrics.liters} L
                </span>
              </div>

              <button
                type="button"
                onClick={() => setTankPanelOpen(false)}
                aria-label="Cerrar controles de la pecera"
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-[0.96] text-slate-300 hover:text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {TANK_SIZE_PRESETS.map((preset) => {
                const active = tankDimensions.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      applyTankDimensions({
                        preset: preset.id,
                        ...preset.dims,
                      })
                    }
                    aria-pressed={active}
                    className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-medium active:scale-[0.96] transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'bg-white/10 hover:bg-white/20 text-slate-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2.5 px-0.5">
              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[11px] text-sky-100/90">
                  <span>Ancho</span>
                  <span className="tabular-nums text-sky-200">{tankMetrics.wCm} cm</span>
                </span>
                <input
                  type="range"
                  min={360}
                  max={760}
                  step={10}
                  value={Math.round(tankDimensions.width * 100)}
                  onChange={(e) =>
                    applyTankDimensions({
                      ...tankDimensions,
                      preset: 'custom',
                      width: Number(e.target.value) / 100,
                    })
                  }
                  aria-label="Ancho de la pecera"
                  className="w-full accent-sky-400 cursor-pointer h-2"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[11px] text-sky-100/90">
                  <span>Alto</span>
                  <span className="tabular-nums text-sky-200">{tankMetrics.hCm} cm</span>
                </span>
                <input
                  type="range"
                  min={240}
                  max={400}
                  step={10}
                  value={Math.round(tankDimensions.height * 100)}
                  onChange={(e) =>
                    applyTankDimensions({
                      ...tankDimensions,
                      preset: 'custom',
                      height: Number(e.target.value) / 100,
                    })
                  }
                  aria-label="Alto de la pecera"
                  className="w-full accent-sky-400 cursor-pointer h-2"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[11px] text-sky-100/90">
                  <span>Fondo</span>
                  <span className="tabular-nums text-sky-200">{tankMetrics.dCm} cm</span>
                </span>
                <input
                  type="range"
                  min={220}
                  max={420}
                  step={10}
                  value={Math.round(tankDimensions.depth * 100)}
                  onChange={(e) =>
                    applyTankDimensions({
                      ...tankDimensions,
                      preset: 'custom',
                      depth: Number(e.target.value) / 100,
                    })
                  }
                  aria-label="Profundidad de la pecera"
                  className="w-full accent-sky-400 cursor-pointer h-2"
                />
              </label>
            </div>

            <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
              <span className="text-xs font-semibold text-white">Fondo del acuario</span>
              <div className="grid grid-cols-3 gap-1.5">
                {BACKGROUND_OPTIONS.map((bg) => {
                  const active = backgroundId === bg.id;
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => handleSelectBackground(bg.id)}
                      aria-pressed={active}
                      className={`min-h-[38px] px-2 py-1.5 rounded-lg flex items-center gap-1.5 text-[11px] font-medium active:scale-[0.96] border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-sky-500/25 border-sky-400 text-white'
                          : 'bg-white/10 hover:bg-white/15 border-white/10 text-slate-100'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="w-3.5 h-3.5 rounded border border-white/30 shrink-0"
                        style={{ background: bg.swatchStyle }}
                      />
                      <span className="truncate">{bg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

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
