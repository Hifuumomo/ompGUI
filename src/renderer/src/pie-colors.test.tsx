// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RichContent } from "./RichContent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

const firstSliceGeometry = "M0,-100A100,100,0,0,1,58.779,80.901L0,0Z";
const secondSliceGeometry = "M58.779,80.901A100,100,0,1,1,0,-100L0,0Z";
// Mermaid 12 uses pieCircle for both the outline and slices; legends follow unrelated group siblings.
const pieSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260">
  <g transform="translate(130,130)">
    <circle class="pieCircle" r="102"/>
    <path class="pieCircle" d="${firstSliceGeometry}"/>
    <path class="pieCircle" d="${secondSliceGeometry}"/>
    <text class="slice" x="50" y="-10">40%</text>
    <text class="slice" x="-50" y="10">60%</text>
    <text class="pieTitleText" y="-110">Category distribution</text>
    <g class="title"><text y="-105">A / B</text></g>
    <g class="decoration"><path d="M-100,110L100,110"/></g>
    <g class="legend" transform="translate(120,-20)">
      <rect width="18" height="18"/>
      <text x="22" y="14">A</text>
    </g>
    <g class="legend" transform="translate(120,10)">
      <rect width="18" height="18"/>
      <text x="22" y="14">B</text>
    </g>
  </g>
</svg>`;

/** Create an isolated React consumer. 参数：无。 @returns 返回值：无。 */
function prepareConsumer() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** Unmount and remove the consumer. 参数：无。 @returns Cleanup completion. */
async function cleanConsumer() {
  /** Unmount the React tree. 参数：无。 @returns 返回值：无。 */
  function unmount() {
    root.unmount();
  }
  await act(unmount);
  container.remove();
}

/** Render SVG through the actual fenced-content sanitizer and shadow preview. @param source [in] Untrusted SVG markup. @returns The consumer's rendered SVG. */
async function renderSvg(source: string): Promise<SVGSVGElement> {
  /** Commit the fenced SVG message. 参数：无。 @returns 返回值：无。 */
  function commit() {
    root.render(<RichContent text={`\`\`\`svg\n${source}\n\`\`\``} />);
  }
  await act(commit);
  const preview = container.querySelector(".rich-diagram-preview");
  expect(preview).not.toBeNull();
  const svg = preview!.shadowRoot!.querySelector("svg");
  expect(svg).not.toBeNull();
  return svg!;
}

/** Assert distinct category fills and ordered legend correspondence. @param svg [in] The sanitized SVG shown to the consumer. @returns Ordered category fill attributes. */
function expectCategoryColors(svg: SVGSVGElement): string[] {
  const slices = [...svg.querySelectorAll("path.pieCircle")];
  const legends = [...svg.querySelectorAll("g.legend rect")];
  expect(slices).toHaveLength(2);
  expect(legends).toHaveLength(2);
  const fills: string[] = [];
  // Check actual presentation attributes, not source markup or sibling-sensitive CSS selectors.
  for (let index = 0; index < slices.length; index += 1) {
    const fill = slices[index].getAttribute("fill");
    expect(fill).toBeTruthy();
    expect(fill).not.toBe("none");
    expect(legends[index].getAttribute("fill")).toBe(fill);
    fills.push(fill!);
  }
  expect(fills[0]).not.toBe(fills[1]);
  return fills;
}

beforeEach(prepareConsumer);
afterEach(cleanConsumer);

/** Register sanitized pie presentation regressions. 参数：无。 @returns 返回值：无。 */
function pieColorBoundaries() {
  /** Preserve Mermaid geometry and labels while matching slice and legend colors. 参数：无。 @returns Test completion. */
  async function orderedCategoryColors() {
    const svg = await renderSvg(pieSvg);
    expectCategoryColors(svg);
    const slices = svg.querySelectorAll("path.pieCircle");
    expect(slices[0].getAttribute("d")).toBe(firstSliceGeometry);
    expect(slices[1].getAttribute("d")).toBe(secondSliceGeometry);
    expect(svg.querySelector("circle.pieCircle")?.getAttribute("r")).toBe(
      "102",
    );
    expect(svg.querySelectorAll(".slice")[0].textContent).toBe("40%");
    expect(svg.querySelectorAll(".slice")[1].textContent).toBe("60%");
    expect(svg.querySelectorAll("g.legend text")[0].textContent).toBe("A");
    expect(svg.querySelectorAll("g.legend text")[1].textContent).toBe("B");
    expect(svg.querySelector("g.legend rect")?.getAttribute("width")).toBe(
      "18",
    );
  }
  it(
    "实际 pieCircle 切片使用不同颜色，且图例不受前置无关分组影响",
    orderedCategoryColors,
  );

  /** Ignore untrusted colors and strip active resource styles before app coloring. 参数：无。 @returns Test completion. */
  async function untrustedColorsCannotOverrideMapping() {
    const expectedFills = expectCategoryColors(await renderSvg(pieSvg));
    // All category nodes request the same source color; app-owned mapping must replace it after sanitization.
    const untrustedSvg = pieSvg
      .replaceAll(
        '<path class="pieCircle"',
        '<path class="pieCircle" fill="red" style="fill:url(https://tracker.invalid/paint.svg#color)!important" onclick="alert(1)"',
      )
      .replaceAll(
        '<rect width="18"',
        '<rect fill="red" style="fill:red!important" onmouseover="alert(1)" width="18"',
      );
    const svg = await renderSvg(untrustedSvg);
    expect(expectCategoryColors(svg)).toEqual(expectedFills);
    for (const element of svg.querySelectorAll(
      "path.pieCircle, g.legend rect",
    )) {
      expect(element.hasAttribute("style")).toBe(false);
      expect(element.hasAttribute("onclick")).toBe(false);
      expect(element.hasAttribute("onmouseover")).toBe(false);
      expect(element.getAttribute("fill")).not.toContain("tracker.invalid");
    }
  }
  it(
    "源填色、内联样式和活动属性不能覆盖应用的类别图例映射",
    untrustedColorsCannotOverrideMapping,
  );
}

describe("RichContent 饼图类别配色", pieColorBoundaries);
