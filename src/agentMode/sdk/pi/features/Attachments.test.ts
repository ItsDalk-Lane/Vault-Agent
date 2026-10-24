import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_RECEIPT_PATTERN,
  AttachmentError,
  Attachments,
  type AttachmentPorts,
  type ModelImageCapability,
} from "@/agentMode/sdk/pi/features/Attachments";
import { sha256 } from "@/utils/hash";

// Attachments keep MIME and blobRef or a controlled vault path, verify scope and size on every read,
// are handed to a model only when it really accepts that image type, export through the existing
// receipt format so a reload restores them, and a missing attachment leaves a placeholder instead of
// blocking the rest of the history:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeAttachmentPorts implements AttachmentPorts {
  readonly blobs = new Map<string, { mime: string; data: Uint8Array }>();
  readonly files = new Map<string, Uint8Array>();
  readonly allowedPaths = new Set<string>();
  readonly saved: Array<{ attachmentId: string; mime: string; bytes: number }> = [];
  readonly reads: string[] = [];
  capabilities = new Map<string, ModelImageCapability>();
  private nextBlob = 1;

  store = {
    save: async (input: { attachmentId: string; mime: string; data: Uint8Array }) => {
      const blobRef = `blob-${this.nextBlob++}`;
      this.blobs.set(blobRef, { mime: input.mime, data: input.data });
      this.saved.push({
        attachmentId: input.attachmentId,
        mime: input.mime,
        bytes: input.data.byteLength,
      });
      return { blobRef };
    },
    load: async (blobRef: string) => this.blobs.get(blobRef),
  };

  vault = {
    isPathAllowed: (path: string) => this.allowedPaths.has(path),
    read: async (path: string) => {
      this.reads.push(path);
      return this.files.get(path);
    },
  };

  modelCapability = (modelKey: string): ModelImageCapability | undefined =>
    this.capabilities.get(modelKey);
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function harness(): { ports: FakeAttachmentPorts; attachments: Attachments } {
  const ports = new FakeAttachmentPorts();
  ports.capabilities.set("pi/vision", {
    modelKey: "pi/vision",
    acceptsImages: true,
    supportedMime: ["image/png", "image/jpeg"],
    maxImageBytes: 1_000,
    maxImages: 2,
  });
  ports.capabilities.set("pi/text", {
    modelKey: "pi/text",
    acceptsImages: false,
    supportedMime: [],
    maxImageBytes: 0,
    maxImages: 0,
  });
  return { ports, attachments: new Attachments({ ports }) };
}

describe("Attachments", () => {
  describe("Attachments", () => {
    describe("save()", () => {
      it("stores MIME and blobRef and validates the declared size", async () => {
        const { ports, attachments } = harness();

        const record = await attachments.save({
          attachmentId: "a1",
          mime: "image/png",
          data: bytes(1, 2, 3, 4),
          declaredBytes: 4,
        });

        expect(record).toMatchObject({ attachmentId: "a1", mime: "image/png", bytes: 4 });
        expect(record.blobRef).toBe("blob-1");
        expect(ports.saved).toEqual([{ attachmentId: "a1", mime: "image/png", bytes: 4 }]);

        await expect(
          attachments.save({
            attachmentId: "a2",
            mime: "image/png",
            data: bytes(1),
            declaredBytes: 9,
          })
        ).rejects.toMatchObject({ code: "ATTACHMENT_SIZE_MISMATCH" });
        await expect(
          attachments.save({ attachmentId: "a3", mime: "application/pdf", data: bytes(1) })
        ).rejects.toMatchObject({ code: "ATTACHMENT_MIME_UNSUPPORTED" });
        await expect(
          attachments.save({
            attachmentId: "a4",
            mime: "image/png",
            data: new Uint8Array(ATTACHMENT_MAX_BYTES + 1),
          })
        ).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });
      });
    });

    describe("resolve()", () => {
      it("rejects a vault path outside the allowed scopes", async () => {
        const { ports, attachments } = harness();

        const denied = await attachments.resolve({
          attachmentId: "a1",
          mime: "image/png",
          vaultPath: "../outside/secret.png",
          originalPath: "../outside/secret.png",
        });

        expect(denied).toMatchObject({ status: "missing", errorCode: "ATTACHMENT_PATH_DENIED" });
        expect(denied.placeholder).toBe("[missing attachment: ../outside/secret.png]");
        expect(ports.reads).toEqual([]);
      });

      it("reads an allowed vault image and reports a missing one without blocking others", async () => {
        const { ports, attachments } = harness();
        ports.allowedPaths.add("attachments/present.png");
        ports.files.set("attachments/present.png", bytes(9, 9, 9));

        const present = await attachments.resolve({
          attachmentId: "a1",
          mime: "image/png",
          vaultPath: "attachments/present.png",
        });
        const missing = await attachments.resolve({
          attachmentId: "a2",
          mime: "image/png",
          vaultPath: "attachments/gone.png",
          originalPath: "attachments/gone.png",
        });

        expect(present).toMatchObject({ status: "ready" });
        expect(present.record).toMatchObject({ bytes: 3, mime: "image/png" });
        expect(missing).toMatchObject({ status: "missing", errorCode: "ATTACHMENT_PATH_DENIED" });
        expect(ports.reads).toEqual(["attachments/present.png"]);
      });
    });

    describe("toModelMessage()", () => {
      it("puts a real image part into the model message for a vision model", async () => {
        const { attachments } = harness();
        const record = await attachments.save({
          attachmentId: "a1",
          mime: "image/png",
          data: bytes(1, 2, 3),
        });

        const parts = await attachments.toModelMessage({
          modelKey: "pi/vision",
          attachments: [{ attachmentId: "a1", mime: "image/png", blobRef: record.blobRef }],
          text: "What is in this image?",
        });

        expect(parts[0]).toEqual({ type: "text", text: "What is in this image?" });
        expect(parts[1]).toMatchObject({ type: "image", mime: "image/png" });
        expect(Array.from(parts[1]?.data ?? [])).toEqual([1, 2, 3]);
      });

      it("never pretends a text-only model can see the image", async () => {
        const { attachments } = harness();

        const parts = await attachments.toModelMessage({
          modelKey: "pi/text",
          attachments: [{ attachmentId: "a1", mime: "image/png", vaultPath: "attachments/x.png" }],
          text: "Describe it",
        });

        expect(parts).toHaveLength(2);
        expect(parts[1]).toMatchObject({ type: "text" });
        expect(parts[1]?.text).toContain("cannot see images");
        expect(parts.some((part) => part.type === "image")).toBe(false);
      });

      it("omits an unsupported image type and a missing attachment with explicit text", async () => {
        const { ports, attachments } = harness();
        ports.capabilities.set("pi/vision", {
          modelKey: "pi/vision",
          acceptsImages: true,
          supportedMime: ["image/png"],
          maxImageBytes: 1_000,
          maxImages: 2,
        });
        const record = await attachments.save({
          attachmentId: "gif",
          mime: "image/gif",
          data: bytes(1, 2),
        });

        const parts = await attachments.toModelMessage({
          modelKey: "pi/vision",
          attachments: [
            { attachmentId: "gif", mime: "image/gif", blobRef: record.blobRef },
            {
              attachmentId: "gone",
              mime: "image/png",
              vaultPath: "attachments/gone.png",
              originalPath: "attachments/gone.png",
            },
          ],
          text: "Look",
        });

        expect(parts.filter((part) => part.type === "image")).toHaveLength(0);
        expect(JSON.stringify(parts)).toContain("does not accept that type");
        expect(JSON.stringify(parts)).toContain("missing attachment: attachments/gone.png");
      });
    });

    describe("exportReceipts()", () => {
      it("round-trips attachments through the existing receipt format", async () => {
        const { attachments } = harness();
        const blob = await attachments.save({
          attachmentId: "a1",
          mime: "image/png",
          data: bytes(1, 2, 3, 4),
        });

        const text = attachments.exportReceipts([blob]);
        const reloaded = attachments.importReceipts(text);

        expect(ATTACHMENT_RECEIPT_PATTERN.test(text)).toBe(true);
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0]).toMatchObject({
          blobRef: blob.blobRef,
          contentHash: blob.contentHash,
          mime: "image/png",
        });

        const vaultRecord = await attachments.save({
          attachmentId: "a2",
          mime: "image/jpeg",
          data: bytes(5),
        });
        const vaultText = attachments.exportReceipts([
          { ...vaultRecord, vaultPath: "attachments/photo.jpg" },
        ]);
        const vaultReloaded = attachments.importReceipts(vaultText);
        expect(vaultReloaded[0]).toMatchObject({
          vaultPath: "attachments/photo.jpg",
          mime: "image/jpeg",
          contentHash: vaultRecord.contentHash,
        });
        expect(sha256(String.fromCharCode(5))).toBe(vaultRecord.contentHash);
      });

      it("ignores text that carries no receipt", () => {
        const { attachments } = harness();

        expect(attachments.importReceipts("plain history without images")).toEqual([]);
        expect(
          attachments.importReceipts(
            "<!-- vault-agent-image:abc -->\nno\n<!-- /vault-agent-image -->"
          )
        ).toEqual([]);
      });
    });

    describe("AttachmentError", () => {
      it("carries the failing code", () => {
        const error = new AttachmentError("ATTACHMENT_MISSING", "gone");
        expect(error.code).toBe("ATTACHMENT_MISSING");
      });
    });
  });
});
