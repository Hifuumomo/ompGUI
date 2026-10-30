// @vitest-environment node
import type { WebContents } from "electron";
import { beforeEach, expect, it, vi, type Mock } from "vitest";
import type { PageRegionSelection } from "./browser-context";

const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), finish: vi.fn(), create: vi.fn(),
}));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: boundary.create } }));
vi.mock("./browser-context", () => ({ prepareRegionCapture: boundary.prepare, finishRegionCapture: boundary.finish }));
import { captureBrowserRegion, cancelRegionCapture } from "./browser-region-capture";

const selection: PageRegionSelection = {
  requestId: "capture_request", captureRevision: 1,
  rect: { x: 10.25, y: 20.25, width: 30.5, height: 40.5 },
  viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, visualScale: 1, visualOffsetX: 0, visualOffsetY: 0 },
};
interface TestImage {
  isEmpty: Mock<() => boolean>;
  getSize: Mock<() => { width: number; height: number }>;
  toPNG: Mock<() => Buffer>;
  crop: Mock<(rect: { width: number; height: number }) => TestImage>;
  resize: Mock<(size: { width: number; height: number }) => TestImage>;
}
function image(width: number, height: number): TestImage {
  return {
    isEmpty: vi.fn(() => false), getSize: vi.fn(() => ({ width, height })),
    toPNG: vi.fn(() => Buffer.from("real-boundary-png")),
    crop: vi.fn((rect: { width: number; height: number }) => image(rect.width, rect.height)),
    resize: vi.fn((size: { width: number; height: number }) => image(size.width, size.height)),
  };
}
function page() {
  return { isDestroyed: vi.fn(() => false), capturePage: vi.fn(async () => image(200, 200)) };
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.prepare.mockImplementation(async (_contents, value) => value);
  boundary.finish.mockResolvedValue(true);
  boundary.create.mockImplementation(() => image(200, 200));
});

it("uses actual pixels, floors top-left and ceils bottom-right, returns immutable PNG attachment", async () => {
  const bitmap = image(200, 200); boundary.create.mockReturnValue(bitmap);
  const result = await captureBrowserRegion(page() as unknown as WebContents, selection, () => true);
  expect(bitmap.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 62, height: 82 });
  expect(result).toEqual({ mimeType: "image/png", data: Buffer.from("real-boundary-png").toString("base64"), width: 62, height: 82 });
  expect(boundary.finish).toHaveBeenCalledWith(expect.anything(), selection);
});

it("rejects partial or mismatched capture rather than shifting the selection", async () => {
  boundary.create.mockReturnValue(image(200, 100));
  await expect(captureBrowserRegion(page() as unknown as WebContents, selection, () => true)).rejects.toThrow("尺寸不匹配");
  expect(boundary.finish).toHaveBeenCalledWith(expect.anything(), selection, true);
});

it("rejects empty native captures and releases its hidden layers", async () => {
  const contents = page();
  const empty = image(200, 200); empty.isEmpty.mockReturnValue(true);
  contents.capturePage.mockResolvedValue(empty);
  await expect(captureBrowserRegion(contents as unknown as WebContents, selection, () => true)).rejects.toThrow("截图为空");
  expect(boundary.finish).toHaveBeenCalledWith(contents, selection, true);
});

it("cancellation while capturePage is running discards late pixels", async () => {
  const contents = page(), deferred = Promise.withResolvers<TestImage>();
  contents.capturePage.mockReturnValue(deferred.promise);
  const result = captureBrowserRegion(contents as unknown as WebContents, selection, () => true);
  await Promise.resolve(); await Promise.resolve();
  cancelRegionCapture(contents as unknown as WebContents);
  deferred.resolve(image(200, 200));
  await expect(result).rejects.toThrow("页面已变化");
  expect(boundary.create).not.toHaveBeenCalled();
});

it("scope/navigation/visibility revocation before capture never reads pixels", async () => {
  const contents = page();
  await expect(captureBrowserRegion(contents as unknown as WebContents, selection, () => false)).rejects.toThrow("页面已变化");
  expect(contents.capturePage).not.toHaveBeenCalled();
});

it("limits screenshot area and longest dimension without enlarging the crop", async () => {
  const bitmap = image(10000, 10000); boundary.create.mockReturnValue(bitmap);
  const full: PageRegionSelection = { ...selection, rect: { x: 0, y: 0, width: 100, height: 100 } };
  const result = await captureBrowserRegion(page() as unknown as WebContents, full, () => true);
  expect(result.width).toBe(2048); expect(result.height).toBe(2048);
});

it("final layout revision rejection cannot publish pixels", async () => {
  boundary.finish.mockResolvedValue(false);
  await expect(captureBrowserRegion(page() as unknown as WebContents, selection, () => true)).rejects.toThrow("页面已变化");
});
