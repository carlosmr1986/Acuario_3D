import { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        aria-label="Instalar aplicación en el dispositivo"
        className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-white bg-sky-500 hover:bg-sky-400 active:scale-[0.96] border border-sky-300/60 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Instalar</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Cómo instalar en iPhone o iPad"
          className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-white bg-sky-500 hover:bg-sky-400 active:scale-[0.96] border border-sky-300/60 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Instalar</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          >
            <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-white/20 p-5 shadow-2xl text-white">
              <div className="flex items-start justify-between gap-3">
                <h2
                  id="ios-install-title"
                  className="font-display text-base font-semibold text-white"
                >
                  Instalar Acuario 3D en iOS
                </h2>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Cerrar instrucciones"
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-sky-100/90">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-sky-300">1.</span>
                  <span>
                    Pulsa el botón{' '}
                    <strong className="text-white inline-flex items-center gap-1">
                      Compartir <Share className="w-3.5 h-3.5 inline" />
                    </strong>{' '}
                    en la barra de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-sky-300">2.</span>
                  <span>
                    Desliza hacia abajo y elige{' '}
                    <strong className="text-white">
                      Añadir a la pantalla de inicio
                    </strong>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-sky-300">3.</span>
                  <span>
                    Pulsa <strong className="text-white">Añadir</strong> arriba
                    a la derecha.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full min-h-[42px] rounded-lg bg-sky-500 hover:bg-sky-400 text-sm font-semibold text-white transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-3 z-20 flex items-center gap-2 rounded-lg bg-amber-600/95 border border-amber-300/40 px-3 py-1.5 text-xs font-medium text-white shadow-lg pointer-events-none"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Sin conexión · Modo local</span>
    </div>
  );
}
