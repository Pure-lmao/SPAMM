import { domToBlob } from "modern-screenshot";

function keepInBetImage(el: Node): boolean {
   if (!(el instanceof Element)) {
      return true;
   }
   return !el.classList.contains("my-bets-card__share") && !el.classList.contains("bet-modal-overlay");
}

function renderBetCardPng(node: HTMLElement): Promise<Blob> {
   const backgroundColor = getComputedStyle(node).backgroundColor;
   return domToBlob(node, {
      type: "image/png",
      scale: 2,
      backgroundColor,
      filter: keepInBetImage,
   }).then((blob) => (blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" })));
}

/** Copy a PNG of the bet card. Starts the clipboard write immediately so the browser still treats it as the click. */
export function copyBetCardImage(node: HTMLElement): Promise<void> {
   const clipboard = navigator.clipboard;
   if (clipboard == null || typeof ClipboardItem === "undefined") {
      return Promise.reject(new Error("clipboard"));
   }
   const pngPromise = renderBetCardPng(node);
   try {
      const item = new ClipboardItem({ "image/png": pngPromise });
      return clipboard.write([item]).catch(async () => {
         const png = await pngPromise;
         await clipboard.write([new ClipboardItem({ "image/png": png })]);
      });
   } catch {
      return pngPromise.then((png) => clipboard.write([new ClipboardItem({ "image/png": png })]));
   }
}
