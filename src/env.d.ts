/** Injected by Vite from package.json */
declare const __APP_VERSION__: string;

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}
