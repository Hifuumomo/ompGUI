import { expect, it } from "vitest";
import { parseSeanceCommand } from "./seance-command";

it("解析带空格的 Windows 会话路径与独立模型，不吞反斜杠", () => {
  expect(parseSeanceCommand('"C:\\Saved sessions\\a.jsonl" --model openai/model')).toEqual({
    source: "C:\\Saved sessions\\a.jsonl", model: "openai/model",
  });
  expect(parseSeanceCommand('--model="provider/model:high" abc123')).toEqual({
    source: "abc123", model: "provider/model:high",
  });
});

it("无源允许打开选择器，非法选项、多源与不完整参数明确失败", () => {
  expect(parseSeanceCommand("")).toEqual({});
  for (const args of ['"unterminated', "one two", "--task summary", "--model", "--model=x --model=y", '""'])
    expect(() => parseSeanceCommand(args)).toThrow();
});
