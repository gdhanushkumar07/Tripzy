/**
 * Custom Vitest environment that extends jsdom but preserves the native
 * Node.js AbortController and AbortSignal.
 *
 * Problem 1: jsdom replaces globalThis.AbortController and AbortSignal with its
 * own implementations. Node.js's undici-based fetch validates signals via
 * `signal instanceof AbortSignal` against its own native class reference.
 * jsdom's AbortSignal instances fail this check, causing fetch to throw:
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an
 *   instance of AbortSignal.
 * Fix: after jsdom installs its globals, restore the native AbortController
 * and AbortSignal so fetch works correctly in tests.
 *
 * Problem 2 (Node 22+ experimental Web Storage): Node now exposes its own
 * `localStorage`/`sessionStorage` globals, inert unless `--localstorage-file`
 * is passed. Vitest's global-populate skips any key already present on the
 * global that isn't in its own allow-list, and Storage isn't in it — so
 * jsdom's working Storage never overwrites Node's inert one and every test
 * throws on `localStorage.clear()`. Fix: delete Node's shadow globals before
 * jsdom setup runs, so vitest copies jsdom's Storage across.
 */

import { builtinEnvironments } from 'vitest/runtime';

const jsdomEnv = builtinEnvironments.jsdom;

export default {
  name: 'jsdom-native-abort',
  viteEnvironment: 'client' as const,

  async setup(global: typeof globalThis, options: Record<string, unknown>) {
    // Capture native AbortController/AbortSignal BEFORE jsdom patches them
    const NativeAbortController = global.AbortController;
    const NativeAbortSignal = global.AbortSignal;

    // Clear Node's inert Web Storage globals so jsdom's win, not this shadow.
    delete (global as { localStorage?: unknown }).localStorage;
    delete (global as { sessionStorage?: unknown }).sessionStorage;

    // Run standard jsdom setup (installs jsdom globals, including its own AbortController)
    const env = await jsdomEnv.setup(global, options as Parameters<typeof jsdomEnv.setup>[1]);

    // Restore native AbortController so Node.js fetch (undici) accepts the signals
    global.AbortController = NativeAbortController;
    global.AbortSignal = NativeAbortSignal;

    // MSW converts XHR multipart bodies into Node Request objects. Node's
    // encoder needs Blob.stream(), which jsdom's File/Blob do not implement.
    // Keep jsdom objects (FileReader and file inputs require them), but supply
    // the standard byte-reading methods so uploads cannot hang in MSW.
    if (!global.Blob.prototype.arrayBuffer) {
      global.Blob.prototype.arrayBuffer = function () {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new global.FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      };
    }
    if (!global.Blob.prototype.stream) {
      global.Blob.prototype.stream = function () {
        const blob = this;
        return new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
              controller.close();
            } catch (error) { controller.error(error); }
          },
        });
      };
    }
    if (!global.Blob.prototype.text) {
      global.Blob.prototype.text = async function () {
        return new TextDecoder().decode(await this.arrayBuffer());
      };
    }

    return env;
  },
};
