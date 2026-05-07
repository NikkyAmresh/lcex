/**
 * Curated shiki bundle: only the LeetCode-supported languages and the
 * two VS Code default themes. Cuts ~9MB out of the bundled extension.
 */
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langCpp from "@shikijs/langs/cpp";
import langJava from "@shikijs/langs/java";
import langJavascript from "@shikijs/langs/javascript";
import langPython from "@shikijs/langs/python";
import langTypescript from "@shikijs/langs/typescript";
import themeDarkPlus from "@shikijs/themes/dark-plus";
import themeLightPlus from "@shikijs/themes/light-plus";

let cached: HighlighterCore | null = null;

function getHighlighter(): HighlighterCore {
  if (cached) return cached;
  cached = createHighlighterCoreSync({
    themes: [themeDarkPlus, themeLightPlus],
    langs: [langTypescript, langJavascript, langPython, langCpp, langJava],
    engine: createJavaScriptRegexEngine(),
  });
  return cached;
}

export function highlightCode(code: string, lang: string, theme: string): string {
  return getHighlighter().codeToHtml(code, { lang, theme });
}
