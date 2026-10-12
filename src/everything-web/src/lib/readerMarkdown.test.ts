import { expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderAnswerMarkdown } from "./readerMarkdown";

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderAnswerMarkdown(text)));

test("paragraphs and bullet lists", () => {
  expect(html("Why 20%:\n- grid build-out is slow\n* permits take years\n\nSecond paragraph\nwith a wrapped line."))
    .toBe("<p>Why 20%:</p><ul><li>grid build-out is slow</li><li>permits take years</li></ul><p>Second paragraph\nwith a wrapped line.</p>");
  expect(html("- first\n  continued\nAfter the list")).toBe("<ul><li>first continued</li></ul><p>After the list</p>");
  expect(html("")).toBe("");
});

test("bold and https links open in a new tab", () => {
  expect(html("**Short answer:** see [the IEA](https://www.iea.org/report) and **[Wikipedia](https://en.wikipedia.org/wiki/Grid_(electricity))**."))
    .toBe('<p><strong>Short answer:</strong> see <a href="https://www.iea.org/report" target="_blank" rel="noopener noreferrer">the IEA</a> and <strong><a href="https://en.wikipedia.org/wiki/Grid_(electricity)" target="_blank" rel="noopener noreferrer">Wikipedia</a></strong>.</p>');
});

test("other links and markup stay as plain, escaped text", () => {
  expect(html("[click](javascript:alert(1)) [plain](http://example.com) <b>x</b> *not bold*"))
    .toBe("<p>[click](javascript:alert(1)) [plain](http://example.com) &lt;b&gt;x&lt;/b&gt; *not bold*</p>");
});
