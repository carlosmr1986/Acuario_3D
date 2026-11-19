import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { AquariumScene3DController } from '../three/aquariumScene3d';
import type {
  AquariumBackgroundId,
  AquariumCounts,
  AquariumLighting,
  SelectedDecor,
  TankDimensions,
} from '../types/aquarium';

export interface AquariumCanvasHandle {
  addPlant: () => void;
  addStone: () => void;
  addFish: () => void;
  dropFood: () => void;
  bringSelectedForward: () => void;
  sendSelectedBackward: () => void;
  clearSelection: () => void;
  setEditMode: (enabled: boolean) => void;
  setLighting: (lighting: AquariumLighting) => void;
  setTankDimensions: (dims: TankDimensions) => void;
  setBackground: (backgroundId: AquariumBackgroundId) => void;
  resetCamera: () => void;
  reset: () => void;
}

interface AquariumCanvasProps {
  onCountsChange: (counts: AquariumCounts) => void;
  onSelectionChange: (selected: SelectedDecor | null) => void;
  onLightingLoaded?: (lighting: AquariumLighting) => void;
  onTankDimensionsLoaded?: (dims: TankDimensions) => void;
  onBackgroundLoaded?: (backgroundId: AquariumBackgroundId) => void;
}

export const AquariumCanvas = forwardRef<AquariumCanvasHandle, AquariumCanvasProps>(
  function AquariumCanvas(
    {
      onCountsChange,
      onSelectionChange,
      onLightingLoaded,
      onTankDimensionsLoaded,
      onBackgroundLoaded,
    },
    ref
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<AquariumScene3DController | null>(null);
    const callbacksRef = useRef({
      onCountsChange,
      onSelectionChange,
      onLightingLoaded,
      onTankDimensionsLoaded,
      onBackgroundLoaded,
    });
    callbacksRef.current = {
      onCountsChange,
      onSelectionChange,
      onLightingLoaded,
      onTankDimensionsLoaded,
      onBackgroundLoaded,
    };

    useImperativeHandle(
      ref,
      () => ({
        addPlant: () => controllerRef.current?.addPlant(),
        addStone: () => controllerRef.current?.addStone(),
        addFish: () => controllerRef.current?.addFish(),
        dropFood: () => controllerRef.current?.dropFood(),
        bringSelectedForward: () => controllerRef.current?.bringSelectedForward(),
        sendSelectedBackward: () => controllerRef.current?.sendSelectedBackward(),
        clearSelection: () => controllerRef.current?.clearSelection(),
        setEditMode: (enabled) => controllerRef.current?.setEditMode(enabled),
        setLighting: (lighting) => controllerRef.current?.setLighting(lighting),
        setTankDimensions: (dims) => controllerRef.current?.setTankDimensions(dims),
        setBackground: (backgroundId) => controllerRef.current?.setBackground(backgroundId),
        resetCamera: () => controllerRef.current?.resetCamera(),
        reset: () => controllerRef.current?.reset(),
      }),
      []
    );

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const controller = new AquariumScene3DController(mount, {
        onCountsChange: (counts) => callbacksRef.current.onCountsChange(counts),
        onSelectionChange: (selected) => callbacksRef.current.onSelectionChange(selected),
        onLightingLoaded: (lighting) => callbacksRef.current.onLightingLoaded?.(lighting),
        onTankDimensionsLoaded: (dims) =>
          callbacksRef.current.onTankDimensionsLoaded?.(dims),
        onBackgroundLoaded: (backgroundId) =>
          callbacksRef.current.onBackgroundLoaded?.(backgroundId),
      });
      controllerRef.current = controller;

      return () => {
        controller.dispose();
        controllerRef.current = null;
      };
    }, []);

    return (
      <div
        ref={mountRef}
        role="application"
        aria-label="Acuario interactivo 3D. Arrastra sobre el cristal para rotar la vista, toca el agua para crear ondas, toca un pez para que huya, o arrastra piedras y plantas 3D para ordenarlas o apilarlas."
        className="w-full h-full bg-black cursor-grab active:cursor-grabbing touch-none select-none"
      />
    );
  }
);
