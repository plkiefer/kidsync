import { NextRequest, NextResponse } from "next/server";

// Polyfill DOMMatrix for pdfjs-dist in Node.js/Vercel serverless
if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    is2D = true;
    isIdentity = true;
    constructor(init?: any) {
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
      }
    }
  };
}

/** Extract text from a PDF buffer using pdfjs-dist directly */
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Pre-load the worker module and inject via globalThis so pdfjs-dist
  // uses it directly instead of trying a dynamic import of ./pdf.worker.mjs
  // (which fails in Vercel's serverless bundle)
  // @ts-ignore — no type declarations for the worker module
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as any).pdfjsWorker = pdfjsWorker;

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
    .promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item: any) => "str" in item)
      .map((item: any) => item.str)
      .join(" ");
    pages.push(pageText);
    page.cleanup();
  }

  await doc.destroy();
  return pages.join("\n\n");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (ext === "pdf") {
      text = await extractPdfText(buffer);
    } else if (ext === "docx" || ext === "doc") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === "txt") {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext}` },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract any text from the document" },
        { status: 400 }
      );
    }

    return NextResponse.json({ text });
  } catch (err: any) {
    console.error("[custody/extract] error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to extract text" },
      { status: 500 }
    );
  }
}
