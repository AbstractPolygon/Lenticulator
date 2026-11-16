/** Injected by Vite from package.json */
declare const __APP_VERSION__: string;

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}

declare module 'gifenc';

/** Bridge exposed by electron/preload.cjs (desktop app only) */
interface LenticulatorHost {
  isDesktop: true;
  platform: string;
  samples: {
    installed(): Promise<boolean>;
    download(onProgress: (done: number, total: number) => void): Promise<void>;
    remove(): Promise<void>;
  };
}
interface Window { lenticulatorHost?: LenticulatorHost }
