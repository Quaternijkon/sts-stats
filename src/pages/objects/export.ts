import { platform } from "../../services/platform";
import { analysisClient } from "../../worker/client";
import type { GameVersion } from "../../services/models";

export async function exportJson(name: string, value: unknown, game: GameVersion) {
  try {
    const text = await analysisClient(game).call<string>({ op: "serializeJson", value });
    return await platform.exportText(name, text);
  } catch (error) {
    window.dispatchEvent(new CustomEvent("sts2stats:error", { detail: String(error) }));
    return false;
  }
}

export async function exportCsv(name: string, headers: unknown[], rows: unknown[][], game: GameVersion) {
  try {
    const text = await analysisClient(game).call<string>({ op: "serializeCsv", headers, rows });
    return await platform.exportText(name, text);
  } catch (error) {
    window.dispatchEvent(new CustomEvent("sts2stats:error", { detail: String(error) }));
    return false;
  }
}

/** Rasterize the same standalone SVG used by the vector export. */
export async function exportSvgPng(name: string, svg: string) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const width = Number(root.getAttribute("width"));
  const height = Number(root.getAttribute("height"));
  if (root.localName !== "svg" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("图表尺寸无效");
  }
  // Bound both axes and total pixels before decoding the SVG image.
  const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(16_777_216 / (width * height)));
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale));
  root.setAttribute("viewBox", root.getAttribute("viewBox") ?? `0 0 ${width} ${height}`);
  root.setAttribute("width", String(outputWidth));
  root.setAttribute("height", String(outputHeight));
  const boundedSvg = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([boundedSvg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图表画布");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("无法生成图表 PNG")),
        "image/png",
      ),
    );
    return await platform.exportBinary(name, Array.from(new Uint8Array(await blob.arrayBuffer())));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function printArena() {
  document.documentElement.dataset.printArena = "true";
  window.addEventListener("afterprint", () => {
    delete document.documentElement.dataset.printArena;
  }, { once: true });
  window.print();
}
