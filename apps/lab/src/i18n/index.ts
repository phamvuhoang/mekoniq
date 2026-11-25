import type { Locale } from "../shared/types";
export let locale: Locale =
  ((typeof localStorage==='undefined'?null:localStorage.getItem("mekoniq-locale")) as Locale) || "vi";
if (!["vi", "ja", "en"].includes(locale)) locale = "vi";
export function setLocale(value: Locale): void {
  locale = value;
  localStorage.setItem("mekoniq-locale", value);
  document.documentElement.lang = value;
}
export function tr(vi: string, ja: string, en: string): string {
  return [vi, ja, en][["vi", "ja", "en"].indexOf(locale)]!;
}
