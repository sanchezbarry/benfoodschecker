import { MAX_FILE_SIZE_LABEL } from "@/lib/constants";

/**
 * Client-side certificate compression, run just before upload.
 *
 * Scanned and photographed certificates are usually several megabytes of
 * redundant pixels — far more resolution than anyone needs to read an expiry
 * date. Downscaling and re-encoding typically takes a 4 MB phone photo to a few
 * hundred KB with no meaningful loss of legibility.
 */

/** Longest edge kept, in pixels. A4 at ~180dpi, comfortably readable. */
export const MAX_IMAGE_EDGE = 2000;

/** WEBP quality. 0.82 keeps small text crisp while shedding most of the bulk. */
export const IMAGE_QUALITY = 0.82;

const COMPRESSIBLE_IMAGES = ["image/png", "image/jpeg", "image/webp"];

/**
 * PDFs below this are left completely alone. Measured against a real sample of
 * nine certificates, everything under ~2 MB was either born-digital or an
 * already well-compressed single page — nothing worth touching, and leaving
 * them untouched preserves their selectable text.
 */
export const PDF_COMPRESS_THRESHOLD = 3 * 1024 * 1024;

/** Rasterisation resolution. 150dpi stays comfortably readable for a scan. */
export const PDF_TARGET_DPI = 150;

const PDF_JPEG_QUALITY = 0.7;

/** Refuse to grind through a pathological document and freeze the tab. */
const PDF_MAX_PAGES = 60;

/** Below this saving, keep the original — not worth flattening the text away. */
const PDF_MIN_SAVING = 0.2;

export type CompressionResult = {
  file: File;
  /** Human-readable note when the file actually shrank, else null. */
  note: string | null;
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function withExtension(name: string, extension: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "certificate"}.${extension}`;
}

/**
 * Shrink an image certificate. Returns the original untouched if it isn't a
 * raster image, if the browser can't decode it, or if re-encoding didn't
 * actually make it smaller (already-optimised files often don't).
 */
export async function compressCertificate(file: File): Promise<CompressionResult> {
  if (file.type === "application/pdf") return compressPdf(file);
  if (!COMPRESSIBLE_IMAGES.includes(file.type)) return { file, note: null };

  let bitmap: ImageBitmap;
  try {
    // `from-image` honours the EXIF orientation phone cameras write, so a
    // photo taken sideways doesn't get baked in rotated.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { file, note: null }; // corrupt or unsupported — let the server judge it
  }

  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { file, note: null };
  }

  // Flatten onto white: a PNG scan with a transparent background would
  // otherwise come out black once the alpha channel is dropped.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", IMAGE_QUALITY),
  );

  // Keep whichever is smaller — re-encoding a tiny or already-optimised image
  // can easily produce a bigger file.
  if (!blob || blob.size >= file.size) return { file, note: null };

  return {
    file: new File([blob], withExtension(file.name, "webp"), {
      type: "image/webp",
      lastModified: Date.now(),
    }),
    note: `Compressed ${formatSize(file.size)} → ${formatSize(blob.size)}.`,
  };
}

/**
 * Shrink a large scanned PDF by re-rendering each page at a sane resolution.
 *
 * Certificates arrive scanned at 600–768dpi, several times more than anyone
 * needs to read an expiry date, which is how a 14-page bundle reaches 17 MB.
 * Re-rendering at ${PDF_TARGET_DPI}dpi and re-encoding as JPEG typically sheds
 * about three quarters of that.
 *
 * This flattens the document to images, so any selectable text is lost. That is
 * why it only runs above PDF_COMPRESS_THRESHOLD — below it, born-digital
 * certificates keep their text layer untouched — and why the result is thrown
 * away unless it saves something worthwhile.
 *
 * pdf.js and pdf-lib are imported lazily, so neither reaches the bundle unless
 * someone actually picks a big PDF.
 */
async function compressPdf(file: File): Promise<CompressionResult> {
  if (file.size <= PDF_COMPRESS_THRESHOLD) return { file, note: null };

  try {
    const [pdfjs, { PDFDocument }] = await Promise.all([
      import("pdfjs-dist"),
      import("pdf-lib"),
    ]);

    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const source = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;

    if (source.numPages > PDF_MAX_PAGES) return { file, note: null };

    const output = await PDFDocument.create();
    const scale = PDF_TARGET_DPI / 72; // PDF user space is 72dpi

    for (let n = 1; n <= source.numPages; n++) {
      const page = await source.getPage(n);
      const viewport = page.getViewport({ scale });
      const points = page.getViewport({ scale: 1 });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return { file, note: null };

      // Scans are opaque, but a PDF page has no inherent background — without
      // this, transparent areas encode as black in JPEG.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;

      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", PDF_JPEG_QUALITY),
      );
      if (!jpeg) return { file, note: null };

      // Re-add at the original point size so the page still prints to scale.
      const embedded = await output.embedJpg(await jpeg.arrayBuffer());
      output
        .addPage([points.width, points.height])
        .drawImage(embedded, {
          x: 0,
          y: 0,
          width: points.width,
          height: points.height,
        });
    }

    const bytes = await output.save();
    if (bytes.byteLength > file.size * (1 - PDF_MIN_SAVING))
      return { file, note: null };

    return {
      file: new File([bytes as unknown as BlobPart], file.name, {
        type: "application/pdf",
        lastModified: Date.now(),
      }),
      note: `Compressed ${formatSize(file.size)} → ${formatSize(bytes.byteLength)} (rescanned at ${PDF_TARGET_DPI}dpi, so text is no longer selectable).`,
    };
  } catch {
    // Encrypted, malformed, or simply too big to render — upload it as it is.
    return { file, note: null };
  }
}

/** Shown on the upload forms so the behaviour isn't a surprise. */
export const COMPRESSION_HINT = `Photos and scans are resized before upload, and PDFs over ${Math.round(PDF_COMPRESS_THRESHOLD / 1024 / 1024)} MB are re-rendered at ${PDF_TARGET_DPI}dpi. Anything up to ${MAX_FILE_SIZE_LABEL} is accepted.`;
