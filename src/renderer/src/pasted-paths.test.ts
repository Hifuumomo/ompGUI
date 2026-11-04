import { afterEach, expect, it, vi } from "vitest";
import { formatPastedPaths, insertIntoTextarea, padInsertion, pastedFilePaths, quotePath } from "./pasted-paths";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "execCommand");
});

/** 构造只含所需字段的剪贴板数据。[in] types：数据类型；[in] names：文件名。返回值：DataTransfer 替身。 */
function clipboard(types: string[], names: string[]): DataTransfer {
  return { types, files: names.map((name) => new File([], name)) } as unknown as DataTransfer;
}

it.each([
  ["C:\\a.txt", "C:\\a.txt"],
  ["D:\\My Files\\r.docx", '"D:\\My Files\\r.docx"'],
  ['/tmp/a "b".txt', `'/tmp/a "b".txt'`],
  ["C:\\a\tb.txt", '"C:\\a\tb.txt"'],
])("quotePath：%s", (path, expected) => {
  expect(quotePath(path)).toBe(expected);
});

it("formatPastedPaths 按顺序用空格连接，空数组返回空串", () => {
  expect(formatPastedPaths(["C:\\a.txt", "C:\\b c.txt", "C:\\dir"])).toBe('C:\\a.txt "C:\\b c.txt" C:\\dir');
  expect(formatPastedPaths([])).toBe("");
});

it.each([
  ["x", "", "", "x"],
  ["x", "看一下", "", " x"],
  ["x", "看一下 ", "", "x"],
  ["x", "看一下\n", "", "x"],
  ["x", "", "后文", "x "],
  ["x", "前", " 后", " x"],
])("padInsertion：%s | %s | %s", (text, before, after, expected) => {
  expect(padInsertion(text, before, after)).toBe(expected);
});

it("pastedFilePaths：含 text/plain 时不干预", () => {
  expect(pastedFilePaths(clipboard(["text/plain", "Files"], ["a.txt"]), () => "C:\\a.txt")).toBeUndefined();
});

it("pastedFilePaths：只有 files 时返回路径", () => {
  expect(pastedFilePaths(clipboard(["Files"], ["a.txt", "b.txt"]), (file) => `C:\\${file.name}`)).toEqual(["C:\\a.txt", "C:\\b.txt"]);
});

it("pastedFilePaths：全部取不到路径时不干预，部分取不到时只保留有路径的", () => {
  expect(pastedFilePaths(clipboard(["Files"], ["a.png"]), () => "")).toBeUndefined();
  expect(pastedFilePaths(clipboard(["Files"], ["a.png", "b.txt"]), (file) => (file.name === "b.txt" ? "C:\\b.txt" : ""))).toEqual(["C:\\b.txt"]);
});

/** 创建带选区的文本域。[in] value：内容；[in] start：选区起点；[in] end：选区终点。返回值：已挂载的文本域。 */
function textarea(value: string, start: number, end: number) {
  const element = document.createElement("textarea");
  document.body.append(element);
  element.value = value;
  element.setSelectionRange(start, end);
  return element;
}

it("insertIntoTextarea：回退路径替换选区、补空格、光标落在末尾并同步草稿", () => {
  const element = textarea("看一下旧内容后", 3, 6);
  const sync = vi.fn();
  insertIntoTextarea(element, "C:\\a.txt", sync);
  expect(element.value).toBe("看一下 C:\\a.txt 后");
  expect(element.selectionStart).toBe("看一下 C:\\a.txt ".length);
  expect(sync).toHaveBeenCalledWith(element);
  element.remove();
});

it("insertIntoTextarea：execCommand 成功时不调用 sync", () => {
  const element = textarea("", 0, 0);
  const sync = vi.fn();
  const exec = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  insertIntoTextarea(element, "C:\\a.txt", sync);
  expect(exec).toHaveBeenCalledWith("insertText", false, "C:\\a.txt");
  expect(sync).not.toHaveBeenCalled();
  element.remove();
});

it("insertIntoTextarea：execCommand 返回 false 时走回退", () => {
  const element = textarea("", 0, 0);
  const sync = vi.fn();
  Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
  insertIntoTextarea(element, "C:\\a.txt", sync);
  expect(element.value).toBe("C:\\a.txt");
  expect(sync).toHaveBeenCalledOnce();
  element.remove();
});
