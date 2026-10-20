// Mini-polyfills (sem dependências) para Chrome/WebView ~60 (tablet Android 5/6). Importado PRIMEIRO em main.ts.
// Só o que o app usa de fato (ver scripts/qa/compat-scan.mjs e docs/qa/compat-fase3.md); navegador novo não executa nada.
/* eslint-disable @typescript-eslint/no-explicit-any */
const w = (typeof window !== 'undefined' ? window : (self as any)) as any;

// globalThis (Chrome 71): o app e o motor de áudio leem `globalThis.AudioContext` etc.
if (typeof globalThis === 'undefined') w.globalThis = w;

// Array.prototype.flat / flatMap (Chrome 69)
if (!(Array.prototype as any).flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap(this: any[], fn: (v: any, i: number, a: any[]) => any, thisArg?: any): any[] {
      const out: any[] = [];
      for (let i = 0; i < this.length; i++) {
        const r = fn.call(thisArg, this[i], i, this);
        if (Array.isArray(r)) for (let j = 0; j < r.length; j++) out.push(r[j]);
        else out.push(r);
      }
      return out;
    },
  });
}
if (!(Array.prototype as any).flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat(this: any[], depth?: number): any[] {
      const d = depth === undefined ? 1 : depth;
      const out: any[] = [];
      const walk = (a: any[], k: number) => {
        for (let i = 0; i < a.length; i++) {
          if (Array.isArray(a[i]) && k > 0) walk(a[i], k - 1);
          else out.push(a[i]);
        }
      };
      walk(this, d);
      return out;
    },
  });
}

// Promise.prototype.finally (Chrome 63)
if (typeof Promise !== 'undefined' && !(Promise.prototype as any).finally) {
  (Promise.prototype as any).finally = function finallyPoly(this: Promise<any>, fn: () => any) {
    const P = this.constructor as PromiseConstructor;
    return this.then(
      (v) => P.resolve(fn()).then(() => v),
      (e) => P.resolve(fn()).then(() => {
        throw e;
      }),
    );
  };
}

// queueMicrotask (Chrome 71)
if (typeof w.queueMicrotask !== 'function') {
  w.queueMicrotask = (fn: () => void) => {
    Promise.resolve().then(fn).catch((e) => setTimeout(() => {
      throw e;
    }, 0));
  };
}

export {};
