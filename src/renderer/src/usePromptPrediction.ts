import { useEffect, useRef, useState } from "react";
import type { SessionView } from "./session";

const STORAGE_KEY = "omp-desktop.composer-predictions";

/** 提示词预测开关；与原生 composer.predictions 一样默认关闭，仅保存在本机。 */
export function usePromptPredictionSetting() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      /* 存储不可用时保留本次窗口设置。 */
    }
  }, [enabled]);
  return { enabled, setEnabled };
}

/**
 * 复刻原生 composer prediction：回合正常结束且输入框为空时请求一次预测，
 * 仅在该回复仍是最后一条消息、输入框为空且没有新回合时显示。
 * @param options [in] enabled：用户开关；connected：已连接原生会话；view：会话视图；draft：当前草稿。
 * @returns 可显示的预测文本；不可用时为 undefined。
 */
export function usePromptPrediction({
  enabled,
  connected,
  view,
  draft,
}: {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly view: SessionView;
  readonly draft: string;
}): string | undefined {
  const [prediction, setPrediction] = useState<{
    readonly text: string;
    readonly anchor: string;
  }>();
  const wasBusy = useRef(view.busy);
  const last = view.messages.at(-1);
  // 只在忙碌→空闲的边沿评估请求条件；草稿等其他状态以该时刻为准。
  const request = useRef({ enabled, connected, draft, last });
  request.current = { enabled, connected, draft, last };

  useEffect(() => {
    const ended = wasBusy.current && !view.busy;
    wasBusy.current = view.busy;
    if (view.busy) {
      setPrediction(undefined);
      return;
    }
    const { enabled, connected, draft, last } = request.current;
    if (!ended || !enabled || !connected || draft || !last) return;
    const message = last.message;
    if (
      message.role !== "assistant" ||
      message.stopReason === "error" ||
      message.stopReason === "aborted"
    )
      return;
    let active = true;
    const anchor = last.key;
    window.desktop.predictPrompt().then(
      (text) => {
        if (active && text) setPrediction({ text, anchor });
      },
      () => {
        /* 预测是可选辅助；失败时保持普通占位提示。 */
      },
    );
    return () => {
      active = false;
    };
  }, [view.busy]);

  return prediction &&
    enabled &&
    connected &&
    !view.busy &&
    !draft &&
    prediction.anchor === last?.key
    ? prediction.text
    : undefined;
}
